import { iconForKind } from "./icons.js";
import { COLORS, FONT } from "./theme.js";

// A glassy tile showing a product logo (Simple Icons path) or a generic Lucide icon for the element's kind.
export const TechIcon = ({ element, size, accent }) => {
  const tint = element.brand?.color || accent;
  const glyph = size * 0.5;
  const Icon = iconForKind(element.kind);
  return (
    <div style={{
      width: size, height: size, borderRadius: size * 0.27, display: "flex", alignItems: "center", justifyContent: "center",
      background: "linear-gradient(145deg, rgba(255,255,255,0.16), rgba(255,255,255,0.04))",
      border: "2px solid rgba(255,255,255,0.18)",
      boxShadow: `0 0 ${Math.round(size * 0.45)}px ${tint}55, inset 0 2px 0 rgba(255,255,255,0.15)`
    }}>
      {element.brand
        ? <svg viewBox="0 0 24 24" width={glyph} height={glyph}><path d={element.brand.path} fill={element.brand.color} /></svg>
        : <Icon size={glyph} color={accent} strokeWidth={1.7} />}
    </div>
  );
};

export const Label = ({ children, size = 38, width = 320, color = COLORS.ink }) => (
  <div style={{
    width, textAlign: "center", fontFamily: FONT, fontWeight: 700, fontSize: size, lineHeight: 1.15, color,
    textShadow: "0 4px 18px rgba(0,0,0,0.6)"
  }}>{children}</div>
);
