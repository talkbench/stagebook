# Warn authors about overflowing placeholders (September 2026)

Status: **accepted** — [#590](https://github.com/talkbench/stagebook/issues/590).

## Context

An open-response placeholder can exceed the height set by `rows`. In the reported
browser probes, Chrome and Safari let participants scroll to the rest, while
Firefox clips it without making it scrollable. Entered response text scrolls
correctly in all three engines; the discrepancy concerns placeholder hints.

## Decision

Add a warning to `validatePromptSource`, which supplies prompt-file CLI validation
and VS Code diagnostics. Keep the native placeholder and authored field height.
Instructions belong in the prompt body; placeholder text should be a short hint.
The warning suggests shortening the hint, moving instructions into the body, or
increasing `rows` and checking the narrowest supported preview width.

The check sums an approximate line count for each parsed placeholder line:
one line per 80 Unicode code points, rounded up, with at least one for an authored
blank line. Compare with `rows`, defaulting to 5 as Prompt and TextArea do. Only
valid open-response prompts with non-blank placeholder content receive this lint.

Eighty is a deliberately generous screening threshold, not a claim about the
component's width or measured character capacity. Explicit line breaks consume
rows regardless of width; estimates for wrapped text can produce false positives
on wide layouts and miss overflow on narrow layouts or with wider glyphs. A clean
validation result does not guarantee that a placeholder fits. The warning states
that it is approximate and does not fail validation.

## Scope

No browser-specific component behavior, automatic resizing, custom placeholder
overlay, or response-saving change. The shared-notepad preview retains its clipped
box: the runner's CodeMirror placeholder still clips at rest, and an authoring
warning should not make the preview imply a larger field. No new preview badge is
introduced; the diagnostic belongs to the prompt source.

The CLI checks this rule when validating prompt files directly. Validating only a
treatment file is not a substitute for validating its prompt files. Hosts calling
`promptFileSchema` directly still get schema errors only; advisory diagnostics
come from `validatePromptSource`.
