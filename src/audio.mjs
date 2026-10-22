import { spawn } from "node:child_process";
import { rm } from "node:fs/promises";
import { FPS } from "./timing.mjs";

export function run(command, args) {
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

export async function mediaDuration(file) {
  const { stdout } = await run("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file]);
  return Number(stdout.toString().trim()) || 0;
}

// Loudness (RMS) of the audio for every video frame.
export async function frameLoudness(audioPath) {
  const rate = 16000;
  const { stdout } = await run("ffmpeg", ["-v", "error", "-i", audioPath, "-ac", "1", "-ar", String(rate), "-f", "s16le", "-"]);
  const samples = Math.floor(stdout.length / 2);
  const frames = Math.max(1, Math.ceil(samples / (rate / FPS)));
  const sums = new Float64Array(frames);
  const counts = new Uint32Array(frames);
  for (let i = 0; i < samples; i += 1) {
    const frame = Math.min(frames - 1, Math.floor(i / (rate / FPS)));
    const sample = stdout.readInt16LE(i * 2) / 32768;
    sums[frame] += sample * sample;
    counts[frame] += 1;
  }
  return Array.from(sums, (sum, i) => Math.sqrt(sum / Math.max(1, counts[i])));
}

export function parseEbur128(stderr) {
  const summary = stderr.slice(stderr.lastIndexOf("Summary:"));
  const read = (pattern) => {
    const match = pattern.exec(summary);
    return match ? Number(match[1]) : null;
  };
  return {
    integrated_lufs: read(/I:\s+(-?[\d.]+|-inf) LUFS/),
    loudness_range_lu: read(/LRA:\s+(-?[\d.]+) LU/),
    true_peak_dbtp: read(/Peak:\s+(-?[\d.]+|-inf) dBFS/)
  };
}

export function parseSilences(stderr) {
  const silences = [];
  for (const match of stderr.matchAll(/silence_end: ([\d.]+) \| silence_duration: ([\d.]+)/g)) {
    const end = Number(match[1]);
    const duration = Number(match[2]);
    silences.push({ start: Math.max(0, end - duration), end, duration });
  }
  return silences;
}

// Integrated loudness, true peak, duration and silent stretches of an audio or video file.
export async function measureAudio(file) {
  const { stderr } = await run("ffmpeg", ["-nostats", "-hide_banner", "-i", file, "-vn",
    "-af", "ebur128=peak=true,silencedetect=noise=-45dB:d=0.8", "-f", "null", "-"]);
  return { ...parseEbur128(stderr), silences: parseSilences(stderr), duration_seconds: await mediaDuration(file) };
}

// Cleans the raw TTS narration: trims silence at both ends (keeping a short lead-in), adds tiny fades so the
// first and last words do not click, and normalises loudness to about -16 LUFS with true peak under -1.5 dBTP.
// Two-pass loudnorm in linear mode applies a single gain change, so the voice itself is not reshaped.
export async function prepareNarration(input, output) {
  const trimmed = output.replace(/\.wav$/, "") + "-trimmed.wav";
  await run("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-i", input, "-af",
    "silenceremove=start_periods=1:start_silence=0.15:start_threshold=-50dB,areverse,"
      + "silenceremove=start_periods=1:start_silence=0.3:start_threshold=-50dB,areverse",
    "-ar", "48000", "-ac", "1", "-c:a", "pcm_s16le", trimmed]);
  const duration = await mediaDuration(trimmed);
  if (duration < 1) throw new Error("Narration is empty or almost entirely silent.");

  const target = "I=-16:TP=-1.5:LRA=11";
  const { stderr } = await run("ffmpeg", ["-hide_banner", "-nostats", "-i", trimmed, "-af",
    "loudnorm=" + target + ":print_format=json", "-f", "null", "-"]);
  const stats = JSON.parse(stderr.slice(stderr.lastIndexOf("{"), stderr.lastIndexOf("}") + 1));
  const [i, tp, lra, thresh, offset] = ["input_i", "input_tp", "input_lra", "input_thresh", "target_offset"]
    .map((key) => Number(stats[key]));
  if (![i, tp, lra, thresh, offset].every(Number.isFinite)) throw new Error("Narration loudness could not be measured.");
  await run("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-i", trimmed, "-af",
    "loudnorm=" + target + ":linear=true:measured_I=" + i + ":measured_TP=" + tp + ":measured_LRA=" + lra
      + ":measured_thresh=" + thresh + ":offset=" + offset
      + ",afade=t=in:d=0.03,afade=t=out:st=" + Math.max(0, duration - 0.06).toFixed(3) + ":d=0.06",
    "-ar", "48000", "-ac", "1", "-c:a", "pcm_s16le", output]);
  await rm(trimmed, { force: true });
  return { source_lufs: i, source_true_peak_dbtp: tp, trimmed_seconds: duration };
}

// Cuts audio to [start, end) seconds with short fades, for removing speech that is not part of the script.
export async function trimAudio(input, output, start, end) {
  const length = Math.max(0.1, end - start);
  await run("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-ss", start.toFixed(3), "-t", length.toFixed(3), "-i", input,
    "-af", "afade=t=in:d=0.03,afade=t=out:st=" + Math.max(0, length - 0.06).toFixed(3) + ":d=0.06",
    "-ar", "48000", "-ac", "1", "-c:a", "pcm_s16le", output]);
}
