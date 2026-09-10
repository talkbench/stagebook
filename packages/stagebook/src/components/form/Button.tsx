import React, { useEffect, useId } from "react";
import { focusRingCss } from "../focusRing.js";

interface ButtonBaseProps {
  children: React.ReactNode;
  onClick?: React.MouseEventHandler<HTMLButtonElement> | null;
  className?: string;
  style?: React.CSSProperties;
  primary?: boolean;
  type?: "button" | "submit" | "reset";
  autoFocus?: boolean;
  disabled?: boolean;
  id?: string;
  "data-testid"?: string;
  /**
   * Native tooltip, forwarded verbatim to the `<button>` (#621). A
   * tooltip is never the accessible name — touch and screen-reader users
   * don't get it — so an icon-only button still needs `aria-label`.
   */
  title?: string;
}

/** A text button: its children are its accessible name. */
export interface TextButtonProps extends ButtonBaseProps {
  icon?: false;
  /**
   * Overrides the name computed from the children (#621). Forwarded
   * verbatim, so an absent prop is an absent attribute and the text
   * button's DOM is unchanged. When set, it must contain the visible text
   * (WCAG 2.5.3, Label in Name) or voice-control users can't activate the
   * button by what they see.
   */
  "aria-label"?: string;
}

/**
 * An icon-only button (#622): a square, glyph-sized target sharing the
 * text button's variants, tokens, focus halo and disabled treatment.
 *
 * `aria-label` is required — a glyph has no text to name the button by
 * (WCAG 4.1.2) — and the glyph itself should be `aria-hidden`, so the
 * name is the label alone. Draw it in `currentColor` and it inherits the
 * variant's text colour, which clears 3:1 on both fills (WCAG 1.4.11).
 * `title` may repeat the label as a tooltip; it never replaces it.
 */
export interface IconButtonProps extends ButtonBaseProps {
  icon: true;
  "aria-label": string;
}

export type ButtonProps = TextButtonProps | IconButtonProps;

// Structural / dimensional styles live inline so the button survives
// aggressive host CSS resets (#213). State-dependent properties
// (background-color, box-shadow, border-color) live in the
// class-scoped <style> block instead — keeping them inline would
// have made the hover / focus-visible / active rules lose
// specificity and never apply (same trap I hit on Slider / TextArea).
//
// The Button ships as SubmitButton on every stage, so it's the most
// visible component in the form-input family.

const baseInlineStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  padding: "0.5rem 1rem",
  // Border longhands rather than the `border` shorthand — same #367
  // fix pattern as the sibling form components.
  borderWidth: "1px",
  borderStyle: "solid",
  // Pin the font for the same reason as TextArea / Select (#399) —
  // bare <button> can pick up a UA-default that drifts cross-browser.
  fontFamily:
    'var(--stagebook-font, "Inter", ui-sans-serif, system-ui, sans-serif)',
  fontSize: "0.875rem",
  fontWeight: 500,
  borderRadius: "0.375rem",
  // The hover / focus transitions live in the class-scoped <style>
  // block, not here: an inline `transition` outranks the class rule
  // that turns them off under prefers-reduced-motion, so that override
  // never applied (#630).
};

// Icon-only geometry (#622), layered over the base style. The box is a
// Select's, spelled out: its 1.25rem line-height plus 0.5rem padding
// above and below plus a 1px border each side (38px), with the same
// row-height token as its floor — so an icon button is level with a
// Select in the same row by construction, and stays level when a host
// raises the token for touch. Square by pinning both axes rather than via
// `aspect-ratio`, whose min-size transfer differs across engines. Padding
// is zero and the glyph is flex-centered: a 1.25rem glyph leaves 0.5rem
// on every side, comfortably over the 24×24 floor of WCAG 2.5.8.
// Addition only, one term per contribution: line-height, padding above,
// padding below, both borders.
const ICON_BOX = "calc(1.25rem + 0.5rem + 0.5rem + 2px)";
const ICON_BOX_MIN = "var(--stagebook-row-min-height, 2.25rem)";
const iconInlineStyle: React.CSSProperties = {
  width: ICON_BOX,
  height: ICON_BOX,
  minWidth: ICON_BOX_MIN,
  minHeight: ICON_BOX_MIN,
  boxSizing: "border-box",
  padding: 0,
  justifyContent: "center",
  // A one-character text glyph ("+", "?") would otherwise sit on a
  // normal line box and look low in the square.
  lineHeight: 1,
  // A flex child with an explicit width still shrinks toward its
  // min-content once a sibling claims 100% — exactly the "full-width
  // Select plus a refresh control" row this is for.
  flexShrink: 0,
};

export function Button({
  children,
  onClick = null,
  className = "",
  style = {},
  primary = true,
  type = "button",
  autoFocus = false,
  disabled = false,
  id = "",
  "data-testid": dataTestId,
  icon = false,
  "aria-label": ariaLabel,
  title,
}: ButtonProps) {
  const generatedId = useId();
  const buttonId = id || `button${generatedId}`;
  // useId returns an opaque string. Preventive sanitization for
  // future React versions — today's output (`:r0:` style) only has
  // colons outside the allowlist, but the regex covers anything
  // else that might land in there.
  const safeId = generatedId.replace(/[^a-zA-Z0-9_-]/g, "");
  const buttonClass = `stagebook-button-${safeId}`;

  // The type already refuses an icon button without a name; this is for
  // JS consumers, who never see the type. Trimmed, because the accessible-
  // name computation collapses whitespace: a label of spaces names nothing,
  // same as an empty string. It reports rather than throws — a nameless
  // button is a defect to fix, not a reason to take the stage down
  // mid-session. Effect, not render body, so it fires once per change
  // rather than on every re-render.
  useEffect(() => {
    if (icon && !ariaLabel?.trim()) {
      console.error(
        "[Stagebook] <Button icon> has no aria-label. An icon-only button has no text to name it by — pass aria-label (title is a tooltip, not a name).",
      );
    }
  }, [icon, ariaLabel]);

  const stateStyle: React.CSSProperties = disabled
    ? {
        cursor: "not-allowed",
        opacity: 0.5,
        // Belt-and-suspenders: the `disabled` attr on the <button>
        // already prevents click events, but `pointer-events: none`
        // additionally guards against hover-state CSS firing on a
        // disabled button (which would visually contradict the
        // "disabled" semantic).
        pointerEvents: "none",
      }
    : {
        cursor: "pointer",
      };

  const variant = primary ? "primary" : "secondary";

  return (
    <>
      <style>{`
        /* Base + variant fills. Live in CSS (not inline) so the
           hover / active / focus-visible rules below can override
           background-color and box-shadow. */
        .${buttonClass} {
          color: #fff;
          background-color: var(--stagebook-primary, #2563eb);
          border-color: transparent;
          box-shadow: 0 1px 2px 0 rgba(0, 0, 0, 0.05);
          transition:
            background-color 120ms ease-out,
            box-shadow 120ms ease-out;
        }
        .${buttonClass}[data-variant="secondary"] {
          color: var(--stagebook-text-secondary, #374151);
          background-color: #fff;
          border-color: var(--stagebook-border, #d1d5db);
        }
        /* Hover — subtly darkens the fill. Primary shifts to the
           one-step-darker brand color (--stagebook-primary-hover,
           already a token for theming consistency). Secondary tints
           with --stagebook-hover-bg, the same token Radio /
           Checkbox rows use for their hover. */
        .${buttonClass}[data-variant="primary"]:hover {
          background-color: var(--stagebook-primary-hover, #1d4ed8);
        }
        .${buttonClass}[data-variant="secondary"]:hover {
          background-color: var(--stagebook-hover-bg, #f3f4f6);
        }
        /* Active / pressed — a touch darker than hover. Provides
           tactile feedback during the click; without it the button
           feels unresponsive on slow clicks. */
        .${buttonClass}[data-variant="primary"]:active {
          background-color: var(--stagebook-primary-active, #1e40af);
        }
        .${buttonClass}[data-variant="secondary"]:active {
          background-color: var(--stagebook-bg-track, #e5e7eb);
        }
        /* :focus-visible so the focus ring appears only on keyboard
           navigation, not after a mouse click. Stacks on top of the
           base elevation shadow. */
        .${buttonClass}:focus-visible {
          ${focusRingCss("0 1px 2px 0 rgba(0, 0, 0, 0.05)")}
        }
        @media (prefers-reduced-motion: reduce) {
          .${buttonClass} {
            transition: none;
          }
        }
      `}</style>
      <button
        type={type}
        onClick={onClick ?? undefined}
        className={`${buttonClass} ${className}`.trim()}
        data-variant={variant}
        autoFocus={autoFocus}
        // Explicit tabIndex={0} so Safari includes the button in the
        // Tab order. macOS Safari's default keyboard navigation skips
        // <button> (and <a>) unless the system "Use keyboard
        // navigation" preference is on — explicit tabindex overrides
        // that, so participants on Safari can keyboard-reach the
        // SubmitButton and other Stagebook buttons (#415 / #413).
        tabIndex={disabled ? -1 : 0}
        style={{
          ...baseInlineStyle,
          ...(icon ? iconInlineStyle : undefined),
          ...stateStyle,
          ...style,
        }}
        id={buttonId}
        data-testid={dataTestId}
        disabled={disabled}
        // Forwarded verbatim: React drops an undefined attribute, so a
        // text button with neither prop renders neither (#621).
        aria-label={ariaLabel}
        title={title}
      >
        {children}
      </button>
    </>
  );
}
