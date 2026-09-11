/**
 * Test wrapper for Timeline. Provides a PlaybackProvider with an optional
 * mock PlaybackHandle registered under a given name. Exposes save calls
 * via the DOM so Playwright can assert on them.
 *
 * IMPORTANT: Playwright CT cannot serialize function props across the worker
 * boundary. So instead of accepting `handleOverrides: Partial<PlaybackHandle>`
 * (which contains methods), this wrapper accepts plain serializable values
 * (numbers/booleans) and constructs the handle internally.
 */
import React, { useEffect, useMemo, useRef, useState } from "react";
import { Timeline, type TimelineProps } from "../elements/Timeline.js";
import {
  PlaybackProvider,
  useRegisterPlayback,
} from "../playback/PlaybackProvider.js";
import type { PlaybackHandle } from "../playback/PlaybackHandle.js";

/** Plain-value config for the mock handle (serializable across CT boundary). */
export interface MockHandleConfig {
  duration?: number;
  currentTime?: number;
  paused?: boolean;
  channelCount?: number;
}

/**
 * Build a handle whose getter methods read from the supplied refs. Updating
 * a ref's `.current` makes the handle's methods see the new value without
 * re-creating the handle — important for tests that drive playback over
 * time (auto-scroll, snap-on-seek).
 *
 * `captureCallCount` tracks how many times requestWaveformCapture has been
 * called, so tests can assert that showWaveform=false suppresses the call.
 */
function makeRefBackedHandle(refs: {
  duration: { current: number };
  currentTime: { current: number };
  paused: { current: boolean };
  channelCount: { current: number };
  captureCallCount: { current: number };
  peaks: { current: Float32Array[] };
  peaksVersion: { current: number };
  durationVersion: { current: number };
  muted: { current: boolean[] };
}): PlaybackHandle {
  return {
    play() {
      refs.paused.current = false;
    },
    pause() {
      refs.paused.current = true;
    },
    seekTo(s: number) {
      refs.currentTime.current = s;
    },
    getCurrentTime: () => refs.currentTime.current,
    getDuration: () => refs.duration.current,
    isPaused: () => refs.paused.current,
    isYouTube: false,
    get channelCount() {
      return refs.channelCount.current;
    },
    get peaks() {
      return refs.peaks.current;
    },
    get peaksVersion() {
      return refs.peaksVersion.current;
    },
    get durationVersion() {
      return refs.durationVersion.current;
    },
    requestWaveformCapture() {
      refs.captureCallCount.current += 1;
    },
    setChannelMuted(channel: number, muted: boolean) {
      if (channel < 0) return;
      const arr = refs.muted.current.slice();
      while (arr.length <= channel) arr.push(false);
      arr[channel] = muted;
      refs.muted.current = arr;
    },
    isChannelMuted(channel: number) {
      return refs.muted.current[channel] ?? false;
    },
  };
}

/** Registers a mock handle inside the PlaybackProvider. */
function MockPlayer({
  name,
  handle,
}: {
  name: string;
  handle: PlaybackHandle;
}) {
  useRegisterPlayback(name, handle);
  return null;
}

export interface MockTimelineProps extends Omit<TimelineProps, "save"> {
  /** Name of the mock player to register. Omit to test the "no player" case. */
  playerName?: string;
  /** Plain-value overrides for the mock PlaybackHandle. */
  mockDuration?: number;
  mockCurrentTime?: number;
  mockPaused?: boolean;
  mockChannelCount?: number;
  /**
   * Per-channel interleaved min/max peaks. Accepts plain number[][] so
   * Playwright CT can serialize it across the worker boundary; converted to
   * Float32Array[] internally.
   */
  mockPeaks?: number[][];
}

export function MockTimeline({
  playerName,
  mockDuration,
  mockCurrentTime,
  mockPaused,
  mockChannelCount,
  mockPeaks,
  ...props
}: MockTimelineProps) {
  const [saves, setSaves] = useState<Array<{ key: string; value: unknown }>>(
    [],
  );

  // Refs that the handle's getter methods read from. Updating these via a
  // re-render with new prop values lets tests drive playback over time
  // (e.g., for auto-scroll and snap-on-seek tests).
  const durationRef = useRef(mockDuration ?? 60);
  const currentTimeRef = useRef(mockCurrentTime ?? 0);
  const pausedRef = useRef(mockPaused ?? true);
  const channelCountRef = useRef(mockChannelCount ?? 0);
  // Counts how many times Timeline called requestWaveformCapture, so tests
  // can verify that showWaveform=false suppresses it.
  const captureCallCountRef = useRef(0);
  const peaksRef = useRef<Float32Array[]>([]);
  const peaksVersionRef = useRef(0);
  const durationVersionRef = useRef(1);
  // Channel mute state the handle reports. Tests read this through the
  // <div data-testid="mute-state"> below.
  const mutedRef = useRef<boolean[]>([]);
  // Only explicit prop changes drive the mutable playback state. Save,
  // mute and capture-count rerenders must not undo the handle's seek/play.
  const previousTimeProp = useRef(mockCurrentTime);
  const previousPausedProp = useRef(mockPaused);
  if (mockCurrentTime !== previousTimeProp.current) {
    currentTimeRef.current = mockCurrentTime ?? 0;
    previousTimeProp.current = mockCurrentTime;
  }
  if (mockPaused !== previousPausedProp.current) {
    pausedRef.current = mockPaused ?? true;
    previousPausedProp.current = mockPaused;
  }
  durationRef.current = mockDuration ?? 60;
  channelCountRef.current = mockChannelCount ?? 0;
  // Convert plain number arrays to Float32Array[] when the top-level
  // mockPeaks array OR any per-channel array reference changes; bump the
  // version so WaveformRenderer's redraw effect sees the new data. Comparing
  // by reference (rather than length) lets a test pass freshly-constructed
  // arrays of the same length to push updated values through the refs.
  const lastMockPeaksRef = useRef<typeof mockPeaks>(undefined);
  const lastChannelRefsRef = useRef<readonly number[][]>([]);
  const channels: readonly number[][] = mockPeaks ?? [];
  const peaksChanged =
    lastMockPeaksRef.current !== mockPeaks ||
    lastChannelRefsRef.current.length !== channels.length ||
    channels.some((ch, i) => lastChannelRefsRef.current[i] !== ch);
  if (peaksChanged) {
    lastMockPeaksRef.current = mockPeaks;
    lastChannelRefsRef.current = channels.slice();
    peaksRef.current = channels.map((ch) => Float32Array.from(ch));
    peaksVersionRef.current += 1;
  }

  // Memoize the handle once — its methods close over the refs above, so
  // updates flow through without recreating.
  const handle = useMemo(
    () =>
      makeRefBackedHandle({
        duration: durationRef,
        currentTime: currentTimeRef,
        paused: pausedRef,
        channelCount: channelCountRef,
        captureCallCount: captureCallCountRef,
        peaks: peaksRef,
        peaksVersion: peaksVersionRef,
        durationVersion: durationVersionRef,
        muted: mutedRef,
      }),
    // Refs only — handle is stable for the lifetime of the mock.
    [],
  );

  // Re-render the capture count display whenever it might have changed.
  // Poll the ref on a short interval — Timeline's requestWaveformCapture
  // call happens in its mount effect, which runs AFTER the child render
  // but BEFORE this parent's effect, so a one-shot effect would already
  // have observed the current value. We poll to catch later changes too.
  const [captureCallCount, setCaptureCallCount] = useState(0);
  useEffect(() => {
    const id = setInterval(() => {
      if (captureCallCountRef.current !== captureCallCount) {
        setCaptureCallCount(captureCallCountRef.current);
      }
    }, 30);
    return () => clearInterval(id);
  }, [captureCallCount]);

  // Expose the handle's per-channel mute state to tests via the DOM. Poll
  // the ref (same pattern as captureCallCount above) so CT tests can assert
  // on handle.isChannelMuted via a data-testid.
  const [muteSnapshot, setMuteSnapshot] = useState<boolean[]>([]);
  useEffect(() => {
    const id = setInterval(() => {
      const current = mutedRef.current;
      if (
        current.length !== muteSnapshot.length ||
        current.some((v, i) => v !== muteSnapshot[i])
      ) {
        setMuteSnapshot(current.slice());
      }
    }, 30);
    return () => clearInterval(id);
  }, [muteSnapshot]);

  return (
    <PlaybackProvider>
      {playerName && <MockPlayer name={playerName} handle={handle} />}
      {/* Force a fixed width so ResizeObserver in tests has a known size. */}
      <div style={{ width: "800px" }}>
        <Timeline
          {...props}
          save={(key, value) => setSaves((prev) => [...prev, { key, value }])}
        />
      </div>
      <div data-testid="save-log" style={{ display: "none" }}>
        {JSON.stringify(saves)}
      </div>
      <div data-testid="capture-call-count" style={{ display: "none" }}>
        {String(captureCallCount)}
      </div>
      <div data-testid="mute-state" style={{ display: "none" }}>
        {JSON.stringify(muteSnapshot)}
      </div>
    </PlaybackProvider>
  );
}
