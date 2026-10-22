import { spring, useCurrentFrame, useVideoConfig } from "remotion";
import { BUBBLE, CAPTION_BAND, CAPTION_STYLES } from "./layout.js";
import { ACCENTS, COLORS, FONT } from "./theme.js";

// Captions are subtitles in their own band, independent of the robot. Only scenes that src/direction.mjs
// marks as a short in-character remark use the speech bubble. Phrases, lines, and word timings come from
// src/captions.mjs; the word being spoken is yellow and product names are teal.

const Words = ({ phrase, frame, fontSize, lineHeight }) => phrase.lines.map((line, l) => (
  <div key={l} style={{ display: "flex", justifyContent: "center", gap: fontSize * 0.28, whiteSpace: "nowrap", lineHeight }}>
    {line.map((index) => {
      const word = phrase.words[index];
      const active = frame >= word.start && frame < word.end;
      return (
        <span key={index} style={{
          fontFamily: FONT, fontWeight: 700, fontSize, color: active ? COLORS.highlight : word.keyword ? COLORS.keyword : COLORS.ink
        }}>{word.text}</span>
      );
    })}
  </div>
));

const fitSize = (phrase, style) => {
  const longest = Math.max(...phrase.lines.map((line) => line.map((i) => phrase.words[i].text).join(" ").length));
  return Math.max(style.minFontSize, Math.min(style.fontSize, style.fontSize * style.lineChars / longest));
};

export const Captions = ({ phrases, scenes }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const phrase = phrases.find((item) => frame >= item.start && frame < item.end);
  if (!phrase) return null;
  const pop = spring({ frame: frame - phrase.start, fps, config: { damping: 16, mass: 0.5 } });

  if (phrase.style === "bubble") {
    const fontSize = fitSize(phrase, CAPTION_STYLES.bubble);
    const height = phrase.lines.length * fontSize * BUBBLE.lineHeight + BUBBLE.padding * 2;
    const top = BUBBLE.y + (BUBBLE.h - height) / 2;
    const mascot = scenes[phrase.segment]?.mascot;
    const tip = mascot?.visible ? [mascot.left + 345 * mascot.scale, mascot.top + 214 * mascot.scale] : [BUBBLE.x - 40, top + height / 2];
    const tailY = Math.min(Math.max(tip[1], top + 40), top + height - 40);
    return (
      <div style={{ position: "absolute", inset: 0, opacity: Math.min(1, pop * 1.6) }}>
        <svg width={1080} height={1920} style={{ position: "absolute", inset: 0 }}>
          <path d={`M ${BUBBLE.x + 6} ${tailY - 22} L ${tip[0] + 12} ${tip[1]} L ${BUBBLE.x + 6} ${tailY + 18} Z`}
            fill="#121A36" stroke={ACCENTS[0]} strokeWidth={3} strokeLinejoin="round" />
        </svg>
        <div style={{
          position: "absolute", left: BUBBLE.x, top, width: BUBBLE.w, height, boxSizing: "border-box", padding: `${BUBBLE.padding}px 22px`,
          borderRadius: 38, background: "#121A36", border: `3px solid ${ACCENTS[0]}`, boxShadow: "0 18px 50px rgba(0,0,0,0.45)",
          display: "flex", flexDirection: "column", justifyContent: "center", transform: `scale(${0.92 + 0.08 * pop})`, transformOrigin: "0% 50%"
        }}>
          <Words phrase={phrase} frame={frame} fontSize={fontSize} lineHeight={BUBBLE.lineHeight} />
        </div>
        <div style={{ position: "absolute", left: BUBBLE.x + 1, top: tailY - 19, width: 10, height: 34, background: "#121A36" }} />
      </div>
    );
  }

  const fontSize = fitSize(phrase, CAPTION_STYLES.subtitle);
  return (
    <div style={{
      position: "absolute", left: CAPTION_BAND.x, top: CAPTION_BAND.y, width: CAPTION_BAND.w, display: "flex", justifyContent: "center",
      transform: `translateY(${(1 - pop) * 12}px)`, opacity: Math.min(1, pop * 1.6)
    }}>
      {/* A soft dark backing keeps captions readable over diagrams without a heavy box. */}
      <div style={{ padding: "8px 26px 12px", borderRadius: 26, background: "rgba(7,11,24,0.72)" }}>
        <Words phrase={phrase} frame={frame} fontSize={fontSize} lineHeight={CAPTION_BAND.lineHeight} />
      </div>
    </div>
  );
};
