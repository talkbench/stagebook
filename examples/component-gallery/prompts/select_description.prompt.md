---
type: noResponse
name: select_description
---

# Select

`dropdown`. The compact version of RadioGroup — best when the option
list is longer than ~7 items, the choices are familiar enough that
the participant doesn't need to see all of them at once, or vertical
space is tight. Set `placeholder:` to render a leading "Pick one…"
prompt before the participant has chosen anything.

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

When the `- key: value` form is used (as above), the **key** is what's
saved to the response and the **value** is what's shown to the
participant. For a list where the displayed text is also the stored
value, just write `- Option A`.
