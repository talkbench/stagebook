import { StrictMode, useEffect, useRef, useState } from "react";
import {
  StagebookProvider,
  type StagebookContext,
} from "../StagebookProvider.js";
import { PlaybackProvider, usePlayback } from "../playback/PlaybackProvider.js";
import { Element } from "../Element.js";
import { probeChannelOrder } from "../../audioProbe/probeChannelOrder.js";
import type { ChannelProbeResult } from "../../audioProbe/probe.js";
import type {
  ChannelMappingEntry,
  ChannelLayoutError,
} from "../../audioProbe/channelLayout.js";

const frequencies = [311, 523, 743, 977, 1213, 1453, 1699, 1951];

/** Observe the actual mono mix that the production graph sends to destination.
 * No source, splitter, permutation or per-channel gain is replaced. */
function observeOutput() {
  // Saved method is always invoked with its original receiver via Reflect.
  // eslint-disable-next-line @typescript-eslint/unbound-method
  const original = AudioNode.prototype.connect;
  const taps: AnalyserNode[] = [];
  AudioNode.prototype.connect = function (this: AudioNode, ...args: unknown[]) {
    const result = Reflect.apply(original, this, args) as AudioNode;
    if (
      (this instanceof GainNode ||
        this instanceof MediaElementAudioSourceNode) &&
      args[0] === this.context.destination
    ) {
      const analyser = this.context.createAnalyser();
      analyser.fftSize = 8192;
      const silent = this.context.createGain();
      silent.gain.value = 0;
      Reflect.apply(original, this, [analyser]);
      Reflect.apply(original, analyser, [silent]);
      Reflect.apply(original, silent, [this.context.destination]);
      taps.push(analyser);
    }
    return result;
  } as typeof original;
  return {
    restore: () => {
      AudioNode.prototype.connect = original;
    },
    powers: () => {
      const node = taps.at(-1);
      if (!node) return [];
      const samples = new Float32Array(node.fftSize);
      node.getFloatTimeDomainData(samples);
      return frequencies.map((f) => {
        let real = 0,
          imag = 0;
        for (let i = 0; i < samples.length; i++) {
          const phase = (2 * Math.PI * f * i) / node.context.sampleRate;
          real += samples[i] * Math.cos(phase);
          imag += samples[i] * Math.sin(phase);
        }
        return (real * real + imag * imag) / samples.length ** 2;
      });
    },
  };
}

function Inspector({ powers }: { powers: () => number[] }) {
  const handle = usePlayback("recording");
  const [snapshot, setSnapshot] = useState("");
  return (
    <>
      <button
        onClick={() => {
          handle?.seekTo(0);
          handle?.play();
        }}
      >
        Play recording
      </button>
      <button onClick={() => handle?.pause()}>Pause recording</button>
      <button
        onClick={() =>
          setSnapshot(
            JSON.stringify({
              tracks: handle?.participantTracks,
              peaks: handle?.peaks.map((p) => {
                let peak = 0;
                for (let i = 0; i < p.length; i += 2) {
                  if (p[i] <= p[i + 1])
                    peak = Math.max(peak, Math.abs(p[i]), Math.abs(p[i + 1]));
                }
                return peak;
              }),
              powers: powers(),
            }),
          )
        }
      >
        Measure audio
      </button>
      <output data-testid="audio-measurement">{snapshot}</output>
    </>
  );
}

export interface GroupRecordingHarnessProps {
  count?: number;
  positions?: number[];
  mappingOverride?: unknown;
  ordinary?: boolean;
  skipProbe?: boolean;
  probeOverride?: unknown;
  initialSelections?: unknown;
  showWaveform?: boolean;
  selectionType?: "point" | "range";
  locale?: string;
}

export function GroupRecordingHarness(props: GroupRecordingHarnessProps) {
  const [count, setCount] = useState(props.count ?? 2);
  const [probe, setProbe] = useState<ChannelProbeResult>();
  const [started, setStarted] = useState(false);
  const [generation, setGeneration] = useState(0);
  const [saves, setSaves] = useState<{ key: string; value: unknown }[]>([]);
  const [errors, setErrors] = useState<unknown[]>([]);
  const stored = useRef<Record<string, unknown>>({
    timeline_marks: props.initialSelections,
  });
  const output = useRef<ReturnType<typeof observeOutput> | null>(null);
  useEffect(() => () => output.current?.restore(), []);
  const file = `asset://room/participants_${count}ch.mp4`;
  const positions =
    props.positions ??
    (count === 2
      ? [5, 0]
      : Array.from({ length: count }, (_, i) => 2 * (count - i)));
  const mapping = Array.from({ length: count }, (_, index) => ({
    index,
    role: "participant",
    position: positions[index],
  }));
  const context: StagebookContext = {
    get: (key) =>
      stored.current[key] === undefined ? [] : [stored.current[key]],
    save: (key, value) => {
      stored.current[key] = value;
      setSaves((s) => [...s, { key, value }]);
    },
    getElapsedTime: () => 0,
    submit() {},
    getTextContent: () => Promise.resolve(""),
    getAssetURL: (path) => `/audio-probe/${path.split("/").at(-1)}`,
    getChannelMapping: (path) => {
      if (path !== file) throw new Error("Expected authored file identity");
      return props.ordinary
        ? undefined
        : ((props.mappingOverride === undefined
            ? mapping
            : props.mappingOverride) as ChannelMappingEntry[]);
    },
    channelProbe:
      props.probeOverride === undefined
        ? probe
        : (props.probeOverride as ChannelProbeResult),
    playerId: "annotator",
    position: 0,
    playerCount: 1,
    progressLabel: "task",
    isSubmitted: false,
    locale: props.locale,
    onElementError: ({ error }) =>
      setErrors((e) => [...e, (error as ChannelLayoutError).diagnostics]),
  };
  return (
    <div style={{ width: 800 }}>
      <button
        onClick={() => {
          void (async () => {
            if (!props.skipProbe) setProbe(await probeChannelOrder());
            output.current?.restore();
            output.current = observeOutput();
            setStarted(true);
          })();
        }}
      >
        Start session
      </button>
      <output data-testid="session-probe">
        {probe && JSON.stringify(probe)}
      </output>
      {started && (
        <>
          {[1, 2, 3, 6, 8].map((n) => (
            <button key={n} onClick={() => setCount(n)}>
              Load {n} channels
            </button>
          ))}
          <button onClick={() => setGeneration((n) => n + 1)}>
            Reload recording
          </button>
          <StagebookProvider value={context}>
            <StrictMode>
              <PlaybackProvider key={`${count}:${generation}`}>
                <Element
                  onSubmit={() => {}}
                  element={{
                    type: "mediaPlayer",
                    name: "recording",
                    file,
                    playback: "manual",
                    autoplay: false,
                    controls: { playPause: true },
                  }}
                />
                <Element
                  onSubmit={() => {}}
                  element={{
                    type: "timeline",
                    name: "marks",
                    source: "recording",
                    selectionType: props.selectionType ?? "point",
                    selectionScope: "track",
                    multiSelect: true,
                    showWaveform: props.showWaveform ?? true,
                    trackLabels: ["Wrong static label"],
                  }}
                />
                <Inspector powers={() => output.current?.powers() ?? []} />
              </PlaybackProvider>
            </StrictMode>
          </StagebookProvider>
        </>
      )}
      <output data-testid="group-saves">{JSON.stringify(saves)}</output>
      <output data-testid="group-errors">{JSON.stringify(errors)}</output>
    </div>
  );
}
