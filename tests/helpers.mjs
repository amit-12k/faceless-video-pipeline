import { readFileSync } from "node:fs";
import { buildPhrases } from "../src/captions.mjs";
import { buildTimeline } from "../src/timing.mjs";

// Loads a recorded run (script plus per-frame narration loudness) and plans it the way src/render.mjs does.
export function loadFixture(name) {
  const dir = new URL("./fixtures/" + name + "/", import.meta.url);
  const script = JSON.parse(readFileSync(new URL("script.json", dir), "utf8"));
  const loudness = JSON.parse(readFileSync(new URL("loudness.json", dir), "utf8"));
  const segments = [script.hook, ...script.scenes.map((scene) => scene.narration)];
  const timeline = buildTimeline(segments, loudness);
  const keywords = script.scenes.flatMap((scene) => (scene.elements || []).filter((element) => element.is_product).map((element) => element.name));
  const labels = script.scenes.flatMap((scene) => [...(scene.elements || []).map((element) => element.name), ...(scene.points || [])]);
  const phrases = buildPhrases(timeline.words, timeline.sceneBounds, keywords, labels);
  return { script, loudness, segments, timeline, phrases, narration: segments.join(" ") };
}

// Synthetic loudness: `pattern` is a list of [seconds, speaking?] stretches at 30 fps.
export function loudnessPattern(pattern) {
  return pattern.flatMap(([seconds, speaking]) => Array.from({ length: Math.round(seconds * 30) }, () => (speaking ? 0.2 : 0.001)));
}

// Plans a fixture the way src/render.mjs does (without audio or rendering) and returns what QA checks.
export async function planFixture(name) {
  const { alignTranscript, timelineFromWordTimes, wordTimesFromAlignment } = await import("../src/align.mjs");
  const { buildPhrases, restylePhrase } = await import("../src/captions.mjs");
  const { directScenes } = await import("../src/direction.mjs");
  const { planStoryboard } = await import("../src/storyboard.mjs");
  const { splitWords } = await import("../src/timing.mjs");
  const fixture = loadFixture(name);
  const { script, loudness, segments } = fixture;
  let timeline = fixture.timeline;
  const transcriptUrl = new URL("./fixtures/" + name + "/transcript.json", import.meta.url);
  let frames = loudness.length;
  try {
    const spoken = JSON.parse(readFileSync(transcriptUrl, "utf8"));
    const words = segments.flatMap(splitWords);
    const { pairs } = alignTranscript(words, spoken);
    frames = Math.ceil(spoken[spoken.length - 1].end * 30) + 15;
    timeline = timelineFromWordTimes(segments, wordTimesFromAlignment(words, spoken, pairs, frames / 30), frames);
  } catch { /* no transcript: keep the pause-based timeline */ }
  const total = frames + 18;
  const storyboard = planStoryboard(script, (element) => ({ name: element.name, kind: element.kind, brand: null }));
  const bounded = storyboard.map((scene, i) => ({ ...scene, start: timeline.sceneBounds[i][0], end: i === storyboard.length - 1 ? total : timeline.sceneBounds[i][1] }));
  const phrases = buildPhrases(timeline.words, timeline.sceneBounds, ["NGINX"]);
  const scenes = directScenes(bounded, timeline, phrases);
  const speech = {
    sentences: timeline.sentences.map((s) => ({ start: s.start, end: s.end, question: /\?$/.test(s.text) })),
    words: timeline.words.map((w) => ({ start: w.start, end: w.end, text: w.text, emphasis: w.text.length >= 8 }))
  };
  const mouth = Array.from({ length: total }, (_, f) => (speech.words.some((w) => f >= w.start && f < w.end) ? 0.6 : 0));
  return {
    scenes, timeline, speech, mouth, frames: total, cues: scenes.flatMap((scene) => scene.cues),
    phrases: phrases.map((phrase) => (scenes[phrase.segment]?.caption === "bubble" ? restylePhrase(phrase, "bubble") : phrase))
  };
}
