import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { alignTranscript, timelineFromWordTimes, wordTimesFromAlignment } from "../src/align.mjs";
import { buildPhrases } from "../src/captions.mjs";
import { checkCaptions, checkSpeech } from "../src/qa.mjs";
import { splitWords } from "../src/timing.mjs";

const spokenWords = (text, start = 0, step = 0.4) => text.split(" ").map((word, i) => ({ text: word, start: start + i * step, end: start + i * step + 0.35 }));

test("script words align to what was heard despite spelling differences", () => {
  const script = splitWords("NGINX sends the request to a backend server.");
  const spoken = spokenWords("EngineX sends the request to a back-end server.");
  const { pairs, stats } = alignTranscript(script, spoken);
  assert.equal(pairs[0], 0, "NGINX matches EngineX by position and similarity");
  assert.ok(stats.matched_ratio >= 0.85);
  assert.deepEqual(stats.leading_words, []);
});

test("speech before the script, such as a prompt read aloud, is reported rather than captioned", () => {
  const script = splitWords("Caching keeps hot data close.");
  const spoken = spokenWords("Read the following narration in English. Caching keeps hot data close.");
  const { pairs, stats } = alignTranscript(script, spoken);
  assert.deepEqual(stats.leading_words, ["Read", "the", "following", "narration", "in", "English."]);
  assert.equal(pairs[0], 6);
  assert.equal(checkSpeech(stats, "transcript").errors.length, 1);
});

test("words the recogniser missed get times between their neighbours, in order", () => {
  const script = splitWords("Requests reach the load balancer first.");
  const spoken = spokenWords("Requests reach the first.", 1);
  const { pairs } = alignTranscript(script, spoken);
  const times = wordTimesFromAlignment(script, spoken, pairs, 10);
  for (let i = 1; i < times.length; i += 1) assert.ok(times[i].start >= times[i - 1].start);
  assert.ok(times[3].start >= times[2].start && times[4].end <= times[5].start + 0.001);
});

test("added or skipped words are flagged", () => {
  const script = splitWords("One two three four five six seven eight nine ten.");
  const spoken = spokenWords("One two banana three four apple five six cherry seven eight grape nine kiwi ten melon pear.");
  const { stats } = alignTranscript(script, spoken);
  assert.ok(stats.extra_words.length >= 5);
  assert.ok(checkSpeech(stats, "transcript").errors.some((error) => error.includes("added")));
  assert.ok(checkSpeech(null, "estimate").warnings[0].includes("estimated"));
});

test("nginx regression: captions follow the real narration, which began with a leaked instruction", () => {
  const script = JSON.parse(readFileSync(new URL("./fixtures/nginx/script.json", import.meta.url), "utf8"));
  const spoken = JSON.parse(readFileSync(new URL("./fixtures/nginx/transcript.json", import.meta.url), "utf8"));
  const segments = [script.hook, ...script.scenes.map((scene) => scene.narration)];
  const words = segments.flatMap(splitWords);
  const { pairs, stats } = alignTranscript(words, spoken);
  assert.equal(stats.matched_ratio, 1);
  assert.equal(stats.leading_words.join(" "), "Read the following narration in English with clear natural pacing.");
  const frames = Math.ceil(63.3 * 30);
  const timeline = timelineFromWordTimes(segments, wordTimesFromAlignment(words, spoken, pairs, 63.3), frames);
  assert.ok(timeline.words[0].start / 30 > 4.5, "the hook caption waits for the hook to be spoken");
  const phrases = buildPhrases(timeline.words, timeline.sceneBounds, ["NGINX"]);
  const result = checkCaptions(phrases, { frames, sceneBounds: timeline.sceneBounds, narration: segments.join(" ") });
  assert.deepEqual(result.errors, []);
  const heard = spoken.find((word) => /^round/i.test(word.text));
  const roundRobin = timeline.words.find((word) => word.text === "Round");
  assert.ok(Math.abs(roundRobin.start / 30 - heard.start) < 0.05, "caption timing comes from the transcript");
});
