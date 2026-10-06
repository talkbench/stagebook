import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import { CALIBRATION_ASSETS } from "./calibrationAssets.generated.js";

// The probe ships the pipeline's calibration assets byte for byte (#663).
// These tests tie the embedded copies to the vendored MP4s, and the MP4s to
// the hashes in the sidecars the pipeline wrote for them. To re-vendor, see
// calibration/PROVENANCE.md.

const dir = new URL("./calibration/", import.meta.url);

interface Sidecar {
  artifact_id: string;
  hash: string;
  size_bytes: number;
  direct_transform: {
    parameters: {
      channels: number;
      encoder_args: string[];
      opus_track: {
        markers: { channel: number; start_s: number; end_s: number }[];
      };
    };
  };
}

function sidecar(channels: number): Sidecar {
  return JSON.parse(
    readFileSync(new URL(`calib_${channels}ch.mp4.sidecar.json`, dir), "utf8"),
  ) as Sidecar;
}

function mp4(channels: number): Buffer {
  return readFileSync(new URL(`calib_${channels}ch.mp4`, dir));
}

const sha256 = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");

test("the generated file is exactly what the embed script writes", () => {
  // Reviewers skip a 136 kB generated file, so nothing may be added to it by
  // hand: --check exits non-zero unless every byte matches.
  const script = fileURLToPath(
    new URL("../../scripts/embed-calibration-assets.mjs", import.meta.url),
  );
  expect(() =>
    execFileSync(process.execPath, [script, "--check"], { stdio: "pipe" }),
  ).not.toThrow();
});

test("one asset per channel count, 2 through 8, and nothing else", () => {
  expect(CALIBRATION_ASSETS.map((a) => a.channels)).toEqual([
    2, 3, 4, 5, 6, 7, 8,
  ]);
  const files = readdirSync(dir).filter((f) => f.endsWith(".mp4"));
  expect(files.sort()).toEqual(
    [2, 3, 4, 5, 6, 7, 8].map((c) => `calib_${c}ch.mp4`),
  );
});

describe.each(CALIBRATION_ASSETS.map((a) => [a.channels, a] as const))(
  "calib_%ich.mp4",
  (channels, asset) => {
    const meta = sidecar(channels);

    test("the vendored file matches its sidecar's hash and size", () => {
      const bytes = mp4(channels);
      expect(`sha256:${sha256(bytes)}`).toBe(meta.hash);
      expect(bytes.length).toBe(meta.size_bytes);
    });

    test("the embedded copy is byte-identical to the vendored file", () => {
      const embedded = Buffer.from(asset.base64, "base64");
      expect(embedded.equals(mp4(channels))).toBe(true);
      expect(asset.sha256).toBe(sha256(embedded));
      expect(asset.artifactId).toBe(meta.artifact_id);
    });

    test("is encoded as a recording's audio: C-channel family-255 Opus, then AAC, both default", () => {
      const params = meta.direct_transform.parameters;
      expect(params.channels).toBe(channels);
      const args = params.encoder_args.join(" ");
      expect(args).toContain(
        `-c:a:0 libopus -mapping_family:a:0 255 -ac:a:0 ${channels}`,
      );
      expect(args).toContain("-c:a:1 aac -ac:a:1 2");
      expect(args).toContain("-disposition:a:0 default");
      expect(args).toContain("-disposition:a:1 default");
    });

    test("source channel k's marker is the k-th to sound, with no overlap", () => {
      // The ordering the probe reads the channel order from.
      const markers = meta.direct_transform.parameters.opus_track.markers;
      expect(markers.map((m) => m.channel)).toEqual(
        Array.from({ length: channels }, (_, k) => k),
      );
      for (let k = 1; k < markers.length; k++) {
        expect(markers[k].start_s).toBeGreaterThan(markers[k - 1].end_s);
      }
    });
  },
);
