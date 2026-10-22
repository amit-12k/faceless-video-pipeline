import { copyFile, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { bundle } from "@remotion/bundler";
import { ensureBrowser, renderMedia, selectComposition } from "@remotion/renderer";
import * as simpleIcons from "simple-icons";
import { frameLoudness, mediaDuration } from "./audio.mjs";
import { buildPhrases, restylePhrase, toSrt } from "./captions.mjs";
import { directScenes } from "./direction.mjs";
import { planStoryboard } from "./storyboard.mjs";
import { alignTranscript, timelineFromWordTimes, wordTimesFromAlignment } from "./align.mjs";
import { FPS, buildTimeline, speakingFrames, splitWords } from "./timing.mjs";

const ROOT_DIR = fileURLToPath(new URL("..", import.meta.url));
const ENTRY_POINT = path.join(ROOT_DIR, "remotion", "index.jsx");

const normalizeName = (value) => value.toLowerCase().replace(/[^a-z0-9]/g, "");
const BRAND_ALIASES = {
  postgres: "postgresql", k8s: "kubernetes", golang: "go", kafka: "apachekafka", cassandra: "apachecassandra",
  spark: "apachespark", mongo: "mongodb", elastic: "elasticsearch", gcp: "googlecloud", jwt: "jsonwebtokens",
  node: "nodedotjs", nextjs: "nextdotjs", gemini: "googlegemini"
};
const brandIndex = new Map();
for (const icon of Object.values(simpleIcons)) {
  if (!icon?.slug || !icon.path) continue;
  brandIndex.set(icon.slug, icon);
  if (!brandIndex.has(normalizeName(icon.title))) brandIndex.set(normalizeName(icon.title), icon);
}

// Dark brand colours (black logos) would vanish on the dark background, so they are drawn white.
function brandColor(hex) {
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b < 0.28 ? "#FFFFFF" : "#" + hex;
}

export function resolveElement(element) {
  const name = String(element.name || "").trim().slice(0, 40) || "Concept";
  const key = normalizeName(name);
  const icon = element.is_product ? brandIndex.get(BRAND_ALIASES[key] || key) : null;
  return { name, kind: String(element.kind || ""), brand: icon ? { path: icon.path, color: brandColor(icon.hex) } : null };
}

// Mouth openness per frame: loudness normalised to 0..1 and smoothed so it does not flicker.
function mouthLevels(loudness) {
  const { peak } = speakingFrames(loudness);
  const mouth = [];
  for (const value of loudness) {
    const level = Math.min(1, value / peak) ** 0.8;
    const previous = mouth.length ? mouth[mouth.length - 1] : 0;
    mouth.push(Math.round((level > previous ? level * 0.7 + previous * 0.3 : level * 0.4 + previous * 0.6) * 100) / 100);
  }
  return mouth;
}

// Below this share of script words found in the transcript, transcript timing is not trusted.
export const MIN_TRANSCRIPT_MATCH = 0.6;
// The last frame is held this long after the narration ends, so the conclusion is not cut off.
export const END_HOLD_FRAMES = 18;

// Works out scenes, caption phrases, and presenter motion from the script and the finished narration.
// `spoken` is whisper's word list for this audio; without it, timing is estimated from pauses.
export async function planVideo(script, audioPath, spoken = null, options = {}) {
  const loudness = await frameLoudness(audioPath);
  const duration = await mediaDuration(audioPath);
  const frames = Math.ceil(duration * FPS);
  while (loudness.length < frames) loudness.push(0);
  const segments = [script.hook, ...script.scenes.map((scene) => scene.narration)];
  const scriptWords = segments.flatMap(splitWords);
  const alignment = spoken?.length ? alignTranscript(scriptWords, spoken) : null;
  const { speaking } = speakingFrames(loudness.slice(0, frames));
  const timeline = alignment && alignment.stats.matched_ratio >= MIN_TRANSCRIPT_MATCH
    ? timelineFromWordTimes(segments, wordTimesFromAlignment(scriptWords, spoken, alignment.pairs, duration), frames, speaking)
    : { ...buildTimeline(segments, loudness.slice(0, frames)), source: "estimate" };
  const storyboard = planStoryboard(script, resolveElement);
  const total = frames + END_HOLD_FRAMES;
  const bounded = storyboard.map((scene, i) => ({
    ...scene, start: timeline.sceneBounds[i][0], end: i === storyboard.length - 1 ? total : timeline.sceneBounds[i][1]
  }));
  const keywords = script.scenes.flatMap((scene) => (scene.elements || []).filter((element) => element.is_product).map((element) => element.name));
  const labels = script.scenes.flatMap((scene) => [...(scene.elements || []).map((element) => element.name), ...(scene.points || [])]);
  const subtitlePhrases = buildPhrases(timeline.words, timeline.sceneBounds, keywords, labels);
  const scenes = directScenes(bounded, timeline, subtitlePhrases, options);
  const phrases = subtitlePhrases.map((phrase) => (scenes[phrase.segment]?.caption === "bubble" ? restylePhrase(phrase, "bubble") : phrase));
  // What the teacher animates to: sentence spans (questions raise its eyebrows) and word starts (beats).
  const speech = {
    sentences: timeline.sentences.map((sentence) => ({ start: sentence.start, end: sentence.end, question: /\?["')\]]*$/.test(sentence.text) })),
    words: phrases.flatMap((phrase) => phrase.words.map((word) => ({
      start: word.start, end: word.end, text: word.text, emphasis: word.keyword || word.text.replace(/[^\p{L}]/gu, "").length >= 8
    })))
  };
  const mouth = mouthLevels(loudness.slice(0, frames));
  while (mouth.length < total) mouth.push(0);
  return {
    frames: total, audioFrames: frames, scenes, phrases, timeline, speech, mouth, narration: segments.join(" "),
    alignment: alignment?.stats || null, timing_source: timeline.source
  };
}

async function saveScenePlan(outputDir, scenes) {
  const summary = scenes.map(({ start, end, layout, role, mode, caption, mascot, cues, highlights, elements, points, stat_value, stat_label, code, variant }, i) => ({
    scene: i + 1, start_seconds: start / FPS, end_seconds: end / FPS, role, layout, mode, caption, variant,
    mascot: mascot.visible
      ? { visible: true, height_px: Math.round(mascot.height), side: mascot.flip ? "right" : "left" }
      : { visible: false, reason: mascot.reason },
    robot_cues: cues.map((cue) => ({ state: cue.state, start_seconds: cue.start / FPS, end_seconds: cue.end / FPS })),
    highlights,
    elements: elements.map((element) => ({ name: element.name, kind: element.kind, logo: Boolean(element.brand) })),
    points, stat_value, stat_label, code
  }));
  await writeFile(path.join(outputDir, "scene-plan.json"), JSON.stringify(summary, null, 2) + "\n", "utf8");
}

export async function renderVideo(plan, audioPath, outputDir, log = () => {}) {
  const subtitlesPath = path.join(outputDir, "subtitles.srt");
  const videoPath = path.join(outputDir, "video.mp4");
  await writeFile(subtitlesPath, toSrt(plan.phrases), "utf8");
  await saveScenePlan(outputDir, plan.scenes);

  const publicDir = await mkdtemp(path.join(os.tmpdir(), "remotion-public-"));
  await copyFile(audioPath, path.join(publicDir, "narration.wav"));
  const inputProps = {
    scenes: plan.scenes.map(({ cues, ...scene }) => scene), cues: plan.scenes.flatMap((scene) => scene.cues),
    phrases: plan.phrases, mouth: plan.mouth, speech: plan.speech,
    audio: "narration.wav", durationInFrames: plan.frames
  };
  // Render to a temporary name so a crashed render can never be mistaken for a finished video.
  const partial = videoPath.replace(/\.mp4$/, ".partial.mp4");
  await rm(partial, { force: true });
  await ensureBrowser();
  const serveUrl = await bundle({ entryPoint: ENTRY_POINT, rootDir: ROOT_DIR, publicDir });
  const composition = await selectComposition({ serveUrl, id: "Explainer", inputProps });
  let lastLogged = -1;
  await renderMedia({
    composition, serveUrl, codec: "h264", crf: 20, outputLocation: partial, inputProps, audioBitrate: "192k",
    onProgress: ({ progress }) => {
      const step = Math.floor(progress * 10);
      if (step > lastLogged) { lastLogged = step; log("render", "Rendered " + step * 10 + "%."); }
    }
  });
  await rm(videoPath, { force: true });
  await copyFile(partial, videoPath);
  await rm(partial, { force: true });
  await rm(publicDir, { recursive: true, force: true });
  return { videoPath, subtitlesPath };
}
