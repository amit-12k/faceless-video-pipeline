import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { getJson } from "./http.mjs";

const API_URL = "https://pixabay.com/api/";
const MAX_BYTES = 80 * 1024 * 1024;

async function download(url, file) {
  const response = await fetch(url, { signal: AbortSignal.timeout(120000) });
  if (!response.ok) throw new Error("Media download returned HTTP " + response.status + ".");
  const data = Buffer.from(await response.arrayBuffer());
  if (!data.length || data.length > MAX_BYTES) throw new Error("Media download was empty or larger than 80 MB.");
  await writeFile(file, data);
}

// Prefer the 1920px rendition so the 9:16 centre crop is not upscaled too far.
function videoRendition(hit) {
  for (const size of ["large", "medium"]) {
    const rendition = hit.videos?.[size];
    if (rendition?.url && rendition.width >= 1280) return rendition;
  }
  return null;
}

async function findVideo(key, query, used) {
  const params = new URLSearchParams({ key, q: query, video_type: "film", safesearch: "true", per_page: "10" });
  const data = await getJson(API_URL + "videos/?" + params, "Pixabay video search");
  for (const hit of data.hits || []) {
    const rendition = videoRendition(hit);
    if (used.has("video:" + hit.id) || !rendition || hit.duration < 4) continue;
    return { type: "video", id: "video:" + hit.id, url: rendition.url, page: hit.pageURL, author: hit.user };
  }
  return null;
}

async function findImage(key, query, used) {
  for (const orientation of ["vertical", "all"]) {
    const params = new URLSearchParams({ key, q: query, image_type: "photo", orientation, safesearch: "true", per_page: "10" });
    const data = await getJson(API_URL + "?" + params, "Pixabay image search");
    const hit = (data.hits || []).find((item) => !used.has("image:" + item.id) && item.largeImageURL);
    if (hit) return { type: "image", id: "image:" + hit.id, url: hit.largeImageURL, page: hit.pageURL, author: hit.user };
  }
  return null;
}

// Returns one entry per scene: a downloaded stock video or photo, or null to fall back to a text card.
export async function findSceneMedia(scenes, mediaDir, log) {
  const key = process.env.PIXABAY_API_KEY;
  if (!key) {
    log("visuals", "PIXABAY_API_KEY is not set; using text cards.");
    return scenes.map(() => null);
  }
  await mkdir(mediaDir, { recursive: true });
  const used = new Set();
  const media = [];
  for (const [index, scene] of scenes.entries()) {
    const query = (scene.visual_query || scene.title).slice(0, 100);
    try {
      const found = await findVideo(key, query, used) || await findImage(key, query, used);
      if (!found) {
        log("visuals", "No stock media for scene " + (index + 1) + " (" + query + "); using a text card.");
        media.push(null);
        continue;
      }
      const file = path.join(mediaDir, "scene-" + String(index + 1).padStart(2, "0") + (found.type === "video" ? ".mp4" : ".jpg"));
      await download(found.url, file);
      used.add(found.id);
      media.push({ type: found.type, path: file, query, source: found.page, author: found.author });
    } catch (error) {
      log("visuals", "Stock media failed for scene " + (index + 1) + ": " + error.message + " Using a text card.");
      media.push(null);
    }
  }
  return media;
}
