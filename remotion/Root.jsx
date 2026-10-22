import { Composition } from "remotion";
import { Explainer } from "./Explainer.jsx";

const defaultProps = { scenes: [], cues: [], phrases: [], mouth: [], speech: { sentences: [], words: [] }, audio: null, durationInFrames: 300 };

export const Root = () => (
  <Composition
    id="Explainer"
    component={Explainer}
    width={1080}
    height={1920}
    fps={30}
    durationInFrames={300}
    defaultProps={defaultProps}
    calculateMetadata={({ props }) => ({ durationInFrames: props.durationInFrames })}
  />
);
