// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { ProbeReport } from "./analyze.js";
import { BURST_GAP_SECONDS } from "./analyze.js";
import {
  measureDecodedChannels,
  runDecodeCheck,
  type DecodeAsset,
} from "./decodeCheck.js";
import { checkMultichannelDecode } from "./index.js";
import { WORKLET_SOURCE } from "./worklet.js";

// jsdom has no Web Audio. These pin the bookkeeping and the result's shape
// with a stand-in OfflineAudioContext; real decoders run in
// audioProbe.ct.tsx.

const COUNTS = [2, 3, 4, 5, 6, 7, 8];
const RATE = 48_000;

interface FakeBuffer {
  numberOfChannels: number;
  sampleRate: number;
  length: number;
  getChannelData(channel: number): Float32Array;
}

function buffer(channels: Float32Array[], sampleRate = RATE): FakeBuffer {
  return {
    numberOfChannels: channels.length,
    sampleRate,
    length: channels[0]?.length ?? 0,
    getChannelData: (c) => channels[c],
  };
}

/** A calibration asset's decoded audio: source channel k's marker sounds k-th. */
function markers(count: number, order: readonly number[] = []): Float32Array[] {
  const length = Math.round(0.7 * RATE);
  return Array.from({ length: count }, (_, decoded) => {
    const source = order[decoded] ?? decoded;
    const samples = new Float32Array(length);
    const start = Math.round((0.1 + 0.06 * source) * RATE);
    for (let i = 0; i < Math.round(0.02 * RATE); i++) {
      samples[start + i] = 0.5 * Math.sin((2 * Math.PI * 1000 * i) / RATE);
    }
    return samples;
  });
}

/** Two channels carrying a continuous tone, as WebKit decodes the AAC track. */
function tone(): Float32Array[] {
  const length = Math.round(0.7 * RATE);
  return [0, 1].map(() =>
    Float32Array.from(
      { length },
      (_, i) => 0.032 * Math.sin((2 * Math.PI * 3000 * i) / RATE),
    ),
  );
}

const asset = (channels: number): DecodeAsset => ({
  channels,
  artifactId: `calib_${channels}ch`,
  sha256: `sha-${channels}`,
  bytes: new Uint8Array([channels]).buffer,
});

/** Stub OfflineAudioContext so decodeAudioData returns `decode(firstByte)`. */
function stubDecoder(decode: (channels: number) => FakeBuffer | DOMException) {
  vi.stubGlobal(
    "OfflineAudioContext",
    class {
      decodeAudioData(data: ArrayBuffer) {
        const result = decode(new Uint8Array(data)[0]);
        return "getChannelData" in result
          ? Promise.resolve(result)
          : Promise.reject(result);
      }
    },
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("measureDecodedChannels", () => {
  // Run the shipped worklet over the same samples, so the decode check and
  // the playback probe are judged on the same statistics.
  const scope = globalThis as unknown as {
    sampleRate?: number;
    currentFrame?: number;
  };
  beforeEach(() => {
    scope.sampleRate = RATE;
    scope.currentFrame = 0;
  });
  afterEach(() => {
    delete scope.sampleRate;
    delete scope.currentFrame;
  });

  interface Processor {
    port: {
      onmessage: ((event: unknown) => void) | null;
      postMessage: (data: unknown) => void;
    };
    process: (inputs: Float32Array[][]) => boolean;
  }
  type ProcessorClass = new (options: {
    processorOptions: { channels: number };
  }) => Processor;

  function throughWorklet(channels: Float32Array[]): ProbeReport {
    scope.currentFrame = 0;
    const registered: { ctor?: ProcessorClass } = {};
    class FakeProcessor {
      port = { onmessage: null, postMessage: () => undefined };
    }
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    const run = new Function(
      "AudioWorkletProcessor",
      "registerProcessor",
      WORKLET_SOURCE,
    ) as (processor: unknown, register: unknown) => void;
    run(FakeProcessor, (_: string, ctor: ProcessorClass) => {
      registered.ctor = ctor;
    });
    if (!registered.ctor) throw new Error("worklet did not register");
    const node = new registered.ctor({
      processorOptions: { channels: channels.length },
    });
    let reply: ProbeReport | null = null;
    node.port.postMessage = (d) => {
      reply = d as ProbeReport;
    };
    // Feed render quanta of 128 frames, as a browser does.
    for (let at = 0; at < channels[0].length; at += 128) {
      node.process([channels.map((c) => c.subarray(at, at + 128))]);
      scope.currentFrame = (scope.currentFrame ?? 0) + 128;
    }
    node.port.onmessage?.({ data: "report" });
    if (!reply) throw new Error("worklet did not reply");
    return reply;
  }

  test("reports the same statistics as the probe worklet", () => {
    for (const samples of [markers(3, [0, 2, 1]), tone()]) {
      const fromBuffer = measureDecodedChannels(
        buffer(samples),
        samples.length,
      );
      expect(fromBuffer).toEqual(throughWorklet(samples));
    }
  });

  test("counts a second burst only after a gap longer than BURST_GAP_SECONDS", () => {
    const gap = BURST_GAP_SECONDS * 1_000;
    // As in worklet.test.ts: frames `gap` apart are one burst, `gap + 1` two.
    const same = new Float32Array([
      0.5,
      ...new Array<number>(gap - 1).fill(0),
      0.5,
    ]);
    const split = new Float32Array([
      0.5,
      ...new Array<number>(gap).fill(0),
      0.5,
    ]);
    const r = measureDecodedChannels(buffer([same, split], 1_000), 2);
    expect(r.channels.map((c) => c.bursts)).toEqual([1, 2]);
  });

  test("reports the decoded channel count but measures only the expected channels", () => {
    const r = measureDecodedChannels(buffer(tone()), 3);
    expect(r.inputChannels).toBe(2);
    expect(r.channels).toHaveLength(2);
  });
});

describe("runDecodeCheck", () => {
  test("passes when every count decodes to its markers", async () => {
    stubDecoder((c) => buffer(markers(c, c === 3 ? [0, 2, 1] : [])));
    const result = await runDecodeCheck(COUNTS.map(asset));

    expect(result.verdict).toBe("pass");
    for (const c of COUNTS) {
      expect(result.detail[c].failure).toBeNull();
      expect(result.detail[c].asset).toEqual({
        artifactId: `calib_${c}ch`,
        sha256: `sha-${c}`,
      });
      expect(result.detail[c].report?.inputChannels).toBe(c);
    }
    expect(typeof result.stagebookVersion).toBe("string");
    expect(result.elapsedMs).toBeGreaterThanOrEqual(0);
  });

  test("carries no channel order, so it can't stand in for the playback probe", async () => {
    stubDecoder((c) => buffer(markers(c)));
    const result = await runDecodeCheck(COUNTS.map(asset));
    expect(result).not.toHaveProperty("mappings");
  });

  test("fails WebKit's stereo fallback at 2 channels on its markers, not its count", async () => {
    stubDecoder(() => buffer(tone()));
    const result = await runDecodeCheck(COUNTS.map(asset));

    expect(result.verdict).toBe("fail");
    expect(result.detail[2].failure?.reason).toBe("marker-missing");
    for (const c of COUNTS.slice(1)) {
      expect(result.detail[c].failure?.reason).toBe("channel-count");
    }
  });

  test("fails a count whose asset won't decode, as decode", async () => {
    stubDecoder((c) =>
      c === 5
        ? new DOMException("Unable to decode audio data", "EncodingError")
        : buffer(markers(c)),
    );
    const result = await runDecodeCheck(COUNTS.map(asset));

    expect(result.verdict).toBe("fail");
    expect(result.detail[5].failure).toMatchObject({
      reason: "decode",
      message: expect.stringContaining("EncodingError") as string,
    });
    expect(result.detail[5].report).toBeNull();
    expect(result.detail[4].failure).toBeNull();
  });

  test("leaves the caller's bytes usable (decodeAudioData detaches its input)", async () => {
    const seen: number[] = [];
    vi.stubGlobal(
      "OfflineAudioContext",
      class {
        decodeAudioData(data: ArrayBuffer) {
          seen.push(data.byteLength);
          structuredClone(data, { transfer: [data] });
          return Promise.resolve(buffer(markers(2)));
        }
      },
    );
    const input = asset(2);
    await runDecodeCheck([input]);
    expect(seen).toEqual([1]);
    expect(input.bytes.byteLength).toBe(1);
  });

  test("fails every count as unsupported when OfflineAudioContext is absent", async () => {
    expect(typeof OfflineAudioContext).toBe("undefined");
    const result = await runDecodeCheck(COUNTS.map(asset));

    expect(result.verdict).toBe("fail");
    for (const c of COUNTS) {
      expect(result.detail[c].failure?.reason).toBe("unsupported");
    }
  });

  test("fails with nothing to check", async () => {
    stubDecoder((c) => buffer(markers(c)));
    expect((await runDecodeCheck([])).verdict).toBe("fail");
  });
});

describe("checkMultichannelDecode", () => {
  test("checks every shipped calibration asset and never rejects", async () => {
    const result = await checkMultichannelDecode();
    expect(result.verdict).toBe("fail");
    expect(Object.keys(result.detail).map(Number)).toEqual(COUNTS);
    for (const c of COUNTS) {
      expect(result.detail[c].failure?.reason).toBe("unsupported");
      expect(result.detail[c].asset.artifactId).toBe(
        `compose_group_calibration_${c}ch`,
      );
    }
  });
});
