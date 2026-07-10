import React, { useId } from "react";
import { useIsRTL } from "../StagebookProvider.js";

export interface RadioOption {
  key: string;
  value: string;
}

export type RadioLayout = "vertical" | "horizontal";

export interface RadioGroupProps {
  options: RadioOption[];
  value?: string;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  label?: string;
  layout?: RadioLayout;
  id?: string;
  "data-testid"?: string;
}

// Radio input + row styling. Defensive structural rules live inline so
// they survive aggressive host CSS resets (Tailwind preflight, etc. —
// see issue #213). Pseudo-class behaviors (`:hover`, `:focus-visible`)
// live in a class-scoped `<style>` block — pseudo-classes can't be
// expressed in inline styles, and these rules don't need to survive
// host overrides at the same level the structural rules do.
//
// `:focus-visible` (not `:focus`) so the focus ring appears only when
// the participant is navigating by keyboard — clicking with a mouse
// no longer leaves a lingering ring around the just-clicked option.

const radioBaseStyle: React.CSSProperties = {
  appearance: "none",
  WebkitAppearance: "none",
  width: "1rem",
  height: "1rem",
  flexShrink: 0,
  // Border longhands rather than the `border` shorthand. The checked
  // state below overrides `borderColor` (longhand); mixing shorthand
  // with a longhand override breaks React's inline-style diff — when
  // the longhand drops out of the next render, React clears the
  // individual longhand properties and the shorthand's expansion is
  // lost, leaving the browser's appearance:none default (black
  // border). See #367 for the repro.
  borderWidth: "1px",
  borderStyle: "solid",
  borderColor: "var(--stagebook-border, #d1d5db)",
  borderRadius: "9999px",
  backgroundColor: "var(--stagebook-surface, #fff)",
  backgroundSize: "100% 100%",
  backgroundPosition: "center",
  backgroundRepeat: "no-repeat",
  verticalAlign: "middle",
  cursor: "pointer",
  margin: 0,
};

// Inner dot (white) drawn via SVG data URI so no font / icon-set
// dependency is needed on the host.
const RADIO_DOT_SVG =
  "url(\"data:image/svg+xml,%3csvg viewBox='0 0 16 16' fill='white' xmlns='http://www.w3.org/2000/svg'%3e%3ccircle cx='8' cy='8' r='3'/%3e%3c/svg%3e\")";

const radioCheckedStyle: React.CSSProperties = {
  backgroundColor: "var(--stagebook-primary, #2563eb)",
  borderColor: "var(--stagebook-primary, #2563eb)",
  backgroundImage: RADIO_DOT_SVG,
};

const radioRowStyle: React.CSSProperties = {
  fontWeight: 400,
  fontSize: "0.875rem",
  color: "var(--stagebook-text-muted, #6b7280)",
  cursor: "pointer",
  display: "flex",
  alignItems: "center",
  gap: "0.5rem",
  // Touch-target sizing — HIG / Material both recommend ~44px for
  // pointer-coarse targets; 2.25rem (36px) balances target size
  // against vertical density on long Likert-style scales. Hosts that
  // want a different target size (e.g., mobile-first deployments
  // wanting full 44px) override via `--stagebook-row-min-height`.
  // Padding bakes into the hover-fill area so the visual affordance
  // covers the full clickable region.
  minHeight: "var(--stagebook-row-min-height, 2.25rem)",
  padding: "0.25rem 0.5rem",
  borderRadius: "0.375rem",
  // Smooth the hover-fill transition; respects prefers-reduced-motion
  // via the media query in the style block below.
  transition: "background-color 120ms ease-out",
};

export function RadioGroup({
  options,
  value,
  onChange,
  label = "",
  layout = "vertical",
  id,
  "data-testid": dataTestId,
}: RadioGroupProps) {
  const isRTL = useIsRTL();
  // Stable per-instance id for the radiogroup + label association.
  // `useId` guarantees uniqueness even when multiple RadioGroups
  // render on the same page without explicit `id` props — so the
  // `name=` HTML attribute (which scopes the native radio group)
  // doesn't accidentally merge two groups into one.
  const reactId = useId();
  // `useId` returns an opaque string the React docs explicitly call
  // "not a valid HTML id/class on its own" — today it contains `:`
  // (e.g. `:r0:`), and future React versions may introduce other
  // CSS-unsafe characters. Strip anything outside the class-name-safe
  // set rather than just `:` so the regex doesn't drift if React's
  // format changes underneath us.
  const safeId = reactId.replace(/[^a-zA-Z0-9_-]/g, "");
  const rowClass = `stagebook-radio-row-${safeId}`;
  const inputClass = `stagebook-radio-input-${safeId}`;
  const groupId = id ?? `radioGroup-${reactId}`;
  const labelId = `${groupId}-label`;
  // `data-testid` keeps the literal default ("radioGroup") for
  // back-compat with existing tests; only the HTML `id`/`name` need
  // to be DOM-unique.
  const testId = dataTestId ?? "radioGroup";

  return (
    <div
      data-testid={testId}
      dir={isRTL ? "rtl" : "ltr"}
      style={{ marginTop: "1rem" }}
    >
      <style>{`
        .${rowClass}:hover {
          background-color: var(--stagebook-hover-bg, #f3f4f6);
        }
        .${inputClass}:focus-visible {
          outline: none;
          box-shadow: 0 0 0 2px var(--stagebook-focus-ring, rgba(37, 99, 235, 0.25));
        }
        @media (prefers-reduced-motion: reduce) {
          .${rowClass} {
            transition: none;
          }
        }
      `}</style>
      {label && (
        <label
          id={labelId}
          htmlFor={groupId}
          style={{
            display: "block",
            fontSize: "1rem",
            fontWeight: 500,
            color: "var(--stagebook-text, #1f2937)",
            marginBottom: "0.5rem",
          }}
        >
          {label}
        </label>
      )}
      <div
        role="radiogroup"
        aria-labelledby={label ? labelId : undefined}
        style={{
          marginInlineStart: "1.25rem",
          display: layout === "horizontal" ? "flex" : "grid",
          gap: layout === "horizontal" ? "1rem" : "0.125rem",
          flexWrap: layout === "horizontal" ? "wrap" : undefined,
        }}
      >
        {options.map(({ key, value: optionValue }) => {
          const checked = value === key;
          return (
            <label
              key={`${groupId}_${key}`}
              data-testid="option"
              className={rowClass}
              style={radioRowStyle}
            >
              <input
                type="radio"
                className={inputClass}
                // Shared `name` so the browser treats these as one
                // radio group (arrow-key navigation between options +
                // AT grouping semantics). Scoped to `groupId` so
                // multiple RadioGroup instances on the same page
                // don't collide.
                name={groupId}
                value={key}
                checked={checked}
                onChange={onChange}
                // Safari excludes <input type=radio> from the default
                // tab order unless macOS keyboard-nav is on; explicit
                // tabIndex overrides that. The browser's native
                // arrow-key navigation within the group still works
                // (#415 / #413).
                tabIndex={0}
                style={{
                  ...radioBaseStyle,
                  ...(checked ? radioCheckedStyle : {}),
                }}
              />
              {optionValue}
            </label>
          );
        })}
      </div>
    </div>
  );
}
