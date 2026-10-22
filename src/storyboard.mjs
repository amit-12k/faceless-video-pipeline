// Turns the script's per-scene graphic suggestions into a renderable storyboard. Gemini proposes a layout for
// each scene; this checks that the scene has the data the layout needs, falls back to the closest layout that
// fits, and avoids showing the same composition twice in a row unless the scene genuinely needs it.

export const LAYOUTS = ["title", "flow", "fanout", "compare", "steps", "code", "stat", "list", "focus"];
export const CODE_LIMITS = { maxLines: 10, maxLineChars: 38 };
export const FANOUT_VARIANTS = ["rotate", "least", "hash", "weighted"];
const SOURCE_KINDS = new Set(["user", "users", "browser", "mobile"]);
const REPEATABLE = new Set(["flow", "fanout", "steps"]);

const words = (text) => (String(text || "").toLowerCase().match(/[\p{L}\p{N}_-]{4,}/gu) || []);

export function cleanCode(code) {
  const lines = String(code || "").replace(/\t/g, "  ").replace(/\r/g, "").split("\n").map((line) => line.replace(/\s+$/, ""));
  while (lines.length && !lines[0].trim()) lines.shift();
  while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
  const indent = Math.min(...lines.filter((line) => line.trim()).map((line) => line.match(/^ */)[0].length));
  return lines.map((line) => line.slice(Number.isFinite(indent) ? indent : 0));
}

// Picks up to two code lines that mention terms from the narration, to highlight while it is spoken.
export function highlightLines(lines, narration) {
  const terms = new Set(words(narration));
  return lines
    .map((line, index) => ({ index, score: words(line).filter((word) => terms.has(word.replace(/[=:;{}]/g, ""))).length }))
    .filter((item) => item.score > 0 && /[\p{L}]/u.test(lines[item.index]))
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, 2)
    .map((item) => item.index)
    .sort((a, b) => a - b);
}

function supports(layout, scene) {
  const { elements, points, code, narration } = scene;
  switch (layout) {
    case "flow": return elements.length >= 2;
    case "fanout": return elements.length >= 2;
    case "compare": return elements.length >= 2 || points.length >= 2;
    case "steps": return points.length >= 2;
    case "list": return points.length >= 2;
    case "code": return code.length >= 1 && code.length <= CODE_LIMITS.maxLines
      && code.every((line) => line.length <= CODE_LIMITS.maxLineChars);
    case "stat": {
      const digits = String(scene.stat_value || "").replace(/[^0-9]/g, "");
      return digits.length > 0 && narration.replace(/[^0-9]/g, "").includes(digits) && /\d/.test(scene.stat_value);
    }
    case "focus": return elements.length >= 1;
    default: return false;
  }
}

// Order of alternatives to try when a layout is unusable or would repeat the previous scene.
const FALLBACKS = {
  flow: ["fanout", "focus", "list"], fanout: ["flow", "focus", "list"], compare: ["list", "flow", "focus"],
  steps: ["list", "flow", "focus"], code: ["steps", "list", "focus"], stat: ["focus", "list", "steps"],
  list: ["focus", "compare", "steps"], focus: ["list", "steps", "flow", "compare"]
};

function shapeElements(layout, elements, points) {
  if (layout === "compare" && elements.length < 2) {
    const half = Math.ceil(points.length / 2);
    return [{ name: points[0], kind: "layers", brand: null }, { name: points[half] || points[1], kind: "layers", brand: null }];
  }
  if (layout === "fanout") {
    const source = elements.length >= 3 && SOURCE_KINDS.has(elements[0].kind) ? elements[0] : null;
    const [hub, ...targets] = source ? elements.slice(1) : elements;
    const receivers = targets.length === 1
      ? [1, 2, 3].map((n) => ({ ...targets[0], name: targets[0].name.replace(/s$/i, "") + " " + n }))
      : targets.slice(0, 4);
    return source ? [source, hub, ...receivers] : [hub, ...receivers];
  }
  return elements.slice(0, layout === "compare" ? 2 : 4);
}

// script: { title, hook, scenes[] }. resolveElement maps { name, kind, is_product } to a drawable element.
export function planStoryboard(script, resolveElement = (element) => ({ ...element, brand: null })) {
  const firstProduct = script.scenes.flatMap((scene) => scene.elements || []).find((element) => element.is_product);
  const planned = [{
    layout: "title", title: script.title, elements: firstProduct ? [resolveElement(firstProduct)] : [], has_source: false, variant: "",
    points: [], stat_value: "", stat_label: "", code: [], highlight: []
  }];
  let previous = "title";
  let previousMain = null;
  for (const raw of script.scenes) {
    const scene = {
      narration: String(raw.narration || ""),
      elements: (raw.elements || []).filter((element) => element && String(element.name || "").trim()).map(resolveElement),
      points: (raw.points || []).map((point) => String(point).trim()).filter(Boolean).slice(0, 4),
      code: cleanCode(raw.code),
      stat_value: String(raw.stat_value || ""),
      stat_label: String(raw.stat_label || "")
    };
    const requested = LAYOUTS.includes(raw.layout) && raw.layout !== "title" ? raw.layout : "focus";
    const options = [requested, ...FALLBACKS[requested]].filter((layout) => supports(layout, scene));
    let layout = options[0] || "focus";
    const main = scene.elements[0]?.name?.toLowerCase() || null;
    const repeats = layout === previous && !REPEATABLE.has(layout);
    const sameFocus = layout === "focus" && previous === "focus" && main === previousMain;
    if (repeats || sameFocus) layout = options.find((option) => option !== previous) || layout;
    if (layout === "focus" && !scene.elements.length) scene.elements = [{ name: raw.title || script.title, kind: "layers", brand: null }];
    planned.push({
      layout, title: String(raw.title || ""), elements: shapeElements(layout, scene.elements, scene.points),
      has_source: layout === "fanout" && scene.elements.length >= 3 && SOURCE_KINDS.has(scene.elements[0].kind),
      variant: layout === "fanout" && FANOUT_VARIANTS.includes(raw.variant) ? raw.variant : layout === "fanout" ? "rotate" : "",
      points: scene.points, stat_value: scene.stat_value, stat_label: scene.stat_label,
      code: layout === "code" ? scene.code : [], highlight: layout === "code" ? highlightLines(scene.code, scene.narration) : []
    });
    previous = layout;
    previousMain = main;
  }
  return planned;
}
