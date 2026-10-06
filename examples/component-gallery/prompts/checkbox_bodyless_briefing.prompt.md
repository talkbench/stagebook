---
type: noResponse
---

## Briefing materials

The toggles above are a `body: none` prompt: the frontmatter says the
prompt deliberately has no question text, and the body section stays
empty. Each checkbox is named by its own label.

```yaml
conditions:
  - reference: self.prompt.checkbox_bodyless_demo
    comparator: includes
    value: Show briefing materials
```

Uncheck "Show briefing materials" and this section disappears.
