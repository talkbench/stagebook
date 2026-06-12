import React, { useId } from "react";
import { useIsRTL } from "../StagebookProvider.js";

export interface CheckboxOption {
  key: string;
  value: string;
}

export type CheckboxLayout = "vertical" | "horizontal";

export interface CheckboxGroupProps {
  options: CheckboxOption[];
  value: string[];
  onChange: (selected: string[]) => void;
  label?: string;
  layout?: CheckboxLayout;
  id?: string;
  "data-testid"?: string;
}

// Checkbox input + row styling. Same pattern as RadioGroup (#368) —
// defensive structural rules live inline so they survive aggressive
// host CSS resets (Tailwind preflight, etc. — see issue #213).
// Pseudo-class behaviors (`:hover`, `:focus-visible`) live in a
// class-scoped `<style>` block since pseudo-classes can't be
// expressed in inline styles.
//
// `:focus-visible` (not `:focus`) so the focus ring appears only when
// the participant is navigating by keyboard — clicking with a mouse
// no longer leaves a lingering ring around the just-clicked option.

const checkboxBaseStyle: React.CSSProperties = {
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
  // border). Same root cause as #367 for RadioGroup.
  borderWidth: "1px",
  borderStyle: "solid",
  borderColor: "var(--stagebook-border, #d1d5db)",
  borderRadius: "0.125rem",
  backgroundColor: "var(--stagebook-surface, #fff)",
  backgroundSize: "100% 100%",
  backgroundPosition: "center",
  backgroundRepeat: "no-repeat",
  verticalAlign: "middle",
  cursor: "pointer",
  margin: 0,
};

// White check mark drawn via SVG data URI so no font / icon-set
// dependency is needed on the host.
const CHECKBOX_CHECK_SVG =
  "url(\"data:image/svg+xml,%3csvg viewBox='0 0 16 16' fill='white' xmlns='http://www.w3.org/2000/svg'%3e%3cpath d='M12.207 4.793a1 1 0 010 1.414l-5 5a1 1 0 01-1.414 0l-2-2a1 1 0 011.414-1.414L6.5 9.086l4.293-4.293a1 1 0 011.414 0z'/%3e%3c/svg%3e\")";

const checkboxCheckedStyle: React.CSSProperties = {
  backgroundColor: "var(--stagebook-primary, #3b82f6)",
  borderColor: "var(--stagebook-primary, #3b82f6)",
  backgroundImage: CHECKBOX_CHECK_SVG,
};

const checkboxRowStyle: React.CSSProperties = {
  fontWeight: 400,
  fontSize: "0.875rem",
  color: "var(--stagebook-text-muted, #6b7280)",
  cursor: "pointer",
  display: "flex",
  alignItems: "center",
  gap: "0.5rem",
  // Touch-target sizing — see RadioGroup for the rationale. Defaults
  // to 36px via `--stagebook-row-min-height`; hosts targeting
  // mobile-first can override to 2.75rem to hit HIG's 44px.
  minHeight: "var(--stagebook-row-min-height, 2.25rem)",
  padding: "0.25rem 0.5rem",
  borderRadius: "0.375rem",
  // Smooth hover-fill transition; respects prefers-reduced-motion
  // via the media query in the style block below.
  transition: "background-color 120ms ease-out",
};

export function CheckboxGroup({
  options,
  value = [],
  onChange,
  label = "",
  layout = "vertical",
  id,
  "data-testid": dataTestId,
}: CheckboxGroupProps) {
  const isRTL = useIsRTL();
  // Stable per-instance id for the group + label association.
  const reactId = useId();
  // `useId` returns an opaque string the React docs explicitly call
  // "not a valid HTML id/class on its own". Strip anything outside
  // the class-name-safe set rather than just `:` so the regex doesn't
  // drift if React's format changes underneath us.
  const safeId = reactId.replace(/[^a-zA-Z0-9_-]/g, "");
  const rowClass = `stagebook-checkbox-row-${safeId}`;
  const inputClass = `stagebook-checkbox-input-${safeId}`;
  const groupId = id ?? `checkboxGroup-${reactId}`;
  const labelId = `${groupId}-label`;
  // `data-testid` keeps the literal default ("checkboxGroup") for
  // back-compat with existing tests; only the HTML `id` needs to be
  // DOM-unique.
  const testId = dataTestId ?? "checkboxGroup";

  const handleToggle = (key: string) => {
    const selectedSet = new Set(value);
    if (selectedSet.has(key)) {
      selectedSet.delete(key);
    } else {
      selectedSet.add(key);
    }
    onChange(Array.from(selectedSet));
  };

  return (
    <div data-testid={testId} style={{ marginTop: "1rem" }}>
      <style>{`
        .${rowClass}:hover {
          background-color: var(--stagebook-hover-bg, #f3f4f6);
        }
        .${inputClass}:focus-visible {
          outline: none;
          box-shadow: 0 0 0 2px var(--stagebook-focus-ring, rgba(59, 130, 246, 0.25));
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
        dir={isRTL ? "rtl" : "ltr"}
        // ARIA — `role="group"` (not "checkboxgroup", which isn't a
        // real ARIA role) so a screen reader announces the
        // collection of checkboxes as a labelled group rather than
        // as loose siblings. Native `<input type="checkbox">` already
        // conveys `aria-checked` via its `:checked` state.
        role="group"
        aria-labelledby={label ? labelId : undefined}
        style={{
          marginInlineStart: "1.25rem",
          display: layout === "horizontal" ? "flex" : "grid",
          gap: layout === "horizontal" ? "1rem" : "0.125rem",
          flexWrap: layout === "horizontal" ? "wrap" : undefined,
        }}
      >
        {options.map(({ key, value: optionValue }) => {
          const checked = value.includes(key);
          return (
            <label
              key={`${groupId}_${key}`}
              data-testid="option"
              className={rowClass}
              style={checkboxRowStyle}
            >
              <input
                type="checkbox"
                className={inputClass}
                name={key}
                value={key}
                id={`${groupId}_${key}`}
                checked={checked}
                onChange={() => handleToggle(key)}
                // Safari excludes <input type=checkbox> from the
                // default tab order unless macOS keyboard-nav is on;
                // explicit tabIndex overrides that (#415 / #413).
                tabIndex={0}
                style={{
                  ...checkboxBaseStyle,
                  ...(checked ? checkboxCheckedStyle : {}),
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
