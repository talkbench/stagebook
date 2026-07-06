import { useCallback, useEffect, useState, type RefObject } from "react";
import type { ViewerStep } from "../lib/steps.js";
import { noteAnchorId } from "./StateInspector.js";

export interface NotesIconsOverlayProps {
  /** Container whose DOM children include the rendered `<Stage>`. */
  containerRef: RefObject<HTMLElement | null>;
  currentStep: ViewerStep;
}

interface IconPos {
  key: string;
  type: string;
  name: string | undefined;
  top: number;
  left: number;
}

/**
 * Viewer-only overlay that drops a small ℹ icon onto every rendered
 * element whose `notes` field is set. Clicking the icon scrolls the
 * matching note in the StateInspector sidebar into view and briefly
 * highlights it.
 *
 * Implementation uses `data-testid="element-{type}-{name}"` (added by
 * `packages/stagebook/src/components/Stage.tsx`) to locate element
 * wrappers — no library changes required.
 */
export function NotesIconsOverlay({
  containerRef,
  currentStep,
}: NotesIconsOverlayProps) {
  const [positions, setPositions] = useState<IconPos[]>([]);

  const recompute = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;
    const containerRect = container.getBoundingClientRect();
    const next: IconPos[] = [];
    for (const el of currentStep.elements) {
      const typed = el as { type: string; name?: string; notes?: string };
      if (!typed.notes) continue;
      const selector = `[data-testid="element-${typed.type}${typed.name ? `-${typed.name}` : ""}"]`;
      const node = container.querySelector(selector);
      if (!(node instanceof HTMLElement)) continue;
      const r = node.getBoundingClientRect();
      next.push({
        key: `${typed.type}-${typed.name ?? "anon"}-${String(next.length)}`,
        type: typed.type,
        name: typed.name,
        // Anchor the icon in the lower-right of the element rect,
        // relative to the overlay's coordinate system (same as the
        // container since the overlay is inset:0 within it).
        top: r.bottom - containerRect.top - 20,
        left: r.right - containerRect.left - 20,
      });
    }
    setPositions(next);
  }, [containerRef, currentStep]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    // Recompute once after layout settles, then whenever the container
    // resizes, its subtree mutates, the window resizes, or any internal
    // scroll container scrolls (Stage uses `[data-testid="stageContent"]`
    // with `overflow: auto` for long content). Scroll events don't bubble,
    // so we listen in the capture phase on the container — this catches
    // scrolls on any current or future descendant without having to
    // re-resolve the scroller set on DOM churn.
    const ro = new ResizeObserver(recompute);
    ro.observe(container);
    const mo = new MutationObserver(recompute);
    mo.observe(container, { childList: true, subtree: true });
    window.addEventListener("resize", recompute);
    container.addEventListener("scroll", recompute, {
      capture: true,
      passive: true,
    });
    const raf = requestAnimationFrame(recompute);
    return () => {
      ro.disconnect();
      mo.disconnect();
      window.removeEventListener("resize", recompute);
      container.removeEventListener("scroll", recompute, true);
      cancelAnimationFrame(raf);
    };
  }, [recompute, containerRef]);

  const handleClick = (type: string, name: string | undefined) => {
    const id = noteAnchorId(type, name);
    const target = document.getElementById(id);
    if (!target) return;
    target.scrollIntoView({ behavior: "smooth", block: "center" });
    // Brief flash so the reader can find the just-scrolled note.
    const prev = target.style.backgroundColor;
    target.style.backgroundColor = "#fef3c7";
    window.setTimeout(() => {
      target.style.backgroundColor = prev;
    }, 900);
  };

  return (
    <div
      data-testid="notes-icons-overlay"
      style={overlayStyle}
      aria-hidden={false}
    >
      {positions.map((pos) => (
        <button
          key={pos.key}
          type="button"
          onClick={() => handleClick(pos.type, pos.name)}
          title="Has researcher notes — click to jump to the sidebar note"
          aria-label={`Open note for ${pos.name ?? pos.type}`}
          data-testid={`notes-icon-${pos.type}${pos.name ? `-${pos.name}` : ""}`}
          style={{
            ...iconButtonStyle,
            top: `${String(pos.top)}px`,
            left: `${String(pos.left)}px`,
          }}
        >
          <span style={iconGlyphStyle}>i</span>
        </button>
      ))}
    </div>
  );
}

const overlayStyle: React.CSSProperties = {
  position: "absolute",
  inset: 0,
  pointerEvents: "none",
  // Keep icons above rendered stage content but below modal UI.
  zIndex: 10,
};

const iconButtonStyle: React.CSSProperties = {
  position: "absolute",
  width: "1.5rem",
  height: "1.5rem",
  padding: 0,
  borderRadius: "9999px",
  border: "1px solid #fbbf24",
  backgroundColor: "#fde68a",
  color: "#92400e",
  cursor: "pointer",
  pointerEvents: "auto",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  boxShadow: "0 1px 2px rgba(0, 0, 0, 0.08)",
};

const iconGlyphStyle: React.CSSProperties = {
  fontFamily: "'Times New Roman', Georgia, serif",
  fontStyle: "italic",
  fontWeight: 700,
  fontSize: "0.875rem",
  lineHeight: 1,
};
