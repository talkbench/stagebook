# Prompt Files

Prompts are Markdown files with two or three sections separated by lines of three or more dashes (`---`):

1. **Metadata** — YAML frontmatter defining the prompt type and behavior.
2. **Body** — Markdown-formatted text displayed to the participant. Some prompts can leave it empty on purpose; see [Prompts without a body](#prompts-without-a-body).
3. **Responses** — Response options (format depends on type). Required for `multipleChoice`, `dropdown`, `openResponse`, `listSorter`, `slider`. **Omitted entirely for `noResponse` and `numericResponse`**; these files have two sections.

## Example

```markdown
---
type: multipleChoice
---

# Which wizard appears in the most novels?

---

- Dr. Strange
- Gandalf
- Harry Potter
- Dumbledore
```

## Metadata Fields

Each per-type schema is `.strict()` (#243) — unknown frontmatter keys (typos like `tytle:`, `placholder:`, `interavl:`) are rejected at preflight.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | no | Optional human-readable identifier. Can be any string. |
| `type` | enum | yes | `multipleChoice`, `dropdown`, `openResponse`, `numericResponse`, `noResponse`, `listSorter`, `slider` |
| `notes` | string | no | Internal notes (not displayed) |
| `body` | `none` | no | The prompt deliberately has no body. See [Prompts without a body](#prompts-without-a-body). |
| `ariaLabel` | string | with `body: none` | A name for assistive technology, never displayed. See [Prompts without a body](#prompts-without-a-body). |

### Type-specific fields

`required: true | false` (default `false`) is supported on `multipleChoice`,
`dropdown`, `openResponse`, and `numericResponse`. A required dropdown must declare `placeholder`,
so it waits for a deliberate choice. `required` is rejected on `listSorter`
and `noResponse`, and on `slider` until [#689](https://github.com/talkbench/stagebook/issues/689)
provides keyboard access to untouched sliders.

A required prompt displays a static, muted “Required” line between its body
and control, localized in English and Hebrew. The marker stays when answered
or cleared. It describes the question; it does not prevent submission or show
an error. Required textareas, numeric fields, radio groups and dropdowns expose `aria-required`;
checkbox groups describe the marker to assistive technology.

**`openResponse`:**

| Field | Type | Description |
|-------|------|-------------|
| `rows` | integer >= 1 | Height of the text area in lines (default: 5) |
| `minLength` | integer >= 0 | Display a character counter; show progress toward minimum |
| `maxLength` | integer >= 1 | Enforce a maximum character count |

**`numericResponse`:** All fields are optional. The file has two sections and no placeholder or response options.

| Field | Type | Description |
|-------|------|-------------|
| `min` | finite number | Inclusive lower bound for validity |
| `max` | finite number | Inclusive upper bound for validity |
| `integer` | boolean | Require a whole number (default: `false`) |
| `prefix` | string | Plain-text unit label at the field's reading start |
| `suffix` | string | Plain-text unit label at the field's reading end |

Bounds must satisfy `min <= max`; either may appear alone. With `integer: true`,
bounds must be whole. A bound's plain decimal spelling must fit within 100
characters and 15 significant digits. Each affix is a single line of at most
32 UTF-16 code units. Textarea fields (`rows`, `minLength`, `maxLength`), slider
`interval`, and `placeholder` are not accepted.

**`multipleChoice`:**

| Field | Type | Description |
|-------|------|-------------|
| `select` | `"single"` or `"multiple"` | Radio buttons (default: `single`) or checkboxes. The legacy `"undefined"` enum value was removed in #243 — omit the field for the default. |
| `shuffle` | boolean | Randomize option order before display. (Renamed from `shuffleOptions:` in #243.) |
| `layout` | `"vertical"` or `"horizontal"` | Option layout direction (default: `vertical`) |

**`dropdown`:** A single-choice picker rendered as a `<select>`. Same response shape as `multipleChoice` with `select: single` (saved value is the chosen option's text), but compact UI for long option lists (countries, languages, many-step Likert) where rendering every option as a radio is noisy.

| Field | Type | Description |
|-------|------|-------------|
| `placeholder` | string | Text shown as the leading disabled option before the participant has chosen anything (e.g. `"Pick one…"`). Omit to make the first option the implicit default. |
| `shuffle` | boolean | Randomize option order before display. |

**`slider`:**

| Field | Type | Description |
|-------|------|-------------|
| `min` | number | **Required.** Minimum slider value |
| `max` | number | **Required.** Maximum slider value (must be > min) |
| `interval` | number | **Required.** Step size (min + interval must be ≤ max) |

Slider tick labels live in the body's response section (#243), not in the frontmatter — see [Slider](#slider) below. The legacy `labelPts:` frontmatter field was removed.

**`noResponse`:** No type-specific fields. The file has only two sections (frontmatter + body) — no trailing `---` and no third section.

**`listSorter`:**

| Field | Type | Description |
|-------|------|-------------|
| `shuffle` | boolean | Randomize item order on first render |

## Body Section

Standard [CommonMark](https://commonmark.org/help/) with [GitHub Flavored Markdown](https://github.github.com/gfm/) support: headings, bold, italic, lists, tables, links, images.

Images use paths relative to the asset repository root:

```markdown
![diagram](shared/question_diagram.png)
```

**Note:** You cannot use `---` as a horizontal rule in the body since it's used as the section delimiter. Use `***` or `___` instead — both render identically to `---` in any markdown viewer.

### Prompts without a body

Sometimes the response options are the whole prompt: a checkbox that flags a
recording, or a row of show/hide toggles on a crowded call screen. Say so with
`body: none` in the frontmatter, and leave the body section empty:

```markdown
---
type: multipleChoice
select: multiple
layout: horizontal
body: none
notes: No question text; the option labels are the prompt.
---

---

- Show briefing materials
- Show strategy notes
```

The options then render with nothing above them: no body, and no gap or indent
where the question would be. Each checkbox is named by its own label.

The saved value is the usual list of checked labels. To show content while a
checkbox is checked, gate it on `includes`; to hide content while it's
checked, use `doesNotInclude`, which also holds before the participant has
touched the checkbox:

```yaml
conditions:
  - reference: self.prompt.recording_errors
    comparator: doesNotInclude
    value: This recording has technical errors that prevent analysis
```

In the saved data, a prompt nobody touched has no record, while one that was
checked and then unchecked saves `[]`.

An empty body *without* `body: none` is still an error, so an unfinished
question can't slip through. `body: none` with text in the body section is an
error too; notes for other authors go in `notes:`. Keep the empty body section
(the `---` line after the frontmatter) so the file keeps its usual shape.

Other prompt types need a name that the participant's screen reader or voice
control can use. Give it with `ariaLabel`:

```markdown
---
type: openResponse
body: none
ariaLabel: Notes on this recording
---

---

> Anything else we should know?
```

A `numericResponse` without a body is frontmatter alone:

```markdown
---
type: numericResponse
body: none
ariaLabel: Age in years
suffix: years
---
```

| Type | `body: none` | `ariaLabel` |
|------|--------------|-------------|
| `multipleChoice` with `select: multiple` | yes | optional; names the group of checkboxes |
| `multipleChoice` with `select: single` | yes | required: a set of radio buttons is one question |
| `dropdown`, `openResponse`, `numericResponse` | yes | required |
| `slider` | not yet ([#689](https://github.com/talkbench/stagebook/issues/689)) | — |
| `listSorter` | not yet | — |
| `noResponse` | no: the body is all it shows | — |

`ariaLabel` is a single line of plain text, at most 100 characters. It's only
accepted with `body: none`; a prompt with a body is named by it. `required` is
not supported with `body: none` yet. Shared prompts (`shared: true`) work the
same way.

Two rules for `ariaLabel` that the validator can't check:

- **Only leave out the body when something else on the stage visibly labels
  the control**, such as a heading element above it or the recording it
  annotates. A participant who can see needs that label as much as one who
  can't. The `ariaLabel` should contain the visible label's words, because
  voice-control users say what they see.
- **`ariaLabel` restates; it doesn't add.** Only assistive technology announces
  it. Instructions or question wording that aren't on screen would give
  screen-reader participants a different instrument from everyone else.

## Response Section

Per-type marker enforcement (#243): each type accepts exactly one of `-` or `>` for response lines. Mixing the wrong marker for the type is a preflight error.

### Multiple Choice / Dropdown / List Sorter

Each option on its own line, prefixed with `- `:

```markdown
- Option A
- Option B
- Option C
```

The saved value is the chosen option's text.

**Numeric scales (#282).** To attach numeric scale points (averaged downstream), label every option in the explicit `- <number>: <label>` form. The colon is what turns the prompt numeric — it's an opt-in:

```markdown
- 1: Strongly disagree
- 2: Disagree
- 3: Neutral
- 4: Agree
- 5: Strongly agree
```

Each numeric value must be unique, and numeric mode is single-select only.

A **bare** option that happens to look like a number (`- 2`, no colon) is **text**, with the number as its label — never a scale point (#289). So a comprehension check or quiz whose options are small integers plus a non-numeric foil stays in text mode, and `value:` conditions match the bare label:

```markdown
- 1
- 2
- 3
- 4
- It Varies
```

Mixing explicit `- <number>: <label>` options with bare/text options in the same prompt is a preflight error — make every option numeric (add a trailing colon to label-less points, e.g. `- 2:`) or none.

### Open Response

Placeholder text prefixed with `> `:

```markdown
> Type your response here
```

### Slider

Slider tick labels are inline `- <number>(: <label>)?` lines (#243). The number is the slider point; the label (if present, after the first colon) is what the participant sees beneath the tick. Bare numbers default to using the number as the label.

```markdown
- 0: Strongly Disagree
- 25
- 50: Neutral
- 75
- 100: Strongly Agree
```

Mixed labeled and unlabeled points are valid. Labels can themselves contain colons — everything after the first colon is the label.

### No Response / Numeric Response

`noResponse` and `numericResponse` files don't have a response section at all. Drop the trailing `---` and the third section entirely.

## Prompt Types in Detail

### Multiple Choice

```markdown
---
type: multipleChoice
shuffle: true
---

What is your favorite color?

---

- Red
- Blue
- Green
- Yellow
```

Use `select: multiple` for checkbox behavior:

```markdown
---
type: multipleChoice
select: multiple
---

Select all colors you like:

---

- Red
- Blue
- Green
- Yellow
```

Use `layout: horizontal` to lay options out in a row (useful for short option sets like yes/no):

```markdown
---
type: multipleChoice
layout: horizontal
---

Do you agree?

---

- Yes
- No
```

### Open Response

```markdown
---
type: openResponse
rows: 4
minLength: 50
maxLength: 500
---

Please describe your experience in detail.

---

> Write your response here.
```

The `> ` lines are placeholder hints: they disappear when the participant types.
Keep instructions and other information participants must read in the prompt body.
An overflowing placeholder can be clipped, and Firefox does not let participants
scroll to its hidden text. Increasing `rows` can help, but check the preview at the
narrowest width your study supports.

Prompt validation (the CLI and VS Code diagnostics) warns when a placeholder is
likely to exceed `rows` (default: 5). This is a rough check: it budgets 80 characters
per line and counts each authored `> ` line separately, including blank lines.
Actual wrapping depends on width, font, language, and scrollbars, so a warning can
appear for a hint that fits a wide layout, and a short hint can still clip in a
narrow one. It does not resize the field or block validation. Run it on the prompt
files, for example:

```sh
npx --package=stagebook stagebook validate "prompts/**/*.prompt.md"
```

The character counter appears automatically when `minLength` or `maxLength` is
set. `maxLength` caps typing; both constraints contribute to the saved `isValid`
flag, so conditions can use that flag without repeating the bounds. Lengths
count UTF-16 code units: most characters count as one, supplementary-plane
characters such as many emoji count as two. The untrimmed text determines the
length of a nonblank answer. `minLength: 0` means no minimum.

The counter is visible before interaction. Whitespace-only text stays muted,
as does a counter with only a maximum. A blank optional answer is valid even
when its counter shows no progress toward a minimum.

### Numeric Response

Use `numericResponse` for a typed estimate, count, amount, or age. Its saved
`value` is a number; an `openResponse` containing `"00123"` still saves a string.

```markdown
---
type: numericResponse
required: true
min: 18
max: 99
integer: true
suffix: years
---
How old are you?
```

There is no third section and no placeholder value. `min` and `max` are
inclusive, and they determine validity without limiting what is saved. With a
maximum of 20, entering `25` saves `value: 25` and `isValid: false`. Whole-number
mode accepts `3.0`, marks `3.5` invalid, and never rounds the answer.

Digits, `-`, and the study's decimal separator are accepted. Other inserted
characters are dropped with a brief pulse; a rejected insertion does not erase
a selection. The bundled English and Hebrew formats use `.` for decimals and
`,` for grouping. Typing `1,000` therefore produces `1000`; typing `1,5` produces
`15`, not one and a half. Grouping, exponents, hex, and non-Western digits are
not numeric entries. Paste and drop are blocked and recorded for solo fields.

Entries allow surrounding whitespace when parsed, leading zeros, and forms
such as `.5` and `-3.5`. A trailing separator (`5.`), a lone sign, or malformed
text (`3-4`) has no numeric value. The limit is 100 characters and 15 significant
digits, counted from the first nonzero digit through the last digit entered.
A change beyond the character cap is refused whole. More than 15 significant
digits produces “Too many digits,” not a rounded value.

The field gives muted guidance while more typing could complete a valid answer:
`3` can become `35` when the minimum is 18. A problem appears immediately when
appending cannot fix it, such as `25` with a maximum of 20. Leaving the field
shows a remaining problem until the participant's next edit. A nonblank valid
answer is green with ✓; blank stays muted, even when required. Restored invalid
text shows its problem. Feedback advises; it does not block typing or submission.

`prefix` and `suffix` display plain-text units inside the field and contribute
to its accessible description. They wrap rather than truncate. Their positions
follow reading order; the number itself always reads left to right, including
in Hebrew. Guidance spells bounds in plain notation, such as `0.0000001`.

The record retains raw `entry` and the effective `numberFormat`, so `007` and
`5.` return verbatim on reload. Parsed entries save a numeric `value`, including
out-of-range values; `-0` becomes `0`. Blank, unfinished, malformed, or over-limit
entries omit `value` and remove any previous number. A solo restored entry keeps
its saved format until the participant's first accepted edit, then uses the
current host format. Saves follow the text-response schedule: 2 seconds quiet,
5 seconds maximum wait, or blur.

#### Shared numeric answers

Set `shared: true` on the treatment's prompt element to collect one group answer.
The host must support the shared numeric editor; Stagebook reports a clear error
if it is unavailable. This does not fall back to a free-text notepad.

Shared numeric prompts may declare `required`, `min`, `max`, and `integer`.
Their `isValid` flag describes the group's answer, and a gate can read
`shared.prompt.<name>.isValid`. Any member's edit can change that flag for the
whole group. Concurrent typing can merge into a number nobody typed; this is
an accepted limitation of the collaborative editor.

Stagebook commits the typist's edits and coalesces late-merge corrections on the
same bounded schedule as shared notes. Participants who have never edited do
not write in response to remote changes.
The shared live answer retains its saved number format across edits so every
participant interprets the same text consistently. This is a display and parsing
convention, not a guarantee that a client-written format is trustworthy. The
host's final snapshot may recompute with its current configured format.

For numeric analysis, recompute from **`entry`**, not `value`: an optional blank
and `3-4` both lack a value, but only the blank is valid. Use the prompt's trusted
constraints and the host's configured number format; compare the client-written
`numberFormat` against it rather than trusting it. See the
[recomputation example](../engineer/api-reference.md#numeric-entries-and-number-formats)
and the [validity caveat](#response-validity-and-conditions).

**Typing statistics.** Along with the answer, an `openResponse` prompt's saved record keeps a `debugMessages` list. Shared prompts (`shared: true`) are the exception: the platform's shared notepad renders them, and none of what follows is recorded.

Each time the participant leaves the text box, a `typingStats` entry is added. Each entry is a running total since the text box appeared, so use the last one rather than adding them up. Entries are saved along with the answer, and the answer is saved whenever the participant leaves the box. If the stage ends while the participant is still in the box, the final entry is not recorded. So a participant who types until the stage ends without ever leaving has no `typingStats` entry at all. If the prompt is shown again, for example after a page reload, the counts and the list start over, and the next save replaces the earlier entries.

Pasting is blocked. Each attempt adds a `pasteAttempt` entry with the clipboard text's `length` and a `timestamp`. Attempts made after the last save are lost if the stage ends first.

A `typingStats` entry has the fields below. Times are wall-clock milliseconds, so they include any time the participant spent outside the box unless the row says otherwise. The first row defines a counted keystroke.

| Field | What it measures | From key presses |
|-------|------------------|------------------|
| `totalKeystrokes` | Counted keystrokes: key presses that report a character, plus Enter, Tab, Backspace and Delete. Includes shortcuts such as Ctrl/Cmd+V and the repeats from a held-down key. | Yes |
| `editingKeyCount` | Backspace and Delete presses. These are also included in `totalKeystrokes`. | Yes |
| `arrowKeyCount` | Cursor-key presses: arrows, Home/End and Page Up/Down. These are not in `totalKeystrokes` or the timings. | Yes |
| `mouseClickCount` | Clicks or taps on the text box. | No |
| `focusCount` | Times the text box gained focus. | No |
| `blurCount` | Times the text box lost focus. | No |
| `avgInterval` | Mean gap between successive counted keystrokes. A pause, or a visit elsewhere, becomes one long gap. `0` with fewer than two keystrokes. | Yes |
| `stdDev` | Standard deviation of those gaps (population: divided by the number of gaps). `0` with fewer than two keystrokes. | Yes |
| `intervalQuantiles` | 21 values: the 0%, 5%, 10%, …, 100% quantiles of those gaps, linearly interpolated. `null` with fewer than two keystrokes. | Yes |
| `firstKeystrokeDelayMs` | From the first time the box gained focus to the first counted keystroke, including any time spent away in between. `null` with no keystrokes. | Yes |
| `totalTypingTimeMs` | From the first counted keystroke to the last, including pauses and time spent away. It is not time spent actively typing. `null` with fewer than two keystrokes. | Yes |
| `focusedDurationMs` | Total time the box has had focus. This is the only duration that excludes time spent away. | No |

The key-press fields see only counted keystrokes, so text entered any other way is missed:

- Android on-screen keyboards report most keys as `Unidentified`, often including Backspace.
- Dictation and tapped autocomplete suggestions insert text without a key press.
- With IME composition, the usual way to type Chinese, Japanese or Korean, Chrome and Firefox report keys as `Process`, so they are missed. Safari reports the underlying keys, so there the count reflects raw key presses rather than the characters entered.

For affected participants the counts come out too low. The timings are distorted rather than simply low: a missed key merges the gaps on either side of it, and missing the first keys makes the first-keystroke delay too long. Fields can come out `0` or `null` even when the whole answer was typed, and nothing in the record flags it. Treat the key-press fields as reliable only for physical-keyboard input without an IME, and don't compare them across devices or input methods (#692).

### Dropdown

A compact single-choice picker. Use it when `multipleChoice` would render too many radio buttons (long option lists like countries / languages, or many-step Likert scales where the rows take more vertical space than the question itself).

```markdown
---
type: dropdown
placeholder: "Pick one…"
---

What is your primary language of study?

---

- English
- French
- Spanish
- (etc.)
```

Same response shape as `multipleChoice` with `select: single`: the saved value is the chosen option's text. If `placeholder` is set, the dropdown initially shows that disabled placeholder text so the participant can't accidentally submit the first option without picking it deliberately.

### Slider

The slider initializes **without a visible thumb** to avoid anchoring participants' responses. Clicking the track sets the initial value.

```markdown
---
type: slider
min: 0
max: 100
interval: 1
---

How much do you agree with the following statement?

---

- 0: Strongly Disagree
- 25
- 50: Neutral
- 75
- 100: Strongly Agree
```

### List Sorter

```markdown
---
type: listSorter
shuffle: true
---

Drag the following items into your preferred order:

---

- Economy
- Healthcare
- Education
- Environment
- Security
```

### No Response

Use for informational text that doesn't collect a response. Two-section file (no trailing `---`):

```markdown
---
type: noResponse
---

Please read the following instructions carefully before proceeding.

The study will take approximately 15 minutes.
```

## Response validity and conditions

Every saved player-scoped prompt record includes `isValid` beside `value`.
`value` retains the answer even when it fails a constraint. A blank answer is
`undefined`, an empty selection array, or text that becomes empty after trimming
Unicode whitespace. `0` and `false` are not blank. Blank answers pass unless
`required: true`; length bounds do not apply to blank optional answers. Nonblank
text must satisfy its declared bounds. Numeric validity is computed from raw
`entry`: it must parse, meet the inclusive bounds, and be whole when required.
Other nonblank responses pass.

An untouched prompt has no record or `isValid`. Leaving a text field saves its
text, including `""`. Dropdowns without a placeholder save their first option on
mount. Each commit computes `isValid`; the counter reads live text, so the flag
can trail it by one [commit window](../decisions/2026-09-response-commits.md).

Choose the condition idiom by intent:

```yaml
- type: submitButton
  conditions:
    all:
      # Answered, and it passes.
      - reference: self.prompt.essay.isValid
        comparator: equals
        value: true
      # Optional, but anything entered must pass.
      - any:
          - reference: self.prompt.comments.isValid
            comparator: doesNotExist
          - reference: self.prompt.comments.isValid
            comparator: equals
            value: true
```

Use `all` or `any` to combine prompts. Spell out the optional case with
`doesNotExist`; do not replace it with `doesNotEqual: false`, whose absence
semantics are due to change in [#299](https://github.com/talkbench/stagebook/issues/299).
A condition-hidden, untouched prompt has no record: an `equals: true` gate
waiting on it cannot pass. The optional idiom allows that absence.

Do not gate a group with `all.prompt.<name>.isValid`. The resolver drops
participants with no record, so that reference can pass as soon as one
participant has a valid answer. Until #299 preserves missing participant slots,
list each participant explicitly under `all`, for example
`0.prompt.essay.isValid`, `1.prompt.essay.isValid`, and so on.

Validation only advises the participant. Gating the submit button on `isValid`
keeps participants to valid answers, but it cannot guarantee one: a last-moment
edit can be clicked through before its commit reaches the gate. A stage timer,
stage conditions, `submitOnComplete`, Qualtrics completion, or the host can still
end a stage with an invalid answer on record. In those stages, derived values
and analysis should check `isValid`. The participant's browser writes this flag,
like `value`; recompute validity from the saved response and trusted prompt file
for analysis, payment, eligibility, and exclusion. For numeric prompts, use raw
`entry` and the host's configured number format, not `value` or the client-written
format. The exported `checkResponse` function supports both cases.

Shared `numericResponse` is the exception: its constraints and
`shared.prompt.<name>.isValid` apply to the group answer. Every other shared prompt
type still rejects `required: true`, `minLength`, and `maxLength`; explicit
`required: false` is allowed. Those nonnumeric shared records omit `isValid`,
and references to their shared validity are authoring errors.
