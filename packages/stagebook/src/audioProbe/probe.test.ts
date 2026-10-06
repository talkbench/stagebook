// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { ProbeChannelStats, ProbeReport } from "./analyze.js";
import { runProbe, type ProbeAsset } from "./probe.js";

// runProbe's orchestration against stand-in Web Audio and media elements:
// how per-count outcomes become the verdict, the ways playback can fail,
// and settling when the audio stack never answers. What real browsers
// decode is covered in audioProbe.ct.tsx.

const asset = (channels: number, name = "ok"): ProbeAsset => ({
  channels,
  url: `blob:${name}-${channels}`,
  artifactId: `${name}_${channels}ch`,
  sha256: "",
});

const ASSETS = [asset(2), asset(3)];

const never = () => new Promise<never>(() => {});

// ── Stand-ins ──

/** How the stand-in media element behaves when played, by its src. */
type Playback = "ends" | "refused" | "media-error" | "never-ends";
const playback = new Map<string, Playback>();

/** What the stand-in worklet replies with, by its channel count. */
const replies = new Map<number, ProbeReport>();
let workletNodes: FakeWorkletNode[] = [];

class FakeWorkletNode {
  readonly channels: number;
  readonly port = {
    onmessage: null as ((event: { data: unknown }) => void) | null,
    postMessage: () => {
      const report = replies.get(this.channels);
      if (report) setTimeout(() => this.port.onmessage?.({ data: report }));
    },
    close: vi.fn(),
  };
  constructor(_ctx: unknown, _name: string, options: AudioWorkletNodeOptions) {
    this.channels = options.channelCount ?? 0;
    workletNodes.push(this);
  }
  connect() {}
  disconnect() {}
}

const audioNode = () => ({ connect() {}, disconnect() {} });

/** A context that renders: its clock advances with real time. */
function renderingContext(addModule = () => Promise.resolve()) {
  const gains: { gain: { value: number } }[] = [];
  const createdAt = performance.now();
  const ctx = {
    state: "running",
    get currentTime() {
      return (performance.now() - createdAt) / 1000;
    },
    resume: () => Promise.resolve(),
    audioWorklet: { addModule },
    destination: audioNode(),
    createMediaElementSource: audioNode,
    createGain: () => {
      const gain = { ...audioNode(), gain: { value: 1 } };
      gains.push(gain);
      return gain;
    },
  };
  return { ctx: ctx as unknown as AudioContext, gains };
}

/** An AudioContext whose clock never moves. */
function stalledContext(addModule: () => Promise<void>) {
  return {
    state: "suspended",
    currentTime: 0,
    resume: never,
    audioWorklet: { addModule },
  } as unknown as AudioContext;
}

const marker = (peakFrame: number): ProbeChannelStats => ({
  peak: 0.5,
  peakFrame,
  hotSamples: 1_000,
  firstHotFrame: peakFrame - 500,
  lastHotFrame: peakFrame + 499,
  bursts: 1,
});

const silent: ProbeChannelStats = {
  peak: 0,
  peakFrame: -1,
  hotSamples: 0,
  firstHotFrame: -1,
  lastHotFrame: -1,
  bursts: 0,
};

const report = (channels: ProbeChannelStats[]): ProbeReport => ({
  sampleRate: 48_000,
  inputChannels: channels.length,
  channels,
});

const revokeObjectURL = vi.fn();

beforeEach(() => {
  playback.clear();
  replies.clear();
  workletNodes = [];
  revokeObjectURL.mockClear();
  vi.stubGlobal("AudioWorkletNode", FakeWorkletNode);
  // jsdom has no blob URLs.
  vi.stubGlobal(
    "URL",
    class extends URL {
      static createObjectURL = () => "blob:worklet";
      static revokeObjectURL = revokeObjectURL;
    },
  );
  vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementation(function (
    this: HTMLMediaElement,
  ) {
    const how = playback.get(this.getAttribute("src") ?? "") ?? "ends";
    if (how === "refused") {
      return Promise.reject(
        new DOMException("needs a user gesture", "NotAllowedError"),
      );
    }
    const event = { ends: "ended", "media-error": "error" }[how as string];
    if (event) setTimeout(() => this.dispatchEvent(new Event(event)));
    return Promise.resolve();
  });
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
  vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// ── Tests ──

describe("runProbe's verdict", () => {
  test("passes when every count passes", async () => {
    replies.set(2, report([marker(4_800), marker(7_680)]));
    replies.set(3, report([marker(4_800), marker(10_560), marker(7_680)]));
    const result = await runProbe(renderingContext().ctx, ASSETS, 2_000);

    expect(result.verdict).toBe("pass");
    expect(result.mappings).toEqual({ 2: [0, 1], 3: [0, 2, 1] });
    expect(result.detail[3]).toEqual({
      asset: { artifactId: "ok_3ch", sha256: "" },
      failure: null,
      report: replies.get(3),
    });
  });

  test("fails if any count fails, and keeps the counts that passed", async () => {
    replies.set(2, report([marker(4_800), marker(7_680)]));
    replies.set(3, report([marker(4_800), marker(7_680), silent]));
    const result = await runProbe(renderingContext().ctx, ASSETS, 2_000);

    expect(result.verdict).toBe("fail");
    expect(result.mappings).toEqual({ 2: [0, 1], 3: null });
    expect(result.detail[2].failure).toBeNull();
    expect(result.detail[3].failure?.reason).toBe("marker-missing");
  });

  test("fails with nothing to measure", async () => {
    const result = await runProbe(renderingContext().ctx, [], 2_000);
    expect(result.verdict).toBe("fail");
  });
});

describe("runProbe when playback fails", () => {
  test("play() refused, as when the probe was not started from a click", async () => {
    playback.set("blob:ok-3", "refused");
    replies.set(2, report([marker(4_800), marker(7_680)]));
    const result = await runProbe(renderingContext().ctx, ASSETS, 2_000);

    expect(result.detail[2].failure).toBeNull();
    expect(result.detail[3].failure).toMatchObject({
      reason: "playback",
      message: expect.stringMatching(
        /play\(\) was refused.*NotAllowedError/,
      ) as string,
    });
    expect(result.detail[3].report).toBeNull();
  });

  test("a media error", async () => {
    playback.set("blob:ok-2", "media-error");
    const result = await runProbe(renderingContext().ctx, [asset(2)], 2_000);
    expect(result.detail[2].failure).toMatchObject({
      reason: "playback",
      message: expect.stringContaining("Media error") as string,
    });
  });

  test("an asset that never ends", async () => {
    playback.set("blob:ok-2", "never-ends");
    const result = await runProbe(renderingContext().ctx, [asset(2)], 300);
    expect(result.detail[2].failure).toMatchObject({
      reason: "timeout",
      message: expect.stringContaining("Did not finish playing") as string,
    });
  });

  test("every worklet port is closed, whatever happened", async () => {
    playback.set("blob:ok-3", "media-error");
    replies.set(2, report([marker(4_800), marker(7_680)]));
    await runProbe(renderingContext().ctx, ASSETS, 2_000);

    expect(workletNodes).toHaveLength(2);
    for (const node of workletNodes) expect(node.port.close).toHaveBeenCalled();
  });
});

test("the probe is silent: every gain it creates is zero", async () => {
  replies.set(2, report([marker(4_800), marker(7_680)]));
  const { ctx, gains } = renderingContext();
  await runProbe(ctx, [asset(2)], 2_000);

  expect(gains.length).toBeGreaterThan(0);
  for (const { gain } of gains) expect(gain.value).toBe(0);
});

describe("runProbe without a usable AudioWorklet", () => {
  test.each([
    [false, "secure context"],
    [true, "does not support AudioWorklet"],
  ])("secure context %s: unsupported, saying why", async (secure, why) => {
    vi.stubGlobal("isSecureContext", secure);
    const ctx = { audioWorklet: undefined } as unknown as AudioContext;
    const result = await runProbe(ctx, ASSETS, 2_000);

    for (const { channels } of ASSETS) {
      expect(result.detail[channels].failure).toMatchObject({
        reason: "unsupported",
        message: expect.stringContaining(why) as string,
      });
    }
  });

  test("the worklet module fails to load: unsupported, and its URL revoked", async () => {
    const { ctx } = renderingContext(() =>
      Promise.reject(new DOMException("blocked", "AbortError")),
    );
    const result = await runProbe(ctx, ASSETS, 2_000);

    expect(result.detail[2].failure).toMatchObject({
      reason: "unsupported",
      message: expect.stringContaining(
        "Could not load the probe worklet",
      ) as string,
    });
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:worklet");
  });
});

describe("runProbe settles when the audio stack never answers", () => {
  // Firefox in a container with no audio output device leaves resume()
  // pending indefinitely; a host awaits the probe at session start.
  test("resume() never settles and the clock never moves", async () => {
    const ctx = stalledContext(() => Promise.resolve());
    const result = await runProbe(ctx, ASSETS, 50);

    expect(result.verdict).toBe("fail");
    for (const { channels } of ASSETS) {
      expect(result.mappings[channels]).toBeNull();
      expect(result.detail[channels].failure).toMatchObject({
        reason: "timeout",
        message: expect.stringContaining("suspended") as string,
      });
    }
  });

  test("the worklet module never loads", async () => {
    const ctx = stalledContext(never);
    const result = await runProbe(ctx, ASSETS, 50);

    expect(result.verdict).toBe("fail");
    for (const { channels } of ASSETS) {
      expect(result.detail[channels].failure?.reason).toBe("timeout");
    }
  });
});
