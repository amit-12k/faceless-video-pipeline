const normalize = (value) => {
  try {
    const url = new URL(value);
    url.hash = "";
    url.pathname = url.pathname.replace(/\/+$/, "") || "/";
    return url.toString();
  } catch { return ""; }
};

export function validateProject(research, script, searched) {
  const errors = [];
  const flags = [];
  const searchedSet = new Set(searched.map((item) => normalize(item.url)).filter(Boolean));
  const claims = Array.isArray(research.claims) ? research.claims : [];
  const scenes = Array.isArray(script.scenes) ? script.scenes : [];
  if (!searchedSet.size) errors.push("Web search returned no source URLs.");
  if (claims.length < 5 || claims.length > 12) errors.push("Research must contain 5 to 12 claims.");

  for (const claim of claims) {
    const links = (claim.sources || []).map((source) => normalize(source.url)).filter(Boolean);
    if (claim.support === "supported" && !links.some((link) => searchedSet.has(link))) {
      errors.push("Supported claim " + claim.id + " has no URL present in the web search results.");
    }
    if (claim.support !== "supported") flags.push({ claim_id: claim.id, support: claim.support, claim: claim.claim });
  }

  if (scenes.length < 5 || scenes.length > 8) errors.push("Script must contain 5 to 8 scenes.");
  const used = new Set();
  for (const [index, scene] of scenes.entries()) {
    if (!scene.title?.trim() || !scene.narration?.trim()) {
      errors.push("Scene " + (index + 1) + " is missing a title or narration.");
    }
    if (!Array.isArray(scene.claim_ids) || !scene.claim_ids.length) errors.push("Scene " + (index + 1) + " has no claim references.");
    for (const id of scene.claim_ids || []) {
      used.add(id);
      const claim = claims.find((item) => item.id === id);
      if (!claim) errors.push("Scene " + (index + 1) + " references unknown claim " + id + ".");
      else if (claim.support !== "supported") errors.push("Scene " + (index + 1) + " uses non-supported claim " + id + ".");
    }
  }

  const narration = [script.hook, ...scenes.map((scene) => scene.narration)].filter(Boolean).join(" ");
  const words = narration.trim().split(/\s+/).filter(Boolean).length;
  if (words < 80 || words > 170) errors.push("Narration has " + words + " words; allowed range is 80 to 170.");
  if (used.size < 3) errors.push("Script must use at least three supported claims.");

  const sources = [...searchedSet].map((url) => ({
    url,
    title: searched.find((item) => normalize(item.url) === url)?.title || ""
  }));
  return {
    passed: errors.length === 0, errors, flags, word_count: words,
    scene_count: scenes.length, supported_claims_used: used.size,
    source_count: sources.length, sources,
    limitation: "Structural and source-link checks do not prove factual accuracy. Review cited sources and the video before publication."
  };
}
