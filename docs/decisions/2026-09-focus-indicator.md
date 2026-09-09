# The focus indicator: one opaque halo, and it survives forced-colors (September 2026)

Status: **accepted** (2026-09-09) — resolves [#610]. Narrows
[Decision 1 of the accessibility ADR](2026-07-accessibility.md) (WCAG 2.2 AA)
into a concrete, testable treatment, and corrects the palette work in [#535],
which could not see this defect.

[#610]: https://github.com/talkbench/stagebook/issues/610
[#535]: https://github.com/talkbench/stagebook/issues/535
[#382]: https://github.com/talkbench/stagebook/issues/382
[#213]: https://github.com/talkbench/stagebook/issues/213
[runner#836]: https://github.com/talkbench/runner/issues/836

## Context

Every Stagebook control drew its own focus indicator, and they had all
converged on one pattern: `outline: none` plus a 2px `box-shadow` ring in
`--stagebook-focus-ring`, which was the accent at 25% alpha. Sixteen copies,
identical, and wrong in two ways at once.

**The ring was below the contrast minimum.** Flattened over white, the 25%
ring is `rgb(200, 216, 250)`: 1.43:1 against the page, and **1.03:1 against
`--stagebook-border`**, the control edge it is drawn immediately outside. On
any bordered control — a secondary Button, Select, TextArea, the native
inputs — the indicator was very nearly invisible against the thing it
abutted. WCAG 1.4.11 asks 3:1 of a non-text indicator. No hue at 25% alpha
reaches 3:1, so this was never something a host could theme around.

It also slipped through the [#535] palette gate by construction: that gate
resolves each token to an opaque hex and asserts a ratio, and it deliberately
returns `null` for a translucent value, because a translucent color has no
single hex to assert. The one token whose whole job was to be _seen_ was the
one the accessibility-by-construction test could not evaluate.

**In forced-colors mode there was no indicator at all.** Forced-colors forces
`box-shadow` to `none` while honoring `outline`. Pairing a box-shadow ring
with `outline: none` therefore removes the indicator entirely — for exactly
the users who turned high contrast on. Measured in Chromium: a bare
`<button>` keeps `outline: auto 1px` under forced colors; the same button
keeps its indicator right up until Stagebook styles it. That inverts the
policy `styles.css` states in its own comment — an OS accessibility override
is the participant's need, not a theme preference — which the reset honors
and the focus rules silently undid.

[#382] had added the Timeline's ring precisely because participants doing
keyboard annotation had no signal the control was armed. This is the same
concern one level down: the ring that fix standardized on was itself too
faint, and absent under forced colors.

## Decision 1 — The ring is opaque, and drawn as two layers

`--stagebook-focus-ring` is now a plain alias of `--stagebook-primary` — the
accent at full strength. That keeps the property the old token comment was
after (retuning a host's accent retunes the ring) and, unlike the `color-mix`
it replaces, needs no `@supports` fallback to stay in sync.

That alias lives in `styles.css`, which hosts may legitimately not load
([#213]). So components reference the accent as
`var(--stagebook-focus-ring, var(--stagebook-primary, #2563eb))` — nested, not
single-level. A host that skips the stylesheet and themes by defining
`--stagebook-primary` alone leaves the ring token undefined, and a
single-level fallback would ignore their accent and paint our hard-coded blue.

Opacity alone is not sufficient, and this is the part worth recording because
the obvious fix is wrong. On a control whose own fill _is_ the accent — a
primary Button, a checked radio — a flat accent ring is **1.00:1**, which is
worse than the translucent ring it replaces (3.61:1, since a 25% blue over
blue-600 at least lightens it). So the accent ring sits outside a
**page-colored spacer**:

```css
box-shadow:
  0 0 0 2px var(--stagebook-bg, #fff),
  0 0 0 4px var(--stagebook-focus-ring, #2563eb);
```

The spacer guarantees a contrasting edge whatever the ring abuts: 5.17:1 on
the page, 3.51:1 against a gray-300 control border, 5.17:1 against an accent
fill. This pattern was already in the codebase — MediaPlayer adopted it
because a video frame can be any color — and #610 generalized its reasoning
to every other control rather than inventing a second treatment.

The palette gate now asserts the ring against both the page and the border,
which it can do only because the token became opaque.

**Consequence:** `--stagebook-primary-tint` is split out to carry the old
translucent value. The Slider's hover track had been borrowing
`--stagebook-focus-ring` as a tint (a darker gray there would swallow the
gray snap-point ticks drawn on the track); left alone, making the ring opaque
would have turned that track solid blue.

## Decision 2 — The outline is transparent, not absent

Wherever a box-shadow ring is drawn, the rule also declares
`outline: 2px solid transparent; outline-offset: 2px`.

This costs nothing visually — the halo does the drawing, and outlines don't
affect layout — and forced-colors repaints the outline's color from the
system palette, so the indicator survives. We chose it over the alternative
of a `@media (forced-colors: active)` block per site for two reasons: it is
one uniform declaration rather than sixteen media queries to keep in sync,
and several containers (Timeline, MediaPlayer) set their styles inline, where
a stylesheet media block would lose to the inline `outline: none` without an
`!important` fight.

Inline text keeps a real outline instead of a halo: a box-shadow around a
wrapped link would ring each line fragment and read as a highlight. Markdown
links and code blocks therefore use `focusOutlineCss()`. Forced-colors needs
no special handling there — it already honors `outline`.

## Decision 3 — One definition, in `focusRing.ts`, gated by a test

The treatment lives in `packages/stagebook/src/components/focusRing.ts` as
`focusRingCss()` / `focusOutlineCss()`, and every component interpolates it.
It is a string helper rather than a class in `styles.css` because components
carry their own scoped `<style>` blocks and must render correctly on a host
that never loads our stylesheet ([#213]) — so the rule has to be inlined
per component, with `var()` fallbacks. (The native-input rule in `styles.css`
still writes the two layers out longhand, since CSS can't import it; the two
sites cross-reference each other.)

`focus.gate.ct.tsx` holds both halves for every focusable primitive: that the
painted ring is the opaque accent over a page-colored spacer, and — under
`forcedColors: 'active'` — that a ≥2px outline is still there once
box-shadow is gone. A single component's ring can no longer drift, because
the defect never was in one component: it was one pattern copied sixteen
times.

## What we did not change

The viewer's `layoutStyle` keeps `outline: none`. It is a `tabIndex={-1}`
container focused programmatically for hotkey scoping, never a tab stop and
never a participant-facing control, so suppressing a click-drawn ring there
removes no indicator anyone navigates by.

## Why this wasn't fixed downstream

`talkbench/runner` uses Stagebook's styling as shipped and overrides nothing.
Setting `--stagebook-focus-ring` there would have fixed the visible half
app-wide in one line, but it would have masked a defect rather than fixed it,
left the forced-colors half untouched, and made the ring differ between
Stagebook's own demos and the study — a reproducibility problem in an
instrument whose point is that every participant sees the same stimulus. See
[runner#836].
