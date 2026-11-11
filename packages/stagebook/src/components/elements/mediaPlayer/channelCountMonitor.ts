// A parallel, silent tap observes the source BEFORE an explicit splitter can
// truncate it. Ignore empty/pre-play quanta; report changes once signal arrives.
export const CHANNEL_COUNT_WORKLET = `
class ChannelCount extends AudioWorkletProcessor {
  constructor() { super(); this.last = 0; }
  process(inputs) {
    const channels = inputs[0];
    if (channels.length !== this.last && channels.some(c => c.some(x => x !== 0))) {
      this.last = channels.length;
      this.port.postMessage(this.last);
    }
    return true;
  }
}
registerProcessor('stagebook-channel-count', ChannelCount);
`;

/**
 * The caller aborts a pending install and disposes the tap on unmount.
 *
 * `workletUrl` is where the host serves `stagebook/worklets/channel-count.js`
 * (the text above, as a file). Without it the module loads from a blob: URL,
 * which a Content-Security-Policy refuses unless its script directive allows
 * `blob:` (#837).
 */
export async function monitorChannelCount(
  ctx: AudioContext,
  source: AudioNode,
  onCount: (count: number) => void,
  signal: AbortSignal,
  workletUrl?: string,
): Promise<() => void> {
  const moduleUrl =
    workletUrl ??
    URL.createObjectURL(
      new Blob([CHANNEL_COUNT_WORKLET], { type: "text/javascript" }),
    );
  let timer: ReturnType<typeof setTimeout> | undefined;
  let abort: (() => void) | undefined;
  try {
    await Promise.race([
      ctx.audioWorklet.addModule(moduleUrl),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error("Channel monitor load timed out")),
          10_000,
        );
        abort = () => reject(new Error("Channel monitor cancelled"));
        signal.addEventListener("abort", abort, { once: true });
        if (signal.aborted) abort();
      }),
    ]);
  } finally {
    clearTimeout(timer);
    if (abort) signal.removeEventListener("abort", abort);
    if (workletUrl === undefined) URL.revokeObjectURL(moduleUrl);
  }
  if (signal.aborted) return () => {};
  if (ctx.state === "closed") return () => {};
  const node = new AudioWorkletNode(ctx, "stagebook-channel-count", {
    channelCountMode: "max",
    channelInterpretation: "discrete",
    numberOfInputs: 1,
    numberOfOutputs: 1,
    outputChannelCount: [1],
  });
  node.port.onmessage = (event: MessageEvent<number>) => onCount(event.data);
  source.connect(node);
  // The processor outputs only silence; connecting it keeps the tap pulled.
  node.connect(ctx.destination);
  return () => {
    node.port.onmessage = null;
    node.port.close();
    source.disconnect(node);
    node.disconnect();
  };
}
