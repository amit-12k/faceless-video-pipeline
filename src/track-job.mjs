import { appendFileSync, readFileSync } from "node:fs";
import path from "node:path";
import {
  assignJobId, createTracker, recordFinish, recordStart, redact, runContext, secretValues, startFields, topicIdError, trackerConfig
} from "./job-tracker.mjs";

// GitHub Actions entry point for job tracking:
//   node src/track-job.mjs start   assigns VIDEO_JOB_ID and records the run as running
//   node src/track-job.mjs finish  records the final status from the generate and upload step outcomes
// Tracking problems are printed as warnings and never fail the workflow. Only a malformed job_id or
// topic_id input stops the run, before any paid API is called.

const env = process.env;
const secrets = secretValues(env);
const say = (message) => console.log("Job tracking: " + redact(message, secrets));
const warn = (message) => console.log("::warning title=Job tracking::" + redact(message, secrets));
const readJson = (name) => {
  try { return JSON.parse(readFileSync(path.join(env.OUTPUT_DIR || ".", name), "utf8")); } catch { return null; }
};

function tracker() {
  const config = trackerConfig(env);
  if (!config.enabled) {
    say("off (" + config.reason + "). The video is generated without job tracking.");
    return null;
  }
  return createTracker(config, secrets);
}

async function start() {
  const run = runContext(env);
  const { jobId, supplied } = assignJobId(env.REQUESTED_JOB_ID);
  run.jobId = jobId;
  if (env.GITHUB_ENV) appendFileSync(env.GITHUB_ENV, "VIDEO_JOB_ID=" + jobId + "\n");
  say("job ID " + jobId + (supplied ? " (from the scheduler)." : " (new manual run)."));
  const badTopic = topicIdError(run.topicId);
  if (badTopic) run.topicId = null;
  const client = tracker();
  if (client && badTopic) {
    const now = new Date();
    await client.recordJob(jobId, "failed", { ...startFields(run, { supplied, now }), finished_at: now.toISOString(), error_message: badTopic })
      .catch((error) => warn("job " + jobId + " update failed: " + error.message));
  } else if (client) {
    const result = await recordStart(client, run, { supplied });
    if (["updated", "created"].includes(result.job.action)) say("job " + result.job.action + " as running.");
    if (result.topic?.action === "updated") say("topic " + run.topicId + " marked dispatched.");
    result.warnings.forEach(warn);
  }
  if (badTopic) throw new Error(badTopic);
}

async function finish() {
  const run = runContext(env);
  if (topicIdError(run.topicId)) run.topicId = null;
  const client = tracker();
  if (!client) return;
  const generate = env.GENERATE_OUTCOME;
  const stageError = generate === "failure" ? readJson("error-report.json")?.stage_error : null;
  // A resumed run starts with the earlier run's files, so its QA report counts only if this run reached QA.
  const reachedQa = generate === "success" || /^Quality checks failed/.test(stageError || "");
  const steps = {
    generate, upload: env.UPLOAD_OUTCOME, artifactName: env.ARTIFACT_NAME, artifactUrl: env.ARTIFACT_URL, stageError,
    files: { metadata: readJson("metadata.json"), qa: reachedQa ? readJson("qa-report.json") : null }
  };
  const result = await recordFinish(client, run, steps, { secrets });
  if (["updated", "created"].includes(result.job?.action)) say("job " + run.jobId + " recorded as " + result.outcome.status + ".");
  if (result.topic?.action === "updated") say("topic " + run.topicId + " marked " + (result.outcome.status === "succeeded" ? "completed." : "failed."));
  result.warnings.forEach(warn);
}

const command = process.argv[2];
const task = command === "start" ? start : command === "finish" ? finish : null;
if (!task) {
  console.error("Usage: node src/track-job.mjs start|finish");
  process.exitCode = 2;
} else {
  task().catch((error) => {
    console.log("::error title=Job tracking::" + redact(error.message, secrets));
    // Only start's input validation should stop the workflow; finish never masks the run's own result.
    process.exitCode = command === "start" ? 1 : 0;
  });
}
