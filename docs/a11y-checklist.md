# Accessibility checklist for new components

Stagebook targets **WCAG 2.2 AA** for its participant-facing components (see the
[ADR](decisions/2026-07-accessibility.md)). Run through this before shipping a
new component. The axe regression gate
(`packages/stagebook/src/components/a11y.gate.ct.tsx`) catches a subset
automatically — **add your component to it**.

## Names & roles

- [ ] Every interactive control has an accessible name — a `<label>`,
      `aria-label`, or `aria-labelledby`. Icon-only buttons need one too. (4.1.2)
- [ ] Prefer native elements (`<button>`, `<input>`, `<select>`, `<textarea>`);
      if you build a custom widget, give it the correct role and states.
- [ ] Grouped inputs (radios/checkboxes) are associated with their question
      (legend / `aria-labelledby`).

## Keyboard & focus

- [ ] Fully operable by keyboard alone — no mouse-only interactions. (2.1.1)
- [ ] Anything drag-based has a keyboard alternative. (2.5.7)
- [ ] Focus is visible — a `:focus-visible` ring. (2.4.7)
- [ ] Focus order is logical and not trapped; popovers/dialogs return focus and
      close on <kbd>Esc</kbd>.
- [ ] Sticky/fixed content never _entirely_ hides a focused control. (2.4.11)

## Color & contrast

- [ ] Text ≥ 4.5:1, and UI components / large text ≥ 3:1, against the actual
      background. (1.4.3) Use the theme tokens — they are AA-by-construction.
- [ ] Meaning is never conveyed by color alone. (1.4.1)

## Targets & motion

- [ ] Interactive targets are ≥ 24 × 24 CSS px. (2.5.8)
- [ ] Respects `prefers-reduced-motion`; no audio auto-plays for > 3 s without a
      control. (2.2.2 / 1.4.2)

## Content & i18n

- [ ] Images accept authorable `alt`; media offers captions/transcript
      affordances. (1.1.1 / 1.2.x)
- [ ] Content reflows and resizes — no fixed heights that clip, no text baked
      into images. (1.4.10 / 1.4.4 / 1.4.5)
- [ ] Works in RTL.

## Verify

- [ ] Add the component to `a11y.gate.ct.tsx` (axe, WCAG 2.2 AA) — it must pass
      in its correctly-used (named, themed) form.
- [ ] Do a manual keyboard walkthrough — axe catches only ~a third to a half of
      WCAG issues.

This is a floor, not a substitute for judgment. See
[the ADR](decisions/2026-07-accessibility.md) for the standard and the scoping
(components conform; researcher-authored content is _helped_; some surfaces are
out of scope).
