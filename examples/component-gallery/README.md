# Component gallery

Single-player walkthrough of each interactive form component
stagebook ships, with a brief description of what it is and when to
reach for it. Acts as living documentation — editing a prompt file
here changes both the demo and its description, so the two can't
drift apart.

## Stages

| Stage | Component | Prompt type |
|-------|-----------|-------------|
| Welcome | — | `noResponse` |
| Markdown | Markdown rendering | `noResponse` |
| RadioGroup | Pick one | `multipleChoice` (`select: single`, the default) |
| CheckboxGroup | Pick any | `multipleChoice` (`select: multiple`) |
| Select | Compact pick-one | `dropdown` |
| TextArea | Free text | `openResponse` |
| Slider | Continuous scale | `slider` |
| ListSorter | Drag-to-rank | `listSorter` |
| Done | — | `noResponse` |

## Use this gallery to

- Audit visual behavior after a stagebook upgrade.
- Reference syntax when authoring a new study (this README).
- Hand off a new collaborator a single self-contained tour of the
  available inputs.

For a deeper tour that covers templates, broadcasts, intro / game /
exit sequences, conditional rendering, and references, see the
**annotated walkthrough** example next door.

## Prompt-file syntax reference

Every prompt file is a `.prompt.md` Markdown document with two or
three sections separated by `---` lines:

1. YAML frontmatter (`type:` discriminates the response shape)
2. Markdown body (the participant-facing question)
3. Response items (`-` lines for list types, `>` lines for openResponse) — omitted for `noResponse`

Use `***` or `___` for horizontal rules inside the body, since `---`
is reserved as the section delimiter.

### RadioGroup — `multipleChoice`

```markdown
---
type: multipleChoice
name: my_question
shuffle: true   # optional: randomize option order per participant
---

# Your question goes here

---

- Option A
- Option B
- Option C
```

### CheckboxGroup — `multipleChoice` with `select: multiple`

```markdown
---
type: multipleChoice
name: my_question
select: multiple
---

# Your question goes here

---

- Option A
- Option B
- Option C
```

### Select — `dropdown`

```markdown
---
type: dropdown
name: my_question
placeholder: Pick one…
---

# Your question goes here

---

- option_a: Option A
- option_b: Option B
- option_c: Option C
```

When the `- key: value` form is used, the **key** is what's saved to
the response and the **value** is what's shown to the participant.
For a list where the displayed text is also the stored value, just
write `- Option A`.

### TextArea — `openResponse`

```markdown
---
type: openResponse
name: my_question
rows: 5
minLength: 30
maxLength: 500
---

# Your question goes here

---

> Optional placeholder text shown inside the textarea before typing
```

### Slider — `slider`

```markdown
---
type: slider
name: my_question
min: 0
max: 100
interval: 1
---

# Your question goes here

---

- 0: Not at all
- 50: Somewhat
- 100: Very much
```

### ListSorter — `listSorter`

```markdown
---
type: listSorter
name: my_ranking
shuffle: true
---

# Your question goes here

---

- option_a: First option
- option_b: Second option
- option_c: Third option
```

## Known limitation

Stagebook's prompt-file parser splits on any `---` line in the file,
including lines inside fenced code blocks. That means you can't put
prompt-syntax examples (like those above) inside a `noResponse`
prompt body — the `---` inside the code block gets read as a section
delimiter. Worked around here by keeping the syntax examples in this
README rather than inside the prompts themselves. See the follow-up
issue linked from the gallery's PR for the parser fix.
