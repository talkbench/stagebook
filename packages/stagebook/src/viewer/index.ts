// stagebook/viewer
//
// A reusable, batteries-included harness for previewing stagebook treatment
// content from the participant's perspective — used by the reference viewer
// (GitHub Pages), the VS Code extension preview, and external hosts embedding
// a preview lens over their own study files.
//
// `components` render, `validate` diagnoses, `viewer` harnesses: this surface
// wraps the participant-rendering contract (`stagebook/components` behind a
// `StagebookProvider`) with a mock state store and dev chrome. The harness
// itself does no I/O — `PreviewHost`/`Viewer` read content only through
// host-supplied callbacks. (The optional `createUrlContentFns` helper is a
// convenience that fetches over the network; hosts that want zero I/O use
// `createStaticContentFns` or bring their own callbacks.)

// --- State store ---
export { ViewerStateStore, createViewerStateStore } from "./lib/store.js";
export type { PositionKey, StoreEntry, StoreRecord } from "./lib/store.js";

// --- Mock rendering context (bridge to StagebookProvider) ---
export { createViewerContext } from "./lib/context.js";
export type { ViewerContextOptions } from "./lib/context.js";

// --- Introspection / structural utilities ---
export { flattenSteps } from "./lib/steps.js";
export type { ViewerStep, Phase } from "./lib/steps.js";
export { extractStageReferences } from "./lib/references.js";
export { extractTimeBreakpoints } from "./lib/timeBreakpoints.js";
export { expandTreatmentFile } from "./lib/expandTreatmentFile.js";

// --- Content-fn helpers (host-supplied file access) ---
export {
  createUrlContentFns,
  createStaticContentFns,
} from "./lib/contentFns.js";

// --- React components ---
export { Viewer } from "./components/Viewer.js";
export type { ViewerProps } from "./components/Viewer.js";
export { PreviewHost } from "./components/PreviewHost.js";
export type { PreviewHostProps } from "./components/PreviewHost.js";
export { StageNav } from "./components/StageNav.js";
export { StateInspector } from "./components/StateInspector.js";
export { TimeScrubber } from "./components/TimeScrubber.js";
export {
  SkeletonPlaceholder,
  createSkeletonRenderers,
} from "./components/SkeletonPlaceholder.js";
export { TreatmentPicker } from "./components/TreatmentPicker.js";
export { FieldForm } from "./components/FieldForm.js";
