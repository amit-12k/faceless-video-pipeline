import { AbsoluteFill, Easing, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { Label, TechIcon } from "./TechIcon.jsx";
import { iconForKind } from "./icons.js";
import { ACCENTS, COLORS, FONT } from "./theme.js";

const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" };

const usePop = (delay) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  return spring({ frame: frame - delay, fps, config: { damping: 13, mass: 0.7 } });
};

// Positions an element by its centre point and pops it in after `delay` frames.
const Pop = ({ x, y, delay = 0, children }) => {
  const p = usePop(delay);
  return (
    <div style={{
      position: "absolute", left: x, top: y, display: "flex", flexDirection: "column", alignItems: "center", gap: 22,
      transform: `translate(-50%, -50%) translateY(${(1 - p) * 50}px) scale(${0.55 + 0.45 * p})`, opacity: Math.min(1, p * 1.4)
    }}>{children}</div>
  );
};

const Chip = ({ children, accent }) => (
  <div style={{
    padding: "16px 30px", borderRadius: 999, fontFamily: FONT, fontWeight: 500, fontSize: 36, color: COLORS.ink,
    background: "rgba(255,255,255,0.07)", border: `2px solid ${accent}66`, maxWidth: 900, textAlign: "center"
  }}>{children}</div>
);

const Chips = ({ points, y, accent, delay }) => points.slice(0, 2).map((point, i) => (
  <Pop key={i} x={540} y={y + i * 105} delay={delay + i * 10}><Chip accent={accent}>{point}</Chip></Pop>
));

const FLOW_POSITIONS = {
  2: { size: 250, points: [[290, 560], [790, 560]] },
  3: { size: 210, points: [[200, 560], [540, 560], [880, 560]] },
  4: { size: 210, points: [[290, 380], [790, 380], [790, 800], [290, 800]] }
};

const Connector = ({ from, to, gap, delay, accent }) => {
  const frame = useCurrentFrame();
  const dx = to[0] - from[0];
  const dy = to[1] - from[1];
  const length = Math.hypot(dx, dy);
  const ux = dx / length;
  const uy = dy / length;
  const start = [from[0] + ux * gap, from[1] + uy * gap];
  const end = [to[0] - ux * gap, to[1] - uy * gap];
  const span = length - gap * 2;
  const drawn = interpolate(frame, [delay, delay + 14], [0, 1], { ...clamp, easing: Easing.out(Easing.cubic) });
  const angle = Math.atan2(dy, dx) * 180 / Math.PI;
  const packets = drawn < 1 ? [] : [0, 0.5].map((offset) => ((frame - delay) / 40 + offset) % 1);
  return (
    <g>
      <line x1={start[0]} y1={start[1]} x2={end[0]} y2={end[1]} stroke={accent} strokeOpacity={0.35} strokeWidth={6}
        strokeLinecap="round" strokeDasharray={span} strokeDashoffset={span * (1 - drawn)} />
      <line x1={start[0]} y1={start[1]} x2={end[0]} y2={end[1]} stroke={accent} strokeWidth={4} strokeLinecap="round"
        strokeDasharray="2 22" strokeDashoffset={-frame * 2} opacity={drawn} />
      <g opacity={drawn} transform={`translate(${end[0]} ${end[1]}) rotate(${angle})`}>
        <path d="M -18 -13 L 4 0 L -18 13 Z" fill={accent} />
      </g>
      {packets.map((t, i) => (
        <circle key={i} cx={start[0] + (end[0] - start[0]) * t} cy={start[1] + (end[1] - start[1]) * t} r={11}
          fill="#FFFFFF" style={{ filter: `drop-shadow(0 0 12px ${accent})` }} />
      ))}
    </g>
  );
};

const Flow = ({ scene, accent }) => {
  const elements = scene.elements.slice(0, 4);
  const { size, points } = FLOW_POSITIONS[elements.length];
  const bottom = Math.max(...points.map((p) => p[1])) + size / 2 + 140;
  return (
    <>
      <svg width={1080} height={1920} style={{ position: "absolute", inset: 0 }}>
        {points.slice(1).map((point, i) => (
          <Connector key={i} from={points[i]} to={point} gap={size / 2 + 26} delay={14 + i * 14} accent={accent} />
        ))}
      </svg>
      {elements.map((element, i) => (
        <Pop key={i} x={points[i][0]} y={points[i][1] + 30} delay={i * 8}>
          <TechIcon element={element} size={size} accent={accent} />
          <Label width={size + 90} size={34}>{element.name}</Label>
        </Pop>
      ))}
      {elements.length < 4 ? <Chips points={scene.points} y={bottom} accent={accent} delay={30} /> : null}
    </>
  );
};

const Compare = ({ scene, accent }) => {
  const [left, right] = scene.elements;
  const half = Math.ceil(scene.points.length / 2);
  const sides = [[left, 290, scene.points.slice(0, half)], [right, 790, scene.points.slice(half)]];
  const vs = usePop(14);
  return (
    <>
      {sides.map(([element, x, points], side) => (
        <div key={side}>
          <Pop x={x} y={470} delay={side * 8}>
            <TechIcon element={element} size={240} accent={ACCENTS[(ACCENTS.indexOf(accent) + side) % ACCENTS.length]} />
            <Label width={420} size={40}>{element.name}</Label>
          </Pop>
          {points.slice(0, 2).map((point, i) => (
            <Pop key={i} x={x} y={770 + i * 150} delay={22 + side * 6 + i * 10}>
              <div style={{
                width: 440, padding: "22px 26px", borderRadius: 32, background: "rgba(255,255,255,0.07)",
                border: "2px solid rgba(255,255,255,0.12)", fontFamily: FONT, fontWeight: 500, fontSize: 34,
                color: COLORS.ink, textAlign: "center", lineHeight: 1.2
              }}>{point}</div>
            </Pop>
          ))}
        </div>
      ))}
      <div style={{
        position: "absolute", left: 540 - 62, top: 470 - 62, width: 124, height: 124, borderRadius: "50%",
        display: "flex", alignItems: "center", justifyContent: "center", fontFamily: FONT, fontWeight: 700, fontSize: 46,
        color: "#0B1226", background: `linear-gradient(135deg, ${accent}, #F472B6)`, transform: `scale(${vs}) rotate(${(1 - vs) * -90}deg)`,
        boxShadow: `0 0 50px ${accent}88`
      }}>VS</div>
    </>
  );
};

const parseStat = (value) => {
  const match = /^(\D*?)(\d[\d,]*(?:\.\d+)?)(.*)$/.exec(value.trim());
  if (!match) return null;
  const number = Number(match[2].replaceAll(",", ""));
  const decimals = (match[2].split(".")[1] || "").length;
  return { prefix: match[1], number, decimals, suffix: match[3], grouped: match[2].includes(",") };
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
          backgroundImage: `linear-gradient(135deg, #FFFFFF 10%, ${accent} 90%)`, backgroundClip: "text",
          WebkitBackgroundClip: "text", color: "transparent", filter: `drop-shadow(0 0 40px ${accent}66)`, whiteSpace: "nowrap"
        }}>{shown}</div>
      </Pop>
      <Pop x={540} y={790} delay={14}><Label width={900} size={52} color={COLORS.muted}>{scene.stat_label}</Label></Pop>
      <Chips points={scene.points} y={940} accent={accent} delay={26} />
    </>
  );
};

const List = ({ scene, accent }) => {
  const element = scene.elements[0];
  const top = element ? 500 : 340;
  const Check = iconForKind("success");
  return (
    <>
      {element ? (
        <Pop x={540} y={290} delay={0}>
          <TechIcon element={element} size={170} accent={accent} />
        </Pop>
      ) : null}
      {scene.points.slice(0, 4).map((point, i) => (
        <Pop key={i} x={540} y={top + i * 140} delay={8 + i * 12}>
          <div style={{
            width: 880, minHeight: 112, padding: "18px 30px", boxSizing: "border-box", borderRadius: 36, display: "flex",
            alignItems: "center", gap: 26, background: "rgba(255,255,255,0.07)", border: "2px solid rgba(255,255,255,0.12)"
          }}>
            <Check size={54} color={accent} strokeWidth={2.2} style={{ flexShrink: 0 }} />
            <span style={{ fontFamily: FONT, fontWeight: 600, fontSize: 42, color: COLORS.ink, lineHeight: 1.15 }}>{point}</span>
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
  const rings = [0, 0.5].map((offset) => ((frame / 60) + offset) % 1);
  return (
    <>
      {rings.map((t, i) => (
        <div key={i} style={{
          position: "absolute", left: 540 - 200, top: 560 - 200, width: 400, height: 400, borderRadius: "50%",
          border: `3px solid ${accent}`, transform: `scale(${0.9 + t * 0.9})`, opacity: (1 - t) * 0.5
        }} />
      ))}
      {satellites.map((element, i) => {
        const angle = (i / satellites.length) * Math.PI * 2 + frame * 0.012 - Math.PI / 2;
        return (
          <Pop key={i} x={540 + Math.cos(angle) * 360} y={560 + Math.sin(angle) * 330} delay={18 + i * 8}>
            <TechIcon element={element} size={130} accent={ACCENTS[(ACCENTS.indexOf(accent) + i + 1) % ACCENTS.length]} />
            <Label width={260} size={28}>{element.name}</Label>
          </Pop>
        );
      })}
      <Pop x={540} y={600} delay={0}>
        <TechIcon element={main} size={320} accent={accent} />
        <Label width={700} size={50}>{main.name}</Label>
      </Pop>
      {satellites.length ? null : <Chips points={scene.points} y={980} accent={accent} delay={22} />}
    </>
  );
};

const LAYOUTS = { flow: Flow, compare: Compare, stat: Stat, list: List, focus: Focus };

export const SceneView = ({ scene, index }) => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const accent = ACCENTS[index % ACCENTS.length];
  const Layout = LAYOUTS[scene.layout] || Focus;
  const exit = interpolate(frame, [durationInFrames - 9, durationInFrames], [1, 0], clamp);
  const drift = interpolate(frame, [0, durationInFrames], [1, 1.035]);
  return (
    // Shifted down so the graphic sits closer to the captions and presenter.
    <AbsoluteFill style={{ opacity: exit, transform: `translateY(90px) scale(${drift * (0.94 + 0.06 * exit)})` }}>
      <Layout scene={scene} accent={accent} />
    </AbsoluteFill>
  );
};
