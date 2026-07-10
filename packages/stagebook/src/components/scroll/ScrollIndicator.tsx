import React, { useId } from "react";

export interface ScrollIndicatorProps {
  visible: boolean;
}

// "More content below" chevron pill that appears at the bottom of an
// internally-scrolling Stage column when new content has grown out of
// view. `useScrollAwareness` toggles `visible`; this component owns
// only the rendering and the (small) animations.
//
// Polish notes (#394):
// - Color tokens (`--stagebook-scroll-indicator-bg` / `-fg`) live in
//   styles.css so hosts can retune without overriding selectors.
// - `@keyframes` names are scoped via `useId()` per-instance so they
//   can't collide with host-defined keyframes of the same name.
//   (Two Stage columns mounting at once each get their own scope.)
// - `prefers-reduced-motion: reduce` disables the fade-in slide and
//   the perpetual pulse. The indicator still appears, just without
//   animation — participants who opted out of motion shouldn't see
//   a continuously pulsing element.
//
// `pointer-events: none` and `aria-hidden="true"` are intentional —
// the indicator is a visual cue, not an interactive control. Adding
// a click-to-scroll-to-bottom affordance would be a UX change worth
// its own design discussion (see comment in PR #397 thread).
export function ScrollIndicator({ visible }: ScrollIndicatorProps) {
  // Hooks must run unconditionally; the early-return below is after.
  const reactId = useId();
  const safeId = reactId.replace(/[^a-zA-Z0-9_-]/g, "");
  const fadeInName = `stagebook-scroll-indicator-fadein-${safeId}`;
  const pulseName = `stagebook-scroll-indicator-pulse-${safeId}`;
  const rootClass = `stagebook-scroll-indicator-${safeId}`;

  if (!visible) return null;

  return (
    <>
      <style>{`
        @keyframes ${fadeInName} {
          from { opacity: 0; transform: translateY(10px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes ${pulseName} {
          0%, 100% { transform: scale(1); opacity: 1; }
          50% { transform: scale(1.05); opacity: 0.85; }
        }
        .${rootClass} {
          animation: ${fadeInName} 0.3s ease-out;
        }
        .${rootClass} > svg {
          animation: ${pulseName} 2s ease-in-out infinite;
        }
        /* Participants who opted into reduced motion see the
           indicator appear, but without the fade-in slide or the
           perpetual pulse — both are vestibular triggers. */
        @media (prefers-reduced-motion: reduce) {
          .${rootClass},
          .${rootClass} > svg {
            animation: none;
          }
        }
      `}</style>
      <div
        className={rootClass}
        style={{
          position: "sticky",
          bottom: 0,
          left: 0,
          right: 0,
          display: "flex",
          justifyContent: "center",
          padding: "0.75rem",
          pointerEvents: "none",
          zIndex: 50,
        }}
        aria-hidden="true"
        data-testid="scroll-indicator"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="40"
          height="40"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{
            backgroundColor:
              "var(--stagebook-scroll-indicator-bg, rgba(229, 231, 235, 0.8))",
            color: "var(--stagebook-scroll-indicator-fg, #374151)",
            borderRadius: "9999px",
            padding: "0.5rem",
            boxShadow: "0 4px 6px -1px rgba(0, 0, 0, 0.1)",
            backdropFilter: "blur(4px)",
          }}
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </div>
    </>
  );
}
