// Pure analysis of one calibration asset's playback — no DOM or Web Audio.
//
// Each calibration asset is a C-channel Opus track in which source channel k
// is silent except for one 20 ms marker, and source channel k's marker is the
// k-th to sound. The worklet records, per decoded channel, when it peaked and
// how long it carried any signal. Sorting the peak times recovers the order
// the browser decoded the channels in. The contract is only that ordering —
// no shared offset schedule — so the analysis never reads absolute times.
// See #663 and ADR-0019 in conversation-processing-pipeline.

/** What the probe worklet measured on one decoded channel. */
export interface ProbeChannelStats {
  /** Largest absolute sample value seen. */
  readonly peak: number;
  /** Context frame at which `peak` was first reached; -1 if never. */
  readonly peakFrame: number;
  /** Samples whose magnitude exceeded {@link HOT_LEVEL}. */
  readonly hotSamples: number;
  /** First and last context frames above {@link HOT_LEVEL}; -1 if none. */
  readonly firstHotFrame: number;
  readonly lastHotFrame: number;
  /**
   * Runs of signal: samples above {@link HOT_LEVEL} separated by more than
   * {@link BURST_GAP_SECONDS} below it. One marker is one burst.
   */
  readonly bursts: number;
}

/** Everything the worklet reports for one asset. */
export interface ProbeReport {
  /** The AudioContext's sample rate, which frame counts are in. */
  readonly sampleRate: number;
  /**
   * Most channels the worklet's input ever carried: the decoded track's
   * channel count (0 if no audio arrived).
   */
  readonly inputChannels: number;
  readonly channels: readonly ProbeChannelStats[];
}

export type ProbeFailureReason =
  /** The decoded audio did not arrive with the asset's channel count. */
  | "channel-count"
  /** A decoded channel carried no marker. */
  | "marker-missing"
  /** A decoded channel carried signal beyond its marker. */
  | "extra-signal"
  /** Two decoded channels peaked at once, so their order is undefined. */
  | "coincident-markers"
  /** The asset did not play to its end: a media error, or play() refused. */
  | "playback"
  /** The asset did not finish playing within the probe's time limit. */
  | "timeout"
  /** The browser lacks a Web Audio feature the probe needs. */
  | "unsupported";

export interface ProbeFailure {
  readonly reason: ProbeFailureReason;
  readonly message: string;
  /** Decoded channels at fault, when the failure is per-channel. */
  readonly channels?: readonly number[];
}

export interface ProbeAnalysis {
  readonly pass: boolean;
  /**
   * `decodedToSource[d]` is the source channel the browser delivers on
   * decoded channel `d`. Null when the asset failed.
   */
  readonly decodedToSource: readonly number[] | null;
  readonly failure: ProbeFailure | null;
}

/**
 * A sample louder than this counts as signal. The assets are digitally
 * silent outside their markers and the fallback tone, so any floor well
 * above zero and well below the marker works; this is the one #663 measured
 * with.
 */
export const HOT_LEVEL = 0.01;

/**
 * A channel whose peak stays below this carries no marker. Markers are 0.5
 * in the asset and arrive near that through every decoder measured.
 */
export const MIN_MARKER_PEAK = 0.05;

/**
 * Most time a channel may spend above {@link HOT_LEVEL} and still carry
 * "its marker and nothing else". Opus ringing stretches the 20 ms marker to
 * about 32 ms (1,517 samples at 48 kHz, worst of three runs in Chrome,
 * Chromium and Firefox); the AAC fallback tone, played in place of or mixed
 * with the Opus track, keeps a channel above the floor for over 500 ms
 * (25,704 samples in WebKit; about 28,900 for a mixing browser). 100 ms
 * leaves 3x headroom over the first and 5x under the second. Kept in
 * seconds, not samples, so it means the same at any context sample rate.
 */
export const MAX_SIGNAL_SECONDS = 0.1;

/**
 * A dip below {@link HOT_LEVEL} longer than this ends a burst. Opus ringing
 * keeps a marker continuously above the floor apart from zero crossings
 * (well under 1 ms at 1 kHz), and successive markers in the calibration
 * assets leave about 28 ms of silence between their hot regions, so a
 * channel that carries a second marker shows a second burst.
 */
export const BURST_GAP_SECONDS = 0.01;

function fail(
  reason: ProbeFailureReason,
  message: string,
  channels?: number[],
): ProbeAnalysis {
  return {
    pass: false,
    decodedToSource: null,
    failure: channels ? { reason, message, channels } : { reason, message },
  };
}

/**
 * Judge one asset's playback and, if it passes, derive the channel order.
 * An asset passes only if every decoded channel carries exactly one marker
 * and nothing else.
 */
export function analyzeProbeReport(
  report: ProbeReport,
  expectedChannels: number,
): ProbeAnalysis {
  const { channels, sampleRate } = report;
  if (
    report.inputChannels !== expectedChannels ||
    channels.length !== expectedChannels
  ) {
    return fail(
      "channel-count",
      `Expected ${expectedChannels} decoded channels, received ${report.inputChannels}.`,
    );
  }

  const missing = indicesWhere(channels, (c) => c.peak < MIN_MARKER_PEAK);
  if (missing.length > 0) {
    return fail(
      "marker-missing",
      `No marker on decoded channel(s) ${missing.join(", ")}.`,
      missing,
    );
  }

  // Too long above the floor (a fallback tone), or more than one burst (a
  // second marker, which fits within the time limit).
  const maxHotSamples = MAX_SIGNAL_SECONDS * sampleRate;
  const noisy = indicesWhere(
    channels,
    (c) => c.hotSamples > maxHotSamples || c.bursts > 1,
  );
  if (noisy.length > 0) {
    return fail(
      "extra-signal",
      `Decoded channel(s) ${noisy.join(", ")} carry signal beyond their marker.`,
      noisy,
    );
  }

  const coincident = indicesWhere(channels, (c, i) =>
    channels.some((other, j) => j !== i && other.peakFrame === c.peakFrame),
  );
  if (coincident.length > 0) {
    return fail(
      "coincident-markers",
      `Decoded channel(s) ${coincident.join(", ")} peak at the same moment.`,
      coincident,
    );
  }

  return { pass: true, decodedToSource: rankOrder(channels), failure: null };
}

/** `rank[d]` is the position of channel d's peak among all peaks. */
function rankOrder(channels: readonly ProbeChannelStats[]): number[] {
  const byPeak = channels
    .map((c, decoded) => ({ decoded, frame: c.peakFrame }))
    .sort((a, b) => a.frame - b.frame);
  const rank = new Array<number>(channels.length);
  byPeak.forEach(({ decoded }, source) => {
    rank[decoded] = source;
  });
  return rank;
}

function indicesWhere<T>(
  items: readonly T[],
  predicate: (item: T, index: number) => boolean,
): number[] {
  const out: number[] = [];
  items.forEach((item, i) => {
    if (predicate(item, i)) out.push(i);
  });
  return out;
}
