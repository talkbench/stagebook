import React, { useId } from "react";

export interface ButtonProps {
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
}

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
  fontSize: "0.875rem",
  fontWeight: 500,
  borderRadius: "0.375rem",
  // The reduced-motion media query in the <style> block disables
  // these transitions.
  transition: "background-color 120ms ease-out, box-shadow 120ms ease-out",
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
}: ButtonProps) {
  const generatedId = useId();
  const buttonId = id || `button${generatedId}`;
  // useId returns an opaque string. Preventive sanitization for
  // future React versions — today's output (`:r0:` style) only has
  // colons outside the allowlist, but the regex covers anything
  // else that might land in there.
  const safeId = generatedId.replace(/[^a-zA-Z0-9_-]/g, "");
  const buttonClass = `stagebook-button-${safeId}`;

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
          background-color: var(--stagebook-primary, #3b82f6);
          border-color: transparent;
          box-shadow: 0 1px 2px 0 rgba(0, 0, 0, 0.05);
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
          background-color: var(--stagebook-primary-hover, #2563eb);
        }
        .${buttonClass}[data-variant="secondary"]:hover {
          background-color: var(--stagebook-hover-bg, #f3f4f6);
        }
        /* Active / pressed — a touch darker than hover. Provides
           tactile feedback during the click; without it the button
           feels unresponsive on slow clicks. */
        .${buttonClass}[data-variant="primary"]:active {
          background-color: var(--stagebook-primary-active, #1d4ed8);
        }
        .${buttonClass}[data-variant="secondary"]:active {
          background-color: var(--stagebook-bg-track, #e5e7eb);
        }
        /* :focus-visible so the focus ring appears only on keyboard
           navigation, not after a mouse click. Stacks on top of the
           base elevation shadow. */
        .${buttonClass}:focus-visible {
          outline: none;
          box-shadow:
            0 0 0 2px var(--stagebook-focus-ring, rgba(59, 130, 246, 0.25)),
            0 1px 2px 0 rgba(0, 0, 0, 0.05);
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
        style={{ ...baseInlineStyle, ...stateStyle, ...style }}
        id={buttonId}
        data-testid={dataTestId}
        disabled={disabled}
      >
        {children}
      </button>
    </>
  );
}
