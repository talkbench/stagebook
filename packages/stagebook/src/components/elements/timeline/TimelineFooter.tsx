import React, { useId } from "react";
import { formatTime } from "../../../utils/formatTime.js";
import { useMessages, useIsRTL } from "../../StagebookProvider.js";
import type { StagebookMessages } from "../../../messages/index.js";
import type { TimelineValue } from "./selections.js";

export interface TimelineFooterProps {
  selectionType: "range" | "point";
  selections: TimelineValue;
  activeIndex: number | null;
  onHelpToggle: () => void;
  helpOpen: boolean;
  helpButtonRef?: React.RefObject<HTMLButtonElement | null>;
  /** Show "Max 1 range — delete to replace" to the left of the help button.
   *  True when the timeline is in single-select range mode and a range
   *  already exists (further create attempts will be blocked). */
  singleSelectFull?: boolean;
}

function isRangeArray(
  s: TimelineValue,
): s is { start: number; end: number; track?: number }[] {
  return s.length === 0 || "start" in (s[0] as object);
}

function summary(
  selectionType: "range" | "point",
  selections: TimelineValue,
  activeIndex: number | null,
  messages: StagebookMessages,
): string {
  const count = selections.length;
  // Active selection time readout takes precedence
  if (activeIndex !== null) {
    const item = selections[activeIndex];
    if (item) {
      if (isRangeArray(selections)) {
        const r = selections[activeIndex];
        if (r) return `${formatTime(r.start)} – ${formatTime(r.end)}`;
      } else {
        const p = (selections as { time: number }[])[activeIndex];
        if (p) return formatTime(p.time);
      }
    }
  }
  // Count-neutral by construction: the catalog phrasing ("Ranges selected: N")
  // never inflects a noun on the count, so the same string works for 0/1/N and
  // across locales without a plural framework.
  return selectionType === "range"
    ? messages.rangesSelected(count)
    : messages.pointsMarked(count);
}

const buttonStyle: React.CSSProperties = {
  width: "24px",
  height: "24px",
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  border: "1px solid var(--stagebook-border, #e5e7eb)",
  borderRadius: "0.25rem",
  background: "var(--stagebook-bg, #ffffff)",
  cursor: "pointer",
  fontSize: "0.875rem",
  lineHeight: 1,
  padding: 0,
  color: "inherit",
};

export function TimelineFooter({
  selectionType,
  selections,
  activeIndex,
  onHelpToggle,
  helpOpen,
  helpButtonRef,
  singleSelectFull = false,
}: TimelineFooterProps) {
  const messages = useMessages();
  const isRTL = useIsRTL();
  // Scoped class for the help button's `:focus-visible` ring + hover
  // (#382 polish). Same useId pattern as Button / Slider / ListSorter.
  const reactId = useId();
  const safeId = reactId.replace(/[^a-zA-Z0-9_-]/g, "");
  const btnClass = `stagebook-timeline-help-${safeId}`;
  return (
    <div
      data-testid="timeline-footer"
      dir={isRTL ? "rtl" : "ltr"}
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "0.25rem 0.5rem",
        borderTop: "1px solid var(--stagebook-border, #e5e7eb)",
        fontSize: "0.75rem",
        color: "var(--stagebook-text-muted, #6b7280)",
        userSelect: "none",
      }}
    >
      <style>{`
        .${btnClass}:focus-visible {
          outline: none;
          box-shadow: 0 0 0 2px var(--stagebook-focus-ring, rgba(59, 130, 246, 0.25));
        }
        .${btnClass}:hover {
          background: var(--stagebook-hover-bg, #f3f4f6);
        }
      `}</style>
      {/* Left: selection summary */}
      <div data-testid="timeline-selection-summary">
        {summary(selectionType, selections, activeIndex, messages)}
      </div>

      {/* Right: single-select hint + help button */}
      <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
        {singleSelectFull && (
          <span
            data-testid="timeline-single-select-hint"
            style={{ fontStyle: "italic" }}
          >
            {messages.singleRangeHint}
          </span>
        )}
        <button
          ref={helpButtonRef}
          type="button"
          className={btnClass}
          data-testid="timeline-help-button"
          onClick={onHelpToggle}
          aria-label={messages.timelineShowShortcuts}
          aria-pressed={helpOpen}
          // Explicit tabIndex for Safari Tab-focus (#415 / #413).
          tabIndex={0}
          style={buttonStyle}
        >
          ?
        </button>
      </div>
    </div>
  );
}
