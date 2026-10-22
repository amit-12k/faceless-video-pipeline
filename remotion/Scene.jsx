import { AbsoluteFill, Easing, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { FLOW, MODE_TRANSFORMS, codeGeometry, fanoutGeometry, fanoutState, stepsTop } from "./geometry.js";
import { iconForKind } from "./icons.js";
import { Label, TechIcon } from "./TechIcon.jsx";
import { ACCENTS, COLORS, FONT, MONO } from "./theme.js";

// Each layout draws from remotion/geometry.js and reacts to scene.highlights: the frame (relative to the
// scene) at which each element, point, or code line is first mentioned in the narration.

const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" };
const mentioned = (at, frame) => at !== null && at !== undefined && frame >= at;

const usePop = (delay) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  return spring({ frame: frame - delay, fps, config: { damping: 14, mass: 0.7 } });
};

const Pop = ({ x, y, delay = 0, children }) => {
  const p = usePop(delay);
  return (
    <div style={{
      position: "absolute", left: x, top: y, display: "flex", flexDirection: "column", alignItems: "center", gap: 20,
      transform: `translate(-50%, -50%) translateY(${(1 - p) * 40}px) scale(${0.6 + 0.4 * p})`, opacity: Math.min(1, p * 1.4)
    }}>{children}</div>
  );
};

// Lights up an element while it is the subject of the narration.
const Lit = ({ on, accent, children }) => (
  <div style={{ transform: `scale(${on ? 1.06 : 1})`, filter: on ? `drop-shadow(0 0 22px ${accent})` : "none" }}>{children}</div>
);

const Chip = ({ children, accent }) => (
  <div style={{
    padding: "16px 30px", borderRadius: 999, fontFamily: FONT, fontWeight: 600, fontSize: 38, color: COLORS.ink,
    background: COLORS.panel, border: `2px solid ${accent}88`, maxWidth: 900, textAlign: "center"
  }}>{children}</div>
);

const Chips = ({ points, y, accent, highlights, fallbackDelay }) => points.slice(0, 2).map((point, i) => (
  <Pop key={i} x={540} y={y + i * 105} delay={highlights?.[i] ?? fallbackDelay + i * 10}><Chip accent={accent}>{point}</Chip></Pop>
));

const Connector = ({ from, to, gap, gapFrom = gap, delay, accent, active = true }) => {
  const frame = useCurrentFrame();
  const dx = to[0] - from[0];
  const dy = to[1] - from[1];
  const length = Math.hypot(dx, dy);
  const [ux, uy] = [dx / length, dy / length];
  const start = [from[0] + ux * gapFrom, from[1] + uy * gapFrom];
  const end = [to[0] - ux * gap, to[1] - uy * gap];
  const span = length - gap - gapFrom;
  const drawn = interpolate(frame, [delay, delay + 14], [0, 1], { ...clamp, easing: Easing.out(Easing.cubic) });
  const angle = Math.atan2(dy, dx) * 180 / Math.PI;
  const packets = drawn < 1 || !active ? [] : [0, 0.5].map((offset) => ((frame - delay) / 40 + offset) % 1);
  return (
    <g>
      <line x1={start[0]} y1={start[1]} x2={end[0]} y2={end[1]} stroke={accent} strokeOpacity={0.45} strokeWidth={6}
        strokeLinecap="round" strokeDasharray={span} strokeDashoffset={span * (1 - drawn)} />
      <g opacity={drawn} transform={`translate(${end[0]} ${end[1]}) rotate(${angle})`}><path d="M -18 -13 L 4 0 L -18 13 Z" fill={accent} /></g>
      {packets.map((t, i) => (
        <circle key={i} cx={start[0] + (end[0] - start[0]) * t} cy={start[1] + (end[1] - start[1]) * t} r={11}
          fill="#FFFFFF" style={{ filter: `drop-shadow(0 0 12px ${accent})` }} />
      ))}
    </g>
  );
};

// Requests travel node to node; each node lights up when the narration reaches it.
const Flow = ({ scene, accent }) => {
  const frame = useCurrentFrame();
  const elements = scene.elements.slice(0, 4);
  const { size, points } = FLOW[elements.length];
  const at = scene.highlights.elements;
  const reached = elements.map((_, i) => at[i] ?? i * 14);
  const bottom = Math.max(...points.slice(0, elements.length).map((p) => p[1])) + size / 2 + 140;
  const litIndex = reached.reduce((latest, value, i) => (frame >= value && at[i] !== null && at[i] !== undefined ? i : latest), -1);
  return (
    <>
      <svg width={1080} height={1400} style={{ position: "absolute", inset: 0 }}>
        {points.slice(1, elements.length).map((point, i) => (
          <Connector key={i} from={points[i]} to={point} gap={size / 2 + 26} delay={Math.max(14 + i * 14, reached[i + 1] - 10)}
            accent={accent} active={frame >= reached[i + 1] - 10} />
        ))}
      </svg>
      {elements.map((element, i) => (
        <Pop key={i} x={points[i][0]} y={points[i][1] + 30} delay={i * 8}>
          <Lit on={i === litIndex} accent={accent}><TechIcon element={element} size={size} accent={accent} /></Lit>
          <Label width={size + 90} size={36}>{element.name}</Label>
        </Pop>
      ))}
      {elements.length < 4 ? <Chips points={scene.points} y={bottom} accent={accent} highlights={scene.highlights.points} fallbackDelay={30} /> : null}
    </>
  );
};

// A distributor hands each request to a receiver chosen by the scene's strategy, shown live.
const Fanout = ({ scene, accent }) => {
  const frame = useCurrentFrame();
  const g = fanoutGeometry(scene);
  const state = fanoutState(frame, scene);
  const started = frame > 20;
  const t = (Math.max(0, frame - 20) % 26) / 26;
  const hub = [g.hub.x, g.hub.y];
  const target = g.targets[state.active];
  const from = [hub[0], hub[1] + 150];
  const to = [target.x, target.y - target.size / 2 - 10];
  const [source, hubElement, ...targets] = scene.has_source ? scene.elements : [null, ...scene.elements];
  const badge = (i) => (state.variant === "least" ? state.counts[i] + " active" : state.variant === "weighted" ? "weight " + state.weights[i] : null);
  return (
    <>
      <svg width={1080} height={1400} style={{ position: "absolute", inset: 0 }}>
        {g.source ? <Connector from={[g.source.x, g.source.y]} to={hub} gap={110} delay={6} accent={accent} /> : null}
        {g.targets.map((item, i) => (
          <Connector key={i} from={from} to={[item.x, item.y]} gap={item.size / 2 + 16} gapFrom={0} delay={12 + i * 4}
            accent={i === state.active && started ? COLORS.highlight : accent} active={false} />
        ))}
        {started ? <circle cx={from[0] + (to[0] - from[0]) * t} cy={from[1] + (to[1] - from[1]) * t} r={16}
          fill={COLORS.highlight} style={{ filter: `drop-shadow(0 0 14px ${COLORS.highlight})` }} /> : null}
      </svg>
      {g.source ? <Pop x={g.source.x} y={g.source.y} delay={0}><TechIcon element={source} size={g.source.size} accent={ACCENTS[1]} /></Pop> : null}
      {state.variant === "hash" && started ? (
        <div style={{
          position: "absolute", left: 540 + 130, top: hub[1] - 34, padding: "10px 20px", borderRadius: 16, fontFamily: MONO, fontSize: 32,
          color: COLORS.ink, background: "#1B2547", border: `2px solid ${COLORS.highlight}`
        }}>{state.client}</div>
      ) : null}
      <Pop x={hub[0]} y={hub[1] + 20} delay={4}>
        <TechIcon element={hubElement} size={g.hub.size} accent={accent} />
        <Label width={420} size={38}>{hubElement.name}</Label>
      </Pop>
      {targets.map((element, i) => (
        <Pop key={i} x={g.targets[i].x} y={g.targets[i].y + 20} delay={10 + i * 5}>
          <Lit on={i === state.active && started} accent={COLORS.highlight}>
            <TechIcon element={element} size={g.targets[i].size} accent={i === state.active && started ? COLORS.highlight : accent} />
          </Lit>
          <Label width={g.targets.length >= 4 ? 225 : 280} size={32}>{element.name}</Label>
          {badge(i) ? <div style={{ fontFamily: MONO, fontSize: 32, fontWeight: 700, color: i === state.active && started ? COLORS.highlight : COLORS.ink }}>{badge(i)}</div> : null}
        </Pop>
      ))}
    </>
  );
};

// Two options side by side; each side and its points come forward as the narration discusses them.
const Compare = ({ scene, accent }) => {
  const frame = useCurrentFrame();
  const [left, right] = scene.elements;
  const half = Math.ceil(scene.points.length / 2);
  const at = scene.highlights.elements;
  const pointAt = scene.highlights.points;
  const focus = mentioned(at[1], frame) && (!mentioned(at[0], frame) || at[1] >= at[0]) ? 1 : mentioned(at[0], frame) ? 0 : -1;
  const vs = usePop(14);
  const sides = [[left, 290, scene.points.slice(0, half), 0], [right, 790, scene.points.slice(half), half]];
  return (
    <>
      {sides.map(([element, x, points, offset], side) => {
        const color = ACCENTS[(ACCENTS.indexOf(accent) + side) % ACCENTS.length];
        return (
          <div key={side} style={{ opacity: focus === -1 || focus === side ? 1 : 0.8 }}>
            <Pop x={x} y={470} delay={side * 8}>
              <Lit on={focus === side} accent={color}><TechIcon element={element} size={240} accent={color} /></Lit>
              <Label width={440} size={42}>{element.name}</Label>
            </Pop>
            {points.slice(0, 2).map((point, i) => (
              <Pop key={i} x={x} y={770 + i * 150} delay={pointAt[offset + i] ?? at[side] ?? 22 + side * 30 + i * 10}>
                <div style={{
                  width: 440, padding: "22px 26px", borderRadius: 32, background: COLORS.panel, boxSizing: "border-box",
                  border: `2px solid ${focus === side ? color : COLORS.border}`, fontFamily: FONT, fontWeight: 600, fontSize: 36,
                  color: COLORS.ink, textAlign: "center", lineHeight: 1.2
                }}>{point}</div>
              </Pop>
            ))}
          </div>
        );
      })}
      <div style={{
        position: "absolute", left: 540 - 62, top: 470 - 62, width: 124, height: 124, borderRadius: "50%",
        display: "flex", alignItems: "center", justifyContent: "center", fontFamily: FONT, fontWeight: 700, fontSize: 46,
        color: "#0B1226", background: `linear-gradient(135deg, ${accent}, #F472B6)`, transform: `scale(${vs})`
      }}>VS</div>
    </>
  );
};

const parseStat = (value) => {
  const match = /^(\D*?)(\d[\d,]*(?:\.\d+)?)(.*)$/.exec(value.trim());
  if (!match) return null;
  return {
    prefix: match[1], number: Number(match[2].replaceAll(",", "")), decimals: (match[2].split(".")[1] || "").length,
    suffix: match[3], grouped: match[2].includes(",")
  };
};

const Stat = ({ scene, accent }) => {
  const frame = useCurrentFrame();
  const stat = parseStat(scene.stat_value);
  const progress = interpolate(frame, [6, 46], [0, 1], { ...clamp, easing: Easing.out(Easing.cubic) });
  const shown = stat
    ? stat.prefix + (stat.number * progress).toLocaleString("en-US", {
      minimumFractionDigits: stat.decimals, maximumFractionDigits: stat.decimals, useGrouping: stat.grouped
    }) + stat.suffix
    : scene.stat_value;
  const element = scene.elements[0];
  return (
    <>
      {element ? <Pop x={540} y={300} delay={0}><TechIcon element={element} size={170} accent={accent} /></Pop> : null}
      <Pop x={540} y={600} delay={4}>
        <div style={{
          fontFamily: FONT, fontWeight: 700, fontSize: shown.length > 7 ? 170 : 230, lineHeight: 1, letterSpacing: -6,
          backgroundImage: `linear-gradient(135deg, #FFFFFF 10%, ${accent} 90%)`, backgroundClip: "text", WebkitBackgroundClip: "text",
          color: "transparent", whiteSpace: "nowrap"
        }}>{shown}</div>
      </Pop>
      <Pop x={540} y={790} delay={14}><Label width={900} size={54} color={COLORS.ink}>{scene.stat_label}</Label></Pop>
      <Chips points={scene.points} y={940} accent={accent} highlights={scene.highlights.points} fallbackDelay={26} />
    </>
  );
};

const List = ({ scene, accent }) => {
  const element = scene.elements[0];
  const top = element ? 500 : 340;
  const Check = iconForKind("success");
  return (
    <>
      {element ? <Pop x={540} y={290} delay={0}><TechIcon element={element} size={170} accent={accent} /></Pop> : null}
      {scene.points.slice(0, 4).map((point, i) => (
        <Pop key={i} x={540} y={top + i * 140} delay={scene.highlights.points[i] ?? 8 + i * 12}>
          <div style={{
            width: 880, minHeight: 116, padding: "18px 30px", boxSizing: "border-box", borderRadius: 36, display: "flex",
            alignItems: "center", gap: 26, background: COLORS.panel, border: `2px solid ${COLORS.border}`
          }}>
            <Check size={56} color={accent} strokeWidth={2.2} style={{ flexShrink: 0 }} />
            <span style={{ fontFamily: FONT, fontWeight: 600, fontSize: 44, color: COLORS.ink, lineHeight: 1.15 }}>{point}</span>
          </div>
        </Pop>
      ))}
    </>
  );
};

const Focus = ({ scene, accent }) => {
  const frame = useCurrentFrame();
  const [main, ...others] = scene.elements;
  const satellites = others.slice(0, 3);
  const at = scene.highlights.elements;
  return (
    <>
      <div style={{ position: "absolute", left: 540 - 220, top: 600 - 220, width: 440, height: 440, borderRadius: "50%", border: `3px solid ${accent}55` }} />
      {satellites.map((element, i) => {
        const angle = (i / satellites.length) * Math.PI * 2 - Math.PI / 2 + 0.6;
        return (
          <Pop key={i} x={540 + Math.cos(angle) * 360} y={560 + Math.sin(angle) * 330} delay={at[i + 1] ?? 18 + i * 8}>
            <Lit on={mentioned(at[i + 1], frame) && frame < at[i + 1] + 45} accent={accent}>
              <TechIcon element={element} size={140} accent={ACCENTS[(ACCENTS.indexOf(accent) + i + 1) % ACCENTS.length]} />
            </Lit>
            <Label width={280} size={32}>{element.name}</Label>
          </Pop>
        );
      })}
      <Pop x={540} y={600} delay={0}>
        <Lit on={mentioned(at[0], frame) && frame < at[0] + 45} accent={accent}><TechIcon element={main} size={320} accent={accent} /></Lit>
        <Label width={700} size={52}>{main.name}</Label>
      </Pop>
      {satellites.length ? null : <Chips points={scene.points} y={980} accent={accent} highlights={scene.highlights.points} fallbackDelay={22} />}
    </>
  );
};

const Title = ({ scene, accent }) => {
  const frame = useCurrentFrame();
  const underline = interpolate(frame, [8, 26], [0, 1], { ...clamp, easing: Easing.out(Easing.cubic) });
  const element = scene.elements[0];
  return (
    <>
      {element ? <Pop x={540} y={330} delay={0}><TechIcon element={element} size={190} accent={accent} /></Pop> : null}
      <Pop x={540} y={element ? 650 : 570} delay={2}>
        <div style={{
          width: 900, textAlign: "center", fontFamily: FONT, fontWeight: 700, fontSize: scene.title.length > 34 ? 80 : 94,
          lineHeight: 1.08, color: COLORS.ink, letterSpacing: -1.5
        }}>{scene.title}</div>
        <div style={{ width: 360 * underline, height: 10, borderRadius: 5, background: `linear-gradient(90deg, ${accent}, #818CF8)` }} />
      </Pop>
    </>
  );
};

// Steps appear when they are spoken (or evenly through the scene), the current one emphasised.
const Steps = ({ scene, accent }) => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const steps = scene.points.slice(0, 4);
  const top = stepsTop(steps.length);
  const revealAt = steps.map((_, i) => scene.highlights.points[i] ?? 6 + Math.round((i / steps.length) * durationInFrames * 0.7));
  const current = revealAt.reduce((latest, at, i) => (frame >= at ? i : latest), 0);
  const lastShown = revealAt.filter((at) => frame >= at).length - 1;
  return (
    <>
      <div style={{
        position: "absolute", left: 136, top, width: 6, height: Math.max(0, lastShown) * 200, borderRadius: 3,
        background: `linear-gradient(180deg, ${accent}, ${accent}55)`
      }} />
      {steps.map((step, i) => {
        const isCurrent = i === current;
        return (
          <Pop key={i} x={540} y={top + i * 200} delay={revealAt[i]}>
            <div style={{ width: 900, display: "flex", alignItems: "center", gap: 34 }}>
              <div style={{
                width: 92, height: 92, borderRadius: "50%", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center",
                fontFamily: FONT, fontWeight: 700, fontSize: 44, color: isCurrent ? "#0B1226" : COLORS.ink,
                background: isCurrent ? accent : "#1B2547", border: `3px solid ${accent}`
              }}>{i + 1}</div>
              <div style={{
                flex: 1, padding: "24px 30px", borderRadius: 30, background: isCurrent ? "#1B2547" : COLORS.panel,
                border: `2px solid ${isCurrent ? accent : COLORS.border}`, fontFamily: FONT, fontWeight: 600, fontSize: 44,
                color: isCurrent ? COLORS.ink : "#D5DCF2", lineHeight: 1.15
              }}>{step}</div>
            </div>
          </Pop>
        );
      })}
    </>
  );
};

const TOKEN = /("[^"]*"|'[^']*'|#.*$|\/\/.*$|\b\d+(?:\.\d+)?[a-z%]*\b|[{}();,=:\[\]]|[A-Za-z_][\w.-]*|\s+|.)/g;
const tokenColor = (token, first) => {
  if (/^(#|\/\/)/.test(token)) return COLORS.muted;
  if (/^["']/.test(token)) return "#A7F3D0";
  if (/^\d/.test(token)) return "#FBBF24";
  if (/^[{}();,=:\[\]]$/.test(token)) return "#94A3B8";
  if (first) return "#A5B4FC";
  return COLORS.ink;
};

// Code typed in line by line; a line lights up when the narration talks about it.
const Code = ({ scene, accent }) => {
  const frame = useCurrentFrame();
  const lines = scene.code;
  const g = codeGeometry(lines);
  return (
    <div style={{
      position: "absolute", left: 72, top: g.top, width: 936, height: g.height, boxSizing: "border-box", borderRadius: 34,
      background: "rgba(8,12,28,0.95)", border: `2px solid ${COLORS.border}`, boxShadow: "0 30px 80px rgba(0,0,0,0.5)", overflow: "hidden",
      opacity: interpolate(frame, [0, 8], [0, 1], clamp)
    }}>
      <div style={{ height: 70, display: "flex", alignItems: "center", gap: 14, paddingLeft: 30, borderBottom: `2px solid ${COLORS.border}` }}>
        {["#F87171", "#FBBF24", "#34D399"].map((color) => <div key={color} style={{ width: 18, height: 18, borderRadius: 9, background: color }} />)}
      </div>
      <div style={{ padding: "24px 0" }}>
        {lines.map((line, i) => {
          const lit = mentioned(scene.highlights.lines[i], frame);
          let first = true;
          return (
            <div key={i} style={{
              height: g.lineHeight, display: "flex", alignItems: "center", paddingLeft: 30, whiteSpace: "pre", fontFamily: MONO, fontSize: g.fontSize,
              opacity: frame >= 8 + i * 5 ? 1 : 0, background: lit ? `${accent}2E` : "transparent", borderLeft: `6px solid ${lit ? accent : "transparent"}`
            }}>
              <span style={{ width: g.fontSize * 1.6, color: "#64748B", flexShrink: 0 }}>{i + 1}</span>
              {(line.match(TOKEN) || []).map((token, t) => {
                const color = tokenColor(token, first && /\w/.test(token));
                if (/\w/.test(token)) first = false;
                return <span key={t} style={{ color }}>{token}</span>;
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
};

const LAYOUTS = { flow: Flow, compare: Compare, stat: Stat, list: List, focus: Focus, title: Title, fanout: Fanout, steps: Steps, code: Code };

export const SceneView = ({ scene, index }) => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const accent = ACCENTS[index % ACCENTS.length];
  const Layout = LAYOUTS[scene.layout] || Focus;
  const { scale, top } = MODE_TRANSFORMS[scene.mode] || MODE_TRANSFORMS.diagram;
  const enter = interpolate(frame, [0, 10], [0, 1], { ...clamp, easing: Easing.out(Easing.cubic) });
  const exit = scene.role === "conclusion" ? 1 : interpolate(frame, [durationInFrames - 8, durationInFrames], [1, 0], clamp);
  // The scene's mode places the stage: smaller for presenter-led scenes, full size for code.
  return (
    <AbsoluteFill style={{
      opacity: Math.min(enter, exit), transformOrigin: "540px 0px",
      transform: `translateY(${top + (1 - enter) * 24}px) scale(${scale})`
    }}>
      <Layout scene={scene} accent={accent} />
    </AbsoluteFill>
  );
};
