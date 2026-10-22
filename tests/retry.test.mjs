import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { writeScript } from "../src/gemini.mjs";
import { postJson, retryPolicy } from "../src/http.mjs";
import { boundedRetry } from "../src/retry.mjs";

const realFetch = globalThis.fetch;
const saved = { ...retryPolicy };
let calls = 0;
const respond = (responses) => {
  calls = 0;
  globalThis.fetch = async () => {
    const [status, body] = responses[Math.min(calls, responses.length - 1)];
    calls += 1;
    return new Response(JSON.stringify(body), { status });
  };
};

beforeEach(() => Object.assign(retryPolicy, { delayMs: 1, rateLimitDelayMs: 1 }));
afterEach(() => {
  globalThis.fetch = realFetch;
  Object.assign(retryPolicy, saved);
});

test("server errors retry a bounded number of times, then fail with the stage name", async () => {
  respond([[503, { error: "busy" }]]);
  await assert.rejects(postJson("https://example.test", {}, {}, "Research"), /Research API returned HTTP 503/);
  assert.equal(calls, retryPolicy.attempts);
});

test("a transient failure recovers on retry", async () => {
  respond([[500, {}], [200, { ok: true }]]);
  assert.deepEqual(await postJson("https://example.test", {}, {}, "Research"), { ok: true });
  assert.equal(calls, 2);
});

test("exhausted quota and invalid requests are not retried", async () => {
  respond([[429, { error: { message: "You exceeded your current quota" } }]]);
  await assert.rejects(postJson("https://example.test", {}, {}, "Research"), /429/);
  assert.equal(calls, 1);
  respond([[400, { error: { message: "Request contains an invalid argument." } }]]);
  await assert.rejects(postJson("https://example.test", {}, {}, "Script generation"), /400/);
  assert.equal(calls, 1);
});

test("script generation reports a failed Gemini call without leaking the key", async () => {
  const previous = process.env.GEMINI_API_KEY;
  process.env.GEMINI_API_KEY = "secret-test-key";
  respond([[400, { error: { message: "Request contains an invalid argument." } }]]);
  const research = { claims: [1, 2, 3].map((i) => ({ id: "c" + i, claim: "x", support: "supported", sources: [] })) };
  await assert.rejects(writeScript("Topic", "explainer", "English", research), (error) => {
    assert.match(error.message, /Script generation API returned HTTP 400/);
    assert.doesNotMatch(error.message, /secret-test-key/);
    return true;
  });
  if (previous === undefined) delete process.env.GEMINI_API_KEY;
  else process.env.GEMINI_API_KEY = previous;
});

test("bounded retry stops at the first acceptable result and never exceeds its limit", async () => {
  let runs = 0;
  const accepted = await boundedRetry(async (attempt) => { runs += 1; return attempt; }, (value) => value === 2, 5);
  assert.equal(accepted, 2);
  assert.equal(runs, 2);
  runs = 0;
  const rejected = await boundedRetry(async () => { runs += 1; return { passed: false }; }, (value) => value.passed, 2);
  assert.equal(rejected.passed, false);
  assert.equal(runs, 2);
});
