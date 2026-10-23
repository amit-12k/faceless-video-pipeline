import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { afterEach, beforeEach, test } from "node:test";
import {
  JOB_ALLOWED_FROM, TOPIC_ALLOWED_FROM, assignJobId, canTransition, createTracker, finishFields, isUuid, recordFinish,
  recordStart, redact, runContext, runOutcome, startFields, supabaseHeaders, topicIdError, trackerConfig, trackerPolicy
} from "../src/job-tracker.mjs";

const JOB = "0f8fad5b-d9cb-469f-a165-70867728950e";
const TOPIC = "7c9e6679-7425-40de-944b-e07fc1f90ae7";
// Fake key-shaped values, assembled at runtime so secret scanners do not mistake the source for real keys.
const SECRET = ["sb", "secret", "testonlynotarealkey00"].join("_");
const FAKE_GOOGLE_KEY = "AI" + "za" + "Fake".repeat(9);
const config = { enabled: true, url: "https://demo.supabase.co", key: SECRET, legacy: false };
const NOW = new Date("2026-10-23T09:00:00.000Z");
const env = {
  GITHUB_RUN_ID: "18800000001", GITHUB_REPOSITORY: "amit-12k/faceless-video-pipeline", GITHUB_SERVER_URL: "https://github.com",
  GITHUB_RUN_ATTEMPT: "1", VIDEO_TOPIC: "How Kafka moves millions of events", VIDEO_STYLE: "explainer",
  VIDEO_LANGUAGE: "English", VIDEO_MASCOT: "on", VIDEO_JOB_ID: JOB, VIDEO_TOPIC_ID: TOPIC
};

// Each mocked response is matched in order; calls records method, path with query, headers, and body.
const realFetch = globalThis.fetch;
const saved = { ...trackerPolicy };
let calls = [];
function respond(responses) {
  calls = [];
  globalThis.fetch = async (url, init) => {
    const { pathname, search } = new URL(url);
    calls.push({ method: init.method, path: decodeURIComponent(pathname + search), headers: init.headers, body: init.body ? JSON.parse(init.body) : undefined });
    const next = responses[Math.min(calls.length - 1, responses.length - 1)];
    if (next instanceof Error) throw next;
    const [status, body] = next;
    return new Response(body === undefined ? "" : JSON.stringify(body), { status });
  };
}
beforeEach(() => Object.assign(trackerPolicy, { delayMs: 1 }));
afterEach(() => {
  globalThis.fetch = realFetch;
  Object.assign(trackerPolicy, saved);
});

test("tracking is off without credentials and prefers the secret key over the legacy key", () => {
  assert.equal(trackerConfig({}).enabled, false);
  assert.equal(trackerConfig({ SUPABASE_URL: "https://demo.supabase.co" }).enabled, false);
  assert.equal(trackerConfig({ SUPABASE_SECRET_KEY: SECRET }).enabled, false);
  assert.equal(trackerConfig({ SUPABASE_URL: "http://demo.supabase.co", SUPABASE_SECRET_KEY: SECRET }).enabled, false);
  const both = trackerConfig({ SUPABASE_URL: "https://demo.supabase.co/", SUPABASE_SECRET_KEY: SECRET, SUPABASE_SERVICE_ROLE_KEY: "eyJa.b.c" });
  assert.deepEqual(both, { enabled: true, url: "https://demo.supabase.co", key: SECRET, legacy: false });
  assert.equal(trackerConfig({ SUPABASE_URL: "https://demo.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "eyJa.b.c" }).legacy, true);
  // The reason never repeats a key.
  assert.doesNotMatch(trackerConfig({ SUPABASE_SECRET_KEY: SECRET }).reason, /sb_secret/);
});

test("secret keys go only on the apikey header; legacy JWTs are also sent as the bearer token", () => {
  const modern = supabaseHeaders(config);
  assert.equal(modern.apikey, SECRET);
  assert.equal(modern.authorization, undefined);
  assert.equal(supabaseHeaders({ ...config, key: "eyJa.b.c", legacy: true }).authorization, "Bearer eyJa.b.c");
});

test("the scheduler's job ID is reused, manual runs get a new UUID, and malformed IDs are rejected", () => {
  assert.deepEqual(assignJobId(JOB.toUpperCase()), { jobId: JOB, supplied: true });
  const manual = assignJobId("");
  assert.equal(manual.supplied, false);
  assert.ok(isUuid(manual.jobId));
  assert.notEqual(assignJobId(undefined).jobId, manual.jobId);
  assert.throws(() => assignJobId("42; drop table video_jobs"), /job_id must be a UUID/);
  assert.equal(topicIdError(TOPIC), null);
  assert.equal(topicIdError(""), null);
  assert.match(topicIdError("not-a-uuid"), /topic_id must be a UUID/);
});

test("status transitions only move forward, except that a re-run may start a finished job again", () => {
  assert.ok(canTransition(JOB_ALLOWED_FROM, "queued", "running"));
  assert.ok(canTransition(JOB_ALLOWED_FROM, "dispatch_failed", "running"));
  assert.ok(canTransition(JOB_ALLOWED_FROM, "failed", "running"));
  assert.ok(canTransition(JOB_ALLOWED_FROM, "running", "succeeded"));
  assert.ok(!canTransition(JOB_ALLOWED_FROM, "succeeded", "failed"));
  assert.ok(!canTransition(JOB_ALLOWED_FROM, "running", "queued"));
  assert.ok(!canTransition(JOB_ALLOWED_FROM, "running", "dispatch_failed"));
  assert.ok(canTransition(TOPIC_ALLOWED_FROM, "dispatching", "dispatched"));
  assert.ok(canTransition(TOPIC_ALLOWED_FROM, "failed", "completed"));
  assert.ok(!canTransition(TOPIC_ALLOWED_FROM, "completed", "failed"));
  assert.ok(!canTransition(TOPIC_ALLOWED_FROM, "paused", "dispatched"));
  assert.ok(!canTransition(TOPIC_ALLOWED_FROM, "paused", "completed"));
});

test("the final status comes from the generate and upload outcomes", () => {
  assert.deepEqual(runOutcome({ generate: "success", upload: "success" }), { status: "succeeded", error: null });
  const uploadFailed = runOutcome({ generate: "success", upload: "failure" });
  assert.equal(uploadFailed.status, "failed");
  assert.match(uploadFailed.error, /passed all checks.*upload/);
  assert.deepEqual(runOutcome({ generate: "failure", upload: "success", stageError: "Quality checks failed: x" }),
    { status: "failed", error: "Quality checks failed: x" });
  assert.match(runOutcome({ generate: "cancelled", upload: "success" }).error, /cancelled/);
  assert.match(runOutcome({ generate: "skipped", upload: "success" }).error, /did not run/);
  assert.equal(runOutcome({}).status, "failed");
});

test("start and finish payloads carry the run's settings, links, and timestamps", () => {
  const run = runContext(env);
  assert.equal(run.runId, 18800000001);
  assert.equal(run.runUrl, "https://github.com/amit-12k/faceless-video-pipeline/actions/runs/18800000001");
  assert.equal(run.presenter, true);
  const manual = startFields(run, { supplied: false, now: NOW });
  assert.equal(manual.source, "manual");
  assert.equal(manual.topic_id, TOPIC);
  assert.equal(manual.started_at, NOW.toISOString());
  assert.equal(manual.finished_at, null);
  // A row created by the scheduler keeps the source it was written with.
  assert.equal("source" in startFields(run, { supplied: true, now: NOW }), false);
  // Resumed runs may leave the topic blank: it is omitted rather than overwritten with nothing.
  assert.equal("topic" in startFields(runContext({ ...env, VIDEO_TOPIC: "" }), { supplied: true, now: NOW }), false);
  assert.equal(runContext({ ...env, VIDEO_STYLE: "bogus", VIDEO_MASCOT: "off" }).style, null);
  assert.equal(runContext({ ...env, VIDEO_MASCOT: "off" }).presenter, false);

  const outcome = runOutcome({ generate: "success", upload: "success" });
  const done = finishFields(runContext({ ...env, VIDEO_TOPIC: "" }), outcome, {
    generate: "success", upload: "success", artifactName: "faceless-video-18800000001",
    artifactUrl: "https://github.com/amit-12k/faceless-video-pipeline/actions/runs/18800000001/artifacts/1",
    files: { metadata: { topic: "Kafka from metadata", title: "How Kafka Moves Events" }, qa: { passed: true, warnings: ["a"] } }, now: NOW
  });
  assert.equal(done.topic, "Kafka from metadata");
  assert.equal(done.artifact_name, "faceless-video-18800000001");
  assert.equal(done.error_message, null);
  assert.deepEqual([done.metadata.title, done.metadata.qa_passed, done.metadata.qa_warnings], ["How Kafka Moves Events", true, 1]);
  const noUpload = finishFields(run, runOutcome({ generate: "success", upload: "failure" }), { generate: "success", upload: "failure", artifactName: "x", now: NOW });
  assert.equal(noUpload.artifact_name, null);
});

test("a manual run creates its job, then marks the topic dispatched", async () => {
  respond([[200, []], [200, []], [201, [{ id: JOB, status: "running" }]], [200, [{ id: TOPIC, status: "dispatched" }]]]);
  const result = await recordStart(createTracker(config), runContext(env), { supplied: false, now: NOW });
  assert.deepEqual(result.warnings, []);
  assert.equal(result.job.action, "created");
  assert.deepEqual(calls.map((call) => call.method + " " + call.path), [
    "PATCH /rest/v1/video_jobs?id=eq." + JOB + "&status=in.(queued,running,succeeded,failed,dispatch_failed)",
    "GET /rest/v1/video_jobs?id=eq." + JOB + "&select=status",
    "POST /rest/v1/video_jobs",
    "PATCH /rest/v1/content_topics?id=eq." + TOPIC + "&status=in.(queued,dispatching,dispatched,failed)"
  ]);
  assert.equal(calls[2].body.id, JOB);
  assert.equal(calls[2].body.status, "running");
  assert.equal(calls[2].body.source, "manual");
  assert.deepEqual(calls[3].body, { github_run_id: 18800000001, last_error: null, status: "dispatched" });
  assert.equal(calls[0].headers.apikey, SECRET);
  assert.equal(calls[0].headers.prefer, "return=representation");
});

test("a successful run marks the job succeeded and the topic completed", async () => {
  respond([[200, [{ id: JOB, status: "succeeded" }]], [200, [{ id: TOPIC, status: "completed" }]]]);
  const result = await recordFinish(createTracker(config), runContext(env),
    { generate: "success", upload: "success", artifactName: "faceless-video-18800000001", artifactUrl: "https://example.test/a" }, { now: NOW });
  assert.equal(result.outcome.status, "succeeded");
  assert.deepEqual(result.warnings, []);
  assert.equal(calls[0].path, "/rest/v1/video_jobs?id=eq." + JOB + "&status=in.(queued,dispatch_failed,running)");
  assert.equal(calls[0].body.status, "succeeded");
  assert.equal(calls[0].body.artifact_url, "https://example.test/a");
  assert.equal(calls[1].path, "/rest/v1/content_topics?id=eq." + TOPIC + "&status=in.(dispatching,dispatched,failed)");
  assert.deepEqual(calls[1].body, { github_run_id: 18800000001, completed_at: NOW.toISOString(), last_error: null, status: "completed" });
});

test("a failed run records the stage error on the job and topic without leaking keys", async () => {
  respond([[200, [{ id: JOB }]], [200, [{ id: TOPIC }]]]);
  const stageError = "Script generation API returned HTTP 400 for key " + FAKE_GOOGLE_KEY;
  const result = await recordFinish(createTracker(config), runContext(env), { generate: "failure", upload: "success", stageError }, { now: NOW });
  assert.equal(result.outcome.status, "failed");
  assert.match(calls[0].body.error_message, /HTTP 400 for key \[redacted\]/);
  assert.equal(calls[1].body.status, "failed");
  assert.equal(calls[1].body.last_error, calls[0].body.error_message);
});

test("runs without a topic only touch the job", async () => {
  respond([[200, [{ id: JOB }]]]);
  const result = await recordFinish(createTracker(config), runContext({ ...env, VIDEO_TOPIC_ID: "" }), { generate: "success", upload: "success" }, { now: NOW });
  assert.equal(result.topic, null);
  assert.equal(calls.length, 1);
});

test("a job that cannot make the move is left alone and reported", async () => {
  respond([[200, []], [200, [{ status: "succeeded" }]], [200, []], [200, [{ status: "paused" }]]]);
  const result = await recordFinish(createTracker(config), runContext(env), { generate: "failure", upload: "success" }, { now: NOW });
  assert.equal(result.job.action, "skipped");
  assert.equal(calls.length, 4, "no insert is attempted for an existing job");
  assert.match(result.warnings[0], /job is succeeded, which cannot change to failed/);
  assert.match(result.warnings[1], /topic is paused/);
});

test("an unknown topic does not stop the job from being recorded", async () => {
  const missingTopic = [409, { code: "23503", message: "insert or update on table \"video_jobs\" violates foreign key constraint" }];
  respond([[200, []], [200, []], missingTopic, [200, []], [200, []], [201, [{ id: JOB }]], [200, []], [200, []]]);
  const result = await recordStart(createTracker(config), runContext(env), { supplied: false, now: NOW });
  assert.equal(result.job.action, "created");
  assert.equal("topic_id" in calls[5].body, false);
  assert.match(result.warnings[0], /does not exist; the job was recorded without it/);
  assert.match(result.warnings[1], /topic not found/);
});

test("HTTP errors become warnings, server errors are retried once, and keys never appear", async () => {
  respond([[503, { message: "upstream " + SECRET }], [503, { message: "upstream " + SECRET }], [401, { message: "Invalid API key" }]]);
  const result = await recordStart(createTracker(config), runContext(env), { supplied: true, now: NOW });
  assert.equal(result.job.action, "error");
  assert.equal(result.topic.action, "error");
  assert.equal(calls.length, 3, "503 retried once; 401 not retried");
  assert.match(result.warnings[0], /HTTP 503/);
  assert.match(result.warnings[1], /HTTP 401: Invalid API key/);
  for (const warning of result.warnings) assert.doesNotMatch(warning, /sb_secret/);
});

test("network failures are retried once and then reported", async () => {
  respond([new TypeError("fetch failed"), new TypeError("fetch failed")]);
  const result = await recordFinish(createTracker(config), runContext({ ...env, VIDEO_TOPIC_ID: "" }), { generate: "success", upload: "success" });
  assert.equal(calls.length, 2);
  assert.match(result.warnings[0], /request failed: fetch failed/);
  assert.equal(result.outcome.status, "succeeded", "a tracking failure does not change the video's result");
});

test("redaction removes known secrets and key-shaped strings and caps the length", () => {
  const text = redact("a " + SECRET + " b " + ["github", "pat", "11ABC"].join("_") + " c eyJhbGciOi.eyJzdWIi.sig d tvly-dev-abc e my-own-value-123", ["my-own-value-123"]);
  assert.equal(text, "a [redacted] b [redacted] c [redacted] d [redacted] e [redacted]");
  assert.equal(redact("x".repeat(5000)).length, 1000);
});

test("the workflow entry point works without credentials and rejects malformed IDs", () => {
  const script = new URL("../src/track-job.mjs", import.meta.url).pathname;
  const base = { PATH: process.env.PATH, GITHUB_RUN_ID: "1" };
  const out = execFileSync(process.execPath, [script, "start"], { env: base, encoding: "utf8" });
  assert.match(out, /job ID [0-9a-f-]{36} \(new manual run\)/);
  assert.match(out, /off \(SUPABASE_URL or SUPABASE_SECRET_KEY is not set\)/);
  assert.throws(() => execFileSync(process.execPath, [script, "start"], { env: { ...base, REQUESTED_JOB_ID: "abc" }, encoding: "utf8", stdio: "pipe" }),
    (error) => error.status === 1 && /job_id must be a UUID/.test(error.stdout));
  // finish never fails the workflow, even with nothing to record.
  execFileSync(process.execPath, [script, "finish"], { env: { ...base, GENERATE_OUTCOME: "failure" }, encoding: "utf8" });
});
