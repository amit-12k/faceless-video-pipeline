import { AbsoluteFill, Html5Audio, Sequence, staticFile } from "remotion";
import { Background } from "./Background.jsx";
import { Captions } from "./Captions.jsx";
import { Character } from "./Character.jsx";
import { SceneView } from "./Scene.jsx";
import { COLORS } from "./theme.js";

export const Explainer = ({ scenes, words, mouth, audio }) => (
  <AbsoluteFill style={{ backgroundColor: COLORS.background }}>
    <Background />
    {scenes.map((scene, i) => (
      <Sequence key={i} from={scene.start} durationInFrames={scene.end - scene.start}>
        <SceneView scene={scene} index={i} />
      </Sequence>
    ))}
    <Captions words={words} />
    <Character mouth={mouth} cues={scenes.map((scene) => scene.start)} />
    {audio ? <Html5Audio src={staticFile(audio)} /> : null}
  </AbsoluteFill>
);
