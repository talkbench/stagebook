import type { TreatmentFileType } from "../../../schemas/index.js";
import { Viewer } from "../Viewer.js";

// Playwright CT can't serialize the Viewer's function props (getTextContent /
// getAssetURL) across the mount boundary, so this fixture closes over them and
// bakes in a small treatment that exercises every researcher hotkey:
//   - 2 treatments        → the "Part to preview" picker renders (⌥↑ / ⌥↓)
//   - 2 game stages each   → step nav has somewhere to go (⌥← / ⌥→)
//   - first stage timed    → TimeScrubber renders, so ⌥K has a target
//   - playerCount 2        → the position <select> has ≥2 options (⌥0 / ⌥1)
// buildUnits appends one synthetic transition step per unit, so each 2-stage
// treatment reads "1 / 3" in the stage counter.
const TREATMENT_FILE = {
  treatments: [
    {
      name: "Treatment A",
      playerCount: 2,
      compatibleIntroSequences: [],
      gameStages: [
        { name: "A1", duration: 60, elements: [] },
        { name: "A2", elements: [] },
      ],
    },
    {
      name: "Treatment B",
      playerCount: 2,
      compatibleIntroSequences: [],
      gameStages: [
        { name: "B1", duration: 30, elements: [] },
        { name: "B2", elements: [] },
      ],
    },
  ],
} as unknown as TreatmentFileType;

export function MockViewer() {
  return (
    <Viewer
      treatmentFile={TREATMENT_FILE}
      getTextContent={() => Promise.resolve("")}
      getAssetURL={(path) => path}
      selectedIntroIndex={0}
      selectedTreatmentIndex={0}
    />
  );
}
