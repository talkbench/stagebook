# Prompt Files

Prompts are Markdown files with two or three sections separated by lines of three or more dashes (`---`):

1. **Metadata** — YAML frontmatter defining the prompt type and behavior.
2. **Body** — Markdown-formatted text displayed to the participant.
3. **Responses** — Response options (format depends on type). Required for `multipleChoice`, `dropdown`, `openResponse`, `listSorter`, `slider`. **Omitted entirely for `noResponse`** (#243 — `noResponse` files are two-section).

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
| `type` | enum | yes | `multipleChoice`, `dropdown`, `openResponse`, `noResponse`, `listSorter`, `slider` |
| `notes` | string | no | Internal notes (not displayed) |

### Type-specific fields

**`openResponse`:**

| Field | Type | Description |
|-------|------|-------------|
| `rows` | integer >= 1 | Height of the text area in lines (default: 5) |
| `minLength` | integer >= 0 | Display a character counter; show progress toward minimum |
| `maxLength` | integer >= 1 | Enforce a maximum character count |

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

### No Response

`noResponse` files don't have a response section at all. Drop the trailing `---` and the third section entirely.

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

The character counter appears automatically when `minLength` or `maxLength` is set. `maxLength` is enforced (input is capped); `minLength` is displayed but must be enforced separately via conditions if you want to block submission.

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
