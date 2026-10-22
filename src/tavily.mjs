import { postJson } from "./http.mjs";

const API_URL = "https://api.tavily.com/search";

function normalizeUrl(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") return null;
    url.hash = "";
    url.pathname = url.pathname.replace(/\/+$/, "") || "/";
    return url.toString();
  } catch { return null; }
}

export async function searchWeb(query) {
  const key = process.env.TAVILY_API_KEY;
  if (!key) throw new Error("Missing TAVILY_API_KEY. Add it under repository Actions secrets.");
  const response = await postJson(API_URL, { authorization: "Bearer " + key }, {
    query,
    search_depth: "basic",
    max_results: 8,
    include_answer: false,
    include_raw_content: false
  }, "Web search");
  const found = new Map();
  for (const result of response.results || []) {
    const url = normalizeUrl(result.url);
    const content = typeof result.content === "string" ? result.content.trim() : "";
    if (!url || !content || found.has(url)) continue;
    found.set(url, { url, title: typeof result.title === "string" ? result.title : "", content: content.slice(0, 1500) });
  }
  return [...found.values()];
}
