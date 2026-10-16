import { useState, useLayoutEffect, useCallback, useRef } from "react";
import { isAtBottom } from "./scrollUtils.js";

interface Attachment {
  container: HTMLElement;
  threshold: number;
  resetKey: string | number | undefined;
  cleanup: () => void;
}

/** Indicates new content below the viewport, peeking only while the reader
 * stays near the bottom. Explicit navigation and input take precedence. */
export function useScrollAwareness(
  containerRef: React.RefObject<HTMLElement | null>,
  options: {
    threshold?: number;
    /** Stable stage identity. Changes cancel pending work and start at the
     * top; ordinary response/content updates must keep the same key. */
    resetKey?: string | number;
  } = {},
): { showIndicator: boolean; dismissIndicator: () => void } {
  const { threshold = 120, resetKey } = options;
  const [showIndicator, setShowIndicator] = useState(false);
  const indicatorRef = useRef(false);
  const attachmentRef = useRef<Attachment | null>(null);
  const updateIndicator = useCallback((visible: boolean) => {
    indicatorRef.current = visible;
    setShowIndicator(visible);
  }, []);

  // A ref's DOM node can change without its object or the stage key changing
  // (waiting screens, conditional discussion layouts). Check each commit,
  // keeping the existing subscription and animation when nothing changed.
  useLayoutEffect(() => {
    const container = containerRef.current;
    const previous = attachmentRef.current;
    if (
      previous?.container === container &&
      previous.threshold === threshold &&
      previous.resetKey === resetKey
    )
      return;
    previous?.cleanup();
    attachmentRef.current = null;
    if (!container) return;

    if (
      resetKey !== undefined &&
      (previous?.resetKey !== resetKey || previous.container !== container)
    ) {
      // "auto" would inherit CSS scroll-behavior:smooth in discussion mode.
      container.scrollTo({ top: 0, behavior: "instant" });
      updateIndicator(false);
    }

    let disposed = false;
    let prevScrollHeight = container.scrollHeight;
    let initialized = false;
    let hasUserScrolled = container.scrollTop > 0;
    const atBottom = () =>
      isAtBottom(
        container.scrollHeight,
        container.scrollTop,
        container.clientHeight,
        threshold,
      );
    let wasAtBottom = atBottom();
    let inputVersion = 0;
    let pointerDown = false;
    let delay: ReturnType<typeof setTimeout> | undefined;
    let animationFrame: number | undefined;
    let mutationFrame: number | undefined;
    // Track observed/written position even while idle: an external scroll can
    // precede the mutation check that would schedule the first peek. Read back
    // animation writes so browser rounding/clamping is not mistaken for input.
    let lastScrollTop = container.scrollTop;
    let clampedFrom: number | undefined;
    let peeking = false;

    const cancelPeek = () => {
      clearTimeout(delay);
      if (animationFrame !== undefined) cancelAnimationFrame(animationFrame);
      delay = undefined;
      animationFrame = undefined;
      peeking = false;
    };
    const indicateRemaining = () => updateIndicator(!atBottom());
    const interrupt = () => {
      const hadPeek = peeking;
      inputVersion++;
      clampedFrom = undefined;
      cancelPeek();
      if (hadPeek) indicateRemaining();
    };
    const externallyMoved = () => {
      const top = container.scrollTop;
      const max = Math.max(0, container.scrollHeight - container.clientHeight);
      if (Math.abs(top - lastScrollTop) <= 1) return false;
      // Removing content (including our indicator) can clamp the position.
      // Chromium may restore the pre-clamp position on later growth; other
      // browsers keep the clamped position. Neither is new scrolling intent.
      if (Math.abs(top - Math.min(lastScrollTop, max)) <= 1) {
        clampedFrom = Math.max(clampedFrom ?? lastScrollTop, lastScrollTop);
        lastScrollTop = top;
        return false;
      }
      if (
        clampedFrom !== undefined &&
        Math.abs(top - Math.min(clampedFrom, max)) <= 1
      ) {
        lastScrollTop = top;
        if (Math.abs(top - clampedFrom) <= 1) clampedFrom = undefined;
        return false;
      }
      return true;
    };
    const handleScroll = () => {
      if (externallyMoved()) interrupt();
      lastScrollTop = container.scrollTop;
      hasUserScrolled = container.scrollTop > 0;
      wasAtBottom = atBottom();
      if (wasAtBottom) updateIndicator(false);
    };
    const handlePointerDown = () => {
      pointerDown = true;
      interrupt();
    };
    const handlePointerUp = () => {
      pointerDown = false;
    };

    const checkForNewContent = (scheduledInputVersion: number) => {
      if (disposed) return;
      // A host reset can run earlier in this same frame, before its scroll
      // event. Do not replace the old animation and lose that evidence.
      if (externallyMoved()) handleScroll();
      const currentScrollHeight = container.scrollHeight;
      const scrollTop = container.scrollTop;
      if (currentScrollHeight < prevScrollHeight) cancelPeek();
      if (currentScrollHeight <= container.clientHeight) updateIndicator(false);

      if (currentScrollHeight > prevScrollHeight && prevScrollHeight > 0) {
        // Absorb initial async content; never treat first load as engagement.
        if (!initialized) {
          initialized = true;
        } else if (currentScrollHeight > container.clientHeight) {
          const nearOldBottom =
            wasAtBottom ||
            isAtBottom(
              prevScrollHeight,
              scrollTop,
              container.clientHeight,
              threshold,
            );
          if (
            nearOldBottom &&
            hasUserScrolled &&
            !pointerDown &&
            scheduledInputVersion === inputVersion &&
            !indicatorRef.current
          ) {
            const peekAmount = Math.min(
              currentScrollHeight - prevScrollHeight,
              150,
            );
            cancelPeek();
            peeking = true;
            const startTime = performance.now();
            const animateScroll = (currentTime: number) => {
              animationFrame = undefined;
              if (disposed) return;
              if (externallyMoved()) {
                interrupt();
                return;
              }
              const progress = Math.min((currentTime - startTime) / 900, 1);
              const easeInOut =
                progress < 0.5
                  ? 4 * progress * progress * progress
                  : 1 - Math.pow(-2 * progress + 2, 3) / 2;
              container.scrollTo({
                top: scrollTop + peekAmount * easeInOut,
                behavior: "instant",
              });
              lastScrollTop = container.scrollTop;
              clampedFrom = undefined;
              if (progress < 1)
                animationFrame = requestAnimationFrame(animateScroll);
              else peeking = false;
            };
            delay = setTimeout(() => {
              delay = undefined;
              animationFrame = requestAnimationFrame(animateScroll);
            }, 50);
          } else {
            // A visible indicator itself adds height. Keep indicating rather
            // than letting that mutation resurrect a canceled animation.
            updateIndicator(true);
          }
        }
      }
      prevScrollHeight = currentScrollHeight;
    };

    const mutationObserver = new MutationObserver(() => {
      if (mutationFrame !== undefined) return;
      const scheduledInputVersion = inputVersion;
      mutationFrame = requestAnimationFrame(() => {
        mutationFrame = undefined;
        checkForNewContent(scheduledInputVersion);
      });
    });
    mutationObserver.observe(container, {
      childList: true,
      subtree: true,
      characterData: true,
    });
    const resizeObserver =
      typeof ResizeObserver !== "undefined"
        ? new ResizeObserver(() => {
            if (!disposed && container.scrollHeight <= container.clientHeight)
              updateIndicator(false);
          })
        : null;
    resizeObserver?.observe(container);
    container.addEventListener("scroll", handleScroll, { passive: true });
    container.addEventListener("pointerdown", handlePointerDown, {
      capture: true,
      passive: true,
    });
    for (const type of ["wheel", "touchstart", "keydown", "focusin"]) {
      container.addEventListener(type, interrupt, {
        capture: true,
        passive: true,
      });
    }
    const document = container.ownerDocument;
    document.addEventListener("pointerup", handlePointerUp, true);
    document.addEventListener("pointercancel", handlePointerUp, true);

    attachmentRef.current = {
      container,
      threshold,
      resetKey,
      cleanup: () => {
        disposed = true;
        cancelPeek();
        if (mutationFrame !== undefined) cancelAnimationFrame(mutationFrame);
        mutationObserver.disconnect();
        resizeObserver?.disconnect();
        container.removeEventListener("scroll", handleScroll);
        container.removeEventListener("pointerdown", handlePointerDown, true);
        for (const type of ["wheel", "touchstart", "keydown", "focusin"]) {
          container.removeEventListener(type, interrupt, true);
        }
        document.removeEventListener("pointerup", handlePointerUp, true);
        document.removeEventListener("pointercancel", handlePointerUp, true);
      },
    };
  });

  useLayoutEffect(
    () => () => {
      attachmentRef.current?.cleanup();
      attachmentRef.current = null;
    },
    [],
  );

  const dismissIndicator = useCallback(
    () => updateIndicator(false),
    [updateIndicator],
  );
  return { showIndicator, dismissIndicator };
}
