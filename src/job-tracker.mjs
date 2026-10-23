import { randomUUID } from "node:crypto";

// Records video jobs and topic progress in Supabase (tables from supabase/migrations). Tracking is
// optional: without credentials every call is skipped, and a failed status update only produces a
// warning, so it can never turn a rendered video into a failed run or hide the run's own error.

export const JOB_STATUSES = ["queued", "running", "succeeded", "failed", "dispatch_failed"];
export const TOPIC_STATUSES = ["queued", "dispatching", "dispatched", "completed", "failed", "paused"];
export const STYLES = ["explainer", "documentary", "myth-busting", "practical"];

// Which current statuses the workflow may move a row from, for each status it writes. Any status may
// become "running" because re-running an Actions run reuses its job. queued and dispatch_failed are
// accepted as starting points because the run is what actually happened, even if Make reported the
// dispatch as failed. The workflow never writes queued, dispatching, or dispatch_failed itself.
export const JOB_ALLOWED_FROM = {
  running: [...JOB_STATUSES],
  succeeded: ["queued", "dispatch_failed", "running"],
  failed: ["queued", "dispatch_failed", "running"]
};
// A paused topic is left alone, and a completed topic is never marked failed by a later re-run.
export const TOPIC_ALLOWED_FROM = {
  dispatched: ["queued", "dispatching", "dispatched", "failed"],
  completed: ["dispatching", "dispatched", "failed"],
  failed: ["dispatching", "dispatched"]
};
export const canTransition = (allowed, from, to) => Boolean(allowed[to]?.includes(from));

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const isUuid = (value) => UUID.test(String(value || ""));

export const trackerPolicy = { attempts: 2, delayMs: 1000, timeoutMs: 15000 };
const MAX_ERROR = 1000;

// Credentials come from the environment only. SUPABASE_SECRET_KEY (sb_secret_...) is preferred; the
// legacy service_role JWT is accepted for projects that have not created a secret key yet.
export function trackerConfig(env = process.env) {
  const url = String(env.SUPABASE_URL || "").trim().replace(/\/+$/, "");
  const key = String(env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  if (!url || !key) return { enabled: false, reason: "SUPABASE_URL or SUPABASE_SECRET_KEY is not set" };
  if (!/^https:\/\/[^/\s]+$/.test(url)) return { enabled: false, reason: "SUPABASE_URL must be the https project URL with no path" };
  return { enabled: true, url, key, legacy: key.startsWith("eyJ") };
}

// New secret keys are not JWTs and belong only on the apikey header; a legacy service_role JWT is also
// sent as the bearer token.
export function supabaseHeaders(config) {
  const headers = { apikey: config.key, "content-type": "application/json", accept: "application/json", prefer: "return=representation" };
  if (config.legacy) headers.authorization = "Bearer " + config.key;
  return headers;
}

const SECRET_PATTERNS = [
  /sb_(secret|publishable)_[\w-]+/g, /eyJ[\w-]+\.[\w-]+\.[\w-]+/g, /github_pat_\w+/g, /\bgh[pousr]_\w{20,}/g,
  /AIza[\w-]{30,}/g, /tvly-[\w-]+/g, /(bearer|apikey[=:]?)\s+\S+/gi
];
// Error text stored in the database or printed as a warning: known secret values and anything shaped
// like a key are removed, and the length is capped.
export function redact(text, secrets = []) {
  let clean = String(text ?? "");
  for (const secret of secrets) if (secret && secret.length >= 8) clean = clean.split(secret).join("[redacted]");
  for (const pattern of SECRET_PATTERNS) clean = clean.replace(pattern, "[redacted]");
  return clean.length > MAX_ERROR ? clean.slice(0, MAX_ERROR - 1) + "…" : clean;
}
export const secretValues = (env = process.env) =>
  ["SUPABASE_SECRET_KEY", "SUPABASE_SERVICE_ROLE_KEY", "GEMINI_API_KEY", "TAVILY_API_KEY"].map((name) => env[name]).filter(Boolean);

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export class TrackingError extends Error {
  constructor(message, { status, code } = {}) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

// A minimal PostgREST client. Network errors, 429, and 5xx are retried once; every request is
// idempotent (filtered PATCH, GET, or an INSERT with an explicit id that conflicts on repeat).
export function createTracker(config, secrets = []) {
  async function request(method, pathAndQuery, body) {
    let last;
    for (let attempt = 1; attempt <= trackerPolicy.attempts; attempt += 1) {
      try {
        const response = await fetch(config.url + "/rest/v1/" + pathAndQuery, {
          method, headers: supabaseHeaders(config), body: body === undefined ? undefined : JSON.stringify(body),
          signal: AbortSignal.timeout(trackerPolicy.timeoutMs)
        });
        const text = await response.text();
        if (response.ok) return text ? JSON.parse(text) : [];
        let detail = {};
        try { detail = JSON.parse(text); } catch { detail = { message: text }; }
        last = new TrackingError(redact("Supabase " + method + " " + pathAndQuery.split("?")[0] + " returned HTTP "
          + response.status + ": " + (detail.message || "") + (detail.details ? " (" + detail.details + ")" : ""), [config.key, ...secrets]),
        { status: response.status, code: detail.code });
        if (response.status !== 429 && response.status < 500) break;
      } catch (error) {
        if (error instanceof TrackingError) throw error;
        last = new TrackingError(redact("Supabase " + method + " request failed: " + error.message, [config.key, ...secrets]));
      }
      if (attempt < trackerPolicy.attempts) await wait(trackerPolicy.delayMs);
    }
    throw last;
  }

  const inList = (statuses) => "in.(" + statuses.join(",") + ")";

  // Updates the job if its current status allows the move; creates it if it does not exist yet.
  async function writeJob(id, status, fields) {
    const updated = await request("PATCH", "video_jobs?id=eq." + id + "&status=" + inList(JOB_ALLOWED_FROM[status]), { ...fields, status });
    if (updated.length) return { action: "updated", row: updated[0] };
    const existing = await request("GET", "video_jobs?id=eq." + id + "&select=status");
    if (existing.length) return { action: "skipped", reason: "job is " + existing[0].status + ", which cannot change to " + status };
    try {
      const created = await request("POST", "video_jobs", { id, ...fields, status });
      return { action: "created", row: created[0] };
    } catch (error) {
      if (error.code === "23505") return { action: "skipped", reason: "job was created by another writer at the same time" };
      throw error;
    }
  }

  return {
    request,
    // An unknown topic_id (deleted or mistyped) must not stop the job itself from being recorded.
    async recordJob(id, status, fields) {
      try {
        return await writeJob(id, status, fields);
      } catch (error) {
        if (error.code !== "23503" || !fields.topic_id) throw error;
        const { topic_id: _unused, ...rest } = fields;
        const result = await writeJob(id, status, rest);
        return { ...result, warning: "topic " + fields.topic_id + " does not exist; the job was recorded without it" };
      }
    },
    async updateTopic(id, status, fields) {
      const updated = await request("PATCH", "content_topics?id=eq." + id + "&status=" + inList(TOPIC_ALLOWED_FROM[status]), { ...fields, status });
      if (updated.length) return { action: "updated", row: updated[0] };
      const existing = await request("GET", "content_topics?id=eq." + id + "&select=status");
      return { action: "skipped", reason: existing.length ? "topic is " + existing[0].status + ", which cannot change to " + status : "topic not found" };
    }
  };
}

// The run as GitHub Actions describes it, read from the environment.
export function runContext(env = process.env) {
  const runId = /^\d+$/.test(env.GITHUB_RUN_ID || "") ? Number(env.GITHUB_RUN_ID) : null;
  const style = String(env.VIDEO_STYLE || "").trim();
  return {
    jobId: env.VIDEO_JOB_ID || null,
    topicId: String(env.VIDEO_TOPIC_ID || "").trim() || null,
    runId,
    runUrl: runId && env.GITHUB_REPOSITORY ? (env.GITHUB_SERVER_URL || "https://github.com") + "/" + env.GITHUB_REPOSITORY + "/actions/runs/" + runId : null,
    runAttempt: Number(env.GITHUB_RUN_ATTEMPT) || 1,
    resumeFrom: String(env.RESUME_FROM_RUN || "").trim() || null,
    topic: String(env.VIDEO_TOPIC || "").trim().slice(0, 240) || null,
    style: STYLES.includes(style) ? style : null,
    language: String(env.VIDEO_LANGUAGE || "").trim() || null,
    presenter: env.VIDEO_MASCOT ? env.VIDEO_MASCOT !== "off" : null
  };
}

// Uses the scheduler's job ID when one was supplied, otherwise creates one for this manual run.
// A malformed ID stops the run before any paid API is called.
export function assignJobId(requested) {
  const supplied = String(requested || "").trim();
  if (supplied && !isUuid(supplied)) throw new Error("job_id must be a UUID, for example 0f8fad5b-d9cb-469f-a165-70867728950e.");
  return { jobId: supplied ? supplied.toLowerCase() : randomUUID(), supplied: Boolean(supplied) };
}
export const topicIdError = (topicId) => (topicId && !isUuid(topicId) ? "topic_id must be a UUID from content_topics.id." : null);

const snapshot = (run) => Object.fromEntries(Object.entries({
  topic: run.topic, style: run.style, language: run.language, presenter: run.presenter
}).filter(([, value]) => value !== null && value !== undefined));

export function startFields(run, { supplied, now = new Date() }) {
  return {
    ...snapshot(run),
    ...(run.topicId ? { topic_id: run.topicId } : {}),
    // A supplied ID belongs to a row its dispatcher created, so its source is kept as written.
    ...(supplied ? {} : { source: "manual" }),
    github_run_id: run.runId, github_run_url: run.runUrl,
    started_at: now.toISOString(), finished_at: null, error_message: null,
    metadata: { run_attempt: run.runAttempt, resume_from_run: run.resumeFrom }
  };
}

// The final status comes from what the generate and upload steps actually did.
// Step outcomes are success, failure, cancelled, or skipped (an earlier step failed).
export function runOutcome({ generate, upload, stageError }) {
  const generated = generate === "success";
  const uploaded = upload === "success";
  if (generated && uploaded) return { status: "succeeded", error: null };
  if (generated) return { status: "failed", error: "The video passed all checks, but uploading the artifact " + (upload === "skipped" || !upload ? "did not run." : "ended with " + upload + ".") };
  if (generate === "failure") return { status: "failed", error: stageError || "Video generation failed; see the Actions log." };
  if (generate === "cancelled") return { status: "failed", error: "The run was cancelled during video generation." };
  return { status: "failed", error: "Video generation did not run because an earlier workflow step failed or the run was cancelled." };
}

export function finishFields(run, outcome, { generate, upload, artifactName, artifactUrl, files = {}, now = new Date() }) {
  const topic = run.topic || files.metadata?.topic?.slice(0, 240) || null;
  return {
    ...snapshot({ ...run, topic }),
    github_run_id: run.runId, github_run_url: run.runUrl,
    artifact_name: upload === "success" ? artifactName || null : null,
    artifact_url: upload === "success" ? artifactUrl || null : null,
    finished_at: now.toISOString(),
    error_message: outcome.error,
    metadata: {
      run_attempt: run.runAttempt, resume_from_run: run.resumeFrom,
      generate_outcome: generate || null, upload_outcome: upload || null,
      title: files.metadata?.title || null,
      qa_passed: typeof files.qa?.passed === "boolean" ? files.qa.passed : null,
      qa_warnings: Array.isArray(files.qa?.warnings) ? files.qa.warnings.length : null,
      artifact_retention_days: 7
    }
  };
}

const attempt = async (label, task, warnings) => {
  try {
    const result = await task();
    if (result.warning) warnings.push(label + ": " + result.warning);
    if (result.action === "skipped") warnings.push(label + " not changed: " + result.reason);
    return result;
  } catch (error) {
    warnings.push(label + " update failed: " + error.message);
    return { action: "error", error: error.message };
  }
};

// Job and topic are written separately: one failing does not stop the other.
export async function recordStart(tracker, run, { supplied, now } = {}) {
  const warnings = [];
  const job = await attempt("job " + run.jobId, () => tracker.recordJob(run.jobId, "running", startFields(run, { supplied, now })), warnings);
  const topic = run.topicId
    ? await attempt("topic " + run.topicId, () => tracker.updateTopic(run.topicId, "dispatched", { github_run_id: run.runId, last_error: null }), warnings)
    : null;
  return { job, topic, warnings };
}

export async function recordFinish(tracker, run, steps, { now = new Date(), secrets = [] } = {}) {
  const warnings = [];
  const outcome = runOutcome({ ...steps, stageError: steps.stageError ? redact(steps.stageError, secrets) : null });
  const job = run.jobId
    ? await attempt("job " + run.jobId, () => tracker.recordJob(run.jobId, outcome.status, finishFields(run, outcome, { ...steps, now })), warnings)
    : null;
  if (!run.jobId) warnings.push("no job ID was assigned, so the job was not recorded");
  const topicStatus = outcome.status === "succeeded" ? "completed" : "failed";
  const topicFields = outcome.status === "succeeded"
    ? { github_run_id: run.runId, completed_at: now.toISOString(), last_error: null }
    : { github_run_id: run.runId, last_error: outcome.error };
  const topic = run.topicId && isUuid(run.topicId)
    ? await attempt("topic " + run.topicId, () => tracker.updateTopic(run.topicId, topicStatus, topicFields), warnings)
    : null;
  return { outcome, job, topic, warnings };
}
