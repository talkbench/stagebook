# Shared failure callout

## Decision

Narrow [#543](https://github.com/talkbench/stagebook/issues/543) to actual
failures: invalid media URLs, prompt loading/parsing failures, and element
render crashes. Export `ErrorCallout` from `stagebook/components` for hosts
to reuse without a provider.

Character limits are normal response behavior, not failures. Leave the
existing counter and overflow pulse unchanged. Stagebook has no consumer
for the proposed field-validation treatment, so do not add that API.

Use the reviewed soft danger fill and border, readable danger text, and a
circle-alert glyph. The border is decorative: the text and glyph communicate
failure without relying on its contrast or color. Add the semantic
`--stagebook-danger-border` token for the soft outline; retain the existing
danger foreground/background tokens and inline fallbacks.

Prompt failures lead with a localized explanation and help text. Preserve
the previously visible file/error diagnostic as plain text under a native,
initially collapsed “Technical details” disclosure. Its target is at least
44px high and uses the shared focus outline. Diagnostics remain untranslated
author/debugging information; disclosure and participant copy use the locale
catalog. General render crashes still expose no technical information in
the participant DOM; logging, host callbacks, and async rethrow are unchanged.

The component always uses `role="alert"`; consumers mount it when a failure
occurs. It has optional title and diagnostic text, without tone/variant
switches for unrelated feedback. Media load-failure frames and neutral hints
retain their existing presentations.

## Verification

Browser regressions exercise all four migrations, diagnostic keyboard
activation, text-only diagnostic rendering, standalone CSS fallbacks,
Hebrew/RTL, and long diagnostic wrapping at a 320px viewport with 200% text.
The accessibility gate scans the collapsed/expanded callout and all migrated
surfaces, including measured glyph contrast; the focus gate covers normal
and forced-colors disclosure focus. The error boundary's containment,
reporting, and privacy regressions remain in place.
