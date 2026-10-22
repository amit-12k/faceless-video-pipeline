import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (part) => { stdout += part; });
    child.stderr.on("data", (part) => { stderr += part; });
    child.on("error", reject);
    child.on("close", (code) => code === 0 ? resolve({ stdout, stderr }) :
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
  return JSON.parse(result.stdout);
}

export async function renderVideo(script, audioPath, outputDir) {
  const audioDuration = Number((await probe(audioPath)).format?.duration || 0);
  if (!audioDuration || audioDuration > 180) throw new Error("Narration audio is missing or exceeds 180 seconds.");
  const scenes = script.scenes;
  const sceneDir = path.join(outputDir, "scene-assets");
  await mkdir(sceneDir, { recursive: true });
  const counts = scenes.map((scene, index) =>
    Math.max(1, scene.narration.trim().split(/\s+/).length + (index === 0 ? script.hook.trim().split(/\s+/).length : 0)));
  const total = counts.reduce((a, b) => a + b, 0);
  const durations = counts.map((count) => audioDuration * count / total);
  const palette = ["68D7C4", "F4B942", "8B9CFF", "FF7D8A", "A8D36A", "55B6E8", "D49BFF", "FF9866"];
  const clips = [];
  const captions = [];
  let elapsed = 0;

  for (let i = 0; i < scenes.length; i += 1) {
    const scene = scenes[i];
    const stem = "scene-" + String(i + 1).padStart(2, "0");
    const titleFile = path.join(sceneDir, stem + "-title.txt");
    const bodyFile = path.join(sceneDir, stem + "-body.txt");
    const clip = path.join(sceneDir, stem + ".mp4");
    const accent = palette[i % palette.length];
    const duration = durations[i];
    await writeFile(titleFile, wrap(scene.title, 22), "utf8");
    await writeFile(bodyFile, wrap(scene.visual_text, 25).split("\n").slice(0, 5).join("\n"), "utf8");
    const filters = [
      "drawbox=x=0:y=0:w=1080:h=1920:color=0x0B1020:t=fill",
      "drawbox=x=72:y=170:w=936:h=12:color=0x" + accent + ":t=fill",
      "drawbox=x=72:y=240:w=936:h=2:color=0x" + accent + "@0.35:t=fill",
      "drawtext=fontfile=/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf:textfile=" + titleFile + ":fontcolor=white:fontsize=62:x=84:y=340:line_spacing=20",
      "drawtext=fontfile=/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf:textfile=" + bodyFile + ":fontcolor=0xE5ECFF:fontsize=44:x=84:y=700:line_spacing=26",
      "drawtext=fontfile=/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf:text=0" + String(i + 1).padStart(2, "0") + ":fontcolor=0x" + accent + ":fontsize=34:x=84:y=110",
      "fade=t=in:st=0:d=0.3",
      "fade=t=out:st=" + Math.max(0.1, duration - 0.3).toFixed(3) + ":d=0.3"
    ].join(",");
    await run("ffmpeg", [
      "-hide_banner", "-loglevel", "error", "-y",
      "-f", "lavfi", "-i", "color=c=0x0B1020:s=1080x1920:r=30:d=" + duration.toFixed(3),
      "-vf", filters, "-an", "-c:v", "libx264", "-preset", "veryfast", "-crf", "23",
      "-pix_fmt", "yuv420p", "-r", "30", clip
    ]);
    clips.push("file '" + clip.replaceAll("'", "'\\''") + "'");
    const caption = (i === 0 ? script.hook + " " : "") + scene.narration;
    captions.push(String(i + 1), timecode(elapsed) + " --> " + timecode(elapsed + duration), wrap(caption, 40), "");
    elapsed += duration;
  }

  const concatFile = path.join(sceneDir, "concat.txt");
  const silentVideo = path.join(sceneDir, "silent.mp4");
  const subtitleFile = path.join(outputDir, "subtitles.srt");
  const finalVideo = path.join(outputDir, "video.mp4");
  await writeFile(concatFile, clips.join("\n") + "\n", "utf8");
  await writeFile(subtitleFile, captions.join("\n"), "utf8");
  await run("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-f", "concat", "-safe", "0",
    "-i", concatFile, "-an", "-c", "copy", silentVideo]);

  const subtitlePath = subtitleFile.replaceAll("\\", "/").replaceAll(":", "\\:");
  const vf = "subtitles=filename=" + subtitlePath + ":force_style='FontName=DejaVu Sans,FontSize=18,Outline=2,Shadow=1,MarginV=150',format=yuv420p";
  await run("ffmpeg", [
    "-hide_banner", "-loglevel", "error", "-y", "-i", silentVideo, "-i", audioPath,
    "-vf", vf, "-map", "0:v:0", "-map", "1:a:0", "-c:v", "libx264", "-preset", "veryfast",
    "-crf", "23", "-c:a", "aac", "-b:a", "128k", "-shortest", "-movflags", "+faststart", finalVideo
  ]);
  return { videoPath: finalVideo, subtitlesPath: subtitleFile };
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
