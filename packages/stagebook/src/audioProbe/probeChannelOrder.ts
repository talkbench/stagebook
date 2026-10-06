// The channel-order probe as a host calls it: the shipped calibration assets,
// played through a context created inside the host's start-session click.

import { CALIBRATION_ASSETS } from "./calibrationAssets.generated.js";
import {
  describeError,
  failAll,
  runProbe,
  type ChannelProbeResult,
} from "./probe.js";

/**
 * How long each asset gets to play to its end. The assets are 0.7 s long
 * and play at once; the verdict has taken 1.2–2.4 s in every engine
 * measured.
 */
const PROBE_TIMEOUT_MS = 10_000;

function base64ToBytes(base64: string): Uint8Array<ArrayBuffer> {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/**
 * Measure the order this browser decodes multichannel Opus in, at every
 * channel count from 2 to 8, through the path recordings take: a media
 * element into Web Audio. Silent.
 *
 * Call it from the host's start-session click handler. Browsers start audio
 * only from a user gesture, so the AudioContext is created and resumed
 * synchronously, before this function first awaits.
 *
 * Never rejects. A browser that cannot run the probe gets a "fail" verdict
 * whose `detail` says why.
 */
export async function probeChannelOrder(): Promise<ChannelProbeResult> {
  const startedAt = performance.now();

  if (typeof AudioContext === "undefined") {
    const message = "This browser does not support Web Audio.";
    return failAll(CALIBRATION_ASSETS, "unsupported", message, startedAt);
  }
  let ctx: AudioContext;
  try {
    ctx = new AudioContext();
  } catch (err) {
    const message = `Could not create an AudioContext (${describeError(err)}).`;
    return failAll(CALIBRATION_ASSETS, "unsupported", message, startedAt);
  }
  // Not awaited here: runProbe watches the context's clock, and reports if
  // it never starts.
  ctx.resume().catch(() => undefined);

  const urls: string[] = [];
  try {
    const assets = CALIBRATION_ASSETS.map(
      ({ channels, artifactId, sha256, base64 }) => {
        const blob = new Blob([base64ToBytes(base64)], { type: "audio/mp4" });
        const url = URL.createObjectURL(blob);
        urls.push(url);
        return { channels, artifactId, sha256, url };
      },
    );
    return await runProbe(ctx, assets, PROBE_TIMEOUT_MS, startedAt);
  } catch (err) {
    // runProbe never rejects; this covers preparing the assets.
    const message = `Could not prepare the calibration assets (${describeError(err)}).`;
    return failAll(CALIBRATION_ASSETS, "unsupported", message, startedAt);
  } finally {
    for (const url of urls) URL.revokeObjectURL(url);
    ctx.close().catch(() => undefined);
  }
}
