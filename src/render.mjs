import { spawn } from "node:child_process";
import { copyFile, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { bundle } from "@remotion/bundler";
import { ensureBrowser, renderMedia, selectComposition } from "@remotion/renderer";
import * as simpleIcons from "simple-icons";

const FPS = 30;
const ROOT_DIR = fileURLToPath(new URL("..", import.meta.url));
const ENTRY_POINT = path.join(ROOT_DIR, "remotion", "index.jsx");

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    const stdout = [];
    let stderr = "";
    child.stdout.on("data", (part) => { stdout.push(part); });
    child.stderr.on("data", (part) => { stderr += part; });
    child.on("error", reject);
    child.on("close", (code) => code === 0 ? resolve({ stdout: Buffer.concat(stdout), stderr }) :
      reject(new Error(command + " exited " + code + ": " + stderr.slice(-2500))));
  });
}

function wrap(text, maxChars) {
  const words = text.replace(/\s+/g, " ").trim().split(" ");
  const lines = [];
  let line = "";
  for (const word of words) {
    const next = line ? line + " " + word : word;
    if (next.length > maxChars && line) { lines.push(line); line = word; }
    else line = next;
  }
  if (line) lines.push(line);
  return lines.join("\n");
}

const timecode = (seconds) => {
  const ms = Math.max(0, Math.round(seconds * 1000));
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  return [h, m, s].map((n) => String(n).padStart(2, "0")).join(":") + "," + String(ms % 1000).padStart(3, "0");
};

async function probe(file) {
  const result = await run("ffprobe", [
    "-v", "error", "-show_entries", "format=duration,size:stream=codec_type,width,height",
    "-of", "json", file
  ]);
  return JSON.parse(result.stdout.toString());
}

const percentile = (values, p) => [...values].sort((a, b) => a - b)[Math.floor((values.length - 1) * p)] || 0;

// Loudness (RMS) of the narration for every video frame.
async function frameLoudness(audioPath, frames) {
  const rate = 16000;
  const { stdout } = await run("ffmpeg", ["-v", "error", "-i", audioPath, "-ac", "1", "-ar", String(rate), "-f", "s16le", "-"]);
  const perFrame = rate / FPS;
  const sums = new Float64Array(frames);
  const counts = new Uint32Array(frames);
  for (let i = 0; i + 1 < stdout.length; i += 2) {
    const frame = Math.min(frames - 1, Math.floor(i / 2 / perFrame));
    const sample = stdout.readInt16LE(i) / 32768;
    sums[frame] += sample * sample;
    counts[frame] += 1;
  }
  return Array.from(sums, (sum, i) => Math.sqrt(sum / Math.max(1, counts[i])));
}

// Moves estimated scene cuts onto the nearest pause in the narration so slides change between sentences.
function sceneBoundaries(weights, speaking, frames) {
  const pauses = [];
  for (let f = 0, start = -1; f <= frames; f += 1) {
    const silent = f < frames && !speaking[f];
    if (silent && start < 0) start = f;
    if (!silent && start >= 0) {
      if (f - start >= 8) pauses.push(Math.round((start + f) / 2));
      start = -1;
    }
  }
  const total = weights.reduce((a, b) => a + b, 0);
  const cuts = [0];
  let cumulative = 0;
  for (const weight of weights.slice(0, -1)) {
    cumulative += weight;
    const estimate = Math.round(frames * cumulative / total);
    const nearest = pauses.reduce((best, p) => Math.abs(p - estimate) < Math.abs(best - estimate) ? p : best, Infinity);
    const cut = Math.abs(nearest - estimate) <= 36 ? nearest : estimate;
    cuts.push(Math.max(cut, cuts[cuts.length - 1] + FPS));
  }
  cuts.push(frames);
  return cuts.map((start, i) => [start, cuts[i + 1]]).slice(0, weights.length);
}

// Spreads each scene's words over the frames where the narrator is actually speaking.
function timeWords(text, start, end, speaking) {
  const words = text.replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
  let voiced = [];
  for (let f = start; f < end; f += 1) if (speaking[f]) voiced.push(f);
  if (voiced.length < words.length) voiced = Array.from({ length: end - start }, (_, i) => start + i);
  const weights = words.map((word) => word.length + 1 + (/[.!?,;:]$/.test(word) ? 3 : 0));
  const total = weights.reduce((a, b) => a + b, 0);
  let cumulative = 0;
  const starts = weights.map((weight) => {
    const frame = voiced[Math.min(voiced.length - 1, Math.floor(voiced.length * cumulative / total))];
    cumulative += weight;
    return frame;
  });
  return words.map((word, i) => ({ text: word, start: starts[i], end: i + 1 < words.length ? starts[i + 1] : end }));
}

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

function resolveElement(element) {
  const name = String(element.name || "").trim().slice(0, 40) || "Concept";
  const key = normalizeName(name);
  const icon = element.is_product ? brandIndex.get(BRAND_ALIASES[key] || key) : null;
  return { name, kind: element.kind, brand: icon ? { path: icon.path, color: brandColor(icon.hex) } : null };
}

// Makes each scene's graphic match what its layout needs, falling back to simpler layouts when it does not.
function prepareScene(scene) {
  const elements = (scene.elements || []).slice(0, 4).map(resolveElement);
  const points = (scene.points || []).map((point) => String(point).trim()).filter(Boolean).slice(0, 4);
  const digits = (scene.stat_value || "").replace(/[^0-9]/g, "");
  let layout = scene.layout;
  if (layout === "stat" && (!digits || !scene.narration.replace(/[^0-9]/g, "").includes(digits))) layout = "focus";
  if (layout === "flow" && elements.length < 2) layout = "focus";
  if (layout === "compare" && elements.length < 2) layout = points.length ? "list" : "focus";
  if (layout === "list" && !points.length) layout = "focus";
  if (layout === "focus" && !elements.length) elements.push({ name: scene.title, kind: "layers", brand: null });
  return { layout, elements, points, stat_value: scene.stat_value || "", stat_label: scene.stat_label || "" };
}

function writeSubtitles(words) {
  const cues = [];
  for (let i = 0; i < words.length; i += 6) {
    const group = words.slice(i, i + 6);
    cues.push(String(cues.length + 1), timecode(group[0].start / FPS) + " --> " + timecode(group[group.length - 1].end / FPS),
      wrap(group.map((word) => word.text).join(" "), 32), "");
  }
  return cues.join("\n");
}

export async function renderVideo(script, audioPath, outputDir, log = () => {}) {
  const audioDuration = Number((await probe(audioPath)).format?.duration || 0);
  if (!audioDuration || audioDuration > 180) throw new Error("Narration audio is missing or exceeds 180 seconds.");
  const frames = Math.ceil(audioDuration * FPS);
  const loudness = await frameLoudness(audioPath, frames);
  const peak = percentile(loudness, 0.95) || 1;
  const speaking = loudness.map((value) => value > peak * 0.12);

  const spoken = script.scenes.map((scene, i) => (i === 0 ? script.hook + " " : "") + scene.narration);
  const bounds = sceneBoundaries(spoken.map((text) => text.length), speaking, frames);
  const words = bounds.flatMap(([start, end], i) => timeWords(spoken[i], start, end, speaking));
  const scenes = script.scenes.map((scene, i) => ({ start: bounds[i][0], end: bounds[i][1], ...prepareScene(scene) }));

  // Mouth openness per frame: loudness normalised to 0..1 and smoothed so it does not flicker.
  const mouth = [];
  for (const value of loudness) {
    const level = Math.min(1, value / peak) ** 0.8;
    const previous = mouth.length ? mouth[mouth.length - 1] : 0;
    mouth.push(Math.round((level > previous ? level * 0.7 + previous * 0.3 : level * 0.4 + previous * 0.6) * 100) / 100);
  }

  const subtitleFile = path.join(outputDir, "subtitles.srt");
  const finalVideo = path.join(outputDir, "video.mp4");
  await writeFile(subtitleFile, writeSubtitles(words), "utf8");

  const publicDir = await mkdtemp(path.join(os.tmpdir(), "remotion-public-"));
  await copyFile(audioPath, path.join(publicDir, "narration.wav"));
  const inputProps = { scenes, words, mouth, audio: "narration.wav", durationInFrames: frames };
  await saveScenes(outputDir, scenes);

  await ensureBrowser();
  const serveUrl = await bundle({ entryPoint: ENTRY_POINT, rootDir: ROOT_DIR, publicDir });
  const composition = await selectComposition({ serveUrl, id: "Explainer", inputProps });
  let lastLogged = -1;
  await renderMedia({
    composition, serveUrl, codec: "h264", crf: 20, outputLocation: finalVideo, inputProps,
    onProgress: ({ progress }) => {
      const step = Math.floor(progress * 10);
      if (step > lastLogged) { lastLogged = step; log("render", "Rendered " + step * 10 + "%."); }
    }
  });
  return { videoPath: finalVideo, subtitlesPath: subtitleFile };
}

async function saveScenes(outputDir, scenes) {
  const summary = scenes.map(({ start, end, layout, elements, points, stat_value, stat_label }, i) => ({
    scene: i + 1, start_seconds: start / FPS, end_seconds: end / FPS, layout,
    elements: elements.map((element) => ({ name: element.name, kind: element.kind, logo: Boolean(element.brand) })),
    points, stat_value, stat_label
  }));
  await writeFile(path.join(outputDir, "scene-plan.json"), JSON.stringify(summary, null, 2) + "\n", "utf8");
}

export async function checkVideo(file) {
  const data = await probe(file);
  const streams = data.streams || [];
  const video = streams.find((item) => item.codec_type === "video");
  const audio = streams.find((item) => item.codec_type === "audio");
  const duration = Number(data.format?.duration || 0);
  const size = Number(data.format?.size || 0);
  const errors = [];
  if (!video || video.width !== 1080 || video.height !== 1920) errors.push("Expected 1080x1920 video stream.");
  if (!audio) errors.push("Missing audio stream.");
  if (duration < 10 || duration > 180) errors.push("Duration must be between 10 and 180 seconds.");
  if (size <= 0 || size > 250 * 1024 * 1024) errors.push("File is empty or larger than 250 MB.");
  if (errors.length) throw new Error("Output check failed: " + errors.join(" "));
  return { width: video.width, height: video.height, duration_seconds: duration, size_bytes: size, audio_stream: true };
}
