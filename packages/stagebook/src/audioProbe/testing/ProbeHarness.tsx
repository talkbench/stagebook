// Component-test harness for the channel-order probe (audioProbe.ct.tsx).
// Not exported from any entry point.
//
// Each button starts its task from a real click, so the browser's own
// gesture rules apply — the probe must work without autoplay flags. Results
// are rendered as JSON for the test to read.

import { useState } from "react";
import {
  loadWorkletModule,
  playIntoWorklet,
  runProbe,
  waitForRendering,
  type ProbeAsset,
} from "../probe.js";
import { probeChannelOrder } from "../probeChannelOrder.js";

/** Source channel k of each tone_<C>ch.mp4 fixture carries TONES[k] Hz. */
export const TONE_FREQUENCIES = [311, 523, 743, 977, 1213, 1453, 1699, 1951];

const TONE_PROCESSOR = "stagebook-test-tone-order";

/**
 * Per decoded channel, the energy at each candidate tone frequency over the
 * whole asset (a running Goertzel filter per frequency). Which frequency
 * dominates a decoded channel names the source channel it carries — a
 * measurement independent of the probe's markers.
 */
const TONE_WORKLET = `
class ToneOrder extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const { channels, frequencies } = options.processorOptions;
    this.coeffs = frequencies.map((f) => 2 * Math.cos((2 * Math.PI * f) / sampleRate));
    this.state = [];
    for (let c = 0; c < channels; c++) {
      this.state.push(frequencies.map(() => ({ s1: 0, s2: 0 })));
    }
    this.port.onmessage = () => {
      this.port.postMessage({
        powers: this.state.map((bank) =>
          bank.map((st, j) => st.s1 * st.s1 + st.s2 * st.s2 - this.coeffs[j] * st.s1 * st.s2),
        ),
      });
    };
  }
  process(inputs) {
    const input = inputs[0];
    const count = Math.min(input.length, this.state.length);
    for (let c = 0; c < count; c++) {
      const x = input[c];
      for (let j = 0; j < this.coeffs.length; j++) {
        const st = this.state[c][j];
        const k = this.coeffs[j];
        let s1 = st.s1;
        let s2 = st.s2;
        for (let i = 0; i < x.length; i++) {
          const s0 = x[i] + k * s1 - s2;
          s2 = s1;
          s1 = s0;
        }
        st.s1 = s1;
        st.s2 = s2;
      }
    }
    return true;
  }
}
registerProcessor(${JSON.stringify(TONE_PROCESSOR)}, ToneOrder);
`;

export interface ToneMeasurement {
  readonly channels: number;
  /** `powers[d][k]`: energy of source tone k on decoded channel d. */
  readonly powers: number[][] | null;
  readonly error?: string;
}

/** A recording the harness plays: its channel count and URL. */
export type HarnessMedia = Pick<ProbeAsset, "channels" | "url">;

async function measureTones(
  ctx: AudioContext,
  assets: readonly HarnessMedia[],
): Promise<ToneMeasurement[]> {
  await loadWorkletModule(ctx, TONE_WORKLET);
  await waitForRendering(ctx, 10_000);
  return Promise.all(
    assets.map(async ({ channels, url }) => {
      try {
        const reply = (await playIntoWorklet(
          ctx,
          url,
          channels,
          TONE_PROCESSOR,
          10_000,
          { frequencies: TONE_FREQUENCIES.slice(0, channels) },
        )) as { powers: number[][] };
        return { channels, powers: reply.powers };
      } catch (err) {
        return { channels, powers: null, error: String(err) };
      }
    }),
  );
}

export interface ProbeHarnessProps {
  /** Assets the "Probe fixtures" button runs the probe's analysis over. */
  readonly probeAssets?: readonly ProbeAsset[];
  /** Tone recordings the "Measure tones" button plays. */
  readonly toneAssets?: readonly HarnessMedia[];
}

export function ProbeHarness({ probeAssets, toneAssets }: ProbeHarnessProps) {
  const [shipped, setShipped] = useState("");
  const [fixtures, setFixtures] = useState("");
  const [tones, setTones] = useState("");

  const report = (task: Promise<unknown>, setResult: (s: string) => void) =>
    void task.then(
      (result) => setResult(JSON.stringify(result)),
      (err: unknown) => setResult(JSON.stringify({ error: String(err) })),
    );

  // A context created inside the click, as a host would.
  const inContext = (task: (ctx: AudioContext) => Promise<unknown>) => {
    const ctx = new AudioContext();
    void ctx.resume();
    return task(ctx).finally(() => void ctx.close());
  };

  return (
    <div>
      <button
        type="button"
        // The public entry point, called straight from the click.
        onClick={() => report(probeChannelOrder(), setShipped)}
      >
        Probe calibration assets
      </button>
      <button
        type="button"
        onClick={() =>
          report(
            inContext((ctx) => runProbe(ctx, probeAssets ?? [], 10_000)),
            setFixtures,
          )
        }
      >
        Probe fixtures
      </button>
      <button
        type="button"
        onClick={() =>
          report(
            inContext((ctx) => measureTones(ctx, toneAssets ?? [])),
            setTones,
          )
        }
      >
        Measure tones
      </button>
      <output data-testid="shipped-result">{shipped}</output>
      <output data-testid="fixture-result">{fixtures}</output>
      <output data-testid="tone-result">{tones}</output>
    </div>
  );
}
