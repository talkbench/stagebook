import React, { useState, useEffect, useId } from "react";

export interface KitchenTimerProps {
  startTime: number;
  endTime: number;
  warnTimeRemaining?: number;
  getElapsedTime: () => number;
}

export function KitchenTimer({
  startTime,
  endTime,
  warnTimeRemaining = 10,
  getElapsedTime,
}: KitchenTimerProps) {
  // Re-render periodically to update the timer display
  const [, setTick] = useState(false);

  useEffect(() => {
    const interval = setInterval(() => setTick((prev) => !prev), 1000);
    return () => clearInterval(interval);
  }, []);

  // Suppress the bar's width-transition for the first render. Host
  // `getElapsedTime()` sometimes returns the previous stage's elapsed
  // time on the first render after a stage transition; if that value
  // exceeds `endTime`, the bar mounts at 100% and then visibly animates
  // back to 0 over the transition duration. Snapping the first render
  // (transition: none) lets the bar appear at whatever percent the
  // computation says without an entry animation. Subsequent renders
  // animate normally.
  const [hasMounted, setHasMounted] = useState(false);
  useEffect(() => {
    // rAF + setState defers the flag past the first paint so the
    // initial render commits without a transition. setHasMounted itself
    // triggers a re-render; that re-render brings the transition in.
    const id = requestAnimationFrame(() => setHasMounted(true));
    return () => cancelAnimationFrame(id);
  }, []);

  // Per-instance class for the reduced-motion media query. Same useId
  // pattern as Button / Slider / Timeline.
  const reactId = useId();
  const safeId = reactId.replace(/[^a-zA-Z0-9_-]/g, "");
  const fillClass = `stagebook-kitchen-timer-fill-${safeId}`;

  const stageElapsed = getElapsedTime();
  const timerDuration = endTime - startTime;

  let timerElapsed = 0;
  let timerRemaining = timerDuration;

  if (stageElapsed > startTime) {
    timerElapsed = stageElapsed - startTime;
    timerRemaining = endTime - stageElapsed;
  }

  if (stageElapsed > endTime) {
    timerElapsed = timerDuration;
    timerRemaining = 0;
  }

  const percent = Math.min((timerElapsed / timerDuration) * 100, 100);
  const displayRemaining = new Date(1000 * Math.max(timerRemaining, 0))
    .toISOString()
    .slice(timerRemaining < 3600 ? 14 : 11, 19);

  const isWarning = timerRemaining <= warnTimeRemaining;
  const barColor = isWarning
    ? "var(--stagebook-danger, #ef4444)"
    : "var(--stagebook-timer-fill, #60a5fa)"; // red-500 / blue-400

  return (
    <div
      style={{
        margin: "0.375rem",
        maxWidth: "36rem",
        display: "flex",
        alignItems: "center",
        gap: "0.75rem",
      }}
      data-testid="kitchen-timer"
      data-state={isWarning ? "warning" : "normal"}
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={timerDuration}
      aria-valuenow={Math.max(timerRemaining, 0)}
      aria-valuetext={`${displayRemaining} remaining`}
      aria-label="Stage timer"
    >
      <style>{`
        /* Reduced-motion: snap the bar instead of animating. Without
           this, users who opted into reduced motion see the bar slide
           every tick, which can trigger vestibular discomfort. */
        @media (prefers-reduced-motion: reduce) {
          .${fillClass} {
            transition: none !important;
          }
        }
      `}</style>
      {/* Progress bar */}
      <div
        style={{
          position: "relative",
          flex: 1,
          height: "1.5rem",
          backgroundColor: "var(--stagebook-bg-track, #e5e7eb)",
          borderRadius: "9999px",
          overflow: "hidden",
        }}
      >
        <div
          data-testid="timer-fill"
          className={fillClass}
          style={{
            height: "100%",
            borderRadius: "9999px",
            width: `${percent}%`,
            backgroundColor: barColor,
            // `hasMounted` gates the transition for one paint cycle
            // so the bar snaps to whatever percent the first render
            // computed instead of animating from the browser-default
            // "no width" state. See the comment near `setHasMounted`
            // above for the host-getElapsedTime gotcha that motivated
            // this guard.
            transition: hasMounted
              ? "width 1s linear, background-color 0.3s ease"
              : "none",
          }}
        />
      </div>
      {/* Time label to the right */}
      <span
        style={{
          fontSize: "0.875rem",
          fontWeight: 500,
          color: "var(--stagebook-text-secondary, #374151)",
          fontVariantNumeric: "tabular-nums",
          whiteSpace: "nowrap",
          minWidth: "3rem",
          textAlign: "right",
        }}
      >
        {displayRemaining}
      </span>
    </div>
  );
}
