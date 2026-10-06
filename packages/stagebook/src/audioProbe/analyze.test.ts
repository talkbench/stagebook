import { describe, expect, test } from "vitest";
import {
  analyzeProbeReport,
  MAX_SIGNAL_SECONDS,
  type ProbeChannelStats,
  type ProbeReport,
} from "./analyze.js";

const RATE = 48_000;

/**
 * A marker-only channel: one 20 ms burst whose peak lands at `peakFrame`,
 * stretched to ~32 ms by Opus ringing (the worst case measured in #663).
 */
function marker(peakFrame: number, hotSamples = 1_550): ProbeChannelStats {
  return {
    peak: 0.5,
    peakFrame,
    hotSamples,
    firstHotFrame: peakFrame - 500,
    lastHotFrame: peakFrame + 1_050,
    bursts: 1,
  };
}

const silent: ProbeChannelStats = {
  peak: 0,
  peakFrame: -1,
  hotSamples: 0,
  firstHotFrame: -1,
  lastHotFrame: -1,
  bursts: 0,
};

function report(
  channels: ProbeChannelStats[],
  overrides: Partial<ProbeReport> = {},
): ProbeReport {
  return {
    sampleRate: RATE,
    inputChannels: channels.length,
    channels,
    ...overrides,
  };
}

/** Markers 60 ms apart, in the given decoded order of source channels. */
function markersInOrder(decodedToSource: number[]): ProbeChannelStats[] {
  return decodedToSource.map((source) => marker(10_000 + source * 2_880));
}

describe("analyzeProbeReport — mapping", () => {
  test("identity order gives the identity mapping", () => {
    const result = analyzeProbeReport(report(markersInOrder([0, 1, 2, 3])), 4);
    expect(result).toEqual({
      pass: true,
      decodedToSource: [0, 1, 2, 3],
      failure: null,
    });
  });

  test("the rank of each decoded channel's peak is its source channel", () => {
    // The libopus-wrapper permutation measured at 6 channels (#663).
    const wrapper6 = [0, 2, 1, 5, 3, 4];
    const result = analyzeProbeReport(report(markersInOrder(wrapper6)), 6);
    expect(result.pass).toBe(true);
    expect(result.decodedToSource).toEqual(wrapper6);
  });

  test("only the ordering matters, not the spacing", () => {
    const uneven = [marker(90_000), marker(5_000), marker(5_200)];
    const result = analyzeProbeReport(report(uneven), 3);
    expect(result.decodedToSource).toEqual([2, 0, 1]);
  });
});

describe("analyzeProbeReport — failures", () => {
  test("no audio reached the worklet", () => {
    const result = analyzeProbeReport(
      report([], { inputChannels: 0, channels: [] }),
      4,
    );
    expect(result.pass).toBe(false);
    expect(result.decodedToSource).toBeNull();
    expect(result.failure?.reason).toBe("channel-count");
  });

  test("a channel without its marker fails (e.g. a 2-channel track up-mixed to 4)", () => {
    const result = analyzeProbeReport(
      report([marker(10_000), marker(12_880), silent, silent]),
      4,
    );
    expect(result.pass).toBe(false);
    expect(result.failure?.reason).toBe("marker-missing");
    expect(result.failure?.channels).toEqual([2, 3]);
  });

  test("a peak below the marker floor counts as missing", () => {
    const faint = { ...marker(12_880), peak: 0.04 };
    const result = analyzeProbeReport(report([marker(10_000), faint]), 2);
    expect(result.failure?.reason).toBe("marker-missing");
    expect(result.failure?.channels).toEqual([1]);
  });

  test("a channel carrying the fallback tone fails (WebKit plays the AAC track)", () => {
    // 25,704 samples above the floor, measured in WebKit 26.4 (#663).
    const tone = { ...marker(20_000), hotSamples: 25_704 };
    const result = analyzeProbeReport(report([tone, tone]), 2);
    expect(result.pass).toBe(false);
    expect(result.failure?.reason).toBe("extra-signal");
    expect(result.failure?.channels).toEqual([0, 1]);
  });

  test("a mixing browser fails: fallback tone on two decoded channels", () => {
    // ~28,900 samples above the floor, measured with sim_mixed (#663).
    const channels = markersInOrder([0, 2, 1, 3, 4]);
    channels[0] = { ...channels[0], hotSamples: 28_900 };
    channels[1] = { ...channels[1], hotSamples: 28_900 };
    const result = analyzeProbeReport(report(channels), 5);
    expect(result.failure?.reason).toBe("extra-signal");
    expect(result.failure?.channels).toEqual([0, 1]);
  });

  test("a channel carrying a second marker fails, though within the time limit", () => {
    // Two markers' worth of signal (~3,000 samples) is under the
    // extra-signal limit; the second burst is what gives it away.
    const crosstalk = { ...marker(10_000, 3_000), bursts: 2 };
    const result = analyzeProbeReport(report([crosstalk, marker(12_880)]), 2);
    expect(result.pass).toBe(false);
    expect(result.failure?.reason).toBe("extra-signal");
    expect(result.failure?.channels).toEqual([0]);
  });

  test("WebKit on macOS: the AAC fallback in place of the Opus track fails", () => {
    // Measured: the stereo fallback tone (peak 0.032, 25,816 samples above
    // the floor) on decoded channels 0 and 1, nothing on the rest.
    const tone: ProbeChannelStats = {
      peak: 0.032,
      peakFrame: 77_000,
      hotSamples: 25_816,
      firstHotFrame: 76_801,
      lastHotFrame: 106_303,
      bursts: 1,
    };
    const atTwo = analyzeProbeReport(report([tone, tone]), 2);
    expect(atTwo.failure?.reason).toBe("marker-missing");
    // At higher counts only the stereo track's two channels arrive.
    const atFive = analyzeProbeReport(
      report([tone, tone, silent, silent, silent], { inputChannels: 2 }),
      5,
    );
    expect(atFive.failure?.reason).toBe("channel-count");
  });

  test("two channels peaking on the same frame fail (a duplicated channel)", () => {
    const result = analyzeProbeReport(
      report([marker(10_000), marker(10_000), marker(15_000)]),
      3,
    );
    expect(result.pass).toBe(false);
    expect(result.failure?.reason).toBe("coincident-markers");
    expect(result.failure?.channels).toEqual([0, 1]);
  });

  test("a report narrower than the expected count fails", () => {
    const result = analyzeProbeReport(report(markersInOrder([0, 1])), 3);
    expect(result.failure?.reason).toBe("channel-count");
  });
});

describe("analyzeProbeReport — the extra-signal limit", () => {
  const limitAt48k = Math.floor(MAX_SIGNAL_SECONDS * RATE);

  test("leaves headroom above the worst marker-only channel measured", () => {
    // 1,517 samples at 48 kHz, worst of 3 runs in Chrome/Chromium/Firefox.
    expect(limitAt48k).toBeGreaterThanOrEqual(2 * 1_517);
  });

  test("leaves headroom below the fallback tone measured", () => {
    // 25,704 samples at 48 kHz in WebKit; ~28,900 for a mixing browser.
    expect(limitAt48k * 4).toBeLessThanOrEqual(25_704);
  });

  test("a channel exactly at the limit passes; one sample over fails", () => {
    const at = analyzeProbeReport(
      report([marker(10_000, limitAt48k), marker(12_880)]),
      2,
    );
    expect(at.pass).toBe(true);
    const over = analyzeProbeReport(
      report([marker(10_000, limitAt48k + 1), marker(12_880)]),
      2,
    );
    expect(over.failure?.reason).toBe("extra-signal");
  });

  test("the limit is in time, not samples: it scales with the context rate", () => {
    // At 96 kHz the same 32 ms marker is twice as many samples.
    const at96k = report([marker(10_000, 3_100), marker(15_760, 3_100)], {
      sampleRate: 96_000,
    });
    expect(analyzeProbeReport(at96k, 2).pass).toBe(true);
    const toneAt96k = report([marker(10_000, 51_000), marker(15_760, 3_100)], {
      sampleRate: 96_000,
    });
    expect(analyzeProbeReport(toneAt96k, 2).failure?.reason).toBe(
      "extra-signal",
    );
  });
});
