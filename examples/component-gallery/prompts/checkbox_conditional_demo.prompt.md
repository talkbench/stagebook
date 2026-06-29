---
type: noResponse
---

## You checked "Sliders" ✅

This block is gated on the checkbox above with:

```yaml
conditions:
  - reference: self.prompt.checkbox_demo
    comparator: includes
    value: Sliders
```

`includes` does **element membership** when the referenced value is a
multi-select array — so it renders only when "Sliders" is among the
checked options. Uncheck it and this section disappears.
