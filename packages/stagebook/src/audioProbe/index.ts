// stagebook/audio-probe
// Measures, at session start, the order this browser decodes a group
// recording's multichannel Opus in (#663). A separate subpath so the
// embedded calibration assets (about 135 kB of base64) stay out of the
// main and components bundles.

export { probeChannelOrder } from "./probeChannelOrder.js";
export { CAPABILITIES } from "./capabilities.js";
export type {
  ChannelProbeResult,
  ChannelProbeDetail,
  ProbeAssetId,
} from "./probe.js";
export type {
  ProbeChannelStats,
  ProbeFailure,
  ProbeFailureReason,
  ProbeReport,
} from "./analyze.js";
