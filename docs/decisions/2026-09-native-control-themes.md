# Keep native controls stable across OS themes

Decision for [#550](https://github.com/talkbench/stagebook/issues/550) and the
Select-chevron portion of [#636](https://github.com/talkbench/stagebook/issues/636).

Stagebook's default participant palette stays light. Select already pins
`color-scheme: light` on the native control. TextArea and Slider now do the same,
so an ancestor advertising a dark color scheme cannot retint their native
surfaces or scrollbars, including when the host omits `stagebook/styles`.
The stylesheet retains its page-level light scheme. A stylesheet-free host
still owns the scheme of its own page and unrelated controls.

The Select chevron is now an aria-hidden SVG beside the native select. It uses
the existing path, dimensions and default `#6b7280` color. The public
`--stagebook-select-chevron` token lets hosts retune its color independently
of the field border and text. The SVG ignores pointer events so the native
select retains click handling; its disabled opacity matches the control.
The native picker icon stays hidden on the customizable-select path.

The contrast gate reads the SVG path's computed fill against the select's
surface. Removing the background image also lets axe score the trigger text
without a background-image exception. The MediaPlayer transport-control portion
of #636 remains separate.

## Verification boundary

- The existing contrast gate covers Button, SubmitButton, TrackedLink and
  status/counter surfaces; #550 does not need a second axe suite.
- Native-control tests emulate OS light and dark preferences, assert each
  control's light scheme, and compare decoded pixels within each engine
  (allowing two channel levels for antialiasing rounding). An unpinned native
  control proves that the comparison detects real OS-theme changes.
  They exercise overflowing text and long picker lists, with and without the
  optional stylesheet, under a host that advertises both color schemes.
- In-page customizable pickers can be captured. Native OS popups, including
  Firefox's, are outside page screenshots; their scheme is verified through the
  select that owns them. Scrollbar paint also depends on the platform's overlay
  scrollbar policy; Chromium’s headless scrollbar-hiding flag is disabled in
  this test, and the invariant applies to the paint the engine exposes.
- Forced-colors accessibility settings remain available; these are not ordinary
  light/dark themes.

This does not change the documented browser floor. The SVG uses existing browser
capabilities, and newer picker styling remains behind its existing feature check.
