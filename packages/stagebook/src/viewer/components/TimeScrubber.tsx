import {
  useState,
  useEffect,
  useRef,
  useCallback,
  forwardRef,
  useImperativeHandle,
} from "react";
import { extractTimeBreakpoints } from "../lib/timeBreakpoints.js";
import type { ViewerStep } from "../lib/steps.js";

interface TimeScrubberProps {
  currentStep: ViewerStep;
  elapsedTime: number;
  onTimeChange: (seconds: number) => void;
}

/** Imperative handle so the viewer's `Alt+K` hotkey can drive playback. */
export interface TimeScrubberHandle {
  /** Play/pause; restarts from 0 if at the end. Mirrors the ▶/⏸ button. */
  toggle: () => void;
}

const SPEEDS = [1, 2, 5, 10];

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

export const TimeScrubber = forwardRef<TimeScrubberHandle, TimeScrubberProps>(
  function TimeScrubber({ currentStep, elapsedTime, onTimeChange }, ref) {
    const duration = currentStep.duration;
    if (duration === undefined) return null;

    return (
      <TimeScrubberInner
        ref={ref}
        duration={duration}
        elements={currentStep.elements as Record<string, unknown>[]}
        elapsedTime={elapsedTime}
        onTimeChange={onTimeChange}
      />
    );
  },
);

const TimeScrubberInner = forwardRef<
  TimeScrubberHandle,
  {
    duration: number;
    elements: Record<string, unknown>[];
    elapsedTime: number;
    onTimeChange: (seconds: number) => void;
  }
>(function TimeScrubberInner(
  { duration, elements, elapsedTime, onTimeChange },
  ref,
) {
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const trackRef = useRef<HTMLDivElement>(null);
  const elapsedRef = useRef(elapsedTime);
  elapsedRef.current = elapsedTime;

  // Play/pause, shared by the ▶/⏸ button and the viewer's Alt+K hotkey (via the
  // imperative handle). Reads elapsed from a ref + a functional setState so it
  // stays correct without re-binding on every tick.
  const toggle = useCallback(() => {
    if (elapsedRef.current >= duration) onTimeChange(0);
    setPlaying((p) => !p);
  }, [duration, onTimeChange]);

  useImperativeHandle(ref, () => ({ toggle }), [toggle]);

  // Playback — interval reads elapsed from ref to avoid teardown every tick
  useEffect(() => {
    if (!playing) return;
    const tickMs = 50;
    const id = setInterval(() => {
      const next = Math.min(
        duration,
        elapsedRef.current + (speed * tickMs) / 1000,
      );
      onTimeChange(next);
      if (next >= duration) setPlaying(false);
    }, tickMs);
    return () => clearInterval(id);
  }, [playing, speed, duration, onTimeChange]);

  const breakpoints = extractTimeBreakpoints(elements);

  const handleTrackClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const track = trackRef.current;
      if (!track) return;
      const rect = track.getBoundingClientRect();
      const fraction = Math.max(
        0,
        Math.min(1, (e.clientX - rect.left) / rect.width),
      );
      onTimeChange(Math.round(fraction * duration));
    },
    [duration, onTimeChange],
  );

  const fraction = duration > 0 ? elapsedTime / duration : 0;

  return (
    <div style={containerStyle}>
      <button
        onClick={toggle}
        style={playButtonStyle}
        aria-label={playing ? "Pause" : "Play"}
        aria-keyshortcuts="Alt+K"
        title="Play/pause (⌥K)"
      >
        {playing ? "⏸" : "▶"}
      </button>

      <button
        onClick={() => {
          const idx = SPEEDS.indexOf(speed);
          setSpeed(SPEEDS[(idx + 1) % SPEEDS.length]);
        }}
        style={speedButtonStyle}
        title="Playback speed"
      >
        {speed}x
      </button>

      <span style={timeStyle}>{formatTime(elapsedTime)}</span>

      <div ref={trackRef} onClick={handleTrackClick} style={trackStyle}>
        {/* Progress fill */}
        <div
          style={{
            ...fillStyle,
            width: `${fraction * 100}%`,
          }}
        />
        {/* Breakpoint markers */}
        {breakpoints.map((t) => (
          <button
            type="button"
            key={t}
            onClick={(e) => {
              e.stopPropagation();
              onTimeChange(t);
            }}
            style={{
              ...markerStyle,
              left: `${(t / duration) * 100}%`,
            }}
            aria-label={`Jump to ${t} seconds`}
          />
        ))}
        {/* Thumb */}
        <div
          style={{
            ...thumbStyle,
            left: `${fraction * 100}%`,
          }}
        />
      </div>

      <span style={timeStyle}>{formatTime(duration)}</span>
    </div>
  );
});

// --- Styles ---

const containerStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "0.375rem",
  minWidth: 0,
  flex: 1,
};

const playButtonStyle: React.CSSProperties = {
  background: "none",
  border: "1px solid #d1d5db",
  borderRadius: "0.25rem",
  cursor: "pointer",
  padding: "0.125rem 0.375rem",
  fontSize: "0.75rem",
  lineHeight: 1,
  flexShrink: 0,
};

const speedButtonStyle: React.CSSProperties = {
  background: "none",
  border: "1px solid #d1d5db",
  borderRadius: "0.25rem",
  cursor: "pointer",
  padding: "0.125rem 0.375rem",
  fontSize: "0.625rem",
  fontWeight: 600,
  color: "#6b7280",
  minWidth: "2rem",
  textAlign: "center" as const,
  flexShrink: 0,
};

const timeStyle: React.CSSProperties = {
  fontSize: "0.6875rem",
  color: "#6b7280",
  fontVariantNumeric: "tabular-nums",
  flexShrink: 0,
  minWidth: "2.25rem",
};

const trackStyle: React.CSSProperties = {
  position: "relative",
  height: "1.25rem",
  flex: 1,
  minWidth: "4rem",
  cursor: "pointer",
  display: "flex",
  alignItems: "center",
  background:
    "linear-gradient(to right, #e5e7eb, #e5e7eb) no-repeat center / 100% 0.25rem",
};

const fillStyle: React.CSSProperties = {
  position: "absolute",
  left: 0,
  top: "50%",
  transform: "translateY(-50%)",
  height: "0.25rem",
  backgroundColor: "#3b82f6",
  borderRadius: "0.125rem",
};

const markerStyle: React.CSSProperties = {
  position: "absolute",
  top: "50%",
  transform: "translate(-50%, -50%)",
  width: "0.5rem",
  height: "0.5rem",
  borderRadius: "50%",
  backgroundColor: "#d1d5db",
  border: "1px solid #9ca3af",
  cursor: "pointer",
  zIndex: 1,
};

const thumbStyle: React.CSSProperties = {
  position: "absolute",
  top: "50%",
  transform: "translate(-50%, -50%)",
  width: "0.75rem",
  height: "0.75rem",
  borderRadius: "50%",
  backgroundColor: "#3b82f6",
  border: "2px solid white",
  boxShadow: "0 1px 3px rgba(0,0,0,0.2)",
  zIndex: 2,
};
