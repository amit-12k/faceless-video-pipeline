import { researchSchema, scriptSchema } from "./schemas.mjs";

const API_URL = "https://generativelanguage.googleapis.com/v1beta/interactions";
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function post(payload, stage) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("Missing GEMINI_API_KEY. Add it under repository Actions secrets.");
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetch(API_URL, {
        method: "POST",
        headers: { "content-type": "application/json", "x-goog-api-key": key },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(120000)
      });
      if (!response.ok) {
        const detail = (await response.text()).slice(0, 400);
        const error = new Error(stage + " API returned HTTP " + response.status + ": " + detail);
        error.retryable = response.status === 408 || response.status === 429 || response.status >= 500;
        throw error;
      }
      return await response.json();
    } catch (error) {
      lastError = error;
      const retryable = error.retryable || error.name === "TimeoutError" || error.name === "TypeError";
      if (!retryable || attempt === 3) break;
      await wait(attempt * 1500);
    }
  }
  throw lastError;
}

function collectText(value, result = []) {
  if (!value || typeof value !== "object") return result;
  if (Array.isArray(value)) {
    for (const item of value) collectText(item, result);
    return result;
  }
  if (value.type === "text" && typeof value.text === "string") result.push(value.text);
  for (const [key, child] of Object.entries(value)) {
    if (key === "output_text" && typeof child === "string") result.push(child);
    else if (child && typeof child === "object") collectText(child, result);
  }
  return result;
}

function getText(response) {
  if (typeof response.output_text === "string") return response.output_text;
  const text = collectText(response).join("\n").trim();
  if (!text) throw new Error("Gemini returned no text content.");
  return text;
}

function parseJson(text, label) {
  const cleaned = text.trim().replace(/^`{3}(?:json)?\s*/i, "").replace(/\s*`{3}$/, "");
  try { return JSON.parse(cleaned); }
  catch { throw new Error(label + " response was not valid JSON."); }
}

function normalizeUrl(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") return null;
    url.hash = "";
    url.pathname = url.pathname.replace(/\/+$/, "") || "/";
    return url.toString();
  } catch { return null; }
}

function groundedSources(value, found = new Map()) {
  if (!value || typeof value !== "object") return [...found.values()];
  if (Array.isArray(value)) {
    for (const item of value) groundedSources(item, found);
    return [...found.values()];
  }
  const candidate = value.url || value.uri || value.link;
  if (typeof candidate === "string") {
    const url = normalizeUrl(candidate);
    if (url) found.set(url, { url, title: typeof value.title === "string" ? value.title : "" });
  }
  for (const child of Object.values(value)) {
    if (child && typeof child === "object") groundedSources(child, found);
  }
  return [...found.values()];
}

const jsonFormat = (schema) => ({ type: "text", mime_type: "application/json", schema });

export async function researchTopic(topic, style, language) {
  const model = process.env.GEMINI_TEXT_MODEL || "gemini-3.8-flash";
  const prompt = [
    "Research this topic for a short vertical video.",
    "Topic: " + topic,
    "Editorial style: " + style,
    "Narration language: " + language,
    "Use web search. Return 5 to 12 concise, checkable material claims.",
    "Mark a claim supported only when search evidence directly supports it; otherwise mark uncertain or unsupported.",
    "For every claim, include exact URLs and titles of sources that support it. Never invent a URL.",
    "Prefer primary sources and reputable references. The final script must not use unsupported material claims."
  ].join("\n");
  const response = await post({
    model,
    input: [{ type: "user_input", content: [{ type: "text", text: prompt }] }],
    tools: [{ type: "google_search" }],
    response_format: jsonFormat(researchSchema)
  }, "Research");
  return { data: JSON.parse(getText(response)), groundedSources: groundedSources(response), model };
}

export async function writeScript(topic, style, language, research) {
  const model = process.env.GEMINI_TEXT_MODEL || "gemini-3.8-flash";
  const facts = research.claims.filter((claim) => claim.support === "supported");
  if (facts.length < 3) throw new Error("Research found fewer than three source-supported claims.");
  const prompt = [
    "Write an original vertical-video script using only these supported claims.",
    "Topic: " + topic,
    "Style: " + style,
    "Narration language: " + language,
    "Create 5 to 8 scenes. Give each a short title, concise visual_text for a motion-graphics card, 1 to 3 narration sentences, and claim_ids.",
    "Every material factual statement must be covered by one or more claim_ids.",
    "Do not add facts, statistics, dates, or causal claims absent from the research. Avoid quoting source wording.",
    "Keep hook plus all scene narration between 80 and 170 words.",
    "Supported research claims:",
    JSON.stringify(facts)
  ].join("\n");
  const response = await post({
    model,
    input: [{ type: "user_input", content: [{ type: "text", text: prompt }] }],
    response_format: jsonFormat(scriptSchema)
  }, "Script generation");
  return { data: JSON.parse(getText(response)), model };
}

export async function createNarrationAudio(narration, language) {
  const model = process.env.GEMINI_TTS_MODEL || "gemini-3.8-flash-lite-tts";
  const response = await post({
    model,
    input: [{
      type: "user_input",
      content: [{
        type: "text",
        text: "Read the following narration in " + language + " with clear, natural pacing: " + narration,
        annotations: [{ type: "speech_metadata", style: "clear, warm, conversational, steady pace" }]
      }]
    }],
    response_format: { type: "audio", mime_type: "audio/wav" },
    generation_config: { speech_config: [{ voice: "Kore" }] }
  }, "Text-to-speech");
  const audio = response.output_audio?.data || findAudio(response);
  if (!audio) throw new Error("Gemini TTS returned no audio data.");
  return { audio: Buffer.from(audio, "base64"), model };
}

function findAudio(value) {
  if (!value || typeof value !== "object") return null;
  if (Array.isArray(value)) {
    for (const item of value) {
      const audio = findAudio(item);
      if (audio) return audio;
    }
    return null;
  }
  if (value.type === "audio" && typeof value.data === "string") return value.data;
  for (const child of Object.values(value)) {
    const audio = findAudio(child);
    if (audio) return audio;
  }
  return null;
}
