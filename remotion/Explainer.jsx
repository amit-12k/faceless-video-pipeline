import { AbsoluteFill, Html5Audio, Sequence, staticFile } from "remotion";
import { Background } from "./Background.jsx";
import { Captions } from "./Captions.jsx";
import { Character } from "./Character.jsx";
import { SceneView } from "./Scene.jsx";
import { COLORS } from "./theme.js";

export const Explainer = ({ scenes, cues, phrases, mouth, speech, audio }) => (
  <AbsoluteFill style={{ backgroundColor: COLORS.background }}>
    <Background />
    {scenes.map((scene, i) => (
      // Each scene runs 8 frames past its cut and fades out while the next fades in (a crossfade, no blank gap).
      <Sequence key={i} from={scene.start} durationInFrames={Math.max(1, scene.end - scene.start + (i < scenes.length - 1 ? 8 : 0))}>
        <SceneView scene={scene} index={i} />
      </Sequence>
    ))}
    <Character cues={cues} mouth={mouth} scenes={scenes} speech={speech} />
    <Captions phrases={phrases} scenes={scenes} />
    {audio ? <Html5Audio src={staticFile(audio)} /> : null}
  </AbsoluteFill>
);
