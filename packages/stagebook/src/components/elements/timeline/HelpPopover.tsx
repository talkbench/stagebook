import React, { useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Button } from "../../form/Button.js";
import { focusRingCss } from "../../focusRing.js";
import { useMessages, useIsRTL } from "../../StagebookProvider.js";

export interface HelpPopoverProps {
  id?: string;
  selectionType: "range" | "point";
  onClose: () => void;
  buttonRef: React.RefObject<HTMLButtonElement | null>;
}

export function HelpPopover({
  id,
  selectionType,
  onClose,
  buttonRef,
}: HelpPopoverProps) {
  const messages = useMessages();
  const isRTL = useIsRTL();
  const popoverRef = useRef<HTMLDivElement>(null);
  const generatedId = useId();
  const focusClass = `stagebook-help-panel-${generatedId.replace(/[^a-zA-Z0-9_-]/g, "")}`;
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

  // Clamp both axes with enough space for the outer focus ring.
  const [position, setPosition] = useState({ top: 8, left: 8 });
  useLayoutEffect(() => {
    let rafId: number | null = null;
    function updatePosition() {
      rafId = null;
      const panel = popoverRef.current?.getBoundingClientRect();
      if (!panel) return;
      const button = buttonRef.current?.getBoundingClientRect();
      const padding = 8;
      const width = document.documentElement.clientWidth;
      const height = window.innerHeight;
      const above = (button?.top ?? padding) - panel.height - padding;
      const preferredTop =
        above >= padding ? above : (button?.bottom ?? 0) + padding;
      const top = Math.max(
        padding,
        Math.min(preferredTop, height - panel.height - padding),
      );
      const left = Math.max(
        padding,
        Math.min(
          (button?.right ?? padding + panel.width) - panel.width,
          width - panel.width - padding,
        ),
      );
      setPosition((prev) =>
        prev.top === top && prev.left === left ? prev : { top, left },
      );
    }
    function schedule() {
      if (rafId === null) rafId = requestAnimationFrame(updatePosition);
    }
    updatePosition();
    // Includes translated content and text zoom that do not resize window.
    const observer =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(schedule);
    if (popoverRef.current) observer?.observe(popoverRef.current);
    if (buttonRef.current) observer?.observe(buttonRef.current);
    window.addEventListener("scroll", schedule, {
      capture: true,
      passive: true,
    });
    window.addEventListener("resize", schedule);
    return () => {
      if (rafId !== null) cancelAnimationFrame(rafId);
      observer?.disconnect();
      window.removeEventListener("scroll", schedule, true);
      window.removeEventListener("resize", schedule);
    };
  }, [buttonRef]);

  // Ref `onClose` so the listener effect doesn't re-register document
  // listeners when the parent passes a fresh callback identity (#105).
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  // This is nonmodal help. Focus its scroll container on open, restore the
  // trigger on Escape, and let Tab continue from the trigger's place in the
  // page rather than the portal's position at the end of document.body.
  useLayoutEffect(() => {
    popoverRef.current?.focus({ preventScroll: true });
    function onKey(e: KeyboardEvent) {
      const inPanel = popoverRef.current?.contains(e.target as Node);
      const onButton = buttonRef.current?.contains(e.target as Node);
      if (!inPanel && !onButton) return;
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        buttonRef.current?.focus();
        onCloseRef.current();
      } else if (e.key === "Tab" && inPanel) {
        const onPanel = e.target === popoverRef.current;
        // The panel is the initial scroll target; its Close button is the
        // only sequential stop within help.
        if (onPanel && !e.shiftKey) return;
        if (!onPanel && e.shiftKey) {
          e.preventDefault();
          popoverRef.current?.focus({ preventScroll: true });
          return;
        }
        buttonRef.current?.focus({ preventScroll: true });
        onCloseRef.current();
        // Leave the default Tab/Shift+Tab navigation to the browser.
      }
    }
    function onOutside(e: Event) {
      const target = e.target as Node;
      if (
        popoverRef.current?.contains(target) ||
        buttonRef.current?.contains(target)
      )
        return;
      // Never restore focus here: the user chose another control.
      onCloseRef.current();
    }
    document.addEventListener("keydown", onKey, true);
    document.addEventListener("mousedown", onOutside, true);
    document.addEventListener("focusin", onOutside, true);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      document.removeEventListener("mousedown", onOutside, true);
      document.removeEventListener("focusin", onOutside, true);
    };
  }, [buttonRef]);

  const popoverContent = (
    <div
      ref={popoverRef}
      id={id ?? generatedId}
      className={focusClass}
      tabIndex={-1}
      data-testid="timeline-help-popover"
      role="dialog"
      dir={isRTL ? "rtl" : "ltr"}
      aria-label={messages.timelineShortcutsLabel}
      style={{
        position: "fixed",
        top: `${String(position.top)}px`,
        left: `${String(position.left)}px`,
        boxSizing: "border-box",
        width: "max-content",
        maxWidth: "calc(100% - 16px)",
        maxHeight: "calc(100% - 16px)",
        overflowY: "auto",
        overflowX: "hidden",
        zIndex: 1000,
        background: "var(--stagebook-bg, #ffffff)",
        border: "1px solid var(--stagebook-border, #d1d5db)",
        borderRadius: "0.375rem",
        padding: "0.5rem 0.75rem",
        fontSize: "0.75rem",
        minWidth: "min(220px, calc(100% - 16px))",
      }}
    >
      <style>{`.${focusClass} { box-shadow: 0 4px 12px rgba(0, 0, 0, 0.12); } .${focusClass}:focus-visible { ${focusRingCss("0 4px 12px rgba(0, 0, 0, 0.12)")} }`}</style>
      <div
        style={{
          position: "sticky",
          top: "-0.5rem",
          display: "flex",
          alignItems: "center",
          gap: "0.5rem",
          background: "var(--stagebook-bg, #ffffff)",
          paddingBlock: "0.5rem",
          fontWeight: 600,
          marginBottom: "0.375rem",
          color: "var(--stagebook-text, #1f2937)",
        }}
      >
        <span style={{ flex: 1, minWidth: 0, overflowWrap: "anywhere" }}>
          {messages.timelineShortcutsTitle}
        </span>
        <Button
          icon
          primary={false}
          aria-label={messages.timelineCloseShortcuts}
          data-testid="timeline-help-close"
          style={{ flexShrink: 0 }}
          onClick={() => {
            buttonRef.current?.focus();
            onCloseRef.current();
          }}
        >
          <span aria-hidden="true">×</span>
        </Button>
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
                  paddingInlineEnd: "0.75rem",
                  fontFamily: "monospace",
                  color: "var(--stagebook-text, #1f2937)",
                  whiteSpace: "normal",
                  overflowWrap: "anywhere",
                  verticalAlign: "top",
                }}
              >
                {s.keys}
              </td>
              <td
                style={{
                  color: "var(--stagebook-text-muted, #626977)",
                  overflowWrap: "anywhere",
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
