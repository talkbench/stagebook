/**
 * Inline SVG icons for MediaPlayer controls.
 * Self-contained — no external icon library dependency.
 * Play/Pause are filled (fill="currentColor"); the chevron-based seek/step
 * icons are stroke-only (stroke="currentColor"). Both inherit text color
 * from the parent button.
 */
import React from "react";

export function PlayIcon() {
  return (
    <svg
      width={24}
      height={24}
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M6 4l14 8-14 8V4z" />
    </svg>
  );
}

/** A circular arrow: play again from the start. Stroked like the seek
 *  icons, and sized to match the filled Play/Pause glyphs. */
export function ReplayIcon() {
  return (
    <svg
      width={24}
      height={24}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M4.5 12a7.5 7.5 0 1 0 2.2-5.3" />
      <polyline points="4.5,3 4.5,7.5 9,7.5" />
    </svg>
  );
}

export function PauseIcon() {
  return (
    <svg
      width={24}
      height={24}
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
    >
      <rect x="5" y="4" width="5" height="16" rx="1" />
      <rect x="14" y="4" width="5" height="16" rx="1" />
    </svg>
  );
}

// Seek vs step icons use chevron counts to communicate magnitude:
//   double chevron (seek) = larger jump (1s), holdable for fast-scrub
//   single chevron (step) = smaller, deterministic step (stepDuration)
// Reading left-to-right the row goes  «« « ▶ » »»  — granularity decreases
// toward the center, like every other video player's transport row.

export function SeekBackIcon() {
  return (
    <svg
      width={20}
      height={20}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {/* Two chevrons pointing left */}
      <polyline points="11,6 5,12 11,18" />
      <polyline points="19,6 13,12 19,18" />
    </svg>
  );
}

export function SeekForwardIcon() {
  return (
    <svg
      width={20}
      height={20}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {/* Two chevrons pointing right */}
      <polyline points="5,6 11,12 5,18" />
      <polyline points="13,6 19,12 13,18" />
    </svg>
  );
}

export function StepBackIcon() {
  return (
    <svg
      width={20}
      height={20}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {/* Single chevron pointing left */}
      <polyline points="15,6 9,12 15,18" />
    </svg>
  );
}

export function StepForwardIcon() {
  return (
    <svg
      width={20}
      height={20}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {/* Single chevron pointing right */}
      <polyline points="9,6 15,12 9,18" />
    </svg>
  );
}
