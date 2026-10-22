import { AbsoluteFill, useCurrentFrame, useVideoConfig } from "remotion";
import { ACCENTS, COLORS } from "./theme.js";

const Glow = ({ color, size, x, y, opacity }) => (
  <div style={{
    position: "absolute", left: x - size / 2, top: y - size / 2, width: size, height: size, borderRadius: "50%",
    background: `radial-gradient(circle, ${color} 0%, transparent 65%)`, opacity
  }} />
);

// A calm, static backdrop: motion is reserved for the diagrams that explain something.
export const Background = () => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  return (
    <AbsoluteFill style={{ backgroundColor: COLORS.background, overflow: "hidden" }}>
      <Glow color={ACCENTS[1]} size={1300} x={260} y={460} opacity={0.26} />
      <Glow color={ACCENTS[0]} size={1100} x={880} y={1100} opacity={0.16} />
      <AbsoluteFill style={{
        backgroundImage: "radial-gradient(rgba(255,255,255,0.07) 1.6px, transparent 1.6px)",
        backgroundSize: "46px 46px", maskImage: "linear-gradient(180deg, black 0%, black 55%, transparent 85%)"
      }} />
      <AbsoluteFill style={{ background: "radial-gradient(ellipse at center, transparent 55%, rgba(0,0,0,0.6) 100%)" }} />
      <div style={{
        position: "absolute", left: 0, top: 0, height: 6, width: `${(frame / durationInFrames) * 100}%`,
        background: `linear-gradient(90deg, ${ACCENTS[0]}, ${ACCENTS[1]})`
      }} />
    </AbsoluteFill>
  );
};
