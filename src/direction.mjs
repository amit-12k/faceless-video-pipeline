import { CAPTION_BAND, BUBBLE, SAFE } from "../remotion/layout.js";
import { MODE_TRANSFORMS, boxToFrame, layoutGeometry, overlaps, toFrame } from "../remotion/geometry.js";
import { RIG } from "../remotion/rig.js";

// Scene direction: decides, for every scene, how it is presented and what the robot does. It turns the
// storyboard (what each scene shows) and the narration timeline (when each word is spoken) into:
// - mode: presenter, diagram, code, comparison, or process, which sets the stage scale;
// - mascot: whether the robot appears, its size and position (never over a diagram region);
// - caption: subtitles, or a speech bubble for a short in-character remark;
// - highlights: when each element, point, or code line is first mentioned, so diagrams react on cue;
// - cues: the robot's states over time (pointing at what is being mentioned, thinking on questions, ...).

export const MODE_FOR_LAYOUT = {
  title: "presenter", flow: "diagram", fanout: "diagram", focus: "diagram", stat: "diagram",
  code: "code", compare: "comparison", steps: "process", list: "process"
};
// Robot height as a share of the 1920 px frame for each mode (0 = absent).
export const MASCOT_HEIGHT = { presenter: 0.26, diagram: 0.15, comparison: 0.13, process: 0.13, code: 0 };
const STOP = new Set("the a an and or of to in on for with is are was be by as at it its this that from into than then".split(" "));
const stem = (word) => word.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "").replace(/(ies|es|s)$/u, "");
const significant = (label) => String(label || "").split(/[\s/._=:{}();-]+/).map(stem).filter((word) => word.length >= 3 && !STOP.has(word));

// First frame (relative to the scene) at which a label's words are spoken in this scene, or null.
export function mentionFrame(label, sceneWords, sceneStart) {
  const wanted = significant(label);
  if (!wanted.length) return null;
  const hit = sceneWords.find((word) => wanted.includes(stem(word.text)));
  return hit ? hit.start - sceneStart : null;
}

export function mascotBox(placement) {
  const k = placement.scale;
  const left = placement.left + (placement.flip ? RIG.viewBox.width - RIG.content.x - RIG.content.width : RIG.content.x) * k;
  return { x: left, y: placement.top + RIG.content.y * k, w: RIG.content.width * k, h: RIG.content.height * k };
}

// Tries the bottom corners above the captions, then beside the diagram at mid-height, shrinking once,
// and otherwise leaves the robot out rather than covering anything.
export function placeMascot(mode, regions, captionTop) {
  const share = MASCOT_HEIGHT[mode];
  if (!share) return { visible: false, left: 0, top: captionTop, scale: 0.3, flip: false, reason: "mode keeps the content clear" };
  for (const factor of [1, 0.78]) {
    const height = 1920 * share * factor;
    const scale = height / RIG.content.height;
    const width = RIG.viewBox.width * scale;
    const bottom = captionTop - 12 - height;
    const middle = Math.min(bottom, 960 - height / 2);
    const left = SAFE.left - RIG.content.x * scale;
    const right = SAFE.right - width + RIG.content.x * scale;
    for (const [x, top, flip] of [[left, bottom, false], [right, bottom, true], [left, middle, false], [right, middle, true]]) {
      const placement = { visible: true, left: x, top, scale, flip };
      // Leave room for gestures: hands reach about a fifth of the body height past the torso.
      const box = mascotBox(placement);
      const reach = { x: box.x - box.h * 0.12, y: box.y - box.h * 0.08, w: box.w + box.h * 0.24, h: box.h * 1.08 };
      if (!regions.some((region) => overlaps(reach, region, 12))) return { ...placement, height };
    }
  }
  return { visible: false, left: 0, top: captionTop, scale: 0.3, flip: false, reason: "no free space beside the diagram" };
}

// options.mascot = false renders without the robot: subtitles only, and diagrams use the full stage.
export function directScenes(scenes, timeline, phrases, options = {}) {
  const withMascot = options.mascot !== false;
  const lastIndex = scenes.length - 1;
  return scenes.map((scene, index) => {
    const role = index === 0 ? "opening" : index === lastIndex ? "conclusion" : "body";
    const presenting = withMascot && (scene.layout === "title" || (role === "conclusion" && ["focus", "list", "stat"].includes(scene.layout)));
    const mode = presenting ? "presenter" : scene.layout === "title" ? "diagram" : MODE_FOR_LAYOUT[scene.layout] || "diagram";
    const transform = MODE_TRANSFORMS[mode];
    const geometry = layoutGeometry(scene);
    const regions = geometry.regions.map((box) => boxToFrame(box, transform));
    const words = timeline.words.filter((word) => word.segment === index);
    const scenePhrases = phrases.filter((phrase) => phrase.segment === index);

    // A short opening line can be the robot's own remark in a bubble; everything else uses subtitles.
    const bubbleFits = mode === "presenter" && scenePhrases.length <= 2 && !regions.some((region) => overlaps(BUBBLE, region, 10));
    const caption = bubbleFits && role === "opening" ? "bubble" : "subtitle";
    const captionTop = caption === "bubble" ? BUBBLE.y + BUBBLE.h + 30 : CAPTION_BAND.y;
    const mascot = withMascot ? placeMascot(mode, regions, Math.min(captionTop, CAPTION_BAND.y))
      : { visible: false, left: 0, top: CAPTION_BAND.y, scale: 0.3, flip: false, reason: "robot turned off for this video" };

    // Points appear in order: a mention can bring one forward, but never later than an even schedule.
    const duration = scene.end - scene.start;
    const pointTimes = [];
    scene.points.forEach((point, i) => {
      const even = 8 + Math.round((i / Math.max(1, scene.points.length)) * duration * 0.7);
      const heard = mentionFrame(point, words, scene.start);
      const at = Math.min(heard ?? Infinity, even);
      pointTimes.push(i === 0 ? at : Math.max(at, pointTimes[i - 1] + 8));
    });
    const highlights = {
      elements: scene.elements.map((element) => mentionFrame(element.name, words, scene.start)),
      points: pointTimes,
      lines: (scene.code || []).map((line, i) => (scene.highlight.includes(i) ? mentionFrame(line, words, scene.start) ?? 30 : null))
    };

    const cues = [];
    const add = (cue) => {
      // Skip near-duplicates of the same state; following a fanout's traffic is its own kind of cue.
      const clash = cues.some((other) => other.state === cue.state && Boolean(other.track) === Boolean(cue.track)
        && cue.start < other.end + 20 && other.start < cue.end + 20);
      if (cue.end - cue.start >= 8 && !clash) cues.push(cue);
    };
    if (mascot.visible) {
      const sentences = timeline.sentences.filter((sentence) => sentence.segment === index);
      if (role === "opening") add({ start: scene.start, end: Math.min(scene.end, scene.start + 40), state: "greet" });
      if (role === "conclusion") add({ start: scene.start + 6, end: scene.end, state: "conclude" });
      sentences.forEach((sentence, s) => {
        if (/\?["')\]]*$/.test(sentence.text)) add({ start: sentence.start, end: Math.min(sentence.end, sentence.start + 45), state: "think" });
        else if (role === "body" && sentence.text.split(/\s+/).length > 12) add({ start: sentence.start, end: Math.min(sentence.end, sentence.start + 42), state: "explain", variant: s % 2 });
      });
      // Point at up to two diagram elements as they are first mentioned; look along a fanout's traffic.
      const anchors = geometry.anchors;
      const mentions = highlights.elements.map((at, i) => ({ at, anchor: anchors[i] }))
        .filter((item) => item.at !== null && item.anchor).sort((a, b) => a.at - b.at).slice(0, 2);
      for (const { at, anchor } of mentions) {
        const start = scene.start + Math.max(0, at - 4);
        add({ start, end: Math.min(scene.end, start + 36), state: "point", target: toFrame([anchor.x, anchor.y], transform) });
      }
      if (scene.layout === "fanout") {
        const lastPoint = Math.max(scene.start, ...cues.filter((cue) => cue.state === "point").map((cue) => cue.end));
        add({ start: lastPoint + 10, end: Math.min(scene.end, lastPoint + 70), state: "point", track: { index, mode } });
      }
      if (scene.layout === "stat" && mentions.length === 0) add({ start: scene.start + 8, end: scene.start + 30, state: "emphasis" });
    }
    cues.sort((a, b) => a.start - b.start);
    return { ...scene, role, mode, caption, mascot, regions, highlights, cues };
  });
}
