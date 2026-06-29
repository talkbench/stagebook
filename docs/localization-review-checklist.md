# Localization review checklist (for an agent)

A rubric for reviewing a **multi-locale study** — one whose treatment file
declares non-default `locale` arms and ships parallel `.prompt.md` files per
language. It exists to catch the things rule-based validation deliberately does
**not**: structural drift and semantic divergence across language variants, and
content that is tagged for a locale but not actually translated.

This is the second layer of a defense-in-depth scheme (see
[2026-06-localization.md](./decisions/2026-06-localization.md)):

1. **Rule (CI):** every prompt's resolved frontmatter `locale` equals its
   treatment's `locale`. Deterministic; already enforced — you can assume it
   passed.
2. **This checklist (agent, on demand):** structural + semantic equivalence.
3. **Human:** a native speaker verifies translation quality.
4. **Gallery:** visual RTL + leaked-language check in the viewer.

Run this when a multi-locale treatment is added or changed. Report findings as a
list; for each, give file + locale + the specific divergence. **Default to
flagging when unsure** — a false flag costs a glance; a miss ships a broken
experiment.

## How the variants relate

The treatment defines structure once (a shared template) and each locale arm
substitutes `${locale}` into the `file:` paths, so
`prompts/en/intro.prompt.md` and `prompts/he/intro.prompt.md` are the *same
logical prompt* in two languages. Group prompts by their path-with-the-locale-
segment-removed (or by the shared templated `file:` field). Within each group,
the language differs; **everything structural must match.**

## A. Structural congruence (must match across all locale variants)

For each group of parallel prompt files:

- [ ] **Same `type`** (`multipleChoice` / `slider` / `openResponse` /
      `dropdown` / `listSorter` / `noResponse`). A slider in one language and a
      multipleChoice in another is a bug.
- [ ] **Same number of response items** (the `-` option lines, or `>` lines for
      openResponse). A missing or extra option is the most common drift.
- [ ] **Same `select`** (`single` / `multiple`) for multipleChoice — compare the
      *resolved/defaulted* value, not raw frontmatter (one variant omitting
      `select:` and another writing `select: single` are identical post-parse).
- [ ] **Same `layout`** for multipleChoice/checkbox where it affects how the
      question reads (again, compare defaulted values).
- [ ] **Same slider geometry** — `min`, `max`, `interval`, `showValue` — and the
      **same number of labelled tick points** at the **same numeric positions**
      (the label *text* differs by language; the numbers must not).
- [ ] **Same numeric points** for numeric-mode multipleChoice (the points carry
      the measurement; only the labels translate).
- [ ] **Same `rows` / `minLength` / `maxLength`** for openResponse.
- [ ] **Same `name`** (the storage-key identifier) — the variants must record to
      the same key so cross-locale analysis lines up.

## B. Semantic equivalence (the part only a reader catches)

- [ ] **Same question is being asked.** The translated body asks the same thing,
      not a paraphrase that shifts meaning.
- [ ] **Scale direction preserved.** A Likert that runs disagree→agree in
      English must not run agree→disagree in the translation. Check that the
      i-th option in each variant means the same thing.
- [ ] **Endpoint labels aligned.** Slider/scale endpoints map to the same poles
      (left = "Strongly disagree" in both, not flipped).
- [ ] **Option meaning aligned position-by-position** where order is meaningful
      (and intentionally *not* required where `shuffle: true`).
- [ ] **No untranslated body.** The body text is actually in the declared
      language — not an English copy left in place under a `he` tag. (This is the
      gap the CI rule cannot see: it only checks the tag, not the bytes.)
- [ ] **Interpolations/placeholders preserved.** Any `${...}` or reference the
      English version contains appears, intact, in every translation.
- [ ] **No bidi-override spoofing.** Flag bidi-control characters (U+202A–202E,
      U+2066–2069) in participant-facing strings — especially
      `trackedLink.displayText`, where a right-to-left override can make the
      visible link text disagree with the real destination. Legitimate
      Hebrew/Arabic content does *not* need these override characters; their
      presence in a tagged-RTL file is a red flag, not normal RTL.

## C. Treatment-level consistency

- [ ] **Each arm declares a `locale`** and the arms cover the intended language
      set.
- [ ] **Arms are structurally identical** apart from `locale` and content —
      same stages, same element order, same conditions, same `playerCount`.
      (If they share a template this is automatic; verify if they don't.)
- [ ] **All treatments assembled into one session share a locale** — a session
      must not mix languages mid-stream.
- [ ] **Referenced assets resolve per locale** — if media/captions are also
      locale-specific (`captionsFile: captions/${locale}/…`), the per-locale
      files exist.

## D. Chrome + RTL (verify in the gallery/viewer)

- [ ] **Stagebook chrome is translated**, not just researcher content — buttons,
      timer/counter text, media + timeline controls, error states all render in
      the target language (these come from stagebook's catalog; flag any missing
      key that fell back to English).
- [ ] **RTL renders correctly** for RTL locales — value-axis components (slider,
      counters, radio rows, blockquote rails) mirror; time-axis components
      (media scrubber, timeline) stay left-to-right; nothing overflows
      (especially Slider endpoint labels, which are tight even in English).
- [ ] **No English leaks through** anywhere in the rendered RTL view.

## What this checklist does NOT cover

- **Translation quality / naturalness** — defer to a native speaker.
- **Whether the experiment design is sound** — out of scope; this is about
  locale parity, not study validity.
