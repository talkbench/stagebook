// stagebook
// Schemas, validators, and utilities for interactive social science experiments

export * from "./schemas/index.js";
export * from "./expressions/index.js";
export * from "./utils/index.js";
export * from "./templates/index.js";
export * from "./imports/index.js";
export { resolveNumberFormat } from "./messages/index.js";
export type { NumberFormat } from "./messages/types.js";
export {
  checkChannelLayout,
  ChannelLayoutError,
} from "./audioProbe/channelLayout.js";
export type {
  ChannelMappingEntry,
  ChannelLayoutDiagnostic,
} from "./audioProbe/channelLayout.js";
export type { ChannelProbeResult } from "./audioProbe/probe.js";
