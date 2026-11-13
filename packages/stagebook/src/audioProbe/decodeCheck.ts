// The decode check: can this browser decode a group recording's multichannel
// Opus track at all? (talkbench/stagebook#840)
//
// It decodes each calibration asset with decodeAudioData in an
// OfflineAudioContext, which needs no user gesture, so a host can run it the
// moment a participant arrives. It judges the decoded channels with the same
// statistics and the same analysis as the playback probe.
//
// It answers capability only. It never reports a channel order: decoding and
// playback are separate code paths, and only playback measures the order a
// recording will be heard in (ADR-0019 Decision 3), so that stays with
// probeChannelOrder(). The result has no `mappings`, so it cannot be passed
// where a channel probe is expected.

import {
  analyzeProbeReport,
  BURST_GAP_SECONDS,
  HOT_LEVEL,
  type ProbeChannelStats,
  type ProbeFailure,
  type ProbeFailureReason,
  type ProbeReport,
} from "./analyze.js";
import type { ProbeAssetId } from "./probe.js";
import { describeError } from "./workletLoad.js";
import { STAGEBOOK_VERSION } from "../version.js";

/** One asset to decode: its channel count, its bytes, and its id. */
export interface DecodeAsset extends ProbeAssetId {
  readonly channels: number;
  readonly bytes: ArrayBuffer;
}

/** What the decode check found at one channel count. */
export interface DecodeCheckDetail {
  readonly asset: ProbeAssetId;
  /** Why the count failed; null when it passed. */
  readonly failure: ProbeFailure | null;
  /** The decoded channels' statistics. Null when nothing decoded. */
  readonly report: ProbeReport | null;
}

/**
 * Whether this browser decodes multichannel Opus, at every channel count
 * from 2 to 8. Plain data, so a host can store it as JSON.
 */
export interface DecodeCheckResult {
  /**
   * "pass" only if, at every count, the asset decoded to that many channels
   * and each carried its marker and nothing else.
   */
  readonly verdict: "pass" | "fail";
  /** Keyed by channel count. */
  readonly detail: Readonly<Record<number, DecodeCheckDetail>>;
  /** The stagebook release that measured this. */
  readonly stagebookVersion: string;
  /** Wall-clock time from the call to the verdict. */
  readonly elapsedMs: number;
}

/** The parts of an AudioBuffer the measurement reads. */
interface DecodedAudio {
  readonly numberOfChannels: number;
  readonly sampleRate: number;
  getChannelData(channel: number): Float32Array;
}

/**
 * The probe worklet's bookkeeping (see worklet.ts), over a whole decoded
 * buffer. Frames count from the buffer's start. Measures at most `channels`
 * channels and reports how many there were, as the worklet does.
 */
export function measureDecodedChannels(
  audio: DecodedAudio,
  channels: number,
): ProbeReport {
  const burstGapFrames = BURST_GAP_SECONDS * audio.sampleRate;
  const measured: ProbeChannelStats[] = [];
  for (let c = 0; c < Math.min(channels, audio.numberOfChannels); c++) {
    const samples = audio.getChannelData(c);
    let peak = 0;
    let peakFrame = -1;
    let hotSamples = 0;
    let firstHotFrame = -1;
    let lastHotFrame = -1;
    let bursts = 0;
    for (let frame = 0; frame < samples.length; frame++) {
      const level = Math.abs(samples[frame]);
      if (level > HOT_LEVEL) {
        hotSamples++;
        if (lastHotFrame < 0 || frame - lastHotFrame > burstGapFrames) {
          bursts++;
        }
        if (firstHotFrame < 0) firstHotFrame = frame;
        lastHotFrame = frame;
      }
      if (level > peak) {
        peak = level;
        peakFrame = frame;
      }
    }
    measured.push({
      peak,
      peakFrame,
      hotSamples,
      firstHotFrame,
      lastHotFrame,
      bursts,
    });
  }
  return {
    sampleRate: audio.sampleRate,
    inputChannels: audio.numberOfChannels,
    channels: measured,
  };
}

/**
 * The calibration assets' sample rate. Decoding into a context at the same
 * rate keeps marker timing exact; the analysis works in seconds regardless.
 */
const SAMPLE_RATE = 48_000;

async function decodeAsset(asset: DecodeAsset): Promise<DecodeCheckDetail> {
  const id = { artifactId: asset.artifactId, sha256: asset.sha256 };
  const fail = (reason: ProbeFailureReason, message: string) => ({
    asset: id,
    failure: { reason, message },
    report: null,
  });
  let audio: DecodedAudio;
  try {
    // Positional arguments: older WebKit has no options constructor.
    const ctx = new OfflineAudioContext(1, 1, SAMPLE_RATE);
    // decodeAudioData detaches its input, so give it a copy.
    audio = await ctx.decodeAudioData(asset.bytes.slice(0));
  } catch (err) {
    return fail(
      "decode",
      `Could not decode the asset (${describeError(err)}).`,
    );
  }
  const report = measureDecodedChannels(audio, asset.channels);
  const { failure } = analyzeProbeReport(report, asset.channels);
  return { asset: id, failure, report };
}

/**
 * Decode every asset and judge it. Never rejects: anything that stops a
 * count from being checked fails that count. `startedAt` (a
 * `performance.now()` reading) is when `elapsedMs` starts.
 */
export async function runDecodeCheck(
  assets: readonly DecodeAsset[],
  startedAt = performance.now(),
): Promise<DecodeCheckResult> {
  let details: DecodeCheckDetail[];
  if (typeof OfflineAudioContext === "undefined") {
    const failure: ProbeFailure = {
      reason: "unsupported",
      message: "This browser does not support Web Audio.",
    };
    details = assets.map((a) => ({
      asset: { artifactId: a.artifactId, sha256: a.sha256 },
      failure,
      report: null,
    }));
  } else {
    details = await Promise.all(assets.map(decodeAsset));
  }
  const detail: Record<number, DecodeCheckDetail> = {};
  details.forEach((d, i) => {
    detail[assets[i].channels] = d;
  });
  const pass = details.length > 0 && details.every((d) => !d.failure);
  return {
    verdict: pass ? "pass" : "fail",
    detail,
    stagebookVersion: STAGEBOOK_VERSION,
    elapsedMs: Math.round(performance.now() - startedAt),
  };
}
