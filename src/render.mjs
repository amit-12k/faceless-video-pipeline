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

const FONT = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf";
const FONT_BOLD = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf";
const countWords = (text) => text.trim().split(/\s+/).filter(Boolean).length;

function sceneInput(media, duration) {
  const seconds = duration.toFixed(3);
  if (media?.type === "video") return ["-stream_loop", "-1", "-t", seconds, "-i", media.path];
  if (media?.type === "image") return ["-loop", "1", "-framerate", "30", "-t", seconds, "-i", media.path];
  return ["-f", "lavfi", "-i", "color=c=0x0B1020:s=1080x1920:r=30:d=" + seconds];
}

// Fill the 9:16 frame: crop footage to the centre, and give photos a slow zoom so they do not sit still.
function backgroundFilters(media, duration) {
  if (media?.type === "video") {
    return ["scale=1080:1920:force_original_aspect_ratio=increase", "crop=1080:1920", "setsar=1", "fps=30",
      "drawbox=x=0:y=0:w=1080:h=1920:color=black@0.2:t=fill"];
  }
  if (media?.type === "image") {
    const frames = Math.max(1, Math.round(duration * 30));
    return ["scale=2160:3840:force_original_aspect_ratio=increase", "crop=2160:3840", "setsar=1",
      "zoompan=z='1+0.08*on/" + frames + "':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s=1080x1920:fps=30",
      "drawbox=x=0:y=0:w=1080:h=1920:color=black@0.2:t=fill"];
  }
  return [];
}

// Splits narration into short caption chunks, breaking after sentence ends or every few words.
function captionChunks(text, maxWords) {
  const chunks = [];
  let current = [];
  for (const word of text.replace(/\s+/g, " ").trim().split(" ")) {
    current.push(word);
    if (current.length >= maxWords || (/[.!?]$/.test(word) && current.length >= 3)) {
      chunks.push(current.join(" "));
      current = [];
    }
  }
  if (current.length) chunks.push(current.join(" "));
  return chunks;
}

export async function renderVideo(script, audioPath, outputDir, media = []) {
  const audioDuration = Number((await probe(audioPath)).format?.duration || 0);
  if (!audioDuration || audioDuration > 180) throw new Error("Narration audio is missing or exceeds 180 seconds.");
  const scenes = script.scenes;
  const sceneDir = path.join(outputDir, "scene-assets");
  await mkdir(sceneDir, { recursive: true });
  const spoken = scenes.map((scene, index) => (index === 0 ? script.hook + " " : "") + scene.narration);
  const counts = spoken.map((text) => Math.max(1, countWords(text)));
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
    const title = wrap(scene.title, 24).split("\n").slice(0, 2).join("\n");
    const bodyY = 200 + title.split("\n").length * 86 + 24;
    await writeFile(titleFile, title, "utf8");
    await writeFile(bodyFile, wrap(scene.visual_text, 30).split("\n").slice(0, 2).join("\n"), "utf8");
    const cardFile = path.join(sceneDir, stem + "-card.txt");
    await writeFile(cardFile, wrap(scene.visual_text, 18).split("\n").slice(0, 4).join("\n"), "utf8");
    // Without stock media, the visual text becomes the centre of a plain card.
    const card = media[i] ? [] : ["drawtext=fontfile=" + FONT_BOLD + ":textfile=" + cardFile + ":fontcolor=white:fontsize=88"
      + ":x=(w-text_w)/2:y=(h-text_h)/2:line_spacing=24"];
    const filters = [
      ...backgroundFilters(media[i], duration),
      ...card,
      // Dark bands keep the title and subtitles readable over bright footage.
      "drawbox=x=0:y=0:w=1080:h=" + (bodyY + 150) + ":color=black@0.5:t=fill",
      "drawbox=x=0:y=1400:w=1080:h=520:color=black@0.45:t=fill",
      "drawbox=x=72:y=150:w=936:h=10:color=0x" + accent + ":t=fill",
      "drawtext=fontfile=" + FONT_BOLD + ":text=" + String(i + 1).padStart(2, "0") + ":fontcolor=0x" + accent + ":fontsize=34:x=72:y=96",
      "drawtext=fontfile=" + FONT_BOLD + ":textfile=" + titleFile + ":fontcolor=white:fontsize=68:x=72:y=200:line_spacing=18",
      "drawtext=fontfile=" + FONT + ":textfile=" + bodyFile + ":fontcolor=0x" + accent + ":fontsize=44:x=72:y=" + bodyY + ":line_spacing=14",
      "fade=t=in:st=0:d=0.3",
      "fade=t=out:st=" + Math.max(0.1, duration - 0.3).toFixed(3) + ":d=0.3",
      "format=yuv420p"
    ].join(",");
    await run("ffmpeg", [
      "-hide_banner", "-loglevel", "error", "-y", ...sceneInput(media[i], duration),
      "-vf", filters, "-an", "-t", duration.toFixed(3), "-c:v", "libx264", "-preset", "veryfast", "-crf", "23",
      "-pix_fmt", "yuv420p", "-r", "30", clip
    ]);
    clips.push("file '" + clip.replaceAll("'", "'\\''") + "'");

    // Time each caption chunk by its share of the scene's characters.
    const chunks = captionChunks(spoken[i], 6);
    const chars = chunks.reduce((sum, chunk) => sum + chunk.length + 1, 0);
    let start = elapsed;
    for (const chunk of chunks) {
      const end = start + duration * (chunk.length + 1) / chars;
      captions.push(String(captions.length / 4 + 1), timecode(start) + " --> " + timecode(end), wrap(chunk, 24), "");
      start = end;
    }
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

  // libass renders SRT on a 384x288 canvas and scales it to the frame (about 6.7x for 1920 px high),
  // so FontSize=10 is roughly 67 px and MarginV=45 places captions about 300 px above the bottom.
  const subtitlePath = subtitleFile.replaceAll("\\", "/").replaceAll(":", "\\:");
  const style = "FontName=DejaVu Sans,Bold=1,FontSize=10,PrimaryColour=&H00FFFFFF,OutlineColour=&H00000000,"
    + "BorderStyle=1,Outline=1,Shadow=0,Alignment=2,MarginV=45,MarginL=10,MarginR=10";
  const vf = "subtitles=filename=" + subtitlePath + ":force_style='" + style + "',format=yuv420p";
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
