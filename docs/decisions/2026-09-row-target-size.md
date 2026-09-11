# Interactive row target size

Status: Accepted. Issue: #632.

## Decision

Use `2.75rem` (44 CSS px at the default 16 px root size) as the default
`--stagebook-row-min-height`. The token describes a minimum **border-box**
height: padding and borders are included, and wrapped content can grow taller.
Use the same fallback in components that render without the stylesheet.

Choose the familiar 44 px radio/checkbox appearance for accessibility rather
than reducing rows to 36 or 40 px for density. The entire label is clickable;
the radio circle or checkbox itself does not need to become larger.

The size follows [WCAG 2.5.5 Target Size (Enhanced)](https://www.w3.org/WAI/WCAG22/Understanding/target-size-enhanced.html),
which specifies 44 by 44 CSS px targets with exceptions. This is a target-size
choice for these controls, not a claim of overall AAA conformance.

## Layout consequences

- Radio and checkbox rows keep their existing 44 px appearance. Previously,
  the 36 px content-box minimum plus 8 px padding happened to produce 44 px.
  Border-box sizing makes the token describe the result explicitly.
- Select triggers and icon buttons grow from 38 to 44 px, staying level when
  placed together. Customizable Select picker rows grow from 36 to 44 px.
- ListSorter retains its existing 54 px row and position-number minimum. Its
  taller floor is explicit, and larger shared-token values still apply.
- Prompt body-to-control spacing stays unchanged. Radio/checkbox prompts
  retain their existing row heights and spacing; dropdown prompts retain
  the 1rem body gap established in #605.

Host overrides now specify the desired total minimum rather than a content
height with padding added afterward. Audit existing custom overrides when
updating. The 44 px default is shared across devices; it does not automatically
change with pointer type or viewport size.

## Verification

Browser tests cover the stylesheet default, an unset token exercising component
fallbacks, and a larger host override. They measure row dimensions, Select/icon
alignment, ListSorter number alignment, and spacing within rendered prompts.
Existing wrapping and keyboard interaction tests remain part of verification.

Select's customizable trigger uses flex layout, so its label is explicitly
centered with `align-items: center` inside the `appearance: base-select` support
branch ([#657](https://github.com/talkbench/stagebook/issues/657)). Otherwise the
extra minimum height collects below the label. Screenshot checks compare the
center of the displayed ink with the control center, excluding the border and
chevron, at the 44px default/fallback and a 72px host override. The tolerance is
1 CSS px of center offset (2px difference between the opposing gaps), accounting
for the observed 1px lower ink position in Linux WebKit. This changes alignment within
the existing target, not its size or prompt spacing.
