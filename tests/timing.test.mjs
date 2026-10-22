import assert from "node:assert/strict";
import { test } from "node:test";
import { buildTimeline, splitSentences } from "../src/timing.mjs";
import { loadFixture, loudnessPattern } from "./helpers.mjs";

test("splits sentences without breaking decimals or abbreviations", () => {
  assert.deepEqual(splitSentences("Uptime hit 99.99% last year. Use a cache, e.g. Redis, for hot keys! Why?"), [
    "Uptime hit 99.99% last year.", "Use a cache, e.g. Redis, for hot keys!", "Why?"
  ]);
});

test("places sentence and scene boundaries on the matching pauses", () => {
  // Three one-sentence scenes of similar length separated by clear pauses, plus a breath inside scene two.
  const loudness = loudnessPattern([[0.3, false], [3, true], [0.8, false], [1.6, true], [0.4, false], [1.6, true],
    [0.8, false], [3, true], [0.3, false]]);
  const segments = ["Requests reach the balancer first.", "It then forwards each request to a healthy server.", "Responses travel back the same way."];
  const { sceneBounds, sentences } = buildTimeline(segments, loudness);
  assert.equal(sceneBounds[0][0], 0);
  assert.ok(Math.abs(sceneBounds[1][0] / 30 - 3.6) < 0.5, "scene 2 starts in the first long pause");
  assert.ok(Math.abs(sceneBounds[2][0] / 30 - 8.2) < 0.5, "scene 3 starts in the second long pause, not the breath");
  assert.equal(sceneBounds[2][1], loudness.length);
  assert.deepEqual(sentences.map((sentence) => sentence.segment), [0, 1, 2]);
});

test("falls back to proportional timing when the narration has no pauses", () => {
  const loudness = loudnessPattern([[12, true]]);
  const { sceneBounds, words } = buildTimeline(["One short line.", "Another line of similar size."], loudness);
  assert.equal(sceneBounds[0][0], 0);
  assert.ok(sceneBounds[1][0] > 60 && sceneBounds[1][0] < 300);
  assert.equal(sceneBounds[1][1], loudness.length);
  for (let i = 1; i < words.length; i += 1) assert.ok(words[i].start >= words[i - 1].start, "word starts never go backwards");
});

test("copes with silent or empty audio", () => {
  const silent = buildTimeline(["Hello there."], loudnessPattern([[2, false]]));
  assert.equal(silent.sceneBounds.length, 1);
  const empty = buildTimeline(["", "Second scene."], loudnessPattern([[3, true]]));
  assert.equal(empty.sceneBounds.length, 2);
});

for (const name of ["nginx", "bee"]) {
  test(`${name} fixture: scene cuts sit in pauses and speaking rate stays plausible`, () => {
    const { timeline } = loadFixture(name);
    for (const [start] of timeline.sceneBounds.slice(1)) {
      assert.ok(timeline.pauses.some((pause) => start >= pause.start && start <= pause.end), `scene cut at ${(start / 30).toFixed(2)}s is inside a pause`);
    }
    for (const sentence of timeline.sentences) {
      const words = sentence.text.split(/\s+/).length;
      const rate = words / ((sentence.end - sentence.start) / 30);
      assert.ok(rate > 1 && rate < 4, `"${sentence.text.slice(0, 40)}" is spoken at ${rate.toFixed(1)} words/s`);
    }
  });
}

test("nginx regression: the first scene runs until its last sentence ends (was cut 3s early)", () => {
  const { timeline } = loadFixture("nginx");
  const firstSceneEnd = timeline.sceneBounds[1][1] / 30;
  assert.ok(firstSceneEnd > 23 && firstSceneEnd < 24.3, `scene ends at ${firstSceneEnd.toFixed(2)}s`);
});
