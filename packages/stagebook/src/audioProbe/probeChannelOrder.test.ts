// @vitest-environment jsdom
import { afterEach, describe, expect, test, vi } from "vitest";
import { CALIBRATION_ASSETS } from "./calibrationAssets.generated.js";
import { CAPABILITIES, probeChannelOrder } from "./index.js";

// jsdom has no Web Audio, so these cover the paths a host meets on a browser
// that cannot run the probe. The probe itself runs in real browsers in
// audioProbe.ct.tsx.

const COUNTS = [2, 3, 4, 5, 6, 7, 8];

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("probeChannelOrder without Web Audio", () => {
  test("resolves, failing every count as unsupported, when AudioContext is absent", async () => {
    expect(typeof AudioContext).toBe("undefined");
    const result = await probeChannelOrder();

    expect(result.verdict).toBe("fail");
    expect(Object.keys(result.mappings).map(Number)).toEqual(COUNTS);
    for (const count of COUNTS) {
      expect(result.mappings[count]).toBeNull();
      expect(result.detail[count].failure?.reason).toBe("unsupported");
      expect(result.detail[count].report).toBeNull();
    }
    expect(typeof result.stagebookVersion).toBe("string");
    expect(result.elapsedMs).toBeGreaterThanOrEqual(0);
  });

  test("resolves, failing every count as unsupported, when AudioContext throws", async () => {
    vi.stubGlobal(
      "AudioContext",
      class {
        constructor() {
          throw new DOMException("no audio device", "NotSupportedError");
        }
      },
    );
    const result = await probeChannelOrder();

    expect(result.verdict).toBe("fail");
    for (const count of COUNTS) {
      expect(result.mappings[count]).toBeNull();
      expect(result.detail[count].failure).toMatchObject({
        reason: "unsupported",
        message: expect.stringContaining("no audio device") as string,
      });
    }
  });

  test("creates and resumes its AudioContext before it first awaits, then cleans up", async () => {
    // The host calls it from a click, and browsers start audio only inside
    // the gesture, so both must happen synchronously.
    const calls: string[] = [];
    const created: string[] = [];
    const revoked: string[] = [];
    vi.stubGlobal(
      "AudioContext",
      class {
        // No AudioWorklet, so the probe fails fast after preparing assets.
        audioWorklet = undefined;
        constructor() {
          calls.push("new");
        }
        resume() {
          calls.push("resume");
          return Promise.resolve();
        }
        close() {
          calls.push("close");
          return Promise.resolve();
        }
      },
    );
    vi.stubGlobal(
      "URL",
      class extends URL {
        static createObjectURL = () => {
          created.push(`blob:${created.length}`);
          return created[created.length - 1];
        };
        static revokeObjectURL = (url: string) => revoked.push(url);
      },
    );

    const pending = probeChannelOrder();
    expect(calls).toEqual(["new", "resume"]);
    const result = await pending;

    expect(result.detail[2].failure?.reason).toBe("unsupported");
    expect(calls).toEqual(["new", "resume", "close"]);
    expect(created).toHaveLength(CALIBRATION_ASSETS.length);
    expect([...revoked].sort()).toEqual([...created].sort());
  });

  test("names the calibration asset behind each count", async () => {
    const result = await probeChannelOrder();
    for (const asset of CALIBRATION_ASSETS) {
      expect(result.detail[asset.channels].asset).toEqual({
        artifactId: asset.artifactId,
        sha256: asset.sha256,
      });
    }
  });
});

test("Release A capabilities: the probe, not yet per-speaker tracks", () => {
  expect(CAPABILITIES).toEqual({ channelProbe: true, perSpeakerTracks: false });
  // Frozen, so no script on the page can change what the host gates on.
  expect(Object.isFrozen(CAPABILITIES)).toBe(true);
});
