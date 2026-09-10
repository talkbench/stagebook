import React, { useId } from "react";
import { focusRingCss, focusInsetOutlineCss } from "../focusRing.js";

export interface SelectOption {
  key: string;
  value: string;
  disabled?: boolean;
  hidden?: boolean;
}

export interface SelectProps {
  options: SelectOption[];
  value?: string;
  onChange: (e: React.ChangeEvent<HTMLSelectElement>) => void;
  label?: string;
  /**
   * When provided, a leading disabled placeholder option is rendered
   * with this text as its label. The placeholder uses an internal
   * sentinel value (not the empty string) so it can't collide with a
   * real option whose `key` happens to be `""`. Useful as a "Pick
   * one…" prompt before the participant has made a selection. Omit to
   * render only the real options (the first becomes the browser's
   * implicit default).
   */
  placeholder?: string;
  id?: string;
  /**
   * Space-separated id list forwarded to the `<select>`'s
   * `aria-labelledby`. Use when the accessible name lives in existing
   * visible content (e.g. a prompt body) rather than the `label` prop —
   * naming the control without rendering a duplicate visible label.
   * Pass this *instead of* `label`, not alongside it: the visible
   * `<label>` is gated solely on `label`, so if both are set a caption
   * still renders and `aria-labelledby` wins the accessible name. See
   * #545.
   */
  ariaLabelledBy?: string;
  /**
   * Forwarded as the `disabled` attribute on the `<select>` (#620). The
   * control keeps rendering — its options, its placeholder — but can't
   * take focus or open, and the visible label takes the muted colour.
   * Same name and semantics as `Button`'s `disabled` and
   * `SelectOption.disabled`, so there is one vocabulary.
   *
   * Use it to hold a picker still while its options are in flight. An
   * empty picker (`options={[]}` plus a `placeholder` carrying the state
   * message) is otherwise an *enabled* `<select>` with nothing
   * selectable — it takes focus and opens to a single grey line, and
   * reads as a working control that happens to be empty rather than one
   * that is waiting.
   */
  disabled?: boolean;
  "data-testid"?: string;
}

/**
 * Sentinel value used internally for the placeholder option, when
 * present. Picked to be unambiguously not a researcher-authored key —
 * the embedded `${...}` placeholder syntax would never appear in a
 * real option key, and the `__stagebook` prefix scopes it.
 */
const PLACEHOLDER_VALUE = "__stagebook_select_placeholder__";

// Trigger styling. Pattern matches RadioGroup / CheckboxGroup
// (#368/#369): defensive structural rules live inline so they survive
// aggressive host CSS resets (#213); the `:focus-visible` ring lives
// in a class-scoped `<style>` block since pseudo-classes can't be
// expressed inline.
//
// `appearance` is the one structural rule NOT inlined, on purpose (#627).
// The options list is opted into the customizable select —
// `appearance: base-select` — which moves it from the OS-drawn popup
// (offset over the control on macOS, dark under an incognito window, and
// deaf to our tokens) into the page: a top-layer popover anchored under
// the trigger and painted with the same palette. That opt-in needs a
// parse-time fallback, `none` for engines without it, and inline styles
// can't carry two values of one property; nor can an inline `none` be
// left in place, since it would beat the class rule and switch the
// feature off everywhere. So both declarations live in the scoped
// `<style>` block, still class-scoped and still emitted by the component,
// so a host that never loads styles.css is covered as before.
//
// `:focus-visible` (not `:focus`) so the focus ring appears for
// keyboard navigation. Note: Chromium/Firefox/Safari all also apply
// `:focus-visible` after a mouse click on `<select>` because the open
// dropdown is keyboard-navigable (combobox-style trigger) — that's
// correct browser behavior, not a regression. No hover affordance on
// the trigger itself — shadcn / Radix don't add one either; the
// caret arrow is a sufficient interactivity signal.

const selectBaseStyle: React.CSSProperties = {
  // Pinned on the control itself, not only at :root (styles.css, #535):
  // a native popup follows its <select>'s scheme, so this holds on the
  // native path for a host that never loads our stylesheet or nests the
  // control under something that sets a scheme. Under base-select the
  // in-page picker inherits it, which keeps its scrollbar light too.
  colorScheme: "light",
  width: "100%",
  // One line, clipped. The native trigger clips a long label anyway; the
  // base-select trigger is a flex box that would wrap and grow, breaking
  // the row an icon Button is sized to share (#622). The ellipsis only
  // draws where the engine gives the label a block box of its own — under
  // base-select the label sits in an anonymous flex item and is clipped
  // flat, which is what the native trigger does too.
  whiteSpace: "nowrap",
  overflow: "hidden",
  textOverflow: "ellipsis",
  // Touch-target sizing — reuses the same token as RadioGroup /
  // CheckboxGroup so the three families agree on row height.
  boxSizing: "border-box",
  minHeight: "var(--stagebook-row-min-height, 2.75rem)",
  padding: "0.5rem 2rem 0.5rem 0.75rem",
  // Border longhands rather than the `border` shorthand. The focus
  // state below overrides `borderColor` (longhand); mixing shorthand
  // with a longhand override breaks React's inline-style diff — when
  // the longhand drops out of the next render, React clears the
  // individual longhand properties and the shorthand's expansion is
  // lost, leaving the browser's appearance:none default (black
  // border). Same root cause as #367 for RadioGroup.
  borderWidth: "1px",
  borderStyle: "solid",
  borderColor: "var(--stagebook-border, #d1d5db)",
  borderRadius: "0.375rem",
  backgroundColor: "var(--stagebook-surface, #fff)",
  color: "var(--stagebook-text, #1f2937)",
  // Pin the font: same fix as TextArea (#399). Native <select>
  // also picks up the browser UA default font otherwise.
  fontFamily:
    'var(--stagebook-font, "Inter", ui-sans-serif, system-ui, sans-serif)',
  fontSize: "0.875rem",
  lineHeight: "1.25rem",
  cursor: "pointer",
  // The focus box-shadow transition lives in the class-scoped <style>
  // block, not here: an inline `transition` outranks the class rule
  // that turns it off under prefers-reduced-motion, so that override
  // never applied (#630).
};

export function Select({
  options,
  value,
  onChange,
  label = "",
  placeholder,
  id,
  ariaLabelledBy,
  disabled = false,
  "data-testid": dataTestId,
}: SelectProps) {
  // Generate a unique id when the caller doesn't provide one — multiple
  // <Select> instances on the same page (device pickers, repeated
  // dropdowns) would otherwise share a default id and break
  // `<label htmlFor>` association + `data-testid` uniqueness.
  // Pattern matches Button/TextArea (#181 review).
  const generatedId = useId();
  const selectId = id ?? `select${generatedId}`;
  // `useId` returns an opaque string the React docs call "not a valid
  // HTML id/class on its own". Strip anything outside the class-name-
  // safe set so the regex doesn't drift if React's format changes.
  const safeId = generatedId.replace(/[^a-zA-Z0-9_-]/g, "");
  const triggerClass = `stagebook-select-trigger-${safeId}`;
  const chevronClass = `stagebook-select-chevron-${safeId}`;

  // Always-controlled value. When the caller hasn't set `value`, pass
  // the placeholder sentinel (if a placeholder exists) or an empty
  // string. Never pass `undefined` — that flips the <select> to
  // uncontrolled and triggers a controlled/uncontrolled warning the
  // first time `value` is set.
  const currentValue =
    value ?? (placeholder !== undefined ? PLACEHOLDER_VALUE : "");

  // Intercept onChange when the placeholder is selected — the
  // sentinel value is never a real choice, so callers shouldn't see
  // it in their `e.target.value`. (In practice the placeholder is
  // `disabled` so the user can't select it — defense in depth.)
  const handleChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    if (e.target.value === PLACEHOLDER_VALUE) return;
    onChange(e);
  };

  // Disabled treatment mirrors Button (half opacity, not-allowed
  // cursor). The UA greys a disabled <select> on its own, but our
  // explicit `color` / `backgroundColor` are author-origin and beat the
  // UA's `:disabled` rule, so without this a disabled picker would look
  // exactly like an enabled one. No `pointer-events: none` — a disabled
  // <select> already can't open, and the cursor is the visible cue.
  const stateStyle: React.CSSProperties = disabled
    ? { cursor: "not-allowed", opacity: 0.5 }
    : {};

  return (
    <div>
      <style>{`
        /* Doubled selector, (0,2,0): inline, this rule was untouchable
         * short of !important, and a host reset such as
         * ".form select { appearance: auto }" is (0,1,1) — enough to beat
         * a single class, and it would put the native arrow back under
         * our chevron. Doubling keeps the #213 property without
         * !important — deliberately not !important itself, so a host that
         * wants the OS picker back (on phones, say) can still take it at
         * higher specificity. */
        .${triggerClass}.${triggerClass} {
          -webkit-appearance: none;
          appearance: none;
          appearance: base-select;
        }
        .${triggerClass} {
          transition: box-shadow 120ms ease-out;
        }
        .${chevronClass} {
          color: var(--stagebook-select-chevron, #6b7280);
        }
        @media (forced-colors: active) {
          .${chevronClass} { color: ButtonText; }
          .${triggerClass}:disabled + .${chevronClass} { color: GrayText; }
        }
        .${triggerClass}:focus-visible {
          ${focusRingCss()}
        }
        @media (prefers-reduced-motion: reduce) {
          .${triggerClass} {
            transition: none;
          }
        }
        @supports (appearance: base-select) {
          /* The engine's own disclosure icon. Ours is the SVG beside
           * the trigger, which is what the native path shows
           * too, so hide this one rather than double up. */
          .${triggerClass}::picker-icon {
            display: none;
          }
          /* The picker: the UA anchors it under the trigger and flips it
           * above when there is no room. It only floors the width at the
           * trigger's (min-inline-size: anchor-size(self-inline)) and
           * would grow to the widest label, off the viewport; capping it
           * at the same size pins the picker to the width the participant
           * already read the control at, and long labels wrap into taller
           * rows instead. The block margins clear the trigger's 4px focus
           * halo on whichever side the picker opens. It inherits font,
           * colour and color-scheme from the <select>. */
          .${triggerClass}::picker(select) {
            appearance: base-select;
            max-inline-size: anchor-size(self-inline);
            margin-block: 0.25rem;
            padding: 0.25rem;
            border: 1px solid var(--stagebook-border, #d1d5db);
            border-radius: 0.375rem;
            background-color: var(--stagebook-surface, #fff);
            color: var(--stagebook-text, #1f2937);
            box-shadow:
              0 4px 6px -1px rgba(0, 0, 0, 0.1),
              0 2px 4px -2px rgba(0, 0, 0, 0.1);
          }
          /* Rows: the RadioGroup / CheckboxGroup row treatment, so the
           * three families agree on height, hover and the host's lever
           * for raising the target size (--stagebook-row-min-height).
           * Full text colour rather than the muted caption colour those
           * rows use: these are the answer set, not labels beside it. */
          .${triggerClass} option {
            display: flex;
            align-items: center;
            gap: 0.5rem;
            /* The 44px target includes padding; long option labels can
             * grow beyond that minimum (#632). */
            box-sizing: border-box;
            min-height: var(--stagebook-row-min-height, 2.75rem);
            padding: 0.25rem 0.5rem;
            border-radius: 0.375rem;
            color: var(--stagebook-text, #1f2937);
            /* The UA keeps option text on one line; these rows wrap. */
            white-space: normal;
            overflow-wrap: anywhere;
            cursor: pointer;
            transition: background-color 120ms ease-out;
          }
          .${triggerClass} option:hover,
          .${triggerClass} option:focus-visible {
            background-color: var(--stagebook-hover-bg, #f3f4f6);
          }
          /* The walked row's indicator: the inset outline, not the outer
           * halo — see focusInsetOutlineCss for why. */
          .${triggerClass} option:focus-visible {
            ${focusInsetOutlineCss()}
          }
          /* The UA reserves the checkmark slot on every row and shows the
           * glyph on the checked one only, so text stays aligned. */
          .${triggerClass} option::checkmark {
            color: var(--stagebook-primary, #2563eb);
          }
          /* The placeholder sentinel is "checked" while nothing has been
           * chosen; a tick beside "Pick one…" would read as a choice made. */
          .${triggerClass} option[value="${PLACEHOLDER_VALUE}"]::checkmark {
            visibility: hidden;
          }
          .${triggerClass} option:disabled {
            color: var(--stagebook-text-muted, #626977);
            background-color: transparent;
            cursor: not-allowed;
          }
          @media (prefers-reduced-motion: reduce) {
            .${triggerClass} option {
              transition: none;
            }
          }
        }
      `}</style>
      {label && (
        <label
          htmlFor={selectId}
          style={{
            display: "block",
            fontSize: "1rem",
            fontWeight: 500,
            // Muted while disabled — the same token the RadioGroup /
            // CheckboxGroup captions use — so the label reads as part of
            // the held control, not a live prompt above a dead one.
            color: disabled
              ? "var(--stagebook-text-muted, #626977)"
              : "var(--stagebook-text, #1f2937)",
            marginBottom: "0.5rem",
          }}
        >
          {label}
        </label>
      )}
      {/* The grid keeps the overlay centered on the control, excluding the
          label. The SVG ignores pointer events so the native select owns clicks. */}
      <div style={{ position: "relative", display: "grid" }}>
        <select
          id={selectId}
          // On the <select>, not the wrapper: the testid names the
          // element a test drives, and Playwright's selectOption()
          // requires a real <select> (inputValue(), a form control), so
          // both throw on a wrapper <div> (#601). Same placement as
          // Button. Composite controls (RadioGroup, CheckboxGroup) keep
          // theirs on the group wrapper — no single element to name.
          data-testid={dataTestId ?? selectId}
          className={triggerClass}
          value={currentValue}
          onChange={handleChange}
          aria-labelledby={ariaLabelledBy}
          disabled={disabled}
          style={{ ...selectBaseStyle, ...stateStyle }}
        >
          {placeholder !== undefined && (
            <option value={PLACEHOLDER_VALUE} disabled>
              {placeholder}
            </option>
          )}
          {options
            .filter((option) => !option.hidden)
            .map((option) => (
              <option
                key={`${selectId}_${option.key}`}
                value={option.key}
                disabled={option.disabled}
              >
                {option.value}
              </option>
            ))}
        </select>
        <svg
          data-testid="select-chevron"
          className={chevronClass}
          aria-hidden="true"
          focusable="false"
          viewBox="0 0 20 20"
          style={{
            position: "absolute",
            top: "50%",
            // Match the old background image's padding-box origin.
            right: "calc(0.5rem + 1px)",
            transform: "translateY(-50%)",
            fontSize: "0.875rem",
            width: "1.25em",
            height: "1.25em",
            fill: "currentColor",
            pointerEvents: "none",
            opacity: disabled ? 0.5 : 1,
          }}
        >
          <path
            fillRule="evenodd"
            clipRule="evenodd"
            d="M5.23 7.21a.75.75 0 011.06.02L10 11.06l3.71-3.83a.75.75 0 111.08 1.04l-4.25 4.4a.75.75 0 01-1.08 0L5.21 8.27a.75.75 0 01.02-1.06z"
          />
        </svg>
      </div>
    </div>
  );
}
