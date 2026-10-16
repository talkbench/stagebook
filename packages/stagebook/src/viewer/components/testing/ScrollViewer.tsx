import type { TreatmentFileType } from "../../../schemas/index.js";
import { Viewer } from "../Viewer.js";

// Synchronous content keeps both pages taller than the viewport while Stage
// remounts. An async-only prompt could briefly collapse the page and let the
// browser clamp scrollTop to zero, concealing a missing navigation reset.
const elements = [
  ...Array.from({ length: 60 }, () => ({ type: "separator" })),
  { type: "prompt", name: "answer", file: "answer.prompt.md" },
];
const treatmentFile = {
  treatments: ["A", "B"].map((name) => ({
    name: `Treatment ${name}`,
    playerCount: 2,
    compatibleIntroSequences: [],
    gameStages: [1, 2].map((index) => ({
      name: `${name}${String(index)}`,
      duration: 60,
      elements,
    })),
  })),
} as unknown as TreatmentFileType;

const getTextContent = () =>
  Promise.resolve(
    "---\ntype: multipleChoice\nname: answer\n---\nChoose a response.\n\n---\n\n- Alpha\n- Beta",
  );
const getAssetURL = (path: string) => path;

export function ScrollViewer() {
  return (
    <Viewer
      treatmentFile={treatmentFile}
      getTextContent={getTextContent}
      getAssetURL={getAssetURL}
      selectedIntroIndex={0}
      selectedTreatmentIndex={0}
    />
  );
}
