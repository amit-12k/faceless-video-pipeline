import assert from "node:assert/strict";
import { test } from "node:test";
import { MODE_TRANSFORMS, boxToFrame, fanoutState, layoutGeometry, overlaps } from "../remotion/geometry.js";
import { CAPTION_BAND, SAFE } from "../remotion/layout.js";
import { MASCOT_HEIGHT, directScenes, mascotBox, mentionFrame, placeMascot } from "../src/direction.mjs";
import { checkCaptions, checkDirection } from "../src/qa.mjs";
import { planFixture } from "./helpers.mjs";

const element = (name, kind = "server") => ({ name, kind, brand: null });
const sample = {
  title: { layout: "title", title: "How caching works", elements: [element("Redis", "cache")], points: [] },
  flow: { layout: "flow", elements: [element("User", "user"), element("API", "api"), element("Database", "database")], points: ["Validates input"] },
  fanout: { layout: "fanout", has_source: true, variant: "least", elements: [element("Users", "users"), element("Balancer", "load-balancer"), element("A"), element("B"), element("C")], points: [] },
  compare: { layout: "compare", elements: [element("SQL", "database"), element("NoSQL", "database")], points: ["Fixed schema", "Joins", "Flexible", "Scales out"] },
  steps: { layout: "steps", elements: [], points: ["Request arrives", "Cache checked", "Database queried", "Response cached"] },
  list: { layout: "list", elements: [element("Cache", "cache")], points: ["One", "Two", "Three", "Four"] },
  stat: { layout: "stat", elements: [element("Uptime", "success")], points: ["Per year"], stat_value: "99.99%" },
  code: { layout: "code", elements: [], points: [], code: Array.from({ length: 10 }, () => "x".repeat(38)), highlight: [] },
  focus: { layout: "focus", elements: [element("Queue", "queue")], points: ["Decouples services", "Absorbs bursts"] }
};

test("every layout stays inside the frame and clear of the subtitle band in each mode", () => {
  for (const [name, scene] of Object.entries(sample)) {
    for (const [mode, transform] of Object.entries(MODE_TRANSFORMS)) {
      for (const region of layoutGeometry(scene).regions.map((box) => boxToFrame(box, transform))) {
        assert.ok(region.x >= 0 && region.x + region.w <= 1080, `${name} in ${mode} is wider than the frame`);
        assert.ok(region.y >= SAFE.top - 20, `${name} in ${mode} starts above the safe area`);
        assert.ok(!overlaps(region, CAPTION_BAND), `${name} in ${mode} reaches the subtitles`);
      }
    }
  }
});

test("robot size follows the mode, and it stays out of code scenes", () => {
  assert.equal(placeMascot("code", [], CAPTION_BAND.y).visible, false);
  for (const mode of ["presenter", "diagram", "process"]) {
    const placed = placeMascot(mode, [], CAPTION_BAND.y);
    assert.ok(placed.visible);
    assert.ok(Math.abs(mascotBox(placed).h - 1920 * MASCOT_HEIGHT[mode]) < 2, mode);
    assert.ok(mascotBox(placed).h / 1920 <= 0.3);
  }
  assert.ok(MASCOT_HEIGHT.presenter > MASCOT_HEIGHT.diagram && MASCOT_HEIGHT.diagram > MASCOT_HEIGHT.code);
});

test("the robot moves to the free side, shrinks, or steps out rather than covering content", () => {
  const leftBlocked = [{ x: 0, y: 900, w: 500, h: 440 }];
  const right = placeMascot("diagram", leftBlocked, CAPTION_BAND.y);
  assert.equal(right.flip, true, "stands on the right and faces left");
  assert.ok(!overlaps(mascotBox(right), leftBlocked[0]));
  const full = [{ x: 0, y: 700, w: 1080, h: 640 }];
  const hidden = placeMascot("diagram", full, CAPTION_BAND.y);
  assert.equal(hidden.visible, false);
  assert.match(hidden.reason, /no free space/);
});

test("mentions are found by word stem within the scene", () => {
  const words = [{ text: "The", start: 100 }, { text: "servers", start: 112 }, { text: "respond.", start: 120 }];
  assert.equal(mentionFrame("App server", words, 100), 12);
  assert.equal(mentionFrame("Database", words, 100), null);
});

test("fanout strategies: least picks the fewest connections, hash is sticky, weighted favours the heavy receiver", () => {
  for (let frame = 20; frame < 400; frame += 26) {
    const state = fanoutState(frame, sample.fanout);
    assert.equal(state.counts[state.active], Math.min(...state.counts));
  }
  const hashScene = { ...sample.fanout, variant: "hash" };
  const byClient = new Map();
  for (let frame = 20; frame < 600; frame += 26) {
    const { client, active } = fanoutState(frame, hashScene);
    if (byClient.has(client)) assert.equal(byClient.get(client), active, "the same client always reaches the same server");
    byClient.set(client, active);
  }
  const weighted = Array.from({ length: 10 }, (_, k) => fanoutState(20 + k * 26, { ...sample.fanout, variant: "weighted" }).active);
  assert.ok(weighted.filter((i) => i === 0).length > weighted.filter((i) => i === 1).length);
});

for (const name of ["nginx", "bee"]) {
  test(`${name}: direction passes the composition, character, and caption checks`, async () => {
    const plan = await planFixture(name);
    const result = checkDirection(plan);
    assert.deepEqual(result.errors, []);
    assert.equal(plan.scenes[0].role, "opening");
    assert.equal(plan.scenes[plan.scenes.length - 1].role, "conclusion");
    assert.ok(plan.scenes.filter((scene) => scene.caption === "bubble").length <= 1, "the bubble is an occasional remark, not the subtitle system");
    assert.ok(new Set(plan.scenes.map((scene) => scene.mascot.visible ? Math.round(scene.mascot.height) : 0)).size >= 2, "robot size varies with the scene");
    const captions = checkCaptions(plan.phrases, { frames: plan.frames, sceneBounds: plan.timeline.sceneBounds, narration: plan.timeline.words.map((w) => w.text).join(" ") });
    assert.deepEqual(captions.errors, []);
  });
}

test("pointing cues are timed to the first mention of the element they point at", async () => {
  const plan = await planFixture("nginx");
  const pointing = plan.cues.filter((cue) => cue.state === "point" && cue.target);
  assert.ok(pointing.length >= 1);
  for (const cue of pointing) {
    const scene = plan.scenes.find((item) => cue.start >= item.start && cue.start < item.end);
    const mentions = scene.highlights.elements.filter((at) => at !== null).map((at) => scene.start + at);
    assert.ok(mentions.some((at) => Math.abs(cue.start + 4 - at) <= 4), "starts as the element is named");
  }
});

test("QA catches a robot over content, missing conclusion, and an abrupt ending", async () => {
  const plan = await planFixture("nginx");
  const broken = structuredClone(plan);
  const scene = broken.scenes.find((item) => item.mascot.visible && item.regions.length);
  scene.mascot = { ...scene.mascot, left: scene.regions[0].x, top: scene.regions[0].y };
  broken.scenes[broken.scenes.length - 1].role = "body";
  broken.frames = broken.speech.words[broken.speech.words.length - 1].end + 2;
  const errors = checkDirection(broken).errors.join(" ");
  assert.match(errors, /robot covers diagram content/);
  assert.match(errors, /no concluding scene/);
  assert.match(errors, /ends less than 0.4s/);
  assert.ok(directScenes.length >= 0);
});

test("with the robot turned off, no scene shows it, captions are subtitles, and the title uses the full stage", async () => {
  const { scenes } = await planFixture("nginx");
  const { timeline, phrases } = await planFixture("nginx");
  const off = directScenes(scenes.map(({ mascot, cues, mode, caption, regions, highlights, role, ...scene }) => scene), timeline, phrases, { mascot: false });
  assert.ok(off.every((scene) => !scene.mascot.visible && scene.cues.length === 0 && scene.caption === "subtitle"));
  assert.equal(off[0].mode, "diagram");
  assert.deepEqual(checkDirection({ ...(await planFixture("nginx")), scenes: off, cues: [] }).errors, []);
});
