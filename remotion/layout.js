// Frame geometry shared by the Remotion components, src/direction.mjs, and the quality checks in src/qa.mjs.
// Shorts, Reels, and Facebook Reels cover roughly the bottom 20% and the right edge with their own UI,
// so captions, diagrams, and the robot stay inside SAFE.

export const FRAME = { width: 1080, height: 1920, fps: 30 };
export const SAFE = { top: 140, bottom: 1540, left: 40, right: 1040 };

// Subtitles: a band near the bottom of the safe area, independent of the robot.
export const CAPTION_BAND = { x: 60, y: 1360, w: 960, h: 170, fontSize: 62, minFontSize: 50, lineHeight: 1.18 };
// Speech bubble for a short in-character remark, to the right of a presenter-sized robot on the left.
export const BUBBLE = { x: 470, y: 980, w: 570, h: 320, fontSize: 56, minFontSize: 46, lineHeight: 1.18, padding: 26 };

export const CAPTION_STYLES = {
  subtitle: { lineChars: 24, maxLines: 2, fontSize: CAPTION_BAND.fontSize, minFontSize: CAPTION_BAND.minFontSize },
  bubble: { lineChars: 15, maxLines: 3, fontSize: BUBBLE.fontSize, minFontSize: BUBBLE.minFontSize }
};

// Bottom edge of a caption block with the given number of lines, for the safe-area check.
export const captionBottom = (style, lines) => (style === "bubble"
  ? BUBBLE.y + BUBBLE.h / 2 + (lines * BUBBLE.fontSize * BUBBLE.lineHeight + BUBBLE.padding * 2) / 2
  : CAPTION_BAND.y + lines * CAPTION_BAND.fontSize * CAPTION_BAND.lineHeight + 24);
