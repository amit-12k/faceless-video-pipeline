import { AbsoluteFill, useCurrentFrame, useVideoConfig } from "remotion";
import { ACCENTS, COLORS } from "./theme.js";

const Glow = ({ color, size, x, y, opacity }) => (
  <div style={{
    position: "absolute", left: x - size / 2, top: y - size / 2, width: size, height: size, borderRadius: "50%",
    background: `radial-gradient(circle, ${color} 0%, transparent 65%)`, opacity
  }} />
);

export const Background = () => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const t = frame / 30;
  return (
    <AbsoluteFill style={{ backgroundColor: COLORS.background, overflow: "hidden" }}>
      <Glow color={ACCENTS[1]} size={1300} x={250 + Math.sin(t * 0.35) * 120} y={420 + Math.cos(t * 0.3) * 90} opacity={0.32} />
      <Glow color={ACCENTS[0]} size={1100} x={880 + Math.cos(t * 0.28) * 110} y={1050 + Math.sin(t * 0.4) * 100} opacity={0.2} />
      <AbsoluteFill style={{
        backgroundImage: "radial-gradient(rgba(255,255,255,0.09) 1.6px, transparent 1.6px)",
        backgroundSize: "46px 46px", backgroundPosition: `0px ${frame * 0.5}px`,
        maskImage: "linear-gradient(180deg, black 0%, black 55%, transparent 85%)"
      }} />
      <AbsoluteFill style={{ background: "radial-gradient(ellipse at center, transparent 55%, rgba(0,0,0,0.6) 100%)" }} />
      <div style={{
        position: "absolute", left: 0, top: 0, height: 6, width: `${(frame / durationInFrames) * 100}%`,
        background: `linear-gradient(90deg, ${ACCENTS[0]}, ${ACCENTS[1]})`
      }} />
    </AbsoluteFill>
  );
};
