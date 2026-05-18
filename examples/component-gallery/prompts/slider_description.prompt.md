---
type: noResponse
name: slider_description
---

# Slider

Continuous numeric scale, `min` → `max` in `interval` steps. The
participant clicks anywhere on the bar to set their answer; the
thumb is **deliberately hidden until first interaction** so the
starting position doesn't anchor their response (#326).

Tick labels can be added at any subset of the snap points using the
`- N: label` syntax in the response section — common patterns are
labels at just the endpoints (anchored Likert) or at every snap
point (full 7-point scale).

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
