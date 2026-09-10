# Contrast is measured from the render, not the stylesheet (September 2026)

Status: **accepted** (2026-09-10) — resolves [#633]. Narrows
[Decision 1 of the accessibility ADR](2026-07-accessibility.md) (WCAG 2.2 AA)
into how colour contrast is checked, and retires the palette gate that
[#535] introduced and [#617] extended.

[#633]: https://github.com/talkbench/stagebook/issues/633
[#628]: https://github.com/talkbench/stagebook/pull/628
[#617]: https://github.com/talkbench/stagebook/pull/617
[#616]: https://github.com/talkbench/stagebook/issues/616
[#635]: https://github.com/talkbench/stagebook/issues/635
[#610]: https://github.com/talkbench/stagebook/issues/610
[#535]: https://github.com/talkbench/stagebook/issues/535

## Context

Since [#535], `styles.test.ts` held a palette gate: a hand-written list of
foreground/background token pairings, each resolved through the alias graph
to a hex and scored against its WCAG floor. It was meant to make the palette
"accessible by construction". It had three defects that turned out to be one.

**A stylesheet does not record what is drawn on what.** Every pairing was a
claim about rendering, written by hand. When [#628] tried to extend the list
to every token, about nine of its thirty-one pairings named a plausible token
rather than the rendered one, or a background the element never sits on.

**Scoring a pairing meant reimplementing CSS.** Alpha compositing, `color-mix`
percentage forms, hex alpha channels, `var()` fallbacks — the resolver needed
ten fixes of its own across [#617] and [#628], and still got one wrong:
[#617] resolved a translucent value to its composites over pure white and
pure black and asserted both. Those are only worst-case bounds when the other
colour's luminance lies _outside_ the range the composite can reach. The
waveform lane (`rgba(128,128,128,0.15)`) against its bars (`#6b7280`) passes
at 4.09:1 over white and 3.84:1 over black, and renders at 1.00:1 over
`#677080`.

**It never fired.** The gate was green until rows were added by hand. Every
real failure in [#616] was found by auditing components, not by the gate
running. Meanwhile the axe gate already in the repo was evaluating half the
pairings without being asked, and mounting one more component
(`AssetPlaceholder`) made it report a live 2.42:1 failure that the palette
gate had no row for.

The browser resolves `var()`, `color-mix`, alpha and stacking correctly, for
free. Measuring what it paints removes the whole class of defect.

## Decision 1 — Contrast is measured in the a11y gate, in states

`a11y.gate.ct.tsx` mounts every participant-facing component and, for each,
the states a participant's pointer or keyboard puts it in: a hovered row, a
pressed button, an open picker. Axe scores the text in each. Transitions are
awaited first — the first run scored a button hover halfway between its two
blues.

Two kinds of axe result need an explicit entry, per element, with a reason:

- **known failures** ([#616]), which are asserted to _still_ fail, so that
  fixing one flips its entry red and prompts its removal;
- **unmeasured** nodes — a background image, an overlapping element, a glyph
  outside the Basic Multilingual Plane — which axe declines to score. These
  fail the gate until recorded, so nothing drops out silently. This replaces
  the bounding: a translucent value over an unknown backdrop resolves to
  nothing, and has to be named.

## Decision 2 — What axe cannot see is still read from the render

Axe's contrast rule is text-only, and skips `<option>` and anything over a
background image. A gate case can therefore also declare:

- **`marks`** — two computed styles and the WCAG ratio, for an opaque
  non-text indicator (1.4.11: a control's border, a progress fill, the
  picker's `::checkmark`) or for text axe skips (picker rows, the Select
  trigger). The browser has already resolved aliases and mixes; a translucent
  value is refused rather than composited, and a fully transparent one has to
  name what shows through it.
- **`pixels`** — two screenshot pixels, for a colour only the paint knows.
  The Slider's snap ticks are drawn at `opacity: 0.4` over a translucent
  tint; no token, and no computed style, expresses that.

The only colour maths that survives is the WCAG relative-luminance formula on
two rgb triples.

The stylesheet's `@supports (color: color-mix(…))` block has static fallbacks
that render on supported hosts without `color-mix` (Firefox 92–112, Safari
15.4–16.1) and never on the engines the gate runs. A case can scan that
branch too, by doing what such a browser does: dropping the block from the
loaded stylesheet's CSSOM before the scan. The one fallback carrying text —
the range tooltip's translucent background over the waveform canvas — is
read from its own padding pixel, since axe will not composite over a canvas.

## Decision 3 — The stylesheet keeps a ledger, not a scorer

Axe can only see what renders. It cannot tell you about a token nobody wired
up — the [#610] shape, where both tokens were individually fine and nothing
checked them together — or about a canvas. So `styles.test.ts` keeps one
thing: every colour token is either **measured**, naming the gate case its
render is read in, or **excluded** with a reason. A measured token must be
read by some component; a token excluded as `unconsumed:` must stay unread.
This needs no colour resolution at all.

Writing the ledger found `--stagebook-timer-track` and
`--stagebook-timer-warn` declared and read by nothing (`KitchenTimer` reads
`--stagebook-bg-track` and `--stagebook-danger`), and that the success and
warning status pairs are declared for hosts only.

## What we did not change

- `focus.gate.ct.tsx`. Axe has no focus-indicator rule; the ring is its own
  gate ([#610]).
- The waveform. Canvas is invisible to every reader here, so its tokens are
  excluded explicitly.
- The [#616] failures. Seven were recorded there: six are asserted in the
  gate to still fail, at the ratio recorded, and the seventh — the track
  label over the waveform — is recorded as unmeasurable. The new readers
  found two more: the snap ticks fail on the resting track too (1.31:1), and
  the track's mute glyph is drawn in the decoration grey (2.54:1 on the
  page — hovered too, since its hover fill never paints, [#635]). They also
  corrected one row: the labelled ticks [#616] listed with
  the snap ticks measure 3.12:1 on the hovered track and pass. Each failure
  is a separate design decision, left to [#616].

## Consequences

- Adding a colour token forces a classification before the suite passes.
  Adding a component means mounting it in the gate in every state that
  changes a colour, and giving its non-text indicators a `marks` entry.
- Every new check is verified by breaking the thing it watches. Each guard in
  [#628] that was not verified that way turned out to have a hole.
- Before building a new check, measure what the existing tooling already
  covers. Ten minutes on that question at the start of [#628] would have
  produced this design directly, instead of seven hundred lines of colour
  maths and twenty review findings.
