// Plays calibration assets through the path a recording takes — a media
// element into a MediaElementAudioSourceNode — and into the probe worklet.
// See #663: the order a browser decodes multichannel Opus in differs between
// engines and versions, so it is measured, through playback, rather than
// looked up.

import {
  analyzeProbeReport,
  type ProbeFailure,
  type ProbeFailureReason,
  type ProbeReport,
} from "./analyze.js";
import { PROCESSOR_NAME, WORKLET_SOURCE } from "./worklet.js";
import { STAGEBOOK_VERSION } from "../version.js";

/** Which calibration asset a channel count was measured with. */
export interface ProbeAssetId {
  /** The pipeline's artifact id, from the asset's sidecar. */
  readonly artifactId: string;
  /** Hex SHA-256 of the asset's bytes. */
  readonly sha256: string;
}

/** One asset to probe: its channel count, a URL the page can play, and its id. */
export interface ProbeAsset extends ProbeAssetId {
  readonly channels: number;
  readonly url: string;
}

/** What the probe found at one channel count. */
export interface ChannelProbeDetail {
  readonly asset: ProbeAssetId;
  /** Why the count failed; null when it passed. */
  readonly failure: ProbeFailure | null;
  /**
   * What the worklet measured, kept so a stored verdict can be audited.
   * Null when the asset never finished playing.
   */
  readonly report: ProbeReport | null;
}

/**
 * The probe's verdict across every channel count it checked. Plain data, so
 * a host can store it with the session as JSON.
 */
export interface ChannelProbeResult {
  /**
   * "pass" only if, at every count, each decoded channel carried its marker
   * and nothing else.
   */
  readonly verdict: "pass" | "fail";
  /**
   * Keyed by channel count. `mappings[C][d]` is the source channel this
   * browser delivers on decoded channel `d`, for recordings with exactly C
   * channels; never apply it to another count. Null for a count that failed.
   */
  readonly mappings: Readonly<Record<number, readonly number[] | null>>;
  /** Keyed by channel count. */
  readonly detail: Readonly<Record<number, ChannelProbeDetail>>;
  /** The stagebook release that measured this. */
  readonly stagebookVersion: string;
  /** Wall-clock time from the call to the verdict. */
  readonly elapsedMs: number;
}

/** An asset as a result names it, whether or not it was played. */
type CountedAsset = Omit<ProbeAsset, "url">;

/** One count's outcome, before it is filed into a {@link ChannelProbeResult}. */
interface CountOutcome {
  readonly asset: CountedAsset;
  readonly mapping: readonly number[] | null;
  readonly failure: ProbeFailure | null;
  readonly report: ProbeReport | null;
}

/**
 * After `ended`, how long to keep the graph running so the last of the
 * element's audio reaches the worklet before it is asked for its report.
 */
const TAIL_MS = 150;

/** How far the context's clock must advance before assets start playing. */
const GRAPH_SETTLE_SECONDS = 0.1;

/** How long the worklet gets to answer a report request. */
const REPORT_TIMEOUT_MS = 2_000;

class ProbeError extends Error {
  constructor(
    readonly reason: ProbeFailureReason,
    message: string,
  ) {
    super(message);
  }
}

export function describeError(err: unknown): string {
  if (err instanceof Error) return `${err.name}: ${err.message}`;
  return String(err);
}

function failedCount(
  asset: CountedAsset,
  reason: ProbeFailureReason,
  message: string,
): CountOutcome {
  return {
    asset,
    mapping: null,
    failure: { reason, message },
    report: null,
  };
}

/**
 * File per-count outcomes into a {@link ChannelProbeResult}. The verdict
 * passes only if there was something to measure and all of it passed.
 */
function summarize(
  outcomes: readonly CountOutcome[],
  startedAt: number,
): ChannelProbeResult {
  const mappings: Record<number, readonly number[] | null> = {};
  const detail: Record<number, ChannelProbeDetail> = {};
  for (const { asset, mapping, failure, report } of outcomes) {
    mappings[asset.channels] = mapping;
    detail[asset.channels] = {
      asset: { artifactId: asset.artifactId, sha256: asset.sha256 },
      failure,
      report,
    };
  }
  const pass = outcomes.length > 0 && outcomes.every((o) => !o.failure);
  return {
    verdict: pass ? "pass" : "fail",
    mappings,
    detail,
    stagebookVersion: STAGEBOOK_VERSION,
    elapsedMs: Math.round(performance.now() - startedAt),
  };
}

/** A result that fails every asset for one reason, before any is played. */
export function failAll(
  assets: readonly CountedAsset[],
  reason: ProbeFailureReason,
  message: string,
  startedAt: number,
): ChannelProbeResult {
  return summarize(
    assets.map((a) => failedCount(a, reason, message)),
    startedAt,
  );
}

/** Reject with a "timeout" {@link ProbeError} if `promise` takes over `ms`. */
function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  message: string,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new ProbeError("timeout", message)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/**
 * Register a worklet module given as source text. Loaded from a Blob URL so
 * it needs no served file.
 */
export async function loadWorkletModule(
  ctx: BaseAudioContext,
  source: string,
): Promise<void> {
  const url = URL.createObjectURL(
    new Blob([source], { type: "text/javascript" }),
  );
  try {
    await ctx.audioWorklet.addModule(url);
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * Play `url` to its end through a media element, a
 * MediaElementAudioSourceNode and an AudioWorkletNode running
 * `processorName` with discrete inputs, then return whatever the
 * processor replies to a message. Silent: the worklet feeds a zero gain.
 * Rejects with a {@link ProbeError} if playback fails or overruns
 * `timeoutMs`.
 */
export async function playIntoWorklet(
  ctx: AudioContext,
  url: string,
  channels: number,
  processorName: string,
  timeoutMs: number,
  processorOptions: Record<string, unknown> = {},
): Promise<unknown> {
  // A video element, as MediaPlayer uses: the probe has to measure the path
  // recordings take, not one that merely resembles it.
  // Its src is set only once the graph is built, so nothing starts loading
  // if building it throws.
  const element = document.createElement("video");
  element.preload = "auto";
  const source = ctx.createMediaElementSource(element);
  // "max", discrete: the worklet gets the decoded channels as they are, so
  // it sees how many there were (a fallback stereo track shows as 2), and
  // nothing is mixed. "speakers" interpretation would apply downmix
  // matrices.
  const node = new AudioWorkletNode(ctx, processorName, {
    numberOfInputs: 1,
    numberOfOutputs: 1,
    outputChannelCount: [1],
    channelCount: channels,
    channelCountMode: "max",
    channelInterpretation: "discrete",
    processorOptions: { channels, ...processorOptions },
  });
  // Connected through to the destination so the graph pulls the worklet;
  // the zero gain keeps the probe inaudible.
  const mute = ctx.createGain();
  mute.gain.value = 0;
  source.connect(node);
  node.connect(mute);
  mute.connect(ctx.destination);

  try {
    element.src = url;
    await playToEnd(element, timeoutMs);
    await new Promise((resolve) => setTimeout(resolve, TAIL_MS));
    return await requestReport(node);
  } finally {
    element.pause();
    element.removeAttribute("src");
    element.load();
    source.disconnect();
    node.disconnect();
    mute.disconnect();
    node.port.close();
  }
}

function mediaError(element: HTMLMediaElement): ProbeError {
  return new ProbeError(
    "playback",
    `Media error ${element.error?.code ?? "unknown"}${
      element.error?.message ? `: ${element.error.message}` : ""
    }.`,
  );
}

/**
 * Resolve once the context is rendering: resumed, and its clock advancing.
 * Media played into a graph that has not started rendering can be lost. In
 * Firefox under CPU load, starting the assets straight after `resume()`
 * dropped most of each asset's audio in a third of runs — sometimes every
 * marker (a false fail), and once enough of a mixed-in fallback tone that
 * the asset passed (a false pass). Waiting for the clock removed both.
 */
export async function waitForRendering(ctx: AudioContext, timeoutMs: number) {
  // Not awaited: with no audio output device, resume() can stay pending
  // indefinitely (Firefox in a container). The clock is the test.
  ctx.resume().catch(() => undefined);
  const deadline = performance.now() + timeoutMs;
  const start = ctx.currentTime;
  while (ctx.currentTime - start < GRAPH_SETTLE_SECONDS) {
    if (performance.now() > deadline) {
      throw new ProbeError(
        "timeout",
        `The audio context did not start rendering within ${timeoutMs} ms (state: ${ctx.state}).`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

function playToEnd(element: HTMLMediaElement, timeoutMs: number) {
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(
        new ProbeError(
          "timeout",
          `Did not finish playing within ${timeoutMs} ms.`,
        ),
      );
    }, timeoutMs);
    const settle = (outcome: () => void) => () => {
      clearTimeout(timer);
      outcome();
    };
    element.addEventListener("ended", settle(resolve), { once: true });
    element.addEventListener(
      "error",
      settle(() => reject(mediaError(element))),
      { once: true },
    );
    element.play().catch((err: unknown) => {
      settle(() =>
        reject(
          new ProbeError(
            "playback",
            // NotAllowedError here almost always means the probe was not
            // started from a user gesture.
            `play() was refused (${describeError(err)}).`,
          ),
        ),
      )();
    });
  });
}

function requestReport(node: AudioWorkletNode) {
  return new Promise<unknown>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new ProbeError("timeout", "The worklet did not report."));
    }, REPORT_TIMEOUT_MS);
    node.port.onmessage = (event: MessageEvent) => {
      clearTimeout(timer);
      resolve(event.data);
    };
    node.port.postMessage("report");
  });
}

async function probeAsset(
  ctx: AudioContext,
  asset: ProbeAsset,
  timeoutMs: number,
): Promise<CountOutcome> {
  try {
    const report = (await playIntoWorklet(
      ctx,
      asset.url,
      asset.channels,
      PROCESSOR_NAME,
      timeoutMs,
    )) as ProbeReport;
    const { decodedToSource, failure } = analyzeProbeReport(
      report,
      asset.channels,
    );
    return { asset, mapping: decodedToSource, failure, report };
  } catch (err) {
    if (err instanceof ProbeError) {
      return failedCount(asset, err.reason, err.message);
    }
    return failedCount(asset, "playback", describeError(err));
  }
}

/**
 * Probe every asset at once on `ctx`, which the caller owns (creates inside
 * a user gesture, and closes). Never rejects: anything that stops a count
 * from being measured fails that count. `startedAt` (a `performance.now()`
 * reading) is when the caller's clock for `elapsedMs` starts.
 */
export async function runProbe(
  ctx: AudioContext,
  assets: readonly ProbeAsset[],
  timeoutMs: number,
  startedAt = performance.now(),
): Promise<ChannelProbeResult> {
  if (typeof AudioWorkletNode === "undefined" || !ctx.audioWorklet) {
    const message = window.isSecureContext
      ? "This browser does not support AudioWorklet."
      : "AudioWorklet needs a secure context (HTTPS).";
    return failAll(assets, "unsupported", message, startedAt);
  }
  try {
    await withTimeout(
      loadWorkletModule(ctx, WORKLET_SOURCE),
      timeoutMs,
      `The probe worklet did not load within ${timeoutMs} ms.`,
    );
  } catch (err) {
    if (err instanceof ProbeError) {
      return failAll(assets, err.reason, err.message, startedAt);
    }
    const message = `Could not load the probe worklet (${describeError(err)}).`;
    return failAll(assets, "unsupported", message, startedAt);
  }
  try {
    await waitForRendering(ctx, timeoutMs);
  } catch (err) {
    if (err instanceof ProbeError) {
      return failAll(assets, err.reason, err.message, startedAt);
    }
    return failAll(assets, "playback", describeError(err), startedAt);
  }
  return summarize(
    await Promise.all(assets.map((a) => probeAsset(ctx, a, timeoutMs))),
    startedAt,
  );
}
