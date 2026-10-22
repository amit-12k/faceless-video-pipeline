import assert from "node:assert/strict";
import { test } from "node:test";
import { CAPTION_STYLES } from "../remotion/layout.js";
import { CAPTION_LIMITS, buildPhrases, endsOnLeaningWord, segmentSentence, toSrt, wrapPhrase } from "../src/captions.mjs";
import { checkCaptions } from "../src/qa.mjs";
import { buildTimeline } from "../src/timing.mjs";
import { loadFixture, loudnessPattern } from "./helpers.mjs";

const timed = (text) => text.split(" ").map((word, i) => ({ text: word, start: i * 8, end: i * 8 + 8, sentence: 0, segment: 0 }));
const lineText = (phrase) => phrase.lines.map((line) => line.map((i) => phrase.words[i].text).join(" "));

test("nginx regression: no caption ends on a dangling word or splits a name", () => {
  const { phrases } = loadFixture("nginx");
  const texts = phrases.map((phrase) => phrase.text);
  assert.ok(!texts.some((text) => /\bRound$/.test(text)), "\"Round Robin\" is never split");
  assert.ok(!texts.some((text) => /\bdirective in$/.test(text)), "\"The upstream directive in\" no longer appears");
  assert.ok(texts.some((text) => text.includes("Round Robin")));
  assert.ok(!texts.some((text) => /\bload$/.test(text)), "\"load balancing\" stays together");
  phrases.forEach((phrase, i) => {
    const next = phrases[i + 1];
    if (next && next.sentence === phrase.sentence) assert.ok(!endsOnLeaningWord(phrase.text), `"${phrase.text}" ends mid-phrase`);
  });
});

for (const name of ["nginx", "bee"]) {
  test(`${name} fixture: captions pass the caption quality checks`, () => {
    const { phrases, timeline, loudness, narration } = loadFixture(name);
    const result = checkCaptions(phrases, { frames: loudness.length, sceneBounds: timeline.sceneBounds, narration });
    assert.deepEqual(result.errors, []);
  });
}

test("captions never span two sentences or two scenes", () => {
  const { phrases } = loadFixture("nginx");
  for (const phrase of phrases) {
    assert.equal(new Set(phrase.words.map((word) => word.text)).size > 0, true);
    assert.ok(phrase.words.every((_, i) => i === 0 || phrase.words[i].start >= phrase.words[i - 1].start));
  }
  const bySentence = new Map();
  for (const phrase of phrases) bySentence.set(phrase.sentence, phrase.segment);
  for (const phrase of phrases) assert.equal(bySentence.get(phrase.sentence), phrase.segment);
});

test("long unpunctuated sentences are split into phrases that fit the speech bubble", () => {
  const sentence = "The scheduler keeps a priority queue of pending jobs ordered by deadline and assigns each job to the "
    + "least busy worker in the pool while tracking retries timeouts and failures for every attempt it makes";
  const groups = segmentSentence(timed(sentence));
  assert.ok(groups.length >= 4);
  for (const group of groups) {
    const texts = group.map((word) => word.text);
    assert.ok(texts.join(" ").length <= CAPTION_LIMITS.maxChars);
    const lines = wrapPhrase(texts);
    const style = CAPTION_STYLES.subtitle;
    assert.ok(lines.length <= style.maxLines);
    for (const line of lines) assert.ok(line.join(" ").length <= style.lineChars * style.fontSize / style.minFontSize);
  }
  assert.equal(groups.flat().map((word) => word.text).join(" "), sentence, "no words lost or reordered");
});

test("short clauses join their neighbour and single words survive", () => {
  const groups = segmentSentence(timed("By default, NGINX uses round robin."));
  assert.equal(groups[0].map((word) => word.text).join(" "), "By default, NGINX uses round robin.");
  assert.equal(segmentSentence(timed("Yes.")).length, 1);
});

test("subtitles are numbered in order and never overlap", () => {
  const { phrases } = loadFixture("bee");
  const srt = toSrt(phrases);
  const numbers = [...srt.matchAll(/^(\d+)\n/gm)].map((match) => Number(match[1]));
  assert.deepEqual(numbers, numbers.map((_, i) => i + 1));
  for (let i = 1; i < phrases.length; i += 1) assert.ok(phrases[i].start >= phrases[i - 1].end);
  assert.ok(phrases.every((phrase) => phrase.lines.length <= CAPTION_STYLES.subtitle.maxLines && lineText(phrase).every(Boolean)));
});

test("caption checks flag fragments, scene crossings, and text mismatches", () => {
  const loudness = loudnessPattern([[0.2, false], [2, true], [0.6, false], [2, true], [0.3, false]]);
  const segments = ["NGINX picks a server.", "Then it forwards the request."];
  const timeline = buildTimeline(segments, loudness);
  const phrases = buildPhrases(timeline.words, timeline.sceneBounds);
  const context = { frames: loudness.length, sceneBounds: timeline.sceneBounds, narration: segments.join(" ") };
  assert.deepEqual(checkCaptions(phrases, context).errors, []);

  const broken = structuredClone(phrases);
  const last = broken[0].words[broken[0].words.length - 1];
  last.text = "the";
  broken[0].text = broken[0].words.map((word) => word.text).join(" ");
  broken[0].spokenEnd = timeline.sceneBounds[1][0] + 20;
  const result = checkCaptions(broken, context);
  assert.ok(result.errors.some((error) => error.includes("does not match the narration")));
  assert.ok(result.errors.some((error) => error.includes("crosses a scene boundary")));
  assert.ok(result.errors.some((error) => error.includes("unfinished sentence")));
  assert.deepEqual(checkCaptions([], context).errors, ["No captions were produced."]);
});
