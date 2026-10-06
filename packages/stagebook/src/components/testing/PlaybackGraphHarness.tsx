// Component-test harness for MediaPlayer's playback graph
// (playbackGraph.ct.tsx). Renders the graph offline at every channel count
// and reports what reaches each ear, as JSON.

import { useEffect, useState } from "react";
import { buildPlaybackGraph } from "../elements/mediaPlayer/playbackGraph.js";
import { setChannelGain } from "../elements/mediaPlayer/muteChannels.js";

/** Channel k of the synthetic source carries this constant. */
const sourceLevel = (k: number) => (k + 1) / 10;

export interface EarLevels {
  readonly left: number;
  readonly right: number;
}

export interface PlaybackGraphMeasurement {
  readonly channels: number;
  /** `levels[k]`: the constant source channel k carried. */
  readonly levels: number[];
  /** Every channel playing. */
  readonly all: EarLevels;
  /** `muted[j]`: channel j muted, the rest playing. */
  readonly muted: EarLevels[];
}

const SAMPLE_RATE = 48_000;
const FRAMES = 1_024;

/**
 * Render `channels` constant sources (channel k at `sourceLevel(k)`) through
 * the playback graph into a stereo destination, with `mutedChannel` (if
 * any) muted, and read one settled frame from each ear.
 */
async function renderEars(
  channels: number,
  mutedChannel: number | null,
): Promise<EarLevels> {
  const ctx = new OfflineAudioContext(2, FRAMES, SAMPLE_RATE);
  const source = ctx.createChannelMerger(channels);
  for (let k = 0; k < channels; k++) {
    const constant = ctx.createConstantSource();
    constant.offset.value = sourceLevel(k);
    constant.connect(source, 0, k);
    constant.start();
  }
  const { gains } = buildPlaybackGraph(ctx, source, channels);
  if (mutedChannel !== null) setChannelGain(gains, mutedChannel, true);
  const rendered = await ctx.startRendering();
  const frame = FRAMES / 2;
  return {
    left: rendered.getChannelData(0)[frame],
    right: rendered.getChannelData(1)[frame],
  };
}

async function measure(counts: readonly number[]) {
  const out: PlaybackGraphMeasurement[] = [];
  for (const channels of counts) {
    const muted: EarLevels[] = [];
    for (let j = 0; j < channels; j++) {
      muted.push(await renderEars(channels, j));
    }
    out.push({
      channels,
      levels: Array.from({ length: channels }, (_, k) => sourceLevel(k)),
      all: await renderEars(channels, null),
      muted,
    });
  }
  return out;
}

export function PlaybackGraphHarness({
  counts,
}: {
  readonly counts: readonly number[];
}) {
  const [result, setResult] = useState("");
  useEffect(() => {
    measure(counts).then(
      (m) => setResult(JSON.stringify(m)),
      (err: unknown) => setResult(JSON.stringify({ error: String(err) })),
    );
  }, [counts]);
  return (
    <div>
      <output data-testid="graph-result">{result}</output>
    </div>
  );
}
