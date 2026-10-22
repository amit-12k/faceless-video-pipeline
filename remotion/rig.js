// Byte's animation controller. Pure functions: given a frame and the narration timeline, return how every
// part of the canonical rig should be posed. Character.jsx only draws this; tests check it directly.
// Identity (sizes and colours) lives in RIG and never changes between states; states only move joints,
// eyelids, brows, gaze, and the mouth.

import { FANOUT_CYCLE, MODE_TRANSFORMS, fanoutGeometry, fanoutState, toFrame } from "./geometry.js";

export const RIG = {
  viewBox: { width: 400, height: 600 },
  content: { x: 40, y: 0, width: 320, height: 560 }, // visible extent of the character inside the view box
  head: { x: 60, y: 54, width: 280, height: 236, radius: 76 },
  face: { x: 90, y: 92, width: 220, height: 164, radius: 56 },
  torso: { x: 104, y: 300, width: 192, height: 250, radius: 66 },
  chest: { x: 150, y: 360, width: 100, height: 70 },
  shoulders: { left: [120, 338], right: [280, 338] },
  arm: { upper: 100, lower: 92, width: 36, hand: 27 },
  colors: {
    shell: ["#FFFFFF", "#C7D2FE"], face: "#0B1226", glow: "#5EEAD4", cheek: "#F472B6",
    torso: ["#A5B4FC", "#6366F1"], limb: ["#C7D2FE", "#818CF8"], hand: "#E0E7FF", brow: "#A5B4FC"
  }
};

export const STATES = ["idle", "speak", "explain", "point", "think", "emphasis", "conclude", "greet"];
export const STATE_PRIORITY = { point: 6, emphasis: 5, greet: 4, think: 3, conclude: 2, explain: 2, speak: 1, idle: 0 };

// Arm angles in degrees: upper arm from straight down, then the elbow relative to it. Positive turns
// clockwise on screen, so the right arm (viewer's right) moves outward with negative angles.
const ARMS = {
  idle: { rU: -9, rL: -10, lU: 9, lL: 10 },
  speak: { rU: -14, rL: -26, lU: 14, lL: 26 },
  explain: { rU: -20, rL: -118, lU: 20, lL: 118 },
  explainOne: { rU: -56, rL: -92, lU: 11, lL: 20 },
  think: { rU: 30, rL: 150, lU: 12, lL: 18 },
  emphasis: { rU: -62, rL: -78, lU: 12, lL: 22 },
  conclude: { rU: -32, rL: -36, lU: 32, lL: 36 },
  greet: { rU: -122, rL: -28, lU: 10, lL: 14 },
  point: { rU: -120, rL: -8, lU: 11, lL: 18 }
};
export const JOINT_LIMITS = { upper: [-178, 60], lower: [-160, 160] };

const FACES = {
  idle: { browL: 0, browR: 0, open: 1, eyes: "round", rest: "smile", tilt: 0 },
  speak: { browL: 2, browR: 2, open: 1, eyes: "round", rest: "neutral", tilt: 0 },
  explain: { browL: 4, browR: 4, open: 1, eyes: "round", rest: "neutral", tilt: 3 },
  point: { browL: 5, browR: 5, open: 1.05, eyes: "round", rest: "neutral", tilt: 4 },
  think: { browL: 9, browR: -1, open: 0.82, eyes: "round", rest: "hmm", tilt: -6, gaze: [-6, -7] },
  emphasis: { browL: 10, browR: 10, open: 1.18, eyes: "round", rest: "o", tilt: 0 },
  conclude: { browL: 3, browR: 3, open: 1, eyes: "happy", rest: "smile", tilt: 2 },
  greet: { browL: 6, browR: 6, open: 1, eyes: "happy", rest: "smile", tilt: 3 }
};

const VISEMES = {
  closed: { w: 44, h: 4 }, fv: { w: 50, h: 9 }, round: { w: 30, h: 26 }, wide: { w: 66, h: 13 }, open: { w: 54, h: 32 }, mid: { w: 48, h: 18 }
};
const letterViseme = (ch) => (/[mbp]/.test(ch) ? "closed" : /[fv]/.test(ch) ? "fv" : /[ouwq]/.test(ch) ? "round"
  : /[eiy]/.test(ch) ? "wide" : ch === "a" ? "open" : "mid");

const mix = (a, b, t) => a + (b - a) * t;
const clamp = (value, [low, high]) => Math.min(high, Math.max(low, value));
// Critically damped ease-in over `length` frames: smooth start and settle, no overshoot.
export const ease = (elapsed, length = 10) => {
  const t = Math.max(0, elapsed) / length * 6;
  return Math.min(1, 1 - (1 + t) * Math.exp(-t));
};

// Where the character is drawn: { left, top, scale, flip, visible } eased between scenes.
export function placementAt(frame, scenes) {
  const index = Math.max(0, scenes.findIndex((scene) => frame >= scene.start && frame < scene.end));
  const current = scenes[index]?.mascot || { visible: false, left: 0, top: 1400, scale: 0.3, flip: false };
  const previous = index > 0 ? scenes[index - 1].mascot : current;
  const t = index > 0 ? ease(frame - scenes[index].start, 14) : 1;
  const fade = (m) => (m.visible ? 1 : 0);
  return {
    left: mix(previous.visible ? previous.left : current.left, current.left, t),
    top: mix(previous.visible ? previous.top : current.top, current.top, t),
    scale: mix(previous.visible ? previous.scale : current.scale, current.scale, t),
    flip: t < 0.5 && previous.visible ? previous.flip : current.flip,
    opacity: mix(fade(previous), fade(current), t),
    visible: current.visible || (previous.visible && t < 1)
  };
}

export function shoulderPosition(placement) {
  const [x, y] = RIG.shoulders.right;
  return [placement.left + (placement.flip ? RIG.viewBox.width - x : x) * placement.scale, placement.top + y * placement.scale];
}

// Arm rotation (degrees from straight down) that points the right arm at a frame position.
export function pointingAngle(placement, target) {
  const [sx, sy] = shoulderPosition(placement);
  const dx = (target[0] - sx) * (placement.flip ? -1 : 1);
  const dy = target[1] - sy;
  return clamp(Math.atan2(-dx, dy) * 180 / Math.PI, [-175, 10]);
}

function cueTarget(cue, frame, scenes) {
  if (!cue?.track) return cue?.target || null;
  const scene = scenes[cue.track.index];
  const { mode } = cue.track;
  const g = fanoutGeometry(scene);
  const { active } = fanoutState(frame - scene.start, scene);
  const t = g.targets[active];
  return t ? toFrame([t.x, t.y], MODE_TRANSFORMS[mode]) : null;
}

// The cue that controls this frame (highest priority), or the speaking/idle baseline.
export function activeState(frame, cues, sentences) {
  const covering = cues.filter((cue) => frame >= cue.start && frame < cue.end);
  const cue = covering.sort((a, b) => STATE_PRIORITY[b.state] - STATE_PRIORITY[a.state] || b.start - a.start)[0];
  if (cue) return { state: cue.state, cue };
  const speaking = sentences.some((sentence) => frame >= sentence.start && frame < sentence.end);
  return { state: speaking ? "speak" : "idle", cue: null };
}

function stateSince(frame, cues, sentences) {
  const marks = [0];
  for (const cue of cues) marks.push(cue.start, cue.end);
  for (const sentence of sentences) marks.push(sentence.start, sentence.end);
  return Math.max(...marks.filter((mark) => mark <= frame));
}

function armsFor(state, cue, placement, frame, scenes) {
  if (state === "explain" && cue?.variant === 1) return ARMS.explainOne;
  if (state === "point") {
    const target = cueTarget(cue, frame, scenes);
    if (target) return { ...ARMS.point, rU: pointingAngle(placement, target) + 6, rL: -8 };
  }
  return ARMS[state] || ARMS.idle;
}

function blinkAmount(frame) {
  // Irregular, deterministic blinks every 2.3 to 4.6 seconds, with an occasional double blink.
  for (let t = 37, i = 0; t <= frame; i += 1) {
    const age = frame - t;
    if (age < 6) return 1 - Math.abs(age - 2.5) / 2.5;
    const gap = 70 + ((i * 53 + 17) % 70);
    t += i % 5 === 3 ? 9 : gap;
  }
  return 0;
}

function mouthAt(frame, words, level, rest) {
  const word = words.find((item) => frame >= item.start && frame < item.end);
  if (!word || level < 0.05) return { ...VISEMES.closed, rest };
  const letters = word.text.toLowerCase().replace(/[^a-z]/g, "") || "a";
  const position = (frame - word.start) / Math.max(1, word.end - word.start) * letters.length;
  const current = VISEMES[letterViseme(letters[Math.min(letters.length - 1, Math.floor(position))])];
  const next = VISEMES[letterViseme(letters[Math.min(letters.length - 1, Math.floor(position) + 1)])];
  const blend = position % 1;
  const strength = Math.min(1.25, 0.45 + level);
  return { w: mix(current.w, next.w, blend), h: Math.max(4, mix(current.h, next.h, blend) * strength), rest: null };
}

// Full pose for a frame. ctx: { cues, sentences, words, mouth (levels 0..1), scenes }.
export function characterPose(frame, ctx) {
  const placement = placementAt(frame, ctx.scenes);
  const { state, cue } = activeState(frame, ctx.cues, ctx.sentences);
  const since = stateSince(frame, ctx.cues, ctx.sentences);
  const before = activeState(Math.max(0, since - 1), ctx.cues, ctx.sentences);
  const fromArms = armsFor(before.state, before.cue, placement, frame, ctx.scenes);
  const toArms = armsFor(state, cue, placement, frame, ctx.scenes);
  // Bigger moves take longer, so no joint swings faster than about 16 degrees per frame.
  const travel = Math.max(...Object.keys(toArms).map((key) => Math.abs(toArms[key] - fromArms[key])));
  const t = since === 0 ? 1 : ease(frame - since, Math.min(26, Math.max(10, travel / 7)));
  const arms = Object.fromEntries(Object.keys(toArms).map((key) => [key, mix(fromArms[key], toArms[key], t)]));
  if (state === "greet") arms.rL += Math.sin((frame - since) / 3) * 14 * t;
  arms.rU = clamp(arms.rU, JOINT_LIMITS.upper);
  arms.lU = clamp(arms.lU, [-60, 178]);
  arms.rL = clamp(arms.rL, JOINT_LIMITS.lower);
  arms.lL = clamp(arms.lL, JOINT_LIMITS.lower);

  const face = FACES[state];
  const fromFace = FACES[before.state];
  const level = ctx.mouth[Math.min(frame, ctx.mouth.length - 1)] || 0;
  const target = cueTarget(cue, frame, ctx.scenes);
  let gaze = face.gaze || [0, 0];
  if (target) {
    const [sx, sy] = shoulderPosition(placement);
    const dx = (target[0] - sx) * (placement.flip ? -1 : 1);
    const dy = target[1] - (sy - 160 * placement.scale);
    const length = Math.hypot(dx, dy) || 1;
    gaze = [dx / length * 8, dy / length * 8];
  }
  const emphasisWord = ctx.words.find((word) => word.emphasis && frame >= word.start && frame < word.start + 10);
  const nod = emphasisWord ? 4 * Math.exp(-(frame - emphasisWord.start) / 3) : 0;
  const speaking = state === "speak" || state === "explain" || state === "point";
  return {
    placement,
    state,
    pointing: state === "point" ? t : 0,
    arms,
    // Drawn in the character's own coordinates and mirrored as a whole, so tilts and gaze need no flipping.
    head: { tilt: mix(fromFace.tilt, face.tilt, t) + (speaking ? Math.sin(frame / 45) * 1.5 : 0), nod },
    body: { lean: (speaking ? 1.5 : 0) + (state === "point" ? 2 : 0), breathe: Math.sin(frame / 40) * 1.2 },
    antenna: { angle: Math.sin(frame / 30) * (state === "emphasis" ? 8 : 3), glow: 0.6 + level * 0.4 },
    face: {
      browL: mix(fromFace.browL, face.browL, t), browR: mix(fromFace.browR, face.browR, t),
      open: mix(fromFace.open, face.open, t) * (1 - blinkAmount(frame) * 0.88), eyes: face.eyes,
      gaze, mouth: mouthAt(frame, ctx.words, level, face.rest)
    }
  };
}
