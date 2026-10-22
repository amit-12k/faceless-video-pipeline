import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { parseEbur128, parseSilences } from "../src/audio.mjs";
import { checkArtifacts, checkAudio, checkScenes, checkVideo, combine } from "../src/qa.mjs";

const goodAnalysis = () => ({
  probe: {
    format: { duration: "63.3", size: "18000000" },
    streams: [
      { codec_type: "video", codec_name: "h264", width: 1080, height: 1920, r_frame_rate: "30/1", pix_fmt: "yuv420p" },
      { codec_type: "audio", codec_name: "aac" }
    ]
  },
  black: [], frozen: [], decodeErrors: 0
});

test("a correct render passes the video checks", () => {
  assert.deepEqual(checkVideo(goodAnalysis(), 63.28).errors, []);
});

test("video checks catch wrong format, black frames, partial files, and length mismatches", () => {
  const analysis = goodAnalysis();
  analysis.probe.streams[0].width = 1920;
  analysis.probe.streams[0].height = 1080;
  analysis.probe.streams[0].r_frame_rate = "25/1";
  analysis.probe.streams.pop();
  analysis.black.push({ start: 10, end: 12 });
  analysis.decodeErrors = 3;
  analysis.frozen.push(30);
  const result = checkVideo(analysis, 60);
  for (const expected of ["1920x1080", "Frame rate", "Audio stream is missing", "Black frames", "decoding error", "narration lasts"]) {
    assert.ok(result.errors.some((error) => error.includes(expected)), expected);
  }
  assert.equal(result.warnings.length, 1, "a long still stretch is only a warning");
});

test("audio checks catch silence, clipping, long gaps, and duration mismatches", () => {
  const good = { integrated_lufs: -16.1, true_peak_dbtp: -1.6, silences: [], duration_seconds: 63.28 };
  assert.deepEqual(checkAudio(good, 63.28), { errors: [], warnings: [] });
  const bad = checkAudio({ integrated_lufs: -9, true_peak_dbtp: 0.4, silences: [{ start: 20, end: 23.5, duration: 3.5 }], duration_seconds: 50 }, 63.28);
  for (const expected of ["clips", "Silent gap", "narration lasts"]) assert.ok(bad.errors.some((error) => error.includes(expected)), expected);
  assert.ok(bad.warnings.some((warning) => warning.includes("LUFS")));
  assert.deepEqual(checkAudio(null).errors, ["Audio is missing."]);
  assert.ok(checkAudio({ integrated_lufs: -70, true_peak_dbtp: -60, silences: [], duration_seconds: 5 }).errors[0].includes("silent"));
});

test("scene checks require full coverage and the data each layout draws", () => {
  const scenes = [
    { layout: "title", start: 0, end: 90, elements: [], code: [] },
    { layout: "flow", start: 90, end: 400, elements: [], code: [] },
    { layout: "code", start: 410, end: 600, elements: [], code: [] }
  ];
  const result = checkScenes(scenes, 620);
  for (const expected of ["no elements", "empty code", "does not start where", "whole video"]) {
    assert.ok(result.errors.some((error) => error.includes(expected)), expected);
  }
});

test("artifact checks catch missing, empty, and invalid files", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "qa-test-"));
  await writeFile(path.join(dir, "ok.json"), "{}");
  await writeFile(path.join(dir, "empty.srt"), "");
  await writeFile(path.join(dir, "bad.json"), "{");
  const result = await checkArtifacts(dir, ["ok.json", "empty.srt", "bad.json", "video.mp4"]);
  assert.equal(result.errors.length, 3);
  assert.ok(result.errors.some((error) => error.startsWith("video.mp4 is missing")));
});

test("combined reports fail on any error and keep warnings separate", () => {
  const report = combine({ a: { errors: [], warnings: ["w"] }, b: { errors: ["e"], warnings: [] } });
  assert.equal(report.passed, false);
  assert.deepEqual(report.errors, ["b: e"]);
  assert.deepEqual(report.warnings, ["a: w"]);
});

test("ffmpeg loudness and silence output is parsed", () => {
  const stderr = "[silencedetect] silence_end: 12.5 | silence_duration: 2.5\nSummary:\n  Integrated loudness:\n    I:         -16.1 LUFS\n"
    + "  Loudness range:\n    LRA:         4.1 LU\n  True peak:\n    Peak:       -1.5 dBFS\n";
  assert.deepEqual(parseEbur128(stderr), { integrated_lufs: -16.1, loudness_range_lu: 4.1, true_peak_dbtp: -1.5 });
  assert.deepEqual(parseSilences(stderr), [{ start: 10, end: 12.5, duration: 2.5 }]);
});
