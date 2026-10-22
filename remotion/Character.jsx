import { useCurrentFrame } from "remotion";
import { RIG, characterPose } from "./rig.js";

// Draws Byte from the canonical rig (remotion/rig.js). All timing and acting decisions are made there and
// in src/direction.mjs; this component only turns a pose into SVG.

const { head, face, torso, chest, shoulders, arm, colors } = RIG;

const Arm = ({ at, upper, lower, pointing }) => (
  <g transform={`translate(${at[0]} ${at[1]}) rotate(${upper})`}>
    <rect x={-arm.width / 2} y={-8} width={arm.width} height={arm.upper + 16} rx={arm.width / 2} fill="url(#byte-limb)" />
    <g transform={`translate(0 ${arm.upper}) rotate(${lower})`}>
      <circle r={arm.width / 2 + 1} fill={colors.torso[0]} />
      <rect x={-arm.width / 2 + 2} y={0} width={arm.width - 4} height={arm.lower} rx={(arm.width - 4) / 2} fill="url(#byte-limb)" />
      <g transform={`translate(0 ${arm.lower + 14})`}>
        {pointing > 0.4 ? <rect x={-7} y={8} width={14} height={36} rx={7} fill={colors.hand} /> : null}
        <circle r={arm.hand} fill={colors.hand} />
        <circle cx={-20} cy={-8} r={10} fill={colors.hand} />
      </g>
    </g>
  </g>
);

const Eye = ({ x, open, shape, gaze }) => {
  const height = 44 * open;
  if (shape === "happy" && open > 0.5) {
    return <path d={`M ${x - 17 + gaze[0]} ${158 + gaze[1]} Q ${x + gaze[0]} ${132 + gaze[1]} ${x + 17 + gaze[0]} ${158 + gaze[1]}`}
      stroke={colors.glow} strokeWidth={10} strokeLinecap="round" fill="none" />;
  }
  return <rect x={x - 16 + gaze[0]} y={150 + gaze[1] - height / 2} width={32} height={Math.max(4, height)} rx={16} />;
};

const Mouth = ({ mouth, gaze }) => {
  const x = 200 + gaze[0] * 0.4;
  if (mouth.rest === "smile") return <path d={`M ${x - 28} 208 Q ${x} 230 ${x + 28} 208`} stroke={colors.glow} strokeWidth={9} strokeLinecap="round" fill="none" />;
  if (mouth.rest === "hmm") return <path d={`M ${x - 18} 216 Q ${x + 4} 210 ${x + 20} 220`} stroke={colors.glow} strokeWidth={8} strokeLinecap="round" fill="none" />;
  if (mouth.rest === "o") return <ellipse cx={x} cy={214} rx={14} ry={16} />;
  if (mouth.rest === "neutral") return <rect x={x - 22} y={211} width={44} height={6} rx={3} />;
  return <rect x={x - mouth.w / 2} y={214 - mouth.h / 2} width={mouth.w} height={mouth.h} rx={Math.min(mouth.h / 2, mouth.w / 2, 18)} />;
};

export const Character = ({ cues, speech, mouth, scenes }) => {
  const frame = useCurrentFrame();
  const pose = characterPose(frame, { cues, sentences: speech.sentences, words: speech.words, mouth, scenes });
  const { placement } = pose;
  if (!placement.visible || placement.opacity <= 0.01) return null;
  const { arms, face: f } = pose;
  return (
    // Mirrored in place when standing on the right, so it still faces the content.
    <div style={{
      position: "absolute", left: 0, top: 0, width: RIG.viewBox.width, height: RIG.viewBox.height, transformOrigin: "0 0",
      transform: `translate(${placement.left + (placement.flip ? RIG.viewBox.width * placement.scale : 0)}px, ${placement.top}px) `
        + `scale(${placement.flip ? -placement.scale : placement.scale}, ${placement.scale})`,
      opacity: placement.opacity
    }}>
      <svg viewBox={`0 0 ${RIG.viewBox.width} ${RIG.viewBox.height}`} width={RIG.viewBox.width} height={RIG.viewBox.height} style={{ overflow: "visible" }}>
        <defs>
          <linearGradient id="byte-shell" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor={colors.shell[0]} /><stop offset="1" stopColor={colors.shell[1]} /></linearGradient>
          <linearGradient id="byte-torso" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor={colors.torso[0]} /><stop offset="1" stopColor={colors.torso[1]} /></linearGradient>
          <linearGradient id="byte-limb" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stopColor={colors.limb[0]} /><stop offset="1" stopColor={colors.limb[1]} /></linearGradient>
          <filter id="byte-glow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="3.5" result="blur" />
            <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
        </defs>
        <g transform={`rotate(${pose.body.lean} 200 560) translate(0 ${pose.body.breathe})`}>
          <Arm at={shoulders.left} upper={arms.lU} lower={arms.lL} pointing={0} />
          <rect x={torso.x} y={torso.y} width={torso.width} height={torso.height} rx={torso.radius} fill="url(#byte-torso)" />
          <rect x={chest.x} y={chest.y} width={chest.width} height={chest.height} rx={22} fill={colors.face} />
          <rect x={chest.x + 14} y={chest.y + 28 - pose.antenna.glow * 8} width={chest.width - 28} height={10 + pose.antenna.glow * 14} rx={6}
            fill={colors.glow} opacity={0.85} filter="url(#byte-glow)" />
          <g transform={`translate(0 ${pose.head.nod}) rotate(${pose.head.tilt} 200 290)`}>
            <g transform={`rotate(${pose.antenna.angle} 200 56)`}>
              <line x1={200} y1={56} x2={200} y2={20} stroke={colors.shell[1]} strokeWidth={8} strokeLinecap="round" />
              <circle cx={200} cy={16} r={12} fill={colors.glow} opacity={pose.antenna.glow} filter="url(#byte-glow)" />
            </g>
            <rect x={42} y={132} width={30} height={70} rx={14} fill={colors.torso[0]} />
            <rect x={328} y={132} width={30} height={70} rx={14} fill={colors.torso[0]} />
            <rect x={head.x} y={head.y} width={head.width} height={head.height} rx={head.radius} fill="url(#byte-shell)" />
            <rect x={face.x} y={face.y} width={face.width} height={face.height} rx={face.radius} fill={colors.face} />
            <g fill={colors.brow}>
              <rect x={134 + f.gaze[0] * 0.5} y={108 - f.browL} width={42} height={10} rx={5} transform={`rotate(${-4 - f.browL * 0.5} 155 ${113 - f.browL})`} />
              <rect x={224 + f.gaze[0] * 0.5} y={108 - f.browR} width={42} height={10} rx={5} transform={`rotate(${4 + f.browR * 0.5} 245 ${113 - f.browR})`} />
            </g>
            <g fill={colors.glow} filter="url(#byte-glow)">
              <Eye x={156} open={f.open} shape={f.eyes} gaze={f.gaze} />
              <Eye x={244} open={f.open} shape={f.eyes} gaze={f.gaze} />
              <Mouth mouth={f.mouth} gaze={f.gaze} />
            </g>
            <circle cx={118} cy={218} r={12} fill={colors.cheek} opacity={0.45} />
            <circle cx={282} cy={218} r={12} fill={colors.cheek} opacity={0.45} />
          </g>
          <Arm at={shoulders.right} upper={arms.rU} lower={arms.rL} pointing={pose.pointing} />
        </g>
      </svg>
    </div>
  );
};
