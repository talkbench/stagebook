---
type: noResponse
name: markdown_demo
---

## Headings, paragraphs, emphasis

Paragraphs flow normally. **Bold**, *italic*, ~~strikethrough~~, and
`inline code` all work. So do
[external links](https://github.com/deliberation-lab/stagebook).

### Heading hierarchy

The full set (h1-h6). Researchers usually stop at h3, but the deeper
levels are available for long-form instruction text.

#### h4 — section
##### h5 — sub-section
###### h6 — minor heading

### Lists

- Unordered list item
- Another unordered item
  - Nested item
- Back to top level

1. Ordered first
2. Ordered second
3. Ordered third

Task-list checkboxes work too:

- [x] Saved consent
- [x] Verified microphone
- [ ] Completed practice round

### Code blocks

```yaml
gameStages:
  - name: example
    elements:
      - type: prompt
        file: prompts/question.prompt.md
      - type: submitButton
```

### Tables

GFM tables get borders, a header background, zebra striping, and
horizontal scroll on narrow viewports.

| Element type      | Renders                       | Records a response?           |
|-------------------|-------------------------------|-------------------------------|
| `prompt`          | A markdown prompt body        | Yes (per type)                |
| `submitButton`    | "Next" affordance             | Submit timestamp, when named  |
| `separator`       | Horizontal rule between rows  | No                            |
| `audio`           | Audio playback widget         | No                            |
| `display`         | Echoes a prior response       | No                            |

### Block quote

> Block quotes render with a left rule and muted text so the quote
> visually steps back from body content. Useful for participant-
> facing notes or pull quotes inside instructions.

### Images

![A 1×1 transparent placeholder showing that images render at max
width 100%.](data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=)

### Horizontal rule (use `***` or `___`)

The `---` separator is reserved for splitting prompt-file sections,
so use `***` or `___` for an in-body horizontal rule:

***

That's most of what authors reach for. For a separator between
elements *on the stage* (rather than inside a single prompt body),
use the `separator` element type in the YAML.
