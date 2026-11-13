// The decode check as a host calls it: the shipped calibration assets,
// decoded without a user gesture (#840).

import { CALIBRATION_ASSETS } from "./calibrationAssets.generated.js";
import { runDecodeCheck, type DecodeCheckResult } from "./decodeCheck.js";
import { base64ToBytes } from "./probeChannelOrder.js";

/**
 * Check, without a user gesture, that this browser decodes a group
 * recording's multichannel Opus track: each calibration asset (2 to 8
 * channels) must decode to its channel count, with every channel carrying
 * its marker and nothing else. Silent, and quick: nothing plays.
 *
 * A browser that fails cannot present per-speaker tracks. WebKit, for one,
 * decodes the stereo AAC fallback instead, which fails at 2 channels on its
 * markers and at 3 to 8 on its channel count.
 *
 * This says nothing about channel order. Use probeChannelOrder() for that.
 *
 * Never rejects. A browser that cannot run the check gets a "fail" verdict
 * whose `detail` says why.
 */
export async function checkMultichannelDecode(): Promise<DecodeCheckResult> {
  const startedAt = performance.now();
  return runDecodeCheck(
    CALIBRATION_ASSETS.map(({ channels, artifactId, sha256, base64 }) => ({
      channels,
      artifactId,
      sha256,
      bytes: base64ToBytes(base64).buffer,
    })),
    startedAt,
  );
}
