import assert from "node:assert/strict";
import { test } from "node:test";
import { JOINT_LIMITS, RIG, STATES, characterPose, pointingAngle } from "../remotion/rig.js";

const placement = (overrides = {}) => ({ visible: true, left: 40, top: 900, scale: 0.6, flip: false, ...overrides });
const scenes = (mascot = placement()) => [{ start: 0, end: 600, layout: "flow", mascot }];
const speech = {
  sentences: [{ start: 30, end: 150, question: false }, { start: 200, end: 300, question: true }],
  words: Array.from({ length: 30 }, (_, i) => ({ start: 30 + i * 4, end: 34 + i * 4, text: ["routes", "every", "request", "to", "a", "backend", "server", "quickly"][i % 8], emphasis: i % 7 === 0 }))
};
const mouth = Array.from({ length: 600 }, (_, f) => (f >= 30 && f < 150 ? 0.4 + 0.4 * Math.abs(Math.sin(f)) : 0));
const ctx = (cues, mascot) => ({ cues, sentences: speech.sentences, words: speech.words, mouth, scenes: scenes(mascot) });

test("every state keeps the canonical rig: joints inside limits and no invalid values", () => {
  for (const state of STATES) {
    const cues = [{ start: 0, end: 600, state, target: [800, 300] }];
    for (const frame of [0, 5, 20, 90, 250, 590]) {
      const pose = characterPose(frame, ctx(cues));
      for (const value of [pose.arms.rU, pose.arms.rL, pose.arms.lU, pose.arms.lL, pose.head.tilt, pose.face.open, pose.face.mouth.w, pose.face.mouth.h]) {
        assert.ok(Number.isFinite(value), `${state} produced ${value}`);
      }
      assert.ok(pose.arms.rU >= JOINT_LIMITS.upper[0] && pose.arms.rU <= JOINT_LIMITS.upper[1]);
      assert.ok(Math.abs(pose.head.tilt) <= 12, `${state} tilts the head ${pose.head.tilt} degrees`);
      assert.equal(pose.placement.scale, 0.6, "states never resize the character");
    }
  }
  assert.equal(RIG.arm.upper, 100);
  assert.equal(RIG.colors.glow, "#5EEAD4");
});

test("state changes ease in without jumps", () => {
  const cues = [
    { start: 40, end: 90, state: "explain", variant: 0 }, { start: 100, end: 140, state: "point", target: [900, 200] },
    { start: 200, end: 240, state: "think" }, { start: 300, end: 360, state: "conclude" }
  ];
  let previous = characterPose(0, ctx(cues));
  for (let frame = 1; frame < 400; frame += 1) {
    const pose = characterPose(frame, ctx(cues));
    for (const key of ["rU", "rL", "lU", "lL"]) {
      assert.ok(Math.abs(pose.arms[key] - previous.arms[key]) < 30, `${key} jumps ${pose.arms[key] - previous.arms[key]} at frame ${frame}`);
    }
    previous = pose;
  }
});

for (const flip of [false, true]) {
  test(`pointing aims the arm and eyes at the target (${flip ? "mirrored" : "normal"})`, () => {
    const mascot = placement(flip ? { left: 700, flip: true } : {});
    const target = flip ? [300, 500] : [800, 450];
    const cues = [{ start: 50, end: 120, state: "point", target }];
    const pose = characterPose(90, ctx(cues, mascot));
    assert.equal(pose.state, "point");
    assert.ok(Math.abs(pose.arms.rU - 6 - pointingAngle(mascot, target)) < 2);
    assert.ok(pose.face.gaze[0] > 0, "eyes turn toward the target in the character's own coordinates");
    assert.ok(pose.pointing > 0.9);
  });
}

test("the mouth rests in silence and moves through several shapes while speaking", () => {
  const silent = characterPose(10, ctx([]));
  assert.equal(silent.face.mouth.h, 4);
  const shapes = new Set();
  for (let frame = 30; frame < 150; frame += 1) shapes.add(Math.round(characterPose(frame, ctx([])).face.mouth.h / 4));
  assert.ok(shapes.size >= 4, `only ${shapes.size} mouth openings`);
});

test("blinks happen every few seconds and the eyes are open otherwise", () => {
  let closed = 0;
  for (let frame = 0; frame < 600; frame += 1) if (characterPose(frame, ctx([])).face.open < 0.5) closed += 1;
  assert.ok(closed >= 4 && closed < 60, `${closed} closed frames in 20s`);
});

test("higher-priority cues win: pointing beats explaining, questions make it think", () => {
  const cues = [{ start: 0, end: 200, state: "explain" }, { start: 50, end: 90, state: "point", target: [800, 300] }, { start: 200, end: 240, state: "think" }];
  assert.equal(characterPose(60, ctx(cues)).state, "point");
  assert.equal(characterPose(120, ctx(cues)).state, "explain");
  assert.equal(characterPose(210, ctx(cues)).state, "think");
  assert.equal(characterPose(260, ctx(cues)).state, "speak");
  assert.equal(characterPose(400, ctx(cues)).state, "idle");
});
