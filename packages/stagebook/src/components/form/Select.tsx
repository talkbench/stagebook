import React, { useId, useState } from "react";

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
  "data-testid"?: string;
}

/**
 * Sentinel value used internally for the placeholder option, when
 * present. Picked to be unambiguously not a researcher-authored key —
 * the embedded `${...}` placeholder syntax would never appear in a
 * real option key, and the `__stagebook` prefix scopes it.
 */
const PLACEHOLDER_VALUE = "__stagebook_select_placeholder__";

// Inline styles match the RadioGroup / CheckboxGroup theming (focus
// ring, label color, border) so the Select renders consistently on
// any host without depending on host CSS resets.

const selectBaseStyle: React.CSSProperties = {
  appearance: "none",
  WebkitAppearance: "none",
  MozAppearance: "none",
  width: "100%",
  padding: "0.5rem 2rem 0.5rem 0.75rem",
  border: "1px solid var(--stagebook-border, #d1d5db)",
  borderRadius: "0.375rem",
  backgroundColor: "var(--stagebook-surface, #fff)",
  color: "var(--stagebook-text, #1f2937)",
  fontSize: "0.875rem",
  lineHeight: "1.25rem",
  cursor: "pointer",
  // Caret SVG drawn inline so no font / icon dependency is needed.
  // The `none` appearance removes the platform native arrow; this
  // fills in for it.
  backgroundImage:
    "url(\"data:image/svg+xml,%3csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 20 20' fill='%236b7280'%3e%3cpath fill-rule='evenodd' d='M5.23 7.21a.75.75 0 011.06.02L10 11.06l3.71-3.83a.75.75 0 111.08 1.04l-4.25 4.4a.75.75 0 01-1.08 0L5.21 8.27a.75.75 0 01.02-1.06z' clip-rule='evenodd'/%3e%3c/svg%3e\")",
  backgroundRepeat: "no-repeat",
  backgroundPosition: "right 0.5rem center",
  backgroundSize: "1.25em",
};

const selectFocusStyle: React.CSSProperties = {
  outline: "none",
  borderColor: "var(--stagebook-primary, #3b82f6)",
  boxShadow: "0 0 0 2px var(--stagebook-focus-ring, rgba(59, 130, 246, 0.25))",
};

export function Select({
  options,
  value,
  onChange,
  label = "",
  placeholder,
  id,
  "data-testid": dataTestId,
}: SelectProps) {
  // Generate a unique id when the caller doesn't provide one — multiple
  // <Select> instances on the same page (device pickers, repeated
  // dropdowns) would otherwise share `id="select"` and break
  // `<label htmlFor>` association + `data-testid` uniqueness.
  // Pattern matches Button/TextArea (#181 review).
  const generatedId = useId();
  const selectId = id ?? `select${generatedId}`;

  const [focused, setFocused] = useState(false);

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

  return (
    <div data-testid={dataTestId ?? selectId} style={{ marginTop: "1rem" }}>
      {label && (
        <label
          htmlFor={selectId}
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
      <select
        id={selectId}
        value={currentValue}
        onChange={handleChange}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        style={{
          ...selectBaseStyle,
          ...(focused ? selectFocusStyle : {}),
        }}
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
    </div>
  );
}
