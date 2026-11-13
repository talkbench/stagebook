// One channel-order probe shared by everything in a session (#841): the host
// starts it in the background from the participant's first click, and a
// group media player that renders before it has passed waits for the same
// probe instead of starting another.

import type { ChannelProbeResult } from "./probe.js";
import {
  probeChannelOrder,
  type ProbeChannelOrderOptions,
} from "./probeChannelOrder.js";

/**
 * Make a function that runs probeChannelOrder() at most as often as needed.
 * Each call returns:
 *
 * - the probe still running, if there is one;
 * - the passing result, once one has passed (a browser's decoder cannot
 *   change within a session);
 * - otherwise a fresh probe, started before the call returns.
 *
 * A fresh probe starts its audio synchronously, so call the function from a
 * click handler, as you would probeChannelOrder(). Pass it to
 * StagebookContext as `requestChannelProbe`, so a media player can call it
 * from its own click. Like probeChannelOrder(), the promise never rejects.
 *
 * Make one per session.
 */
export function createChannelProbe(
  options: ProbeChannelOrderOptions = {},
): () => Promise<ChannelProbeResult> {
  let current:
    | { promise: Promise<ChannelProbeResult>; settled?: ChannelProbeResult }
    | undefined;
  return () => {
    if (current && current.settled?.verdict !== "fail") return current.promise;
    const entry: NonNullable<typeof current> = {
      promise: probeChannelOrder(options),
    };
    void entry.promise.then((result) => {
      entry.settled = result;
    });
    current = entry;
    return entry.promise;
  };
}
