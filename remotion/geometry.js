// Where every diagram element sits. Scene.jsx draws from these positions, src/direction.mjs aims the
// robot's gaze and pointing at them, and src/qa.mjs checks that nothing covers them. Positions are in
// "stage" coordinates (1080 wide, content between y = 140 and 1110); a mode transform places the stage
// in the frame.

export const MODE_TRANSFORMS = {
  presenter: { scale: 0.8, top: 70 },
  diagram: { scale: 1, top: 80 },
  comparison: { scale: 1, top: 80 },
  process: { scale: 1, top: 80 },
  code: { scale: 1, top: 40 }
};

export const toFrame = ([x, y], t) => [540 + (x - 540) * t.scale, t.top + y * t.scale];
export const boxToFrame = (box, t) => ({ x: 540 + (box.x - 540) * t.scale, y: t.top + box.y * t.scale, w: box.w * t.scale, h: box.h * t.scale });
export const overlaps = (a, b, margin = 0) =>
  a.x < b.x + b.w + margin && b.x < a.x + a.w + margin && a.y < b.y + b.h + margin && b.y < a.y + a.h + margin;
const around = ([x, y], w, h) => ({ x: x - w / 2, y: y - h / 2, w, h });
const union = (boxes) => {
  const x = Math.min(...boxes.map((b) => b.x));
  const y = Math.min(...boxes.map((b) => b.y));
  return { x, y, w: Math.max(...boxes.map((b) => b.x + b.w)) - x, h: Math.max(...boxes.map((b) => b.y + b.h)) - y };
};

// A tile with its label below it: centre of the tile, plus the box the pair occupies.
const tile = (center, size, labelWidth = size + 90, labelHeight = 70) => ({
  x: center[0], y: center[1], size,
  box: { x: center[0] - Math.max(size, labelWidth) / 2, y: center[1] - size / 2, w: Math.max(size, labelWidth), h: size + 22 + labelHeight }
});

export const FLOW = {
  2: { size: 250, points: [[290, 560], [790, 560]] },
  3: { size: 210, points: [[200, 560], [540, 560], [880, 560]] },
  4: { size: 200, points: [[290, 400], [790, 400], [790, 800], [290, 800]] }
};

export function fanoutGeometry(scene) {
  const hasSource = Boolean(scene.has_source);
  const targets = scene.elements.length - (hasSource ? 2 : 1);
  const hub = [540, hasSource ? 440 : 360];
  const spacing = targets >= 4 ? 245 : 300;
  const targetSize = targets >= 4 ? 160 : 180;
  return {
    source: hasSource ? tile([540, 190], 140, 260, 50) : null,
    hub: tile(hub, 190, 420),
    targets: Array.from({ length: targets }, (_, i) => tile([540 + (i - (targets - 1) / 2) * spacing, 800], targetSize, spacing - 20, 50))
  };
}

export const stepsTop = (count) => 600 - ((count - 1) * 200) / 2;
export const codeGeometry = (lines) => {
  const longest = Math.max(1, ...lines.map((line) => line.length));
  const fontSize = Math.round(Math.max(30, Math.min(44, 800 / (longest * 0.6))));
  const lineHeight = Math.round(fontSize * 1.65);
  const height = lines.length * lineHeight + 130;
  return { fontSize, lineHeight, height, top: 600 - height / 2 };
};

// Anchors are the things the robot can look or point at; regions must stay unobstructed.
export function layoutGeometry(scene) {
  const anchors = [];
  const regions = [];
  const els = scene.elements || [];
  const points = scene.points || [];
  switch (scene.layout) {
    case "title": {
      if (els[0]) { const t = tile([540, 330], 190, 190, 0); anchors.push(t); regions.push(t.box); }
      regions.push({ x: 80, y: els[0] ? 520 : 440, w: 920, h: 300 });
      break;
    }
    case "flow": {
      const { size, points: centers } = FLOW[Math.min(4, Math.max(2, els.length))];
      centers.slice(0, els.length).forEach((c) => { const t = tile([c[0], c[1] + 30], size); anchors.push(t); regions.push(t.box); });
      if (els.length < 4) points.slice(0, 2).forEach((_, i) => regions.push(around([540, Math.max(...centers.map((c) => c[1])) + size / 2 + 140 + i * 105], 900, 90)));
      break;
    }
    case "fanout": {
      const g = fanoutGeometry(scene);
      for (const t of [g.source, g.hub, ...g.targets].filter(Boolean)) { anchors.push(t); regions.push(t.box); }
      break;
    }
    case "compare": {
      [[290, 470], [790, 470]].forEach((c) => { const t = tile(c, 240, 420); anchors.push(t); regions.push(t.box); });
      regions.push(around([540, 470], 130, 130));
      const half = Math.ceil(points.length / 2);
      [points.slice(0, half), points.slice(half)].forEach((side, s) => side.slice(0, 2)
        .forEach((_, i) => regions.push(around([s ? 790 : 290, 770 + i * 150], 460, 130))));
      break;
    }
    case "stat": {
      if (els[0]) { const t = tile([540, 300], 170, 170, 0); anchors.push(t); regions.push(t.box); }
      anchors.push({ x: 540, y: 600, size: 240 });
      regions.push(around([540, 600], 920, 260), around([540, 790], 920, 80));
      points.slice(0, 2).forEach((_, i) => regions.push(around([540, 940 + i * 105], 900, 90)));
      break;
    }
    case "list": {
      const top = els[0] ? 500 : 340;
      if (els[0]) { const t = tile([540, 290], 170, 170, 0); anchors.push(t); regions.push(t.box); }
      points.slice(0, 4).forEach((_, i) => { const box = around([540, top + i * 140], 880, 116); anchors.push({ x: 160, y: top + i * 140, size: 60, box }); regions.push(box); });
      break;
    }
    case "steps": {
      const top = stepsTop(Math.min(4, points.length));
      points.slice(0, 4).forEach((_, i) => { const box = around([540, top + i * 200], 900, 130); anchors.push({ x: 182, y: top + i * 200, size: 92, box }); regions.push(box); });
      break;
    }
    case "code": {
      const g = codeGeometry(scene.code || []);
      const box = { x: 72, y: g.top, w: 936, h: g.height };
      (scene.code || []).forEach((_, i) => anchors.push({ x: 300, y: g.top + 94 + (i + 0.5) * g.lineHeight, size: g.lineHeight, box }));
      regions.push(box);
      break;
    }
    default: { // focus
      const main = tile([540, 600], 320, 700);
      anchors.push(main);
      regions.push(main.box, around([540, 560], 760, 720));
      if (els.length <= 1) points.slice(0, 2).forEach((_, i) => regions.push(around([540, 980 + i * 105], 900, 90)));
    }
  }
  // regions: the individual boxes that must stay clear; bounds: their overall extent.
  return { anchors, regions, bounds: regions.length ? union(regions) : null };
}

// Which receiver a fanout sends the current request to, and the live connection counts for "least".
// Deterministic so the diagram, the robot's gaze, and the tests all agree.
export const FANOUT_CYCLE = 26;
export function fanoutState(frame, scene) {
  const g = fanoutGeometry(scene);
  const n = Math.max(1, g.targets.length);
  const step = Math.max(0, Math.floor((frame - 20) / FANOUT_CYCLE));
  const variant = scene.variant || "rotate";
  if (variant === "least") {
    const counts = [3, 1, 4, 2].slice(0, n).concat(Array(Math.max(0, n - 4)).fill(2));
    let active = 0;
    for (let s = 0; s <= step; s += 1) {
      if (s % 2 === 1) { const busiest = counts.indexOf(Math.max(...counts)); counts[busiest] = Math.max(0, counts[busiest] - 1); }
      active = counts.indexOf(Math.min(...counts));
      if (s < step) counts[active] += 1;
    }
    return { active, counts, variant };
  }
  if (variant === "hash") {
    const clients = ["10.0.0.7", "10.0.0.12", "10.0.0.31"];
    const client = clients[step % clients.length];
    const hash = [...client].reduce((sum, ch) => (sum * 31 + ch.charCodeAt(0)) % 9973, 7);
    return { active: hash % n, client, variant };
  }
  if (variant === "weighted") {
    const weights = Array.from({ length: n }, (_, i) => (i === 0 ? 3 : 1));
    const pattern = weights.flatMap((weight, i) => Array(weight).fill(i));
    return { active: pattern[step % pattern.length], weights, variant };
  }
  return { active: step % n, variant: "rotate" };
}
