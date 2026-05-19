---
type: noResponse
name: markdown_demo
---

## Headings, paragraphs, emphasis

Paragraphs flow normally. **Bold**, *italic*, and `inline code` all
work. So do [external links](https://github.com/deliberation-lab/stagebook).

### Lists

- Unordered list item
- Another unordered item
  - Nested item
- Back to top level

1. Ordered first
2. Ordered second
3. Ordered third

### Code blocks

```yaml
gameStages:
  - name: example
    elements:
      - type: prompt
        file: prompts/question.prompt.md
      - type: submitButton
```

### Block quote

> Block quotes render with a left rule. Useful for participant-facing
> notes or pull quotes inside instructions.

### Horizontal rule (use `***` or `___`)

The `---` separator is reserved for splitting prompt-file sections,
so use `***` or `___` for an in-body horizontal rule:

***

That's most of what authors reach for. For a separator between
elements *on the stage* (rather than inside a single prompt body),
use the `separator` element type in the YAML.
