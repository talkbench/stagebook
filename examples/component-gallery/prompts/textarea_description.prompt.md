---
type: noResponse
name: textarea_description
---

# TextArea

`openResponse`. Free-text input. Optional `minLength` / `maxLength`
bounds, optional `rows:` for the initial visible height. The
character counter appears automatically when bounds are set.

Stagebook also bakes in **typing telemetry** on every TextArea — paste
detection, typing-interval quantiles, first-keystroke delay,
focused-duration. Those land alongside the response value in the
saved record; researchers can inspect them in the analysis pipeline
or in the viewer's state inspector. The telemetry is part of the
component (not an opt-in setting) so every study using stagebook
collects the same signals.

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
