import assert from "node:assert/strict";
import { test } from "node:test";
import { CODE_LIMITS, highlightLines, planStoryboard } from "../src/storyboard.mjs";
import { loadFixture } from "./helpers.mjs";

const element = (name, kind = "server", is_product = false) => ({ name, kind, is_product });
const scene = (overrides) => ({
  title: "Scene", narration: "Requests go to servers.", claim_ids: ["c1"], layout: "focus", elements: [element("Server")],
  points: [], stat_value: "", stat_label: "", code: "", ...overrides
});

test("the hook becomes a title card", () => {
  const plan = planStoryboard({ title: "How caching works", hook: "Why is the second load faster?", scenes: [scene({})] });
  assert.equal(plan[0].layout, "title");
  assert.equal(plan[0].title, "How caching works");
});

test("fanout keeps the sender and draws a single receiver type three times", () => {
  const plan = planStoryboard({ title: "t", hook: "h", scenes: [scene({
    layout: "fanout", elements: [element("Users", "users"), element("NGINX", "load-balancer", true), element("App servers")]
  })] });
  assert.equal(plan[1].layout, "fanout");
  assert.equal(plan[1].has_source, true);
  assert.deepEqual(plan[1].elements.map((item) => item.name), ["Users", "NGINX", "App server 1", "App server 2", "App server 3"]);
});

test("layouts without the data they need fall back to one that fits", () => {
  const plan = planStoryboard({ title: "t", hook: "h", scenes: [
    scene({ layout: "stat", stat_value: "99.99%", narration: "Load balancers keep sites online." }),
    scene({ layout: "flow", elements: [element("API", "api")], points: ["Validates input", "Returns JSON"] }),
    scene({ layout: "made-up", elements: [element("Cache", "cache")] })
  ] });
  assert.equal(plan[1].layout, "focus", "stat needs its number in the narration");
  assert.equal(plan[2].layout, "list", "flow needs two elements");
  assert.equal(plan[3].layout, "focus", "unknown layouts are treated as focus");
});

test("the same composition is not repeated back to back unless it is a continuing diagram", () => {
  const points = ["First point here", "Second point here"];
  const plan = planStoryboard({ title: "t", hook: "h", scenes: [
    scene({ layout: "focus", points }), scene({ layout: "focus", points }), scene({ layout: "list", points }), scene({ layout: "list", points }),
    scene({ layout: "flow", elements: [element("A", "api"), element("B", "database")] }),
    scene({ layout: "flow", elements: [element("A", "api"), element("C", "cache")] })
  ] });
  const layouts = plan.slice(1).map((item) => item.layout);
  for (let i = 1; i < layouts.length; i += 1) {
    if (!["flow", "fanout", "steps"].includes(layouts[i])) assert.notEqual(layouts[i], layouts[i - 1], layouts.join(","));
  }
  assert.equal(layouts[5], "flow");
});

test("code scenes keep short snippets, highlight the narrated lines, and reject oversized code", () => {
  const code = "upstream backend {\n  server app1.example.com weight=3;\n  server app2.example.com;\n}";
  const plan = planStoryboard({ title: "t", hook: "h", scenes: [
    scene({ layout: "code", code, narration: "The weight parameter sends more traffic to the larger machine.", points: ["Weights", "Upstream"] }),
    scene({ layout: "code", code: "x".repeat(CODE_LIMITS.maxLineChars + 5), points: ["One step", "Two steps"] })
  ] });
  assert.equal(plan[1].layout, "code");
  assert.deepEqual(plan[1].highlight, [1]);
  assert.notEqual(plan[2].layout, "code");
  assert.deepEqual(highlightLines(["}", "{"], "nothing"), []);
});

test("scripts from before the graphics fields existed still plan without errors", () => {
  const plan = planStoryboard({ title: "Bees", hook: "How do bees talk?", scenes: [
    { title: "Dance", narration: "Bees dance.", claim_ids: ["c1"], visual_text: "Dance", visual_query: "bee" }
  ] });
  assert.equal(plan[1].layout, "focus");
  assert.equal(plan[1].elements[0].name, "Dance");
});

test("nginx fixture: the planner breaks up repeated lone-logo scenes", () => {
  const { script } = loadFixture("nginx");
  const layouts = planStoryboard(script).map((item) => item.layout);
  assert.equal(layouts[0], "title");
  for (let i = 1; i < layouts.length; i += 1) {
    if (!["flow", "fanout", "steps"].includes(layouts[i])) assert.notEqual(layouts[i], layouts[i - 1], layouts.join(","));
  }
});
