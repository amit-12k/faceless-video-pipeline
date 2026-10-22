import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { downloadWhisperModel, installWhisperCpp, toCaptions, transcribe } from "@remotion/install-whisper-cpp";
import { run } from "./audio.mjs";

// Word timestamps for the narration from whisper.cpp, which runs locally on the runner (no API key or cost).
// The build and model are cached in WHISPER_DIR so later runs skip both.
const WHISPER_VERSION = "1.5.5";
const LANGUAGES = new Set(["Arabic", "Bengali", "Chinese", "Dutch", "English", "French", "German", "Gujarati", "Hindi",
  "Indonesian", "Italian", "Japanese", "Kannada", "Korean", "Malayalam", "Marathi", "Nepali", "Persian", "Polish",
  "Portuguese", "Punjabi", "Russian", "Spanish", "Swedish", "Tamil", "Telugu", "Thai", "Turkish", "Ukrainian", "Urdu", "Vietnamese"]);

export const whisperDir = () => process.env.WHISPER_DIR || path.join(os.homedir(), ".cache", "faceless-whisper");

export async function transcribeWords(audioPath, language) {
  const name = String(language || "").trim().replace(/^\w/, (c) => c.toUpperCase());
  const english = name === "English";
  const model = english ? "base.en" : "base";
  const dir = whisperDir();
  await installWhisperCpp({ to: dir, version: WHISPER_VERSION, printOutput: false });
  await downloadWhisperModel({ model, folder: dir, printOutput: false });

  const temp = await mkdtemp(path.join(os.tmpdir(), "whisper-"));
  const wav = path.join(temp, "narration-16k.wav");
  try {
    await run("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-i", audioPath, "-ar", "16000", "-ac", "1", "-c:a", "pcm_s16le", wav]);
    const output = await transcribe({
      inputPath: wav, whisperPath: dir, whisperCppVersion: WHISPER_VERSION, model, tokenLevelTimestamps: true,
      splitOnWord: true, printOutput: false, language: LANGUAGES.has(name) ? name : "auto"
    });
    const { captions } = toCaptions({ whisperCppOutput: output });
    return captions
      .map((caption) => ({ text: caption.text.trim(), start: caption.startMs / 1000, end: caption.endMs / 1000, confidence: caption.confidence }))
      .filter((word) => word.text && !/^\[.*\]$/.test(word.text));
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
}
