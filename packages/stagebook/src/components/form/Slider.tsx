import React, { useState, useEffect, useId, useMemo } from "react";
import { useMessages, useIsRTL } from "../StagebookProvider.js";

export interface SliderProps {
  min?: number;
  max?: number;
  interval?: number;
  labelPts?: number[];
  labels?: string[];
  value?: number;
  onChange?: (value: number) => void;
  /**
   * When true, renders a numeric value badge above the thumb after
   * the participant has selected a value. Off by default — preserves
   * the "no anchoring information" posture (#326). Opt in per
   * prompt by setting `showValue: true` in the slider frontmatter.
   */
  showValue?: boolean;
}

// Cap the number of snap-point micro-ticks rendered below the track.
// A `0..100` slider with `interval: 1` has 101 snap points — drawing
// every one would look like a barcode. Beyond this threshold we drop
// the micro-ticks entirely; the labeled-position ticks remain.
const MAX_SNAP_TICKS = 25;

// Track + value-badge geometry. Centralized so the click-target
// padding math doesn't drift from the visible track height.
const TRACK_HEIGHT = 10; // px
const CLICK_TARGET_HEIGHT = 36; // px (track + vertical padding)
const THUMB_SIZE = 20; // px

export function Slider({
  min = 0,
  max = 100,
  interval = 1,
  labelPts = [],
  labels = [],
  value,
  onChange,
  showValue = false,
}: SliderProps) {
  const messages = useMessages();
  // Mirror under RTL locales (Material bidirectionality: value/quantity
  // sliders mirror; time-based controls don't). The native <input
  // type=range> auto-reverses under dir=rtl; the custom thumb / ticks /
  // labels follow it via insetInlineStart + direction-aware transforms,
  // and click-to-jump math flips. Value semantics are unchanged — min
  // still records as min, wherever it's painted.
  const isRTL = useIsRTL();
  const dir = isRTL ? "rtl" : "ltr";
  const [localValue, setLocalValue] = useState<number | undefined>(value);

  useEffect(() => {
    setLocalValue(value);
  }, [value]);

  const reactId = useId();
  // `useId` returns an opaque string. Strip anything outside the
  // class-name-safe set so future React versions don't break the
  // CSS selectors below.
  const safeId = reactId.replace(/[^a-zA-Z0-9_-]/g, "");
  const trackClass = `stagebook-slider-track-${safeId}`;
  const inputClass = `stagebook-slider-input-${safeId}`;

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = parseFloat(e.target.value);
    setLocalValue(newValue);
    onChange?.(newValue);
  };

  const handleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    // Click-to-jump for the click-target padding (above / below the
    // 10px track) and for the unanchored state (when the native
    // input doesn't yet exist). Clicks directly on the native range
    // input's track area are handled by the input's built-in
    // click-to-jump behavior — and those clicks ALSO bubble to this
    // wrapper handler. Skip them here so we don't fire onChange
    // twice for a single user click; a host's debounced save would
    // otherwise observe two fires per click.
    if (e.target instanceof HTMLInputElement) return;

    // The track sits inside a padded click-area wrapper, so we
    // measure against the visible track's bounding rect (not the
    // event target's) to get accurate `x` regardless of how far
    // above/below the track the user actually clicked.
    const trackEl = e.currentTarget.querySelector(`.${trackClass}`);
    const rect = (trackEl ?? e.currentTarget).getBoundingClientRect();
    const x = e.clientX - rect.left;
    let percentage = Math.max(0, Math.min(1, x / rect.width));
    // Under RTL the visual axis is mirrored: a click near the left edge
    // means max, not min.
    if (isRTL) percentage = 1 - percentage;
    const rawValue = min + percentage * (max - min);
    const newValue = Math.round(rawValue / interval) * interval;
    const clampedValue = Math.max(min, Math.min(max, newValue));
    setLocalValue(clampedValue);
    onChange?.(clampedValue);
  };

  const getPosition = (pt: number) => ((pt - min) / (max - min)) * 100;

  // Snap-point micro-ticks. Decoupled from `labelPts` so that authors
  // who only label endpoints still get visible cues for the
  // intermediate snap points (the "what values can I even pick?"
  // signal that's missing without this). Above MAX_SNAP_TICKS we
  // degrade by stepping — show every Nth tick — rather than dropping
  // ticks entirely, so a 0..100 slider still carries the "discrete
  // positions exist here" signal across its full range.
  const snapTicks = useMemo<number[]>(() => {
    if (!Number.isFinite(min) || !Number.isFinite(max) || interval <= 0) {
      return [];
    }
    const count = Math.round((max - min) / interval) + 1;
    const stride =
      count > MAX_SNAP_TICKS ? Math.ceil(count / MAX_SNAP_TICKS) : 1;
    const ticks: number[] = [];
    for (let i = 0; i < count; i += stride) {
      ticks.push(min + i * interval);
    }
    return ticks;
  }, [min, max, interval]);

  const hasValue = localValue !== undefined && localValue !== null;

  return (
    <div
      data-testid="slider"
      data-state={hasValue ? "anchored" : "unanchored"}
      style={{ marginTop: "1rem", width: "100%" }}
    >
      <style>{`
        /* Hover affordance. Highlights the full 36px click-target
           region (not just the 10px track), so the participant sees
           the whole interactive area light up, not just a sliver.
           The track inside gets a stronger color shift too so the
           hover is unmistakable. Applied in both anchored and
           unanchored states — click-to-jump is always supported, so
           the hover signal should be too. */
        .${trackClass}-wrapper {
          border-radius: 0.375rem;
          transition: background-color 120ms ease-out;
        }
        .${trackClass}-wrapper:hover {
          background-color: var(--stagebook-hover-bg, #f3f4f6);
        }
        /* Track bg also moved out of inline style so the hover
           rule below isn't blocked by inline-style specificity. */
        .${trackClass} {
          background-color: var(--stagebook-bg-track, #e5e7eb);
        }
        /* Hover track uses a primary-tinted color (the same token as
           the focus ring) rather than a darker gray. A darker-gray
           track would blend visually with the gray snap-point ticks
           and labeled ticks, hiding them on hover — the user reported
           this. The primary-tint reads as "interactive / selected"
           and keeps the gray ticks visible against it. */
        .${trackClass}-wrapper:hover .${trackClass} {
          background-color: var(--stagebook-focus-ring, rgba(59, 130, 246, 0.25));
        }
        /* Base thumb elevation. Kept in CSS (not inline) so the
           focus-ring rule below can stack on top of it — inline
           box-shadow on the thumb would win specificity and block
           the focus ring. Scoped under the track class so the
           per-instance <style> block doesn't paint other sliders. */
        .${trackClass} [data-testid="slider-thumb"] {
          box-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);
        }
        /* Focus ring rendered on the visible thumb via the general
           sibling selector — the actual focused element is the
           invisible range input, but the user sees the thumb. */
        .${inputClass}:focus-visible ~ [data-testid="slider-thumb"] {
          box-shadow: 0 0 0 2px var(--stagebook-focus-ring, rgba(59, 130, 246, 0.25)), 0 2px 4px rgba(0, 0, 0, 0.2);
        }
        @media (prefers-reduced-motion: reduce) {
          .${trackClass},
          .${trackClass} [data-testid="slider-thumb"] {
            transition: none;
          }
        }
      `}</style>

      <div
        dir={dir}
        style={{
          position: "relative",
          width: "100%",
          paddingTop: "0.25rem",
          paddingBottom: "1.75rem",
          // Horizontal padding reserves room for endpoint labels to
          // center on their tick without overflowing the slider's
          // box. Labels are uniformly centered (translateX(-50%)),
          // including at min/max ticks, so each endpoint label needs
          // ~half its width of space past the track edge. 2.5rem
          // fits the typical short endpoint label ("Strongly
          // disagree", "Very unlikely") without overflow. See the
          // labels block below for the design rationale.
          paddingLeft: "2.5rem",
          paddingRight: "2.5rem",
        }}
      >
        {/* Click-target wrapper. Visually wraps the thin track in a
            36px-tall hit area so the slider is actually clickable —
            previously the 8px track was below any reasonable touch
            target. The track sits centered within this strip. */}
        <div
          className={`${trackClass}-wrapper`}
          data-state={hasValue ? "anchored" : "unanchored"}
          onClick={handleClick}
          role="presentation"
          style={{
            position: "relative",
            width: "100%",
            height: `${CLICK_TARGET_HEIGHT}px`,
            // Constant marginTop reserves space for the value badge
            // whether or not it's currently rendered — without this,
            // the first click visibly pushes the track down 1.25rem
            // as the badge appears.
            marginTop: "1.25rem",
            // Uniform `pointer` regardless of anchored state. The
            // alternative (default cursor in padding + ew-resize on
            // the track when anchored) was semantically more precise
            // — signalling that click-to-jump is disabled — but in
            // practice the cursor flicker as the participant moves
            // their mouse around the slider read as distracting,
            // not informative.
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
          }}
        >
          {/* Value badge — opt-in numeric readout above the thumb
              after first click. Styled as a small dark chip so it
              reads as a deliberate UI element rather than stray
              text. Off by default to preserve the no-anchoring
              posture (#326); researchers opt in via `showValue:
              true` in the slider frontmatter. Lives inside the
              click-target wrapper so it shares the track's
              coordinate space — left percentage matches the thumb
              percentage exactly, no padding-offset calc needed. */}
          {hasValue && showValue && (
            <div
              data-testid="slider-value-badge"
              style={{
                position: "absolute",
                insetInlineStart: `${getPosition(localValue)}%`,
                bottom: "100%",
                marginBottom: "0.25rem",
                transform: `translateX(${isRTL ? "50%" : "-50%"})`,
                fontSize: "0.75rem",
                fontWeight: 500,
                lineHeight: 1,
                color: "var(--stagebook-bg, #ffffff)",
                backgroundColor: "var(--stagebook-text, #1f2937)",
                padding: "0.1875rem 0.5rem",
                borderRadius: "0.25rem",
                pointerEvents: "none",
                whiteSpace: "nowrap",
                boxShadow: "0 1px 2px rgba(0, 0, 0, 0.08)",
              }}
            >
              {localValue}
            </div>
          )}
          {/* Instruction text — shares the zone above the click
              target with the value badge. They never coexist: badge
              shows when hasValue, instruction shows when !hasValue.
              Sharing the slot keeps the labels (and everything
              below) anchored to a stable Y, so the first click
              doesn't shift the layout. */}
          {!hasValue && (
            <div
              style={{
                position: "absolute",
                insetInlineStart: "50%",
                bottom: "100%",
                marginBottom: "0.25rem",
                transform: `translateX(${isRTL ? "50%" : "-50%"})`,
                fontSize: "0.75rem",
                lineHeight: 1,
                color: "var(--stagebook-text-muted, #6b7280)",
                whiteSpace: "nowrap",
                pointerEvents: "none",
              }}
            >
              {messages.sliderInstruction}
            </div>
          )}
          {/* Visible track. Centered in the click-target wrapper. */}
          <div
            className={trackClass}
            data-testid="slider-track"
            style={{
              position: "relative",
              width: "100%",
              height: `${TRACK_HEIGHT}px`,
              // backgroundColor lives in the class-scoped <style>
              // block so the hover rule isn't blocked by inline-style
              // specificity.
              borderRadius: `${TRACK_HEIGHT / 2}px`,
              transition:
                "background-color 120ms ease-out, box-shadow 120ms ease-out",
            }}
          >
            {/* Snap-point micro-ticks — subtle marks at every snap
                position. Sit centered on the track height so they
                read as "these are the discrete positions" without
                competing with the labeled ticks below. */}
            {snapTicks
              // Skip snap-tick positions that already get a labeled
              // tick — drawing both at the same X creates a subtle
              // visual jitter where the snap tick peeks out from
              // behind the labeled one.
              .filter((pt) => !labelPts.includes(pt))
              .map((pt) => (
                <div
                  key={`snap-${pt}`}
                  data-testid="slider-snap-tick"
                  style={{
                    position: "absolute",
                    insetInlineStart: `${getPosition(pt)}%`,
                    top: "50%",
                    transform: `translate(${isRTL ? "50%" : "-50%"}, -50%)`,
                    width: "2px",
                    height: `${TRACK_HEIGHT - 2}px`,
                    backgroundColor: "var(--stagebook-text-faint, #9ca3af)",
                    opacity: 0.4,
                    pointerEvents: "none",
                  }}
                />
              ))}

            {/* Labeled-position ticks — taller and more prominent than
                snap ticks so they read as "here are the named
                positions" first, with snap ticks giving the
                granularity context. */}
            {labelPts.map((pt) => (
              <div
                key={`tick-${pt}`}
                data-testid="slider-label-tick"
                style={{
                  position: "absolute",
                  insetInlineStart: `${getPosition(pt)}%`,
                  top: "50%",
                  transform: `translate(${isRTL ? "50%" : "-50%"}, -50%)`,
                  width: "2px",
                  height: `${TRACK_HEIGHT + 6}px`,
                  backgroundColor: "var(--stagebook-text-muted, #6b7280)",
                  pointerEvents: "none",
                }}
              />
            ))}

            {/* Range input — lives inside the track, positioned
                BEFORE the visible thumb in source order so the CSS
                general-sibling selector
                (input:focus-visible ~ [data-testid="slider-thumb"])
                can apply the focus ring. Visually invisible
                (opacity: 0) but handles keyboard + pointer
                interaction. */}
            {hasValue && (
              <input
                type="range"
                className={inputClass}
                min={min}
                max={max}
                step={interval}
                value={localValue}
                onChange={handleChange}
                // Safari excludes <input type=range> from the default
                // tab order unless macOS keyboard-nav is on; explicit
                // tabIndex overrides that so Safari participants can
                // keyboard-reach the slider thumb (#415 / #413).
                tabIndex={0}
                style={{
                  position: "absolute",
                  top: "50%",
                  insetInlineStart: 0,
                  width: "100%",
                  height: `${TRACK_HEIGHT}px`,
                  transform: "translateY(-50%)",
                  background: "transparent",
                  // Inherit the wrapper's `pointer` cursor — keeping
                  // the cursor consistent across the whole slider
                  // region. The earlier `ew-resize` here flickered
                  // as the participant moved their mouse, which
                  // read as distracting rather than informative.
                  cursor: "pointer",
                  WebkitAppearance: "none",
                  MozAppearance: "none",
                  opacity: 0,
                  margin: 0,
                  padding: 0,
                }}
                aria-label={messages.sliderLabel}
                aria-valuemin={min}
                aria-valuemax={max}
                aria-valuenow={localValue}
              />
            )}

            {/* Custom visible thumb — drawn after the input in source
                order so the focus-ring CSS rule can target it via the
                sibling combinator. Positioned via the same
                getPosition() the ticks use so thumb / tick alignment
                stays exact (#326). pointer-events: none lets clicks /
                drags pass through to the input below. */}
            {hasValue && (
              <div
                data-testid="slider-thumb"
                style={{
                  position: "absolute",
                  insetInlineStart: `${getPosition(localValue)}%`,
                  top: "50%",
                  transform: `translate(${isRTL ? "50%" : "-50%"}, -50%)`,
                  boxSizing: "border-box",
                  width: THUMB_SIZE,
                  height: THUMB_SIZE,
                  borderRadius: "50%",
                  background: "var(--stagebook-primary, #3b82f6)",
                  borderWidth: "2px",
                  borderStyle: "solid",
                  borderColor: "white",
                  // box-shadow lives in the class-scoped <style>
                  // block above so the focus-ring rule can stack on
                  // top of the elevation shadow.
                  pointerEvents: "none",
                  transition: "box-shadow 120ms ease-out",
                }}
              />
            )}
          </div>
        </div>

        {/* Labels — positioned below the click target, centered on
            their labeled tick (every label uses translateX(-50%),
            including endpoints). This is the dominant pattern in
            Material 3, MUI, Mantine, Radix-community-recipes, and
            macOS AppKit; survey-design literature is silent on
            label alignment specifically. Reserving horizontal
            padding on the outer wrapper (paddingLeft / paddingRight)
            lets endpoint labels center on their tick without
            overflowing the slider's box. Explicit min-height because
            the absolutely-positioned children give the container
            zero intrinsic height; without it the container collapses
            and the bottom padding overlaps the labels visually. */}
        {labelPts.length > 0 && (
          <div
            style={{
              position: "relative",
              width: "100%",
              marginTop: "0.125rem",
              minHeight: "2.5rem",
            }}
          >
            {labelPts.map((pt, idx) => {
              const pos = getPosition(pt);
              return (
                <div
                  key={`label-${pt}`}
                  style={{
                    position: "absolute",
                    insetInlineStart: `${pos}%`,
                    transform: `translateX(${isRTL ? "50%" : "-50%"})`,
                    textAlign: "center",
                    maxWidth: "8rem",
                    // 0.875rem reads as helper text without the
                    // jarring size gap that 0.75rem produces against
                    // a typical 1rem prompt body. Matches Material 3
                    // `body-small` and Mantine's mark-label size.
                    fontSize: "0.875rem",
                    lineHeight: 1.25,
                    color: "var(--stagebook-text-muted, #6b7280)",
                  }}
                >
                  {labels[idx]}
                </div>
              );
            })}
          </div>
        )}
      </div>

      <style>{`
        input[type="range"]::-webkit-slider-thumb {
          -webkit-appearance: none;
          appearance: none;
          width: 0;
          height: 0;
          background: transparent;
          border: none;
        }
        input[type="range"]::-moz-range-thumb {
          width: 0;
          height: 0;
          background: transparent;
          border: none;
        }
        input[type="range"]::-webkit-slider-runnable-track {
          width: 100%;
          height: 0;
          background: transparent;
        }
        input[type="range"]::-moz-range-track {
          width: 100%;
          height: 0;
          background: transparent;
        }
        input[type="range"]:focus {
          outline: none;
        }
      `}</style>
    </div>
  );
}
