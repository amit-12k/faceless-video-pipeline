import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { overlaps } from "../remotion/geometry.js";
import { BUBBLE, CAPTION_BAND, CAPTION_STYLES, FRAME, SAFE, captionBottom } from "../remotion/layout.js";
import { characterPose, pointingAngle, placementAt } from "../remotion/rig.js";
import { MASCOT_HEIGHT, mascotBox } from "./direction.mjs";
import { mediaDuration, parseEbur128, parseSilences, run } from "./audio.mjs";
import { CAPTION_LIMITS, endsOnLeaningWord } from "./captions.mjs";
import { LAYOUTS } from "./storyboard.mjs";
import { FPS, splitWords } from "./timing.mjs";

// Quality checks run before a video is marked complete. Errors block the job; warnings are reported.
const bucket = () => ({ errors: [], warnings: [] });
const seconds = (frames) => (frames / FPS).toFixed(2) + "s";

export function checkCaptions(phrases, { frames, sceneBounds, narration }) {
  const result = bucket();
  if (!phrases.length) {
    result.errors.push("No captions were produced.");
    return result;
  }
  const spoken = phrases.flatMap((phrase) => phrase.words.map((word) => word.text)).join(" ");
  if (spoken !== splitWords(narration).join(" ")) result.errors.push("Caption text does not match the narration text.");
  phrases.forEach((phrase, i) => {
    const where = "Caption " + (i + 1) + " (" + seconds(phrase.start) + ")";
    if (!phrase.words.length || !phrase.text.trim()) result.errors.push(where + " is empty.");
    if (phrase.end <= phrase.start) result.errors.push(where + " has no display time.");
    if (phrase.start < 0 || phrase.end > frames + 1) result.errors.push(where + " is outside the video.");
    if (i > 0 && phrase.start < phrases[i - 1].end) result.errors.push(where + " overlaps the previous caption.");
    const [sceneStart, sceneEnd] = sceneBounds[phrase.segment] || [0, frames];
    if (phrase.start < sceneStart || phrase.spokenEnd > sceneEnd + 3) result.errors.push(where + " crosses a scene boundary.");
    const style = CAPTION_STYLES[phrase.style || "subtitle"];
    if (phrase.lines.length > style.maxLines) result.errors.push(where + " needs more than " + style.maxLines + " lines.");
    if (captionBottom(phrase.style || "subtitle", phrase.lines.length) > SAFE.bottom) result.errors.push(where + " extends below the mobile safe area.");
    for (const line of phrase.lines) {
      const chars = line.map((index) => phrase.words[index].text).join(" ").length;
      if (chars > style.lineChars * style.fontSize / style.minFontSize) result.errors.push(where + " has a line too long for the screen.");
    }
    const duration = (phrase.end - phrase.start) / FPS;
    if (duration < 0.5) result.warnings.push(where + " is shown for under half a second.");
    if (phrase.text.length / Math.max(duration, 0.1) > 25) result.warnings.push(where + " may be too fast to read.");
    const next = phrases[i + 1];
    const endsSentence = !next || next.sentence !== phrase.sentence;
    if (!endsSentence && endsOnLeaningWord(phrase.text)) result.warnings.push(where + " may break mid-phrase: \"" + phrase.text + "\".");
    if (next && next.segment !== phrase.segment && !/[.!?]["')\]]*$/.test(phrase.text)) {
      result.errors.push(where + " ends a scene with an unfinished sentence: \"" + phrase.text + "\".");
    }
  });
  return result;
}

// Compares what the voice said (whisper transcript) with the script.
export function checkSpeech(stats, source) {
  const result = bucket();
  if (source !== "transcript" || !stats) {
    result.warnings.push("Word timings were estimated from pauses because no usable transcript was available.");
    return result;
  }
  if (stats.leading_words.length >= 3) result.errors.push("Narration starts with words not in the script: \"" + stats.leading_words.join(" ") + "\".");
  if (stats.trailing_words.length >= 3) result.errors.push("Narration ends with words not in the script: \"" + stats.trailing_words.join(" ") + "\".");
  const limit = Math.max(4, Math.round((stats.script_words || 0) * 0.05));
  if (stats.extra_words.length > limit) result.errors.push("The voice added " + stats.extra_words.length + " words that are not in the script.");
  if (stats.matched_ratio < 0.85) result.errors.push("Only " + Math.round(stats.matched_ratio * 100) + "% of script words were heard in the narration.");
  else if (stats.matched_ratio < 0.95) result.warnings.push(Math.round(stats.matched_ratio * 100) + "% of script words were recognised in the narration.");
  return result;
}

// Composition and character checks, computed from the scene plan the renderer draws from.
// plan: { scenes (directed), cues, speech, mouth, frames, audioFrames }.
export function checkDirection(plan) {
  const result = bucket();
  const { scenes } = plan;
  const band = { x: CAPTION_BAND.x, y: CAPTION_BAND.y, w: CAPTION_BAND.w, h: CAPTION_BAND.h };
  const ctx = { cues: plan.cues, sentences: plan.speech.sentences, words: plan.speech.words, mouth: plan.mouth, scenes };
  scenes.forEach((scene, i) => {
    const where = "Scene " + (i + 1) + " (" + scene.layout + ")";
    if (!scene.regions.length && scene.layout !== "title") result.errors.push(where + " has nothing to show.");
    for (const region of scene.regions) {
      if (region.x < 0 || region.x + region.w > FRAME.width || region.y < SAFE.top - 20) result.errors.push(where + " draws outside the safe area.");
      if (scene.caption === "subtitle" && overlaps(region, band)) result.errors.push(where + " content runs into the subtitles.");
    }
    if (scene.caption === "bubble" && scene.regions.some((region) => overlaps(region, BUBBLE))) result.errors.push(where + " speech bubble covers content.");
    if (!scene.mascot.visible) return;
    if (scene.mode === "code") result.errors.push(where + " shows the robot over code.");
    const box = mascotBox(scene.mascot);
    if (scene.regions.some((region) => overlaps(box, region))) result.errors.push(where + " robot covers diagram content.");
    if (box.x < 0 || box.x + box.w > FRAME.width || box.y < SAFE.top) result.errors.push(where + " robot is clipped by the frame.");
    if (box.h > FRAME.height * (MASCOT_HEIGHT[scene.mode] || 0.3) * 1.1) result.warnings.push(where + " robot is larger than its mode allows.");
  });
  for (const cue of plan.cues) {
    const where = cue.state + " cue at " + seconds(cue.start);
    if (cue.end - cue.start < 8) result.errors.push(where + " is too short to read as a gesture.");
    if (cue.state !== "point" || cue.track) continue;
    const at = Math.round((cue.start + cue.end) / 2) + 6;
    const pose = characterPose(at, ctx);
    const wanted = pointingAngle(placementAt(at, scenes), cue.target);
    if (pose.state === "point" && Math.abs(pose.arms.rU - 6 - wanted) > 25) result.errors.push(where + " does not point at its target.");
  }
  scenes.forEach((scene, i) => {
    const changes = plan.cues.filter((cue) => cue.start >= scene.start && cue.start < scene.end).length;
    const seconds_ = (scene.end - scene.start) / FPS;
    if (changes > Math.max(2, seconds_ * 0.8)) result.warnings.push("Scene " + (i + 1) + " changes the robot's state " + changes + " times.");
  });
  const last = scenes[scenes.length - 1];
  if (!last || last.role !== "conclusion") result.errors.push("The video has no concluding scene.");
  else if ((last.end - last.start) / FPS < 2) result.errors.push("The concluding scene is shorter than 2 seconds.");
  const lastWord = plan.speech.words[plan.speech.words.length - 1];
  if (lastWord && plan.frames - lastWord.end < 12) result.errors.push("The video ends less than 0.4s after the last word.");
  return result;
}

export function checkScenes(scenes, frames) {
  const result = bucket();
  scenes.forEach((scene, i) => {
    const where = "Scene " + (i + 1);
    if (!LAYOUTS.includes(scene.layout)) result.errors.push(where + " has unknown layout " + scene.layout + ".");
    if (i > 0 && scene.start !== scenes[i - 1].end) result.errors.push(where + " does not start where the previous scene ends.");
    const length = (scene.end - scene.start) / FPS;
    if (length < 0.5) result.errors.push(where + " is shorter than half a second.");
    else if (length < 1.5) result.warnings.push(where + " lasts only " + length.toFixed(1) + "s.");
    if (["flow", "fanout", "compare", "focus"].includes(scene.layout) && !scene.elements.length) result.errors.push(where + " has no elements to draw.");
    if (scene.layout === "code" && !scene.code.length) result.errors.push(where + " has an empty code block.");
  });
  if (scenes.length && (scenes[0].start !== 0 || scenes[scenes.length - 1].end !== frames)) result.errors.push("Scenes do not cover the whole video.");
  const repeats = scenes.filter((scene, i) => i > 0 && scene.layout === scenes[i - 1].layout && !["flow", "fanout", "steps"].includes(scene.layout));
  if (repeats.length) result.warnings.push(repeats.length + " scene(s) repeat the previous layout.");
  return result;
}

export function checkAudio(measure, expectedSeconds) {
  const result = bucket();
  if (!measure || !measure.duration_seconds) {
    result.errors.push("Audio is missing.");
    return result;
  }
  const { integrated_lufs: lufs, true_peak_dbtp: peak, silences, duration_seconds: duration } = measure;
  if (lufs === null || lufs < -40) result.errors.push("Audio is silent or nearly silent.");
  else if (lufs < -19 || lufs > -13) result.warnings.push("Loudness is " + lufs + " LUFS; the target is about -16.");
  if (peak !== null && peak > 0) result.errors.push("Audio clips (true peak " + peak + " dBTP).");
  else if (peak !== null && peak > -1) result.warnings.push("True peak is " + peak + " dBTP; the target is -1 or lower.");
  for (const silence of silences || []) {
    const inside = silence.start > 0.5 && silence.end < duration - 0.5;
    if (inside && silence.duration > 2) result.errors.push("Silent gap of " + silence.duration.toFixed(1) + "s at " + silence.start.toFixed(1) + "s.");
  }
  if (expectedSeconds && Math.abs(duration - expectedSeconds) > 0.3) {
    result.errors.push("Audio lasts " + duration.toFixed(2) + "s but the narration lasts " + expectedSeconds.toFixed(2) + "s.");
  }
  return result;
}

// Decodes the whole file once, collecting stream info, black and frozen stretches, and audio levels.
export async function analyzeVideo(file) {
  const probe = JSON.parse((await run("ffprobe", ["-v", "error", "-show_entries",
    "format=duration,size:stream=codec_type,codec_name,width,height,r_frame_rate,pix_fmt", "-of", "json", file])).stdout.toString());
  const { stderr } = await run("ffmpeg", ["-nostats", "-hide_banner", "-v", "info", "-i", file,
    "-vf", "blackdetect=d=0.5:pix_th=0.02,freezedetect=n=-60dB:d=6",
    "-af", "ebur128=peak=true,silencedetect=noise=-45dB:d=0.8", "-f", "null", "-"]);
  const black = [...stderr.matchAll(/black_start:([\d.]+) black_end:([\d.]+)/g)].map((m) => ({ start: Number(m[1]), end: Number(m[2]) }));
  const frozen = [...stderr.matchAll(/freeze_start: ([\d.]+)/g)].map((m) => Number(m[1]));
  const decodeErrors = stderr.split("\n").filter((line) => /error while decoding|Invalid data|corrupt/i.test(line)).length;
  const duration = Number(probe.format?.duration || 0);
  return { probe, black, frozen, decodeErrors, audio: { ...parseEbur128(stderr), silences: parseSilences(stderr), duration_seconds: duration } };
}

export function checkVideo(analysis, expectedSeconds) {
  const result = bucket();
  const streams = analysis.probe.streams || [];
  const video = streams.find((item) => item.codec_type === "video");
  const audio = streams.find((item) => item.codec_type === "audio");
  const duration = Number(analysis.probe.format?.duration || 0);
  const size = Number(analysis.probe.format?.size || 0);
  if (!video) result.errors.push("Video stream is missing.");
  else {
    if (video.width !== FRAME.width || video.height !== FRAME.height) result.errors.push("Video is " + video.width + "x" + video.height + ", expected 1080x1920.");
    if (video.r_frame_rate !== FRAME.fps + "/1") result.errors.push("Frame rate is " + video.r_frame_rate + ", expected 30/1.");
    if (video.codec_name !== "h264" || video.pix_fmt !== "yuv420p") result.errors.push("Video is " + video.codec_name + "/" + video.pix_fmt + ", expected h264/yuv420p.");
  }
  if (!audio) result.errors.push("Audio stream is missing.");
  else if (audio.codec_name !== "aac") result.errors.push("Audio codec is " + audio.codec_name + ", expected aac.");
  if (size <= 0 || size > 250 * 1024 * 1024) result.errors.push("File is empty or larger than 250 MB.");
  if (duration < 10 || duration > 180) result.errors.push("Duration " + duration.toFixed(1) + "s is outside 10 to 180 seconds.");
  if (expectedSeconds && Math.abs(duration - expectedSeconds) > 0.25) {
    result.errors.push("Video lasts " + duration.toFixed(2) + "s but the narration lasts " + expectedSeconds.toFixed(2) + "s.");
  }
  if (analysis.decodeErrors) result.errors.push("Video has " + analysis.decodeErrors + " decoding error(s); the file may be partial.");
  for (const stretch of analysis.black) result.errors.push("Black frames from " + stretch.start.toFixed(1) + "s to " + stretch.end.toFixed(1) + "s.");
  for (const start of analysis.frozen) result.warnings.push("Picture barely changes for 6s or more from " + start.toFixed(1) + "s.");
  return result;
}

export async function checkArtifacts(outputDir, names) {
  const result = bucket();
  for (const name of names) {
    const file = path.join(outputDir, name);
    try {
      const info = await stat(file);
      if (!info.size) result.errors.push(name + " is empty.");
      else if (name.endsWith(".json")) JSON.parse(await readFile(file, "utf8"));
    } catch (error) {
      result.errors.push(name + (error.code === "ENOENT" ? " is missing." : " is invalid: " + error.message));
    }
  }
  return result;
}

export function combine(sections) {
  const report = { passed: true, sections: {} };
  for (const [name, section] of Object.entries(sections)) {
    report.sections[name] = section;
    if (section.errors.length) report.passed = false;
  }
  report.errors = Object.entries(sections).flatMap(([name, section]) => section.errors.map((message) => name + ": " + message));
  report.warnings = Object.entries(sections).flatMap(([name, section]) => section.warnings.map((message) => name + ": " + message));
  return report;
}

export { mediaDuration };
