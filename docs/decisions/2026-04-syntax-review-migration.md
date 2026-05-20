# Syntax review (April 2026): migration guide

The April 2026 syntax review tightened the Stagebook DSL across a
coordinated set of issues. Each one was small to medium on its own,
but together they touch most of what a researcher writes in a
treatment file or `.prompt.md`. This document is the consolidated
upgrade path: what changed, what to rewrite, and where to look for
full context.

If you already track Stagebook issue-by-issue, the per-issue PR
descriptions and `docs/decisions/principles.md` are the canonical
write-ups. This page collapses them into a single linear pass.

## At-a-glance changes

Most entries below are **hard breaks** — old syntax fails preflight
validation rather than silently running. The fail-fast direction is
deliberate; silent migration would have masked semantic shifts (e.g.
the discussion storage-key namespace, `qualtrics.url` losing
`asset://` support). A handful of additive changes — boolean-tree
operators, structured references — keep the older syntax working as
sugar; those rows are flagged.

| Area              | Before                                      | After                                         | Kind | Issue |
|-------------------|---------------------------------------------|-----------------------------------------------|------|-------|
| Conditions        | `position: percentAgreement`                | no direct equivalent — see [Conditions](#conditions--position-is-a-read-selector-only-238) | breaking | [#238] |
| Conditions        | flat-array AND only                         | `all:` / `any:` / `none:` boolean tree (flat array still parses as sugar for `all:`) | additive | [#235] |
| References        | dotted strings only                         | `{source, name?, path?}` structured form (dotted strings still parse as sugar) | additive | [#240] |
| References        | `prompt.X` (no position prefix)             | `self.prompt.X` / `0.prompt.X` / `all.prompt.X` etc. (position selector required) | breaking | [#298] |
| References        | `urlParams.<key>`                           | `entryUrl.params.<key>`                        | breaking | [#246] |
| References        | `discussion.<name>` storage key = `<name>`  | storage key = `discussion_<name>`              | breaking | [#240] |
| Templates         | `templateName:` / `templateContent:` / `templateDesc:` | `name:` / `content:` (drop desc, fold into `notes:`) | breaking | [#244] |
| Templates         | `contentType:` optional, `"other"` accepted | `contentType:` required, `"other"` removed     | breaking | [#244] |
| Elements          | bare `*.prompt.md` string in `elements:`    | explicit `{ type: prompt, file: ... }`         | breaking | [#245] |
| Elements          | `type: talkMeter`                           | removed entirely                               | breaking | [#250] |
| Elements          | `type: sharedNotepad`                       | `type: prompt` + `shared: true` + openResponse | breaking | [#250] |
| Elements          | `type: survey`                              | deprecated; one-time runtime warning           | additive | [#250] |
| Resources         | `mediaPlayer.url:`                          | `mediaPlayer.file:`                            | breaking | [#249] |
| Resources         | `qualtrics.url: asset://...`                | strict `https?://` only                        | breaking | [#249] |
| Resources         | `trackedLink.url: asset://...`              | strict `https?://` only                        | breaking | [#249] |
| Prompt files      | `shuffleOptions:`                           | `shuffle:`                                     | breaking | [#243] |
| Prompt files      | `select: undefined`                         | omit field for default `single`                | breaking | [#243] |
| Prompt files      | slider `labelPts: [0, 50, 100]` + body labels | inline `- 0: Not familiar` body lines        | breaking | [#243] |
| Prompt files      | `noResponse` three-section file              | two-section (drop trailing `---`)              | breaking | [#243] |
| Prompt files      | mixed `-` / `>` markers per type            | `-` for list types, `>` for openResponse       | breaking | [#243] |

## Treatment files

### References — structured form alongside the dotted sugar (#240)

A reference identifies a value somewhere in the study state. The
dotted-string form everyone has been writing (`prompt.familiarity`,
`urlParams.condition`) is still accepted as sugar. The new structured
form is preferred in new code, especially when you need to override
defaults the dotted form bakes in:

```yaml
# Before — dotted only, no position prefix
- reference: prompt.familiarity
  comparator: isAtLeast
  value: 50

# After — both forms accepted; both parse to the same internal shape.
# Note: the position prefix in the dotted string (`self.`, `0.`, etc.)
# is now required — see References — required position prefix (#298)
# below.
- reference: self.prompt.familiarity   # string sugar — still works
- reference:
    position: self
    source: prompt
    name: familiarity
    path: [value]                      # explicit; same default the sugar applies

- reference:
    position: self
    source: prompt
    name: familiarity
    path: [debugMessages]              # newly possible — addresses other saved fields
```

Named sources (`prompt`, `survey`, `submitButton`, `qualtrics`,
`timeline`, `trackedLink`, `discussion`) require `name:`, allow
optional `path:`. External sources (`entryUrl`, `connectionInfo`,
`browserInfo`, `participantInfo`) forbid `name:`, require `path:`.
Every reference — dotted or structured — also requires a `position`
selector; see the next section.

### References — required position prefix (#298)

Every reference must begin with an explicit position selector. In
the dotted form that's the first segment; in the structured form
it's the `position:` field. The selector is one of:

- `self` — the current participant's value (matches what pre-#298
  references defaulted to when no `position:` field was set)
- `shared` — group-shared state
- `all` — every participant's value as a list (for aggregating
  across the group; pairs with the boolean-tree `all:` / `any:`
  operators introduced in #235)
- A non-negative integer (`0`, `1`, …) — a specific slot index

Un-prefixed references fail preflight validation with an error
that suggests the migration — e.g. `prompt.familiarity` is rejected
with a hint pointing to `self.prompt.familiarity`.

```yaml
# Before — implicit "current participant"
- reference: prompt.familiarity
  comparator: equals
  value: high

# After — explicit position prefix; `self` matches the old default
- reference: self.prompt.familiarity
  comparator: equals
  value: high

# Cross-participant reads now live in the reference itself instead
# of in a separate position field on the condition (which the
# pre-#238 form also accepted for the same semantic):
- reference: 0.prompt.familiarity      # slot 0 specifically
- reference: 1.prompt.familiarity      # slot 1 specifically
- reference: all.prompt.familiarity    # list of every participant's value
```

The pre-#298 `any` selector and `player` selector are removed.
`any` belonged in the boolean-tree operator family ([#235]); use
`any:` with explicit per-slot leaves. `player` is replaced by
`self` — same semantic, clearer name, single canonical spelling.

Two reference-grammar quirks were fixed in the same change:
- **Timeline references accept paths** in both schema and runtime.
  Previously the schema rejected `timeline.<name>.<path>` while the
  runtime accepted it.
- **Prompt refs can override the implicit `["value"]` path.** Writing
  `path: [debugMessages]` now reads other fields on the prompt's
  saved record.

### `urlParams` reference source → `entryUrl.params.*` (#246)

The word `urlParams` did double duty: an *outgoing* element field on
`trackedLink`/`qualtrics` (params appended to the element's URL) and
an *incoming* reference source (params from the participant's landing
URL). Same word, opposite directions.

| Before                          | After                                |
|---------------------------------|--------------------------------------|
| `reference: urlParams.condition` | `reference: self.entryUrl.params.condition` |
| `{source: urlParams, path: [condition]}` | `{position: self, source: entryUrl, path: [params, condition]}` |
| `urlParams:` element field      | unchanged — still means "outgoing params for this element's URL" |

(The `After` column folds in the position prefix required by #298 — see [References — required position prefix](#references--required-position-prefix-298) above.)

The `params` subpath is required today; bare `entryUrl.<key>` is
rejected. The `entryUrl.*` namespace is reserved so future
`entryUrl.path` / `entryUrl.host` / `entryUrl.href` can land
non-breakingly.

### Conditions — boolean tree operators (#235)

The flat-array AND-of-leaves form is now sugar for `all:`. `any:` and
`none:` are new:

```yaml
conditions:
  any:
    - reference: self.prompt.foo
      comparator: equals
      value: yes
    - all:
        - reference: self.prompt.bar
          comparator: equals
          value: yes
        - reference: self.prompt.baz
          comparator: exists
```

This is purely additive — flat-array conditions you've already written
keep working. See [`docs/researcher/conditions.md`](../researcher/conditions.md).

### Conditions — `position` is a read selector only (#238)

`position` on a condition leaf used to mix two roles: which player's
data to read AND cross-player aggregation (`percentAgreement`,
`any`, `all`). After #238, `position` is purely a read selector
(numeric slot, `shared`, or `player`). Aggregation lives in the
boolean-tree operators.

`position: any` and `position: all` map cleanly onto the new `any:` /
`all:` operators with explicit per-slot leaves:

```yaml
# Before — "all players said yes" via a separate `position: all` field
- reference: prompt.changedMind
  position: all
  comparator: equals
  value: yes

# After — explicit per-slot leaves under all:, position prefix folded
# into each reference string (per #298 — no separate position field
# needed when the position is in the reference itself)
- all:
    - reference: 0.prompt.changedMind
      comparator: equals
      value: yes
    - reference: 1.prompt.changedMind
      comparator: equals
      value: yes
```

`position: percentAgreement` (≥X% of players satisfied) **has no
direct one-line replacement** in the boolean tree. The boolean
operators are existentially quantified (`any`, `all`, `none`), not
threshold-quantified. Re-express the condition based on the study's
intent:

- "any player said yes" → `any:` with per-slot `equals` leaves.
- "all players said yes" → `all:` with per-slot `equals` leaves.
- "at least N out of M agreed" (the original `percentAgreement` use
  case) → no syntactic equivalent today. Either drop the condition
  until a future aggregates / countables feature lands, or model the
  threshold outside the condition tree (e.g. compute the count in a
  separate stage and compare to it via a single condition).

The `display.position: any | all` selectors are unchanged — they're a
render concern, not a condition aggregator.

### Templates (#244)

Five renames in one schema rewrite:

```yaml
# Before
templates:
  - templateName: studyTreatment
    contentType: treatment             # OPTIONAL — fuzzy match if omitted
    templateDesc: One run of the study
    notes: |
      Longer explanation here.
    templateContent:
      name: ${topicLabel}
      ...

# After
templates:
  - name: studyTreatment
    contentType: treatment             # REQUIRED
    notes: |
      One run of the study.

      Longer explanation here.
    content:
      name: ${topicLabel}
      ...
```

| Before              | After       | Why |
|---------------------|-------------|-----|
| `templateName:`     | `name:`     | Aligns with how every other named thing in the schema works. The outer `templates:` array already says "these are templates." |
| `templateContent:`  | `content:`  | Same — `template`-prefix is redundant inside a template definition. |
| `templateDesc:`     | (folded into `notes:`) | Consistency with the rest of the DSL where `notes:` is the universal researcher-comment field. |
| `contentType: optional` | `contentType: required` | The fuzzy `templateContentSchema` (~14 candidate schemas, lowest-unmatched-keys wins) gave bad error messages, hid bugs, and ran a leftover `console.log` debug loop. |
| `contentType: "other"` | (removed) | Schema escape hatch — if a template produces something the validator can't check, that's a missing case to add. |

`contentType:` gained five new enum entries
(`introSteps`, `conditions`, `groupComposition`, `discussion`,
`broadcastAxisValues`) to cover real-world template shapes that
previously needed `"other"`.

The invocation form (`template: <name>`, `fields:`, `broadcast:`) is
unchanged.

### Elements — bare-string prompt shorthand removed (#245)

```yaml
# Before — bare string was sugar for { type: prompt, file: <str>, name: <str> }
elements:
  - prompts/familiarity.prompt.md

# After — explicit form required
elements:
  - type: prompt
    file: prompts/familiarity.prompt.md
```

The shorthand's auto-synthesised `name: prompts/familiarity.prompt.md`
was actually invalid against `nameSchema` (which forbids `/` and `.`),
so the shortcut wasn't pulling its weight. With it gone, `elementSchema`
collapses to a real `z.discriminatedUnion("type", [...])` — better
error messages, tighter inferred types.

### Elements — `talkMeter` and `sharedNotepad` removed (#250)

Both element types are gone. `survey` is deprecated but still works.

```yaml
# Before
- type: sharedNotepad
  name: groupNotes

# After — use a `shared: true` open-response prompt
- type: prompt
  name: groupNotes
  file: prompts/groupNotes.prompt.md
  shared: true
```

Where `prompts/groupNotes.prompt.md` is a minimal openResponse:

```yaml
---
type: openResponse
---

# Group notes

(participant-facing instructions, if any)
```

`talkMeter` has no replacement — discussions already manage their own
speaker indication.

The host's `renderSharedNotepad` slot stays — it's still called by
shared `prompt` elements. `renderTalkMeter` is removed.

`survey` keeps working but emits a one-time `console.warn` per
`surveyName` at parse time. Tracked for removal once a module-reuse
pattern lands; new files should prefer prompt-based patterns.

### Resources — `url:` (browser-direct) split from `file:` (platform-resolved) (#249)

| Element            | Field                | Schema after #249       | Change |
|--------------------|----------------------|-------------------------|--------|
| `prompt`           | `file:`              | `fileSchema` + `.prompt.md` suffix | gains scheme/path validation |
| `audio`            | `file:`              | `fileSchema`            | gains scheme/path validation |
| `image`            | `file:`              | `fileSchema`            | gains scheme/path validation |
| `mediaPlayer`      | `file:` (renamed)    | `fileSchema`            | renamed from `url:`, gains validation |
| `mediaPlayer`      | `captionsFile:`      | `fileSchema`            | gains validation |
| `qualtrics`        | `url:`               | `browserUrlSchema`      | drops `asset://` support |
| `trackedLink`      | `url:`               | `browserUrlSchema`      | drops `asset://` support |

Two distinct schemas now reflect what's actually happening:

- **`browserUrlSchema`** — strict `https?://` with non-empty host. The
  browser navigates here directly; `asset://` has no meaning at a
  browser-direct path.
- **`fileSchema`** — relative path, `asset://` URI, or `https?://` URL.
  Resolved by the host's loader (relative paths against the treatment
  file's directory; `asset://` via `getAssetURL()`; full URLs passed
  through).

`file:` was also removed from `elementBaseSchema` — writing
`file: foo` on a `separator` (or any element type that doesn't declare
`file:`) now fails strict-key validation instead of being silently
accepted.

## Prompt files (#243)

Four threads of change land together in one schema rewrite of the
`*.prompt.md` format.

### Slider labels move into the body section

```yaml
# Before — labelPts in frontmatter, labels in body, paired by position
---
type: slider
min: 0
max: 100
interval: 1
labelPts: [0, 50, 100]
---
# Familiarity
---
- Not familiar
- Somewhat familiar
- Very familiar

# After — inline `- <number>(: <label>)?` lines
---
type: slider
min: 0
max: 100
interval: 1
---
# Familiarity
---
- 0: Not familiar
- 50: Somewhat familiar
- 100: Very familiar
```

Mixed labeled/unlabeled forms are valid (`- 25` and `- 50: Neutral`
coexist). Bare numbers default to using the number as the label.
Labels can contain colons — everything after the first colon is the
label. `labelPts:` in frontmatter is rejected.

### `noResponse` files are two-section

```yaml
# Before — three sections, third was empty
---
type: noResponse
---
# Welcome
Body markdown.
---

# After — two sections
---
type: noResponse
---
# Welcome
Body markdown.
```

Drop the trailing `---` and any third section. A stray third section
is rejected with a migration message.

### Frontmatter renames

| Before                | After       |
|-----------------------|-------------|
| `shuffleOptions:`     | `shuffle:`  |
| `select: "undefined"` | omit field (`single` is the default) |
| `labelPts:` (slider)  | inline body lines (see above) |

`name:` is **kept** as-is — `name` is the universal identifier across
all study portions ([Principle 9](principles.md)). Each per-type
schema is now `.strict()` — typos like `tytle:` / `placholder:` /
`interavl:` fail at preflight.

### Per-type marker enforcement

| Type             | Allowed marker | Rejects                          |
|------------------|----------------|----------------------------------|
| `multipleChoice` | `-`            | `>` lines                        |
| `listSorter`     | `-`            | `>` lines                        |
| `slider`         | `-`            | `>` lines                        |
| `openResponse`   | `>`            | `-` lines                        |
| `noResponse`     | (no third section) | any third section            |

Both forms require a trailing space (`- Foo` / `> Foo`) or a bare
marker on its own line. `-Foo` / `>Foo` no-space forms are rejected.

### Body horizontal-rule convention

Use `***` or `___` for horizontal rules in the body. `---` is the
section delimiter. Both alternatives render identically to `---` in any
markdown viewer.

## Host-side breaking changes

Hosts (the platforms that implement `StagebookContext`) have a small
set of changes beyond the treatment-file syntax above.

### Storage-key renames

`getReferenceKeyAndPath(...)` returns `{ referenceKey, path }`; the
host's `get(referenceKey, scope)` looks up the singleton bucket and
the path is walked into the returned record. Two buckets changed:

| Reference                  | `referenceKey` before | `referenceKey` after | `path` after | Issue |
|----------------------------|------------------------|----------------------|--------------|-------|
| `discussion.<name>`        | `<name>`               | `discussion_<name>`  | (unchanged)   | [#240] |
| `entryUrl.params.<key>`    | `urlParams`            | `entryUrl`           | `["params", "<key>"]` | [#246] |

For `discussion.*`, the rename is a flat namespace bump — what hosts
stored under `<name>` now lives under `discussion_<name>`.

For `entryUrl.params.*`, the rename happens at the singleton-key
level: hosts that previously stored a flat `urlParams: { condition:
"A", referrer: "..." }` bucket now serve it under
`entryUrl: { params: { condition: "A", referrer: "..." } }`. The
extra `params` nesting reserves room for future `entryUrl.path`,
`entryUrl.host`, `entryUrl.href` accessors without another rename.

### Removed / deprecated context slots

| Slot                  | Status                                                                                  |
|-----------------------|------------------------------------------------------------------------------------------|
| `renderTalkMeter`     | Removed (#250). Drop the implementation.                                                |
| `renderSharedNotepad` | Kept — still called by shared `prompt` elements (#250).                                  |
| `renderSurvey`        | `@deprecated` (#250). Keep implementing for now; tracked for removal once module-reuse pattern lands. |

### One-time runtime warning

Parsing a treatment file with any `type: survey` element prints a
`console.warn` once per `surveyName` per process. This is a
deprecation signal, not an error.

## Per-issue references

Each PR's body has the full design rationale, including the
considered-and-rejected alternatives. The principles document
synthesises the cross-cutting "why" patterns.

- [#235] — Conditions: boolean-tree operators `all` / `any` / `none`
- [#238] — Conditions: narrow `position` to a read selector
- [#240] — References: structured `{source, name?, path?}` form (string shorthand kept as sugar)
- [#243] — Prompt files: format and schema cleanup
- [#244] — Templates: schema cleanup (require `contentType`, drop `"other"`, rename fields)
- [#245] — Elements: drop the bare-string `promptShorthand`
- [#246] — References: rename `urlParams` source to `entryUrl.params.*`
- [#247] — Visibility docs (additive, no migration)
- [#248] — Time-field reference frame docs (additive, no migration)
- [#249] — Resources: separate `url:` (browser-direct) from `file:` (platform-resolved)
- [#250] — Element types: drop `talkMeter` + `sharedNotepad`, deprecate `survey`

Cross-cutting rationale: [`docs/decisions/principles.md`](principles.md).

[#235]: https://github.com/deliberation-lab/stagebook/issues/235
[#238]: https://github.com/deliberation-lab/stagebook/issues/238
[#240]: https://github.com/deliberation-lab/stagebook/issues/240
[#243]: https://github.com/deliberation-lab/stagebook/issues/243
[#244]: https://github.com/deliberation-lab/stagebook/issues/244
[#245]: https://github.com/deliberation-lab/stagebook/issues/245
[#246]: https://github.com/deliberation-lab/stagebook/issues/246
[#247]: https://github.com/deliberation-lab/stagebook/issues/247
[#248]: https://github.com/deliberation-lab/stagebook/issues/248
[#249]: https://github.com/deliberation-lab/stagebook/issues/249
[#250]: https://github.com/deliberation-lab/stagebook/issues/250
