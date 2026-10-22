import { spring, useCurrentFrame, useVideoConfig } from "remotion";
import { COLORS, FONT } from "./theme.js";

// Groups timed words into short on-screen phrases, breaking after punctuation or four words.
const toPhrases = (words) => {
  const phrases = [];
  let current = [];
  for (const word of words) {
    current.push(word);
    if (current.length >= 4 || /[.!?,;:]$/.test(word.text)) {
      phrases.push(current);
      current = [];
    }
  }
  if (current.length) phrases.push(current);
  return phrases;
};

export const Captions = ({ words }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const phrases = toPhrases(words);
  const index = phrases.findIndex((phrase, i) => frame >= phrase[0].start && (i === phrases.length - 1 || frame < phrases[i + 1][0].start));
  if (index < 0) return null;
  const phrase = phrases[index];
  if (frame > phrase[phrase.length - 1].end + 12) return null;
  const pop = spring({ frame: frame - phrase[0].start, fps, config: { damping: 14, mass: 0.5 } });
  return (
    <div style={{
      position: "absolute", left: 60, right: 60, top: 1150, display: "flex", flexWrap: "wrap", justifyContent: "center",
      columnGap: 26, rowGap: 4, transform: `scale(${0.85 + 0.15 * pop})`, opacity: pop
    }}>
      {phrase.map((word, i) => {
        const active = frame >= word.start && frame < word.end;
        const lift = active ? spring({ frame: frame - word.start, fps, config: { damping: 12, mass: 0.4 } }) : 0;
        return (
          <span key={i} style={{
            fontFamily: FONT, fontWeight: 700, fontSize: 78, lineHeight: 1.15,
            color: active ? COLORS.highlight : COLORS.ink, transformOrigin: "50% 100%",
            transform: `translateY(${-8 * lift}px) scale(${1 + 0.05 * lift})`,
            display: "inline-block", textShadow: "0 6px 26px rgba(0,0,0,0.75), 0 0 2px rgba(0,0,0,0.9)"
          }}>{word.text}</span>
        );
      })}
    </div>
  );
};
