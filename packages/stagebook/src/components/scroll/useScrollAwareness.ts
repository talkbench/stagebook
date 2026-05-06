import { useState, useEffect, useCallback, useRef } from "react";
import { isAtBottom } from "./scrollUtils.js";

/**
 * Detects when new content appears below the viewport and either:
 * - Auto-scrolls to "peek" the content if user is near bottom
 * - Shows an indicator if user is not near bottom
 */
export function useScrollAwareness(
  containerRef: React.RefObject<HTMLElement | null>,
  options: { threshold?: number } = {},
): { showIndicator: boolean; dismissIndicator: () => void } {
  const { threshold = 120 } = options;
  const [showIndicator, setShowIndicator] = useState(false);
  const prevScrollHeightRef = useRef(0);
  const wasAtBottomRef = useRef(true);
  const isInitializedRef = useRef(false);
  // Auto-peek scrolling is meant to keep an *engaged* user oriented when
  // new content arrives — e.g., a participant who scrolled to the
  // bottom of a discussion to read the latest, then sees a new message.
  // It should NOT fire on fresh page load, when the user hasn't read the
  // top yet but the container is technically "at bottom" because content
  // happens to fit in the viewport (or hasn't fully loaded). This flag
  // gates peek on actual user scroll engagement; the indicator branch
  // is unaffected.
  const hasUserScrolledRef = useRef(false);

  const checkAtBottom = useCallback(() => {
    const container = containerRef.current;
    if (!container) return true;
    return isAtBottom(
      container.scrollHeight,
      container.scrollTop,
      container.clientHeight,
      threshold,
    );
  }, [containerRef, threshold]);

  // Handle scroll events — dismiss indicator when user scrolls down
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return undefined;

    const handleScroll = () => {
      hasUserScrolledRef.current = true;
      wasAtBottomRef.current = checkAtBottom();
      if (showIndicator && wasAtBottomRef.current) {
        setShowIndicator(false);
      }
    };

    container.addEventListener("scroll", handleScroll, { passive: true });
    wasAtBottomRef.current = checkAtBottom();
    prevScrollHeightRef.current = container.scrollHeight;

    return () => container.removeEventListener("scroll", handleScroll);
  }, [containerRef, checkAtBottom, showIndicator]);

  // MutationObserver detects when React renders new content; a
  // ResizeObserver catches viewport-size changes that bring content
  // into fit. Both feed into the same "is there content to scroll to?"
  // calculation so the indicator can be dismissed whenever that becomes
  // false (#291).
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return undefined;

    const dismissIfFits = () => {
      if (container.scrollHeight <= container.clientHeight) {
        setShowIndicator(false);
      }
    };

    const checkForNewContent = () => {
      const currentScrollHeight = container.scrollHeight;
      const scrollTop = container.scrollTop;
      const prevScrollHeight = prevScrollHeightRef.current;

      // Dismiss whenever everything fits — covers stage transitions
      // where a previously-overflowing stage left the indicator on,
      // then the new stage's content is short enough that there's
      // nothing to scroll to. (#291)
      dismissIfFits();

      if (currentScrollHeight > prevScrollHeight && prevScrollHeight > 0) {
        if (!isInitializedRef.current) {
          isInitializedRef.current = true;
          prevScrollHeightRef.current = currentScrollHeight;
          return;
        }

        // Nothing to peek or indicate if everything still fits in the
        // viewport. Spares us from cueing on growths that don't push
        // content below the fold (e.g. a header reflow inside short
        // content).
        if (currentScrollHeight <= container.clientHeight) {
          prevScrollHeightRef.current = currentScrollHeight;
          return;
        }

        const wasAtBottomNow =
          wasAtBottomRef.current ||
          isAtBottom(
            prevScrollHeight,
            scrollTop,
            container.clientHeight,
            threshold,
          );
        const heightDelta = currentScrollHeight - prevScrollHeight;

        if (wasAtBottomNow && hasUserScrolledRef.current) {
          // User was near bottom AND has scrolled at least once — a
          // meaningful "I've read this and want to keep up with new
          // content" signal. Peek the new content into view.
          //
          // Without the engagement gate, async content arriving on
          // first paint triggers a peek before the user has read the
          // top — disorienting and unwanted. (Reported observation
          // from the viewer migration.)
          const peekAmount = Math.min(heightDelta, 150);
          const startScrollTop = scrollTop;
          const duration = 900;
          const startTime = performance.now();

          const animateScroll = (currentTime: number) => {
            const elapsed = currentTime - startTime;
            const progress = Math.min(elapsed / duration, 1);
            const easeInOut =
              progress < 0.5
                ? 4 * progress * progress * progress
                : 1 - Math.pow(-2 * progress + 2, 3) / 2;
            container.scrollTop = startScrollTop + peekAmount * easeInOut;
            if (progress < 1) {
              requestAnimationFrame(animateScroll);
            }
          };

          setTimeout(() => requestAnimationFrame(animateScroll), 50);
        } else {
          // Either user isn't near the bottom, or they haven't engaged
          // yet (no peek without engagement). Either way, content now
          // overflows — surface the "more below" indicator so it's
          // discoverable.
          setShowIndicator(true);
        }
      }

      prevScrollHeightRef.current = currentScrollHeight;
    };

    const mutationObserver = new MutationObserver(() => {
      requestAnimationFrame(() => checkForNewContent());
    });

    mutationObserver.observe(container, {
      childList: true,
      subtree: true,
      characterData: true,
    });

    // ResizeObserver covers the case where the viewport grows (or the
    // container shrinks) enough to bring overflowing content into fit
    // without any DOM mutation.
    const resizeObserver = new ResizeObserver(() => {
      dismissIfFits();
    });
    resizeObserver.observe(container);

    prevScrollHeightRef.current = container.scrollHeight;

    return () => {
      mutationObserver.disconnect();
      resizeObserver.disconnect();
    };
  }, [containerRef, threshold]);

  const dismissIndicator = useCallback(() => {
    setShowIndicator(false);
  }, []);

  return { showIndicator, dismissIndicator };
}
