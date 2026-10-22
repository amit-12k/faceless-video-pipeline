import { loadFont as loadDisplay } from "@remotion/google-fonts/SpaceGrotesk";

const { fontFamily } = loadDisplay("normal", { weights: ["500", "600", "700"], subsets: ["latin"] });

// Noto Sans covers non-Latin narration languages (installed on the runner) when Space Grotesk lacks glyphs.
export const FONT = fontFamily + ", 'Noto Sans', 'Noto Sans Devanagari', sans-serif";

export const COLORS = {
  background: "#070B18",
  ink: "#F5F7FF",
  muted: "#A9B4D0",
  highlight: "#FACC15"
};

export const ACCENTS = ["#5EEAD4", "#818CF8", "#F472B6", "#FBBF24", "#34D399", "#60A5FA"];
