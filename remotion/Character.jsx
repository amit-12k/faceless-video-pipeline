import { interpolate, useCurrentFrame } from "remotion";
import { ACCENTS } from "./theme.js";

const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" };

// "Byte", a small robot presenter. Its mouth follows the narration loudness, it blinks, bobs while idle,
// and raises its arm toward the graphic whenever a new scene starts.
export const Character = ({ mouth, cues }) => {
  const frame = useCurrentFrame();
  const accent = ACCENTS[0];
  const level = mouth[Math.min(frame, mouth.length - 1)] || 0;
  const bob = Math.sin(frame / 18) * 7;
  const tilt = Math.sin(frame / 23) * 2.5 + level * 3;

  const blinkPhase = (frame + 37) % 110;
  const eyeScale = blinkPhase < 6 ? interpolate(blinkPhase, [0, 3, 6], [1, 0.12, 1]) : 1;

  const cue = [...cues].reverse().find((start) => start <= frame) ?? -999;
  const gesture = interpolate(frame - cue, [0, 9, 42, 62], [0, 1, 1, 0.25], clamp);
  const pointArm = interpolate(gesture, [0, 1], [-14, -140]) + Math.sin(frame / 4) * 5 * gesture;
  const restArm = 12 + Math.sin(frame / 20) * 4;

  const mouthHeight = 8 + level * 40;
  const mouthWidth = 58 + level * 18;

  const Arm = ({ x, angle }) => (
    <g transform={`rotate(${angle} ${x} 335)`}>
      <rect x={x - 19} y={335} width={38} height={135} rx={19} fill="url(#limb)" />
      <circle cx={x} cy={478} r={27} fill="#E0E7FF" />
    </g>
  );

  return (
    <div style={{ position: "absolute", left: 540 - 195, top: 1385, width: 390, height: 560 }}>
      <svg viewBox="0 0 400 575" width={390} height={560} style={{ overflow: "visible" }}>
        <defs>
          <linearGradient id="head" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#FFFFFF" /><stop offset="1" stopColor="#C7D2FE" />
          </linearGradient>
          <linearGradient id="body" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#A5B4FC" /><stop offset="1" stopColor="#6366F1" />
          </linearGradient>
          <linearGradient id="limb" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#C7D2FE" /><stop offset="1" stopColor="#818CF8" />
          </linearGradient>
          <filter id="glow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="5" result="blur" />
            <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
        </defs>
        <g transform={`translate(0 ${bob * 0.6})`}>
          <Arm x={108} angle={restArm} />
          <rect x={95} y={290} width={210} height={250} rx={64} fill="url(#body)" />
          <circle cx={200} cy={395} r={30} fill="#0B1226" />
          <circle cx={200} cy={395} r={14 + level * 8} fill={accent} filter="url(#glow)" opacity={0.85} />
        </g>
        <g transform={`translate(0 ${bob}) rotate(${tilt} 200 270)`}>
          <line x1={200} y1={52} x2={200} y2={14} stroke="#C7D2FE" strokeWidth={8} strokeLinecap="round" />
          <circle cx={200} cy={12} r={14 + level * 5} fill={accent} filter="url(#glow)" />
          <rect x={40} y={128} width={30} height={70} rx={14} fill="#A5B4FC" />
          <rect x={330} y={128} width={30} height={70} rx={14} fill="#A5B4FC" />
          <rect x={58} y={50} width={284} height={230} rx={74} fill="url(#head)" />
          <rect x={88} y={88} width={224} height={158} rx={54} fill="#0B1226" />
          <g filter="url(#glow)" fill={accent}>
            <rect x={140} y={134 - 22 * eyeScale} width={32} height={44 * eyeScale} rx={16} />
            <rect x={228} y={134 - 22 * eyeScale} width={32} height={44 * eyeScale} rx={16} />
            {level < 0.06
              ? <path d="M172 196 Q200 220 228 196" stroke={accent} strokeWidth={9} strokeLinecap="round" fill="none" />
              : <rect x={200 - mouthWidth / 2} y={202 - mouthHeight / 2} width={mouthWidth} height={mouthHeight}
                  rx={Math.min(mouthHeight / 2, 18)} />}
          </g>
          <circle cx={118} cy={206} r={12} fill="#F472B6" opacity={0.45} />
          <circle cx={282} cy={206} r={12} fill="#F472B6" opacity={0.45} />
        </g>
        <g transform={`translate(0 ${bob * 0.6})`}>
          <Arm x={292} angle={pointArm} />
        </g>
      </svg>
    </div>
  );
};
