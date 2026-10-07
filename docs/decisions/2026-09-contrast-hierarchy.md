# Improve contrast while preserving visual hierarchy

Decision for [#616](https://github.com/talkbench/stagebook/issues/616), after
visual review of the revised forms and media mockup.

Radio and checkbox labels need to remain readable on hovered rows, and the
choice outlines must identify the controls. Large field borders should stay
light so their contents retain more visual weight. Slider minor ticks should
be easier to see while remaining subordinate to labeled major ticks: equally
prominent ticks can suggest that participants should align their responses to
them. Ruler timestamps should remain quieter than track labels and controls.

## Approved defaults

| Role                                             | Default                               |
| ------------------------------------------------ | ------------------------------------- |
| Muted text, including labels, hints and counters | `#626977`                             |
| Unchecked radio and checkbox outline             | `#858c99`                             |
| Select, text-area and secondary-button borders   | Existing `#d1d5db`                    |
| Normal timer fill                                | Primary color, `#2563eb` by default   |
| Major slider ticks                               | Existing `#6b7280`, 16px high, opaque |
| Minor slider ticks                               | `#6b7280`, 6px high, 0.7 opacity      |
| Ruler timestamps                                 | `#737373`                             |
| Unmuted track icon and asset-placeholder hint    | Muted text color                      |

The shared muted-text token changes throughout the components, including
fallbacks for hosts that do not load `stagebook/styles`. The waveform bar color
stays unchanged. Track labels retain their existing translucent white backing.

Three public tokens separate these roles from larger field borders and shared
text: `--stagebook-choice-border`, `--stagebook-slider-tick`, and
`--stagebook-timeline-ruler-text`. Hosts that previously used the general border,
muted-text or decoration tokens to theme these parts should now set the specific
token. The timer's normal fill now consumes `--stagebook-timer-fill`, which
defaults to `initial` (the guaranteed-invalid custom-property value). The
component's nested fallback resolves the primary color where the timer renders,
so a host can set `--stagebook-primary` on any ancestor, with or without the
stylesheet. Aliasing the fill to primary at `:root` would capture the root color
and ignore scoped primary overrides. An explicit timer-fill override still wins.

## Verification and settled questions

The rendered contrast gate measures unchecked choices at rest and on hover,
text, the timer fill, and the mute glyph. A full-height waveform fixture measures
track-label text against the painted background beneath its translucent backing.
Regression tests preserve the minor/major tick hierarchy and independent theme
controls, including their inline fallbacks.

This implemented the approved appearance and left two questions open. Both
were settled in October 2026, which closes #616:

- **Text-entry field boundaries stay light, as a deliberate exception.** The
  TextArea's outline, and NumericInput's (added later, in #708, with the same
  border), measure 1.47:1 against white. That is below WCAG 1.4.11's 3:1
  floor for the boundary of a control. They stay light so that a
  participant's response keeps more visual weight than its frame. The gate
  pins the ratio for both, so it cannot change unnoticed. This is a
  documented exception to the components' WCAG 2.2 AA conformance
  (`2026-07-accessibility.md`, decision 3). The stronger bottom edge from the
  mockup was not selected.
- **Minor slider ticks are supplementary, so they have no contrast floor.**
  They hint at where the slider snaps, but a participant can understand and
  use the slider without them: the labels give the scale, and the thumb shows
  the chosen position. They stay quieter than the labelled ticks so they do
  not invite responses aligned to them. The gate no longer measures them, and
  a component test keeps them subordinate to the labelled ticks, at rest and
  on a hovered track. The stronger minor-tick option from the mockup was not
  selected.

`--stagebook-timer-warn` was declared but read by nothing, so it was removed.
KitchenTimer's warning fill reads `--stagebook-danger`.
