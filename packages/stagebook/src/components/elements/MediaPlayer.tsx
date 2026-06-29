import React, {
  useRef,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useState,
} from "react";
import { isYouTubeURL } from "./mediaPlayer/isYouTubeURL.js";
import { parseVTT, type CaptionCue } from "./mediaPlayer/parseVTT.js";
import { YouTubePlayer } from "./mediaPlayer/YouTubePlayer.js";
import { HTML5Controls, YouTubeControls } from "./mediaPlayer/controls.js";
import { useRegisterPlayback } from "../playback/PlaybackProvider.js";
import type { PlaybackHandle } from "../playback/PlaybackHandle.js";
import { computeWatchedRanges } from "../../utils/watchedRanges.js";
import {
  computeBucketCount,
  createPeaksArrays,
  accumulatePeaks,
  allBuffersSilent,
} from "./mediaPlayer/waveformCapture.js";
import { setChannelGain } from "./mediaPlayer/muteChannels.js";
import { useMessages, useIsRTL } from "../StagebookProvider.js";

export interface VideoEvent {
  type: "play" | "pause" | "ended" | "seek" | "speed" | "stopAt";
  videoTime: number;
  stageTimeElapsed: number;
  /** Present on seek events: the position before seeking */
  fromTime?: number;
  /** Present on speed events: the new playback rate */
  playbackRate?: number;
}

interface VideoRecord {
  name: string;
  url: string;
  startAt?: number;
  stopAt?: number;
  events: VideoEvent[];
  lastVideoTime: number;
  /** Merged closed intervals [startSeconds, endSeconds] derived from the event log. */
  watchedRanges: [number, number][];
}

export interface MediaPlayerProps {
  name: string;
  url: string;
  save: (key: string, value: unknown) => void;
  getElapsedTime: () => number;
  onComplete?: () => void;
  syncToStageTime?: boolean;
  submitOnComplete?: boolean;
  playVideo?: boolean;
  playAudio?: boolean;
  captionsURL?: string;
  startAt?: number;
  stopAt?: number;
  allowScrubOutsideBounds?: boolean;
  stepDuration?: number;
  playback?: "once" | "manual";
  controls?: {
    playPause?: boolean;
    seek?: boolean;
    step?: boolean;
    speed?: boolean;
  };
}

const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2] as const;

// Subtle edge for the video viewport. Without this, near-white content
// (a washed-out background, a whiteboard) bleeds into the surrounding page.
// A 1px inset ring via boxShadow keeps layout identical to a border-less
// viewport (no size inflation) while still delimiting the edge.
const VIEWPORT_STYLE: React.CSSProperties = {
  position: "relative",
  borderRadius: "0.5rem",
  overflow: "hidden",
  boxShadow: "0 0 0 1px rgba(0, 0, 0, 0.12), 0 1px 3px rgba(0, 0, 0, 0.06)",
};

/** Reject URLs with dangerous protocols (javascript:, data:, vbscript:, etc.) */
function isSafeURL(url: string): boolean {
  try {
    const parsed = new URL(url, window.location.href);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

// Number of repeated keydown events before entering fast-scrub mode
const HOLD_REPEAT_THRESHOLD = 10;

export function MediaPlayer({
  name,
  url,
  save,
  getElapsedTime,
  onComplete,
  syncToStageTime = false,
  submitOnComplete = false,
  playVideo = true,
  playAudio = true,
  captionsURL,
  startAt,
  stopAt,
  allowScrubOutsideBounds = false,
  stepDuration = 1,
  playback,
  controls,
}: MediaPlayerProps) {
  const messages = useMessages();
  // Text chrome (captions, error overlays, play-once) follows the locale
  // direction; the transport/scrub axis stays LTR via the component root.
  const localeDir = useIsRTL() ? "rtl" : "ltr";
  const youtubeVideoId = isYouTubeURL(url);
  const saveKey = `mediaPlayer_${name}`;

  // Effective playback mode: explicit value wins; otherwise "once" when no
  // controls or syncToStageTime are configured (avoids the frozen-frame state
  // where the video has no way to start).
  const hasAnyControls =
    controls !== undefined &&
    (controls.playPause || controls.seek || controls.step || controls.speed);
  const effectivePlayback =
    playback ?? (hasAnyControls || syncToStageTime ? "manual" : "once");

  // Defense-in-depth: reject dangerous URL protocols. Element.tsx already
  // resolves relative paths via getAssetURL(), so this guards against
  // javascript:, data:, and other non-HTTP schemes reaching a <video> src.
  // The actual early return for this is deferred until *after* all hooks
  // (just above the render branches) so the hook count stays constant when a
  // single instance transitions unsafe→safe in place — otherwise React's
  // rules of hooks are violated and the component throws (#484). The
  // URL-fetching effects below already guard on isSafeURL, so deferring the
  // return never lets an unsafe URL be fetched.
  const urlIsUnsafe = !youtubeVideoId && !isSafeURL(url);

  const eventsRef = useRef<VideoEvent[]>([]);
  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const autoplayAttemptedRef = useRef(false);
  // Per-instance class for the container's `:focus` ring. Same useId
  // pattern as Timeline / Button / Slider — pairs with the Timeline
  // ring so the two stacked components feel visually coherent and the
  // "keyboard shortcuts are live" signal is identical across both.
  const reactId = useId();
  const safeId = reactId.replace(/[^a-zA-Z0-9_-]/g, "");
  const containerClass = `stagebook-mediaplayer-${safeId}`;

  // Ref unstable callbacks so `recordEvent`, `handleEnded`, and
  // `handleTimeUpdate` stay identity-stable even when the parent passes
  // fresh `save` / `onComplete` / `getElapsedTime` references (#105).
  // `handleTimeUpdate` in particular fires every animation frame during
  // playback — re-creating its closure on every render cascades through
  // every JSX handler tied to the <video> element.
  const saveRef = useRef(save);
  saveRef.current = save;
  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;
  const getElapsedTimeRef = useRef(getElapsedTime);
  getElapsedTimeRef.current = getElapsedTime;

  const [isPaused, setIsPaused] = useState(true);
  const [showPlayOnce, setShowPlayOnce] = useState(false);
  const [isHovered, setIsHovered] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState<number>(0);
  const [bufferedEnd, setBufferedEnd] = useState(0);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [cues, setCues] = useState<CaptionCue[]>([]);
  const [captionText, setCaptionText] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Clear any prior error state when the source changes (e.g. parent
  // swaps to a different clip). Without this the player would stay
  // stuck in the error state forever after a single load failure.
  // Also reset autoplay state so a new URL gets a fresh attempt.
  useEffect(() => {
    setLoadError(null);
    autoplayAttemptedRef.current = false;
    setShowPlayOnce(false);
  }, [url]);

  // Pre-flight HEAD check for `Accept-Ranges` (#424). The existing
  // detection at handleLoadedMetadata can only catch the case when
  // the browser exposes the broken state via `seekable.length=0`
  // (Chrome). Firefox and Linux WebKit both falsely report
  // `seekable=[0, duration]` even when ranges aren't supported —
  // their seek would silently fail with no diagnostic.
  //
  // The HEAD response's `Accept-Ranges` header is the authoritative
  // signal across every engine, so we probe it on mount and warn
  // proactively if missing. Failures (CORS, network, server doesn't
  // support HEAD) fall through silently to the existing
  // loadedmetadata-based check — no worse than today.
  const acceptRangesWarnedRef = useRef(false);
  useEffect(() => {
    acceptRangesWarnedRef.current = false;
    if (youtubeVideoId || !url || !isSafeURL(url)) return;
    const controller = new AbortController();
    fetch(url, { method: "HEAD", signal: controller.signal })
      .then((response) => {
        if (!response.ok) return;
        const acceptRanges = response.headers.get("accept-ranges");
        if (!acceptRanges || acceptRanges.toLowerCase() === "none") {
          acceptRangesWarnedRef.current = true;
          console.warn(
            `[MediaPlayer] ${url} returned without "Accept-Ranges: bytes". ` +
              `The browser may not be able to seek the video — researchers ` +
              `may see seek controls snap back toward the start. Check the ` +
              `asset server's range-request configuration. If the asset is ` +
              `cross-origin and seeking actually works, the server may need ` +
              `to expose the header via "Access-Control-Expose-Headers: ` +
              `Accept-Ranges" — without that, this check sees null and ` +
              `false-positives.`,
          );
        }
      })
      .catch(() => {
        // Best-effort. CORS blocks header reads from cross-origin
        // responses that don't expose them, the network may be
        // offline, the server may not support HEAD, etc. — in any
        // of those cases we fall through to the loadedmetadata-
        // based check (which works on Chrome at least).
      });
    return () => controller.abort();
  }, [url, youtubeVideoId]);

  // YouTube-only: handle registered by YouTubePlayer once the IFrame API is ready
  const [ytHandle, setYtHandle] = useState<PlaybackHandle | null>(null);

  // Track whether the video was playing when a scrub drag started, so we can
  // pause on grab and resume on release (records proper play/pause events for
  // watchedRanges without spamming the server during the drag).
  const scrubWasPlayingRef = useRef(false);

  // Set to true just before programmatically pausing the video at stopAt, so
  // handlePause can suppress the phantom "pause" event and we record "ended".
  const stopAtReachedRef = useRef(false);

  // ── Waveform capture (lazy — only activated when a Timeline requests it) ──
  const BUCKETS_PER_SECOND = 10;
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analysersRef = useRef<AnalyserNode[]>([]);
  // The lib.d.ts signature for getByteTimeDomainData expects the strict
  // Uint8Array<ArrayBuffer> variant, not Uint8Array<ArrayBufferLike>.
  // Type the array element explicitly so TS doesn't widen it.
  const analyserBuffersRef = useRef<Uint8Array<ArrayBuffer>[]>([]);
  // Per-channel GainNodes (splitter → gain → merger → destination). Mute
  // state is ephemeral: setChannelMuted writes here and to mutedStateRef
  // below; not persisted and not saved.
  const gainNodesRef = useRef<GainNode[]>([]);
  const mutedStateRef = useRef<boolean[]>([]);
  const peaksRef = useRef<Float32Array[]>([]);
  // Render token: bumps every time peaks are mutated, so consumers can
  // re-run effects despite the array reference being stable.
  const peaksVersionRef = useRef(0);
  const durationVersionRef = useRef(0);
  const [channelCount, setChannelCount] = useState(0);
  const waveformRafRef = useRef<number>(0);
  // Promote waveformActive to state so React effects (e.g., the RAF loop)
  // re-evaluate when capture is requested mid-playback.
  const [waveformActive, setWaveformActive] = useState(false);

  const startWaveformCapture = useCallback(() => {
    if (waveformActive) return; // already active
    const v = videoRef.current;
    if (!v) return;

    try {
      const ctx = new AudioContext();
      const source = ctx.createMediaElementSource(v);
      const splitter = ctx.createChannelSplitter(source.channelCount || 1);
      source.connect(splitter);

      const numChannels = source.channelCount || 1;
      const analysers: AnalyserNode[] = [];
      const buffers: Uint8Array<ArrayBuffer>[] = [];
      const gainNodes: GainNode[] = [];
      const merger = ctx.createChannelMerger(numChannels);

      // splitter → analyser → gainNode → merger → destination.
      // AnalyserNode is a pass-through tap, so reading peaks from the
      // analyser gives the pre-gain (dry) signal — the displayed waveform
      // reflects the recorded audio, not the mute state. Keeping the
      // analyser inline (not dead-ended) also ensures the Web Audio graph
      // pulls it, so getByteTimeDomainData() returns live samples.
      for (let ch = 0; ch < numChannels; ch++) {
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 2048;
        splitter.connect(analyser, ch);

        const gainNode = ctx.createGain();
        gainNode.gain.value = 1;
        analyser.connect(gainNode);
        gainNode.connect(merger, 0, ch);

        analysers.push(analyser);
        buffers.push(new Uint8Array(analyser.frequencyBinCount));
        gainNodes.push(gainNode);
      }

      merger.connect(ctx.destination);

      audioCtxRef.current = ctx;
      analysersRef.current = analysers;
      analyserBuffersRef.current = buffers;
      gainNodesRef.current = gainNodes;
      mutedStateRef.current = new Array<boolean>(numChannels).fill(false);
      setChannelCount(numChannels);
      setWaveformActive(true);
    } catch (err) {
      console.warn("[MediaPlayer] Waveform capture unavailable:", err);
    }
  }, [waveformActive]);

  // Close the AudioContext on unmount. Chrome enforces a hard limit of ~6
  // simultaneous AudioContexts per tab; without this, an experiment that
  // navigates through several stages each with a Timeline+MediaPlayer would
  // exhaust the limit and silently fail.
  useEffect(() => {
    return () => {
      const ctx = audioCtxRef.current;
      if (ctx && ctx.state !== "closed") {
        void ctx.close().catch(() => {
          // Best-effort cleanup; ignore errors during teardown.
        });
      }
      audioCtxRef.current = null;
      analysersRef.current = [];
      analyserBuffersRef.current = [];
      gainNodesRef.current = [];
      mutedStateRef.current = [];
    };
  }, []);

  // Initialize peaks array when duration or channelCount becomes known
  useEffect(() => {
    if (channelCount === 0 || !Number.isFinite(duration) || duration <= 0)
      return;
    const buckets = computeBucketCount(duration, BUCKETS_PER_SECOND);
    if (buckets === 0) return;
    // Only allocate if not already the right size
    if (
      peaksRef.current.length === channelCount &&
      peaksRef.current[0]?.length === buckets * 2
    )
      return;
    peaksRef.current = createPeaksArrays(channelCount, buckets);
  }, [channelCount, duration]);

  // Silent-tainting detector. CORS-tainted media plays normally but the
  // AnalyserNode receives all-zero (centered at 128) samples — the waveform
  // appears as a flat line forever. We watch for the "still no signal after
  // several seconds of playback" pattern and log a clear warning so
  // researchers debugging a flat waveform know exactly where to look.
  const TAINTING_DETECTION_THRESHOLD_SEC = 5;
  const taintWarnedRef = useRef(false);
  const captureStartTimeRef = useRef<number | null>(null);

  // RAF loop: accumulate peaks while playing. Reads from refs each frame so
  // it picks up newly-allocated peak arrays after duration changes; depends
  // on waveformActive (state) so it re-runs when capture begins mid-playback.
  useEffect(() => {
    if (!waveformActive || isPaused) return;

    function tick() {
      const v = videoRef.current;
      if (!v || v.paused) return;
      const analysers = analysersRef.current;
      const buffers = analyserBuffersRef.current;
      const peaks = peaksRef.current;

      if (analysers.length === 0 || peaks.length === 0) {
        // Capture not yet wired up — skip and try again next frame.
        waveformRafRef.current = requestAnimationFrame(tick);
        return;
      }

      // Initialize capture start time on first tick
      if (captureStartTimeRef.current === null) {
        captureStartTimeRef.current = v.currentTime;
      }

      for (let i = 0; i < analysers.length; i++) {
        analysers[i].getByteTimeDomainData(buffers[i]);
      }

      accumulatePeaks(peaks, buffers, v.currentTime, BUCKETS_PER_SECOND);
      // Bump the render token so consumers (Timeline → WaveformRenderer)
      // know the in-place mutation needs a redraw.
      peaksVersionRef.current += 1;

      // Check for silent tainting: have we played enough but still see zero
      // signal? Almost certainly a CORS issue.
      if (
        !taintWarnedRef.current &&
        v.currentTime - (captureStartTimeRef.current ?? 0) >
          TAINTING_DETECTION_THRESHOLD_SEC &&
        allBuffersSilent(buffers)
      ) {
        taintWarnedRef.current = true;
        console.warn(
          "[MediaPlayer] Waveform capture is producing all-zero data after " +
            `${String(TAINTING_DETECTION_THRESHOLD_SEC)}s of playback. This ` +
            "usually means the media is hosted cross-origin without proper " +
            "CORS headers (Access-Control-Allow-Origin), so the AnalyserNode " +
            "is silently tainted. Configure the media server to allow CORS, " +
            "or host the media same-origin.",
        );
      }

      waveformRafRef.current = requestAnimationFrame(tick);
    }

    waveformRafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(waveformRafRef.current);
  }, [isPaused, waveformActive]);

  // Reset the tainting detector state when capture ends or media changes,
  // so we re-arm for the next capture attempt.
  useEffect(() => {
    if (!waveformActive) {
      taintWarnedRef.current = false;
      captureStartTimeRef.current = null;
    }
  }, [waveformActive, url]);

  // Poll YouTube currentTime ~4×/sec while playing (no timeupdate event from IFrame API)
  useEffect(() => {
    if (!ytHandle || isPaused) return;
    const id = setInterval(() => {
      const t = ytHandle.getCurrentTime();
      setCurrentTime(t);
      if (stopAt !== undefined && t >= stopAt) {
        // Signal that the upcoming onPause is from stopAt, not a user action.
        stopAtReachedRef.current = true;
        ytHandle.pause();
      }
    }, 250);
    return () => clearInterval(id);
  }, [ytHandle, isPaused, stopAt]);

  // HTML5 PlaybackHandle — exposes this player to sibling components via PlaybackProvider
  const handle = useMemo<PlaybackHandle>(
    () => ({
      play: () => {
        void videoRef.current?.play();
      },
      pause: () => videoRef.current?.pause(),
      seekTo: (s: number) => {
        if (videoRef.current) videoRef.current.currentTime = s;
      },
      getCurrentTime: () => videoRef.current?.currentTime ?? 0,
      getDuration: () => videoRef.current?.duration ?? 0,
      isPaused: () => videoRef.current?.paused ?? true,
      isYouTube: false,
      get channelCount() {
        return channelCount;
      },
      get peaks() {
        return peaksRef.current;
      },
      get peaksVersion() {
        return peaksVersionRef.current;
      },
      get durationVersion() {
        return durationVersionRef.current;
      },
      requestWaveformCapture: startWaveformCapture,
      setChannelMuted: (channel: number, muted: boolean) => {
        setChannelGain(gainNodesRef.current, channel, muted);
        if (channel >= 0 && channel < mutedStateRef.current.length) {
          mutedStateRef.current[channel] = muted;
        }
      },
      isChannelMuted: (channel: number) =>
        mutedStateRef.current[channel] ?? false,
    }),
    [channelCount, startWaveformCapture], // re-create when channelCount changes so consumers see the update
  );
  // Use the YouTube handle when available, fall back to the HTML5 handle.
  // Register nothing while the URL is unsafe: no <video> is mounted, so the
  // handle would be inert (null videoRef), and registering it would let a
  // sibling Timeline latch onto a dead handle whose identity never changes —
  // so it would never retry waveform capture once the URL recovers (#487).
  useRegisterPlayback(name, urlIsUnsafe ? null : (ytHandle ?? handle));

  // Hold-to-scrub state
  const arrowRepeatCountRef = useRef(0);
  const holdTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const holdIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Fetch and parse captions when captionsURL changes
  useEffect(() => {
    if (!captionsURL) return;
    // Don't fetch captions for media we're rejecting — the component only
    // renders the invalid-URL alert. Re-runs when urlIsUnsafe flips false so
    // captions still load once the media URL recovers (#487).
    if (urlIsUnsafe) return;
    if (!isSafeURL(captionsURL)) {
      console.warn(
        `[MediaPlayer] Rejected unsafe captions URL: ${captionsURL}`,
      );
      return;
    }
    let cancelled = false;
    fetch(captionsURL)
      .then((r) => r.text())
      .then((text) => {
        if (!cancelled) setCues(parseVTT(text));
      })
      .catch((err: unknown) => {
        console.warn(`[MediaPlayer] Failed to load captions:`, err);
      });
    return () => {
      cancelled = true;
    };
  }, [captionsURL, urlIsUnsafe]);

  // Seek to startAt on mount (or to elapsedTime+startAt when syncToStageTime).
  // Re-runs when urlIsUnsafe flips false so the offset is (re)applied to the
  // <video> that first mounts on an invalid→valid recovery — on the initial
  // unsafe render videoRef is null, the effect no-ops, and without this dep it
  // would never run again, leaving the recovered clip at time 0 (#487).
  useEffect(() => {
    if (!videoRef.current) return;
    if (syncToStageTime) {
      videoRef.current.currentTime =
        getElapsedTimeRef.current() + (startAt ?? 0);
    } else if (startAt !== undefined) {
      videoRef.current.currentTime = startAt;
    }
    // reads current startAt/getElapsedTime when it (re)runs; deliberately not
    // re-applied on every startAt change — only on first mount and recovery.
  }, [urlIsUnsafe]);

  // Autoplay for "once" mode: attempt .play() once metadata is loaded.
  // If the browser blocks it (no prior user interaction), show a fallback button.
  useEffect(() => {
    if (effectivePlayback !== "once") return;
    if (autoplayAttemptedRef.current) return;
    const v = videoRef.current;
    if (!v) return;
    // Wait for metadata: duration is set in handleLoadedMetadata
    if (duration === 0) return;

    autoplayAttemptedRef.current = true;
    void v.play().catch(() => {
      setShowPlayOnce(true);
    });
  }, [effectivePlayback, duration]);

  const recordEvent = useCallback(
    (
      type: VideoEvent["type"],
      videoTime: number,
      extra?: Partial<Pick<VideoEvent, "fromTime" | "playbackRate">>,
    ) => {
      const event: VideoEvent = {
        type,
        videoTime,
        stageTimeElapsed: getElapsedTimeRef.current(),
        ...extra,
      };
      eventsRef.current = [...eventsRef.current, event];
      const record: VideoRecord = {
        name,
        url,
        ...(startAt !== undefined && { startAt }),
        ...(stopAt !== undefined && { stopAt }),
        events: eventsRef.current,
        lastVideoTime: videoTime,
        watchedRanges: computeWatchedRanges(eventsRef.current),
      };
      saveRef.current(saveKey, record);
    },
    [name, url, startAt, stopAt, saveKey],
  );

  const handlePlay = useCallback(
    (e: React.SyntheticEvent<HTMLVideoElement>) => {
      setIsPaused(false);
      recordEvent("play", e.currentTarget.currentTime);
    },
    [recordEvent],
  );

  const handlePause = useCallback(
    (e: React.SyntheticEvent<HTMLVideoElement>) => {
      // Suppress the phantom pause event triggered by our own stopAt enforcement.
      // handleTimeUpdate records "ended" and calls onComplete in that path.
      if (stopAtReachedRef.current) {
        stopAtReachedRef.current = false;
        setIsPaused(true);
        return;
      }
      setIsPaused(true);
      recordEvent("pause", e.currentTarget.currentTime);
    },
    [recordEvent],
  );

  const handleEnded = useCallback(
    (e: React.SyntheticEvent<HTMLVideoElement>) => {
      setIsPaused(true);
      recordEvent("ended", e.currentTarget.currentTime);
      if (submitOnComplete) {
        onCompleteRef.current?.();
      }
    },
    [recordEvent, submitOnComplete],
  );

  const handleLoadedMetadata = useCallback(
    (e: React.SyntheticEvent<HTMLVideoElement>) => {
      const v = e.currentTarget;
      setDuration(v.duration);
      durationVersionRef.current += 1;

      // Detect likely server-side range-request misconfiguration for
      // finite-duration media. Skip the check entirely for live streams or
      // unknown durations, where seekable ranges legitimately don't cover
      // the full timeline. See issue #32.
      const hasFiniteDuration = Number.isFinite(v.duration) && v.duration > 0;
      if (!hasFiniteDuration) return;

      // Suppress this derived warning when the pre-flight HEAD check
      // already surfaced the same problem (#424) — the HEAD response
      // headers are the authoritative source; this seekable-based
      // signal is a fallback for cases where HEAD wasn't readable
      // (CORS, network failure, server doesn't support HEAD).
      if (acceptRangesWarnedRef.current) return;
      const seekable = v.seekable;
      const fullySeekable =
        seekable.length > 0 &&
        seekable.end(seekable.length - 1) >= v.duration - 0.5;
      if (!fullySeekable) {
        console.warn(
          `[MediaPlayer] Video at ${v.currentSrc} does not appear fully ` +
            `seekable. A server range-request configuration issue (for ` +
            `example, missing "Accept-Ranges: bytes") may prevent the ` +
            `browser from seeking correctly — seek/step controls may snap ` +
            `back toward the start. ` +
            `(seekable.length=${String(seekable.length)}, ` +
            `duration=${String(v.duration)})`,
        );
      }
    },
    [],
  );

  const handleError = useCallback(
    (e: React.SyntheticEvent<HTMLVideoElement>) => {
      const err = e.currentTarget.error;
      const codeMessages: Record<number, string> = {
        1: messages.mediaErrorAborted,
        2: messages.mediaErrorNetwork,
        3: messages.mediaErrorDecode,
        4: messages.mediaErrorFormat,
      };
      const friendly = err
        ? (codeMessages[err.code] ?? messages.mediaErrorCode(err.code))
        : messages.mediaErrorUnknown;
      console.error(
        `[MediaPlayer] Video error (code ${err?.code}): ${err?.message ?? "unknown"}`,
      );
      setLoadError(friendly);
    },
    [messages],
  );

  const handleProgress = useCallback(
    (e: React.SyntheticEvent<HTMLVideoElement>) => {
      const v = e.currentTarget;
      if (
        v.buffered.length > 0 &&
        Number.isFinite(v.duration) &&
        v.duration > 0
      ) {
        setBufferedEnd(v.buffered.end(v.buffered.length - 1));
      }
    },
    [],
  );

  const handleTimeUpdate = useCallback(
    (e: React.SyntheticEvent<HTMLVideoElement>) => {
      const { currentTime: ct } = e.currentTarget;
      setCurrentTime(ct);

      // stopAt enforcement — records "stopAt" event (distinct from natural "ended")
      if (stopAt !== undefined && ct >= stopAt) {
        stopAtReachedRef.current = true;
        e.currentTarget.pause(); // fires "pause" event; handlePause suppresses it
        recordEvent("stopAt", ct);
        if (submitOnComplete) onCompleteRef.current?.();
        return;
      }

      // Caption update
      if (cues.length > 0) {
        const active = cues.find((c) => ct >= c.startTime && ct <= c.endTime);
        setCaptionText(active?.text ?? null);
      }
    },
    [stopAt, cues, recordEvent, submitOnComplete],
  );

  // Clamp seek target to allowed range — works for both HTML5 and YouTube
  const seek = useCallback(
    (delta: number) => {
      if (ytHandle) {
        const cur = ytHandle.getCurrentTime();
        const dur = ytHandle.getDuration();
        const min = allowScrubOutsideBounds ? 0 : (startAt ?? 0);
        const max = allowScrubOutsideBounds
          ? Number.isFinite(dur)
            ? dur
            : Infinity
          : (stopAt ?? (Number.isFinite(dur) ? dur : Infinity));
        const newTime = Math.min(Math.max(cur + delta, min), max);
        ytHandle.seekTo(newTime);
        recordEvent("seek", newTime, { fromTime: cur });
        return;
      }
      const v = videoRef.current;
      if (!v) return;
      const fromTime = v.currentTime;
      const min = allowScrubOutsideBounds ? 0 : (startAt ?? 0);
      const max = allowScrubOutsideBounds
        ? Number.isFinite(v.duration)
          ? v.duration
          : Infinity
        : (stopAt ?? (Number.isFinite(v.duration) ? v.duration : Infinity));
      v.currentTime = Math.min(Math.max(v.currentTime + delta, min), max);
      recordEvent("seek", v.currentTime, { fromTime });
    },
    [allowScrubOutsideBounds, startAt, stopAt, ytHandle, recordEvent],
  );

  const cycleSpeed = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    const idx = SPEEDS.indexOf(playbackRate as (typeof SPEEDS)[number]);
    const next = SPEEDS[(idx + 1) % SPEEDS.length];
    v.playbackRate = next;
    setPlaybackRate(next);
    recordEvent("speed", v.currentTime, { playbackRate: next });
  }, [playbackRate, recordEvent]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      // "once" mode: no keyboard controls
      if (effectivePlayback === "once") return;

      // Enter is reserved for Timeline annotation (#263). Preventing
      // default stops focused-button activation so player behavior doesn't
      // depend on which control last had focus.
      if (e.key === "Enter") {
        e.preventDefault();
        return;
      }

      // YouTube: only Space/K play-pause and J/L/Arrow seek work
      if (ytHandle) {
        switch (e.key) {
          case " ":
          case "k":
          case "K":
            e.preventDefault();
            if (ytHandle.isPaused()) ytHandle.play();
            else ytHandle.pause();
            break;
          case "j":
          case "J":
            e.preventDefault();
            seek(-10);
            break;
          case "l":
          case "L":
            e.preventDefault();
            seek(10);
            break;
          case "ArrowRight":
            e.preventDefault();
            seek(1);
            break;
          case "ArrowLeft":
            e.preventDefault();
            seek(-1);
            break;
          default:
            break;
        }
        return;
      }
      const v = videoRef.current;
      if (!v) return;
      switch (e.key) {
        case " ":
        case "k":
        case "K":
          e.preventDefault();
          if (v.paused) void v.play();
          else v.pause();
          break;
        case "ArrowRight":
          e.preventDefault();
          if (e.repeat) {
            arrowRepeatCountRef.current++;
            if (arrowRepeatCountRef.current >= HOLD_REPEAT_THRESHOLD) {
              seek(0.5);
            }
          } else {
            arrowRepeatCountRef.current = 0;
            seek(1);
          }
          break;
        case "ArrowLeft":
          e.preventDefault();
          if (e.repeat) {
            arrowRepeatCountRef.current++;
            if (arrowRepeatCountRef.current >= HOLD_REPEAT_THRESHOLD) {
              seek(-0.5);
            }
          } else {
            arrowRepeatCountRef.current = 0;
            seek(-1);
          }
          break;
        case "l":
        case "L":
          e.preventDefault();
          seek(10);
          break;
        case "j":
        case "J":
          e.preventDefault();
          seek(-10);
          break;
        case ".":
          e.preventDefault();
          seek(stepDuration);
          break;
        case ",":
          e.preventDefault();
          seek(-stepDuration);
          break;
        case ">": {
          e.preventDefault();
          const faster =
            SPEEDS.find((s) => s > playbackRate) ?? SPEEDS[SPEEDS.length - 1];
          v.playbackRate = faster;
          setPlaybackRate(faster);
          break;
        }
        case "<": {
          e.preventDefault();
          const slower =
            [...SPEEDS].reverse().find((s) => s < playbackRate) ?? SPEEDS[0];
          v.playbackRate = slower;
          setPlaybackRate(slower);
          break;
        }
        default:
          break;
      }
    },
    [effectivePlayback, seek, stepDuration, playbackRate],
  );

  const handleKeyUp = useCallback((e: React.KeyboardEvent) => {
    if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
      arrowRepeatCountRef.current = 0;
    }
  }, []);

  // Button hold-to-scrub — rapid discrete seeks in both directions
  const startButtonHold = useCallback(
    (direction: 1 | -1) => {
      holdTimeoutRef.current = setTimeout(() => {
        holdIntervalRef.current = setInterval(() => {
          seek(direction * 0.5);
        }, 100);
      }, 500);
    },
    [seek],
  );

  const endButtonHold = useCallback(() => {
    if (holdTimeoutRef.current !== null) {
      clearTimeout(holdTimeoutRef.current);
      holdTimeoutRef.current = null;
    }
    if (holdIntervalRef.current !== null) {
      clearInterval(holdIntervalRef.current);
      holdIntervalRef.current = null;
    }
  }, []);

  // Track whether a hold-to-scrub was active so a single click (no hold)
  // still does a one-step seek.
  const holdWasActive = useCallback(() => {
    return holdIntervalRef.current !== null;
  }, []);

  // ---------------------------------------------------------------------------
  // Callbacks forwarded to HTML5Controls / YouTubeControls
  // ---------------------------------------------------------------------------

  // Seek button: do a single-step seek only if the hold didn't already
  // move the playhead via the interval.
  const onSeekButtonRelease = useCallback(
    (direction: 1 | -1) => {
      const wasHeld = holdWasActive();
      endButtonHold();
      if (!wasHeld) seek(direction);
    },
    [endButtonHold, holdWasActive, seek],
  );

  const onSeekButtonLeave = useCallback(() => endButtonHold(), [endButtonHold]);

  const onPlayPause = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) void v.play();
    else v.pause();
  }, []);

  // Scrub bar: pause on grab (records "pause" event at pre-scrub position),
  // seek in real-time during drag, resume on release (records "play" event).
  const onScrubStart = useCallback((t: number) => {
    const v = videoRef.current;
    if (!v) return;
    if (!v.paused) {
      scrubWasPlayingRef.current = true;
      v.pause();
    }
    v.currentTime = t;
    setCurrentTime(t);
  }, []);

  const onScrubMove = useCallback((t: number) => {
    if (videoRef.current) videoRef.current.currentTime = t;
    setCurrentTime(t);
  }, []);

  const onScrubEnd = useCallback((t: number) => {
    const v = videoRef.current;
    if (!v) return;
    v.currentTime = t;
    setCurrentTime(t);
    if (scrubWasPlayingRef.current) {
      scrubWasPlayingRef.current = false;
      void v.play();
    }
  }, []);

  // YouTube-specific scrub callbacks
  const ytOnPlayPause = useCallback(() => {
    if (isPaused) ytHandle?.play();
    else ytHandle?.pause();
  }, [isPaused, ytHandle]);

  const ytOnSeekBack = useCallback(() => {
    seek(-1);
  }, [seek]);

  const ytOnSeekForward = useCallback(() => {
    seek(1);
  }, [seek]);

  const ytOnScrubStart = useCallback(
    (t: number) => {
      if (ytHandle && !ytHandle.isPaused()) {
        scrubWasPlayingRef.current = true;
        ytHandle.pause();
      }
      ytHandle?.seekTo(t);
      setCurrentTime(t);
    },
    [ytHandle],
  );

  const ytOnScrubMove = useCallback(
    (t: number) => {
      ytHandle?.seekTo(t);
      setCurrentTime(t);
    },
    [ytHandle],
  );

  const ytOnScrubEnd = useCallback(
    (t: number) => {
      ytHandle?.seekTo(t);
      setCurrentTime(t);
      if (scrubWasPlayingRef.current) {
        scrubWasPlayingRef.current = false;
        ytHandle?.play();
      }
    },
    [ytHandle],
  );

  // ---------------------------------------------------------------------------
  // Derived display values
  // ---------------------------------------------------------------------------

  const hasControls =
    !syncToStageTime &&
    controls !== undefined &&
    (controls.playPause || controls.seek || controls.step || controls.speed);
  // Controls are always visible when paused or hovered (video mode).
  // In audio-only mode (playVideo:false) there's no video to obscure, so always show.
  const controlsVisible = hasControls && (isPaused || isHovered || !playVideo);

  // Focus rescue (#300): when the controls overlay hides (mouse leaves while
  // playing), any control that currently held focus — e.g. the play/pause
  // button the user just keyboard-toggled — unmounts. The browser drops focus
  // to <body>, and a subsequent Space press scrolls the page instead of
  // pausing. We catch that exact transition and move focus to the container
  // (tabIndex=0), which is always mounted; :focus-within keeps the ring lit
  // and the keydown handler keeps Space wired to play/pause.
  const prevControlsVisibleRef = useRef(controlsVisible);
  useEffect(() => {
    const prev = prevControlsVisibleRef.current;
    prevControlsVisibleRef.current = controlsVisible;
    if (!prev || controlsVisible) return;
    // Only rescue when the orphaned focus landed on <body>. If the user
    // tabbed or clicked elsewhere, activeElement would be that element and
    // we leave it alone.
    if (
      typeof document !== "undefined" &&
      document.activeElement === document.body &&
      containerRef.current
    ) {
      containerRef.current.focus({ preventScroll: true });
    }
  }, [controlsVisible]);

  // Scrub bar bounds
  const scrubMin = allowScrubOutsideBounds ? 0 : (startAt ?? 0);
  const scrubMax = allowScrubOutsideBounds
    ? Number.isFinite(duration) && duration > 0
      ? duration
      : 0
    : (stopAt ?? duration);

  // Scrub bar fill percentages
  const playedPct =
    scrubMax > scrubMin
      ? Math.min(
          Math.max(((currentTime - scrubMin) / (scrubMax - scrubMin)) * 100, 0),
          100,
        )
      : 0;
  const bufferedPct =
    scrubMax > scrubMin
      ? Math.min(((bufferedEnd - scrubMin) / (scrubMax - scrubMin)) * 100, 100)
      : 0;

  // Shared props for HTML5Controls (used in both video-overlay and audio-flat layouts)
  const html5ControlsProps = {
    controls,
    isPaused,
    stepDuration,
    playbackRate,
    scrubMin,
    scrubMax,
    currentTime,
    duration,
    playedPct,
    bufferedPct,
    onSeek: seek,
    onCycleSpeed: cycleSpeed,
    onSeekButtonPress: startButtonHold,
    onSeekButtonRelease,
    onSeekButtonLeave,
    onPlayPause,
    onScrubStart,
    onScrubMove,
    onScrubEnd,
  };

  // ---------------------------------------------------------------------------
  // Unsafe-URL guard (deferred past all hooks — see urlIsUnsafe above, #484)
  // ---------------------------------------------------------------------------

  if (urlIsUnsafe) {
    return (
      <div data-testid="mediaPlayer" role="alert">
        {messages.mediaInvalidUrl}
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // YouTube branch
  // ---------------------------------------------------------------------------

  if (youtubeVideoId) {
    const ytHasControls =
      !syncToStageTime &&
      controls !== undefined &&
      (controls.playPause || controls.seek);
    const ytControlsVisible =
      ytHasControls && (isPaused || isHovered || !playVideo);

    return (
      <div
        ref={containerRef}
        className={containerClass}
        data-testid="mediaPlayer"
        // Time-based controls never mirror (Material bidirectionality):
        // lock LTR so neither a host <html dir> nor an RTL study locale
        // flips the transport/scrub axis.
        dir="ltr"
        role="region"
        aria-label={messages.mediaPlayerLabel}
        tabIndex={0}
        onKeyDown={handleKeyDown}
        onKeyUp={handleKeyUp}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
        style={{
          position: "relative",
          // outline:none + the scoped :focus ring below — same pattern
          // as the Timeline so the two stacked components share an
          // identical "keyboard shortcuts are live" affordance.
          outline: "none",
          // Border-radius matches the focus-ring outset so the ring
          // doesn't appear as sharp corners around an unrounded box;
          // YouTube's iframe is itself rectangular, but the ring sits
          // 2px outside via box-shadow, so a slight radius here keeps
          // the ring visually consistent with the Timeline's rounded
          // container.
          borderRadius: "0.5rem",
        }}
      >
        <style>{`
          /* MediaPlayer focus ring (#382 follow-up).
             Two design choices versus the Timeline / form-input
             rings (which use a single faint blue stroke):

             1. Halo pattern. The video frame can be any color —
                dark on most clips, but sometimes blue or light. A
                single-color ring washes out against same-color
                content (the gallery's test clip happens to be blue,
                which kills a blue ring). Stacked shadows render a
                white inner halo + brand-blue outer ring, robust
                against any background.
             2. focus-within (not :focus). The container is
                tabbable, but clicking interior controls (play /
                scrub / etc.) moves focus to those children, which
                drops :focus on the parent. The user is still
                "in" the MediaPlayer though — keyboard shortcuts
                still fire via the container handlers if they
                bubble up. :focus-within keeps the ring visible
                while any descendant has focus, so the "this is the
                active component" affordance doesn't flicker as
                the user moves between sub-controls. */
          .${containerClass}:focus-within {
            box-shadow:
              0 0 0 2px var(--stagebook-bg, #fff),
              0 0 0 5px var(--stagebook-primary, #3b82f6);
          }
        `}</style>
        <div data-testid="mediaPlayer-viewport" style={VIEWPORT_STYLE}>
          <YouTubePlayer
            videoId={youtubeVideoId}
            startAt={startAt}
            onHandleReady={(h) => {
              setYtHandle(h);
              setDuration(h.getDuration());
            }}
            onPlay={(t) => {
              setIsPaused(false);
              setCurrentTime(t);
              recordEvent("play", t);
            }}
            onPause={(t) => {
              setIsPaused(true);
              setCurrentTime(t);
              // stopAt reached via the poll: record "stopAt" not "pause"
              if (stopAtReachedRef.current) {
                stopAtReachedRef.current = false;
                recordEvent("stopAt", t);
                if (submitOnComplete) onCompleteRef.current?.();
                return;
              }
              recordEvent("pause", t);
            }}
            onEnded={(t) => {
              setIsPaused(true);
              setCurrentTime(t);
              recordEvent("ended", t);
              if (submitOnComplete) onCompleteRef.current?.();
            }}
          />
          {ytControlsVisible && (
            <div
              data-testid="mediaPlayer-controls"
              style={{
                position: "absolute",
                bottom: 0,
                left: 0,
                right: 0,
                background:
                  "linear-gradient(to top, rgba(0,0,0,0.75) 0%, rgba(0,0,0,0) 100%)",
                padding: "1.5rem 0.75rem 0.5rem",
                display: "flex",
                flexDirection: "column",
                gap: "0.25rem",
              }}
            >
              <YouTubeControls
                controls={controls}
                isPaused={isPaused}
                scrubMin={scrubMin}
                scrubMax={scrubMax}
                currentTime={currentTime}
                duration={duration}
                playedPct={playedPct}
                onPlayPause={ytOnPlayPause}
                onSeekBack={ytOnSeekBack}
                onSeekForward={ytOnSeekForward}
                onScrubStart={ytOnScrubStart}
                onScrubMove={ytOnScrubMove}
                onScrubEnd={ytOnScrubEnd}
              />
            </div>
          )}
        </div>
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // HTML5 branch
  // ---------------------------------------------------------------------------

  return (
    <div
      ref={containerRef}
      className={containerClass}
      data-testid="mediaPlayer"
      // Time-based controls never mirror — see the video variant's note.
      dir="ltr"
      role="region"
      aria-label={messages.mediaPlayerLabel}
      tabIndex={0}
      onKeyDown={handleKeyDown}
      onKeyUp={handleKeyUp}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      style={{
        position: "relative",
        outline: "none",
        borderRadius: "0.5rem",
      }}
    >
      <style>{`
        /* See the comment on the YouTube-path branch above for the
           design rationale (halo pattern + :focus-within). Identical
           rule here so both render paths get the same affordance. */
        .${containerClass}:focus-within {
          box-shadow:
            0 0 0 2px var(--stagebook-bg, #fff),
            0 0 0 5px var(--stagebook-primary, #3b82f6);
        }
      `}</style>
      {/* Audio-only: hidden video element (no viewport div) */}
      {!playVideo && (
        <video
          ref={videoRef}
          data-testid="mediaPlayer-video"
          src={url}
          muted={!playAudio}
          // crossOrigin="anonymous" is required for Web Audio API capture
          // (Timeline waveform). Without it, cross-origin media plays but
          // taints the AnalyserNode → all-zero peaks. Stagebook convention:
          // media MUST be served with proper CORS headers. Same-origin media
          // is unaffected.
          crossOrigin="anonymous"
          onPlay={handlePlay}
          onPause={handlePause}
          onEnded={handleEnded}
          onLoadedMetadata={handleLoadedMetadata}
          onTimeUpdate={handleTimeUpdate}
          onProgress={handleProgress}
          onError={handleError}
          style={{ display: "none" }}
        >
          <track kind="captions" />
        </video>
      )}

      {/* Video viewport — video + captions + overlay controls */}
      {playVideo && (
        <div data-testid="mediaPlayer-viewport" style={VIEWPORT_STYLE}>
          <video
            ref={videoRef}
            data-testid="mediaPlayer-video"
            src={url}
            muted={!playAudio}
            // See above — required for waveform capture. Same-origin no-op.
            crossOrigin="anonymous"
            onPlay={handlePlay}
            onPause={handlePause}
            onEnded={handleEnded}
            onLoadedMetadata={handleLoadedMetadata}
            onTimeUpdate={handleTimeUpdate}
            onProgress={handleProgress}
            onError={handleError}
            style={{
              width: "100%",
              aspectRatio: "16/9",
              display: loadError ? "none" : "block",
              background: "#000",
            }}
          >
            <track kind="captions" />
          </video>

          {loadError && (
            <div
              data-testid="mediaPlayer-error"
              role="alert"
              dir={localeDir}
              style={{
                width: "100%",
                aspectRatio: "16/9",
                background: "#1c1c1e",
                color: "#fff",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                gap: "0.5rem",
                padding: "1rem",
                textAlign: "center",
                fontSize: "0.875rem",
              }}
            >
              <svg
                width={32}
                height={32}
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
                style={{ opacity: 0.7 }}
              >
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="8" x2="12" y2="12" />
                <line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
              <div style={{ fontWeight: 500 }}>
                {messages.mediaVideoUnavailable}
              </div>
              <div style={{ opacity: 0.75, fontSize: "0.75rem" }}>
                {loadError}
              </div>
            </div>
          )}

          {captionText !== null && (
            <div
              data-testid="mediaPlayer-caption"
              dir={localeDir}
              style={{
                textAlign: "center",
                padding: "0.5rem",
                background: "rgba(0,0,0,0.7)",
                color: "#fff",
              }}
            >
              {captionText}
            </div>
          )}

          {controlsVisible && !loadError && (
            <div
              data-testid="mediaPlayer-controls"
              style={{
                position: "absolute",
                bottom: 0,
                left: 0,
                right: 0,
                background:
                  "linear-gradient(to top, rgba(0,0,0,0.75) 0%, rgba(0,0,0,0) 100%)",
                padding: "1.5rem 0.75rem 0.5rem",
                display: "flex",
                flexDirection: "column",
                gap: "0.25rem",
              }}
            >
              <HTML5Controls {...html5ControlsProps} />
            </div>
          )}

          {showPlayOnce && (
            <button
              type="button"
              data-testid="mediaPlayer-playOnce"
              aria-label={messages.mediaPlayVideo}
              tabIndex={0}
              onClick={() => {
                setShowPlayOnce(false);
                const v = videoRef.current;
                if (!v) {
                  setShowPlayOnce(true);
                  return;
                }
                void v.play().catch(() => {
                  setShowPlayOnce(true);
                });
              }}
              style={{
                position: "absolute",
                top: "50%",
                left: "50%",
                transform: "translate(-50%, -50%)",
                background: "rgba(0,0,0,0.6)",
                border: "none",
                borderRadius: "50%",
                width: 64,
                height: 64,
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "#fff",
              }}
            >
              <svg
                width={32}
                height={32}
                viewBox="0 0 24 24"
                fill="currentColor"
                aria-hidden="true"
              >
                <polygon points="6,3 20,12 6,21" />
              </svg>
            </button>
          )}
        </div>
      )}

      {/* Audio-only: play-once fallback button */}
      {!playVideo && showPlayOnce && (
        <button
          type="button"
          data-testid="mediaPlayer-playOnce"
          aria-label={messages.mediaPlayAudio}
          dir={localeDir}
          tabIndex={0}
          onClick={() => {
            setShowPlayOnce(false);
            const v = videoRef.current;
            if (!v) {
              setShowPlayOnce(true);
              return;
            }
            void v.play().catch(() => {
              setShowPlayOnce(true);
            });
          }}
          style={{
            background: "rgba(28,28,30,0.96)",
            border: "1px solid rgba(255,255,255,0.2)",
            borderRadius: "0.5rem",
            padding: "0.75rem 1.5rem",
            cursor: "pointer",
            color: "#fff",
            fontSize: "0.875rem",
            fontWeight: 500,
          }}
        >
          {messages.mediaPlay}
        </button>
      )}

      {/* Audio-only: flat controls bar (always visible — no hover needed) */}
      {!playVideo && controlsVisible && !loadError && (
        <div
          data-testid="mediaPlayer-controls"
          style={{
            background: "rgba(28,28,30,0.96)",
            borderRadius: "0.5rem",
            padding: "0.5rem 0.75rem",
            display: "flex",
            flexDirection: "column",
            gap: "0.25rem",
          }}
        >
          <HTML5Controls {...html5ControlsProps} />
        </div>
      )}

      {/* Audio-only: error placeholder when load fails */}
      {!playVideo && loadError && (
        <div
          data-testid="mediaPlayer-error"
          role="alert"
          dir={localeDir}
          style={{
            background: "#1c1c1e",
            color: "#fff",
            borderRadius: "0.5rem",
            padding: "1rem",
            display: "flex",
            alignItems: "center",
            gap: "0.75rem",
            fontSize: "0.875rem",
          }}
        >
          <svg
            width={24}
            height={24}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
            style={{ opacity: 0.7, flexShrink: 0 }}
          >
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
          <div>
            <div style={{ fontWeight: 500 }}>
              {messages.mediaAudioUnavailable}
            </div>
            <div style={{ opacity: 0.75, fontSize: "0.75rem" }}>
              {loadError}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
