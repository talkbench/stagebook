---
type: noResponse
name: radio_description
---

# RadioGroup

`multipleChoice` with `select: single` (the default). Pick exactly
one option from a small set. Best when **all options should be
visible at once** so the participant can compare them — 2–7 choices
is the sweet spot.

For larger lists where vertical space is tight, use the **Select**
component instead.

```yaml
- type: prompt
  file: prompts/my_question.prompt.md
```

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
