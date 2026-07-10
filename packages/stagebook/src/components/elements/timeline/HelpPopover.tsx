import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useMessages, useIsRTL } from "../../StagebookProvider.js";

export interface HelpPopoverProps {
  selectionType: "range" | "point";
  onClose: () => void;
  buttonRef: React.RefObject<HTMLButtonElement | null>;
}

export function HelpPopover({
  selectionType,
  onClose,
  buttonRef,
}: HelpPopoverProps) {
  const messages = useMessages();
  const isRTL = useIsRTL();
  const popoverRef = useRef<HTMLDivElement>(null);
  // Whole-table catalog entries (timelineShortcutRowsRange/Point) so a locale
  // translates the table wholesale, including instruction-style "keys" like
  // "Click and drag".
  const rawShortcuts =
    selectionType === "range"
      ? messages.timelineShortcutRowsRange()
      : messages.timelineShortcutRowsPoint();
  // Robustness (not a security boundary — `messages` is trusted host input):
  // a malformed host override returning a non-array would otherwise crash the
  // whole popover at .map(); degrade to an empty table instead.
  const shortcuts = Array.isArray(rawShortcuts) ? rawShortcuts : [];

  // Track button position for fixed positioning
  const [position, setPosition] = useState<{ top: number; right: number }>({
    top: 0,
    right: 0,
  });

  // Compute position from the button's bounding rect on mount and on
  // scroll/resize. The scroll handler fires frequently, so throttle updates
  // to one per animation frame and skip setState if the computed position
  // hasn't changed.
  useEffect(() => {
    let rafId: number | null = null;
    let lastTop = Number.NaN;
    let lastRight = Number.NaN;

    function updatePosition() {
      rafId = null;
      const rect = buttonRef.current?.getBoundingClientRect();
      if (!rect) return;
      const popoverHeight =
        popoverRef.current?.getBoundingClientRect().height ?? 0;
      // Flip above ↔ below when there's not enough room above, and clamp
      // the final top into the viewport so the popover never goes off-screen.
      const viewportPadding = 4;
      const topAbove = rect.top - popoverHeight - viewportPadding;
      const topBelow = rect.bottom + viewportPadding;
      const preferredTop = topAbove >= viewportPadding ? topAbove : topBelow;
      const maxTop = Math.max(
        viewportPadding,
        window.innerHeight - popoverHeight - viewportPadding,
      );
      const top = Math.min(Math.max(preferredTop, viewportPadding), maxTop);
      const right = window.innerWidth - rect.right;
      if (top === lastTop && right === lastRight) return;
      lastTop = top;
      lastRight = right;
      setPosition({ top, right });
    }
    function schedule() {
      if (rafId !== null) return;
      rafId = window.requestAnimationFrame(updatePosition);
    }

    updatePosition();
    window.addEventListener("scroll", schedule, {
      capture: true,
      passive: true,
    });
    window.addEventListener("resize", schedule);
    return () => {
      if (rafId !== null) window.cancelAnimationFrame(rafId);
      window.removeEventListener("scroll", schedule, true);
      window.removeEventListener("resize", schedule);
    };
  }, [buttonRef]);

  // Ref `onClose` so the listener effect doesn't re-register document
  // listeners when the parent passes a fresh callback identity (#105).
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  // Close on Escape and click-outside
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.stopPropagation();
        onCloseRef.current();
      }
    }
    function onClick(e: MouseEvent) {
      const target = e.target as Node;
      if (popoverRef.current?.contains(target)) return;
      // If the button ref is missing (unmounted or never attached), treat
      // the click as "outside" so the popover can still be dismissed.
      if (buttonRef.current?.contains(target)) return;
      onCloseRef.current();
    }
    document.addEventListener("keydown", onKey, true);
    // Use capture so we run before other listeners; mousedown so we close
    // before any click handler on outside elements fires.
    document.addEventListener("mousedown", onClick, true);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      document.removeEventListener("mousedown", onClick, true);
    };
  }, [buttonRef]);

  const popoverContent = (
    <div
      ref={popoverRef}
      data-testid="timeline-help-popover"
      role="dialog"
      dir={isRTL ? "rtl" : "ltr"}
      aria-label={messages.timelineShortcutsLabel}
      style={{
        position: "fixed",
        top: `${String(position.top)}px`,
        right: `${String(position.right)}px`,
        zIndex: 1000,
        background: "var(--stagebook-bg, #ffffff)",
        border: "1px solid var(--stagebook-border, #d1d5db)",
        borderRadius: "0.375rem",
        padding: "0.5rem 0.75rem",
        fontSize: "0.75rem",
        boxShadow: "0 4px 12px rgba(0, 0, 0, 0.12)",
        minWidth: "220px",
      }}
    >
      <div
        style={{
          fontWeight: 600,
          marginBottom: "0.375rem",
          color: "var(--stagebook-text, #1f2937)",
        }}
      >
        {messages.timelineShortcutsTitle}
      </div>
      <table
        style={{
          borderCollapse: "collapse",
          width: "100%",
        }}
      >
        <tbody>
          {shortcuts.map((s) => (
            <tr key={s.keys}>
              <td
                style={{
                  paddingRight: "0.75rem",
                  fontFamily: "monospace",
                  color: "var(--stagebook-text, #1f2937)",
                  whiteSpace: "nowrap",
                  verticalAlign: "top",
                }}
              >
                {s.keys}
              </td>
              <td
                style={{
                  color: "var(--stagebook-text-muted, #6b7280)",
                  verticalAlign: "top",
                }}
              >
                {s.description}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );

  // Guard against SSR / pre-render: document may be undefined.
  if (typeof document === "undefined") return null;
  return createPortal(popoverContent, document.body);
}
