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
- Reference syntax when authoring a new study.
- Hand off a new collaborator a single self-contained tour of the
  available inputs.

For a deeper tour that covers templates, broadcasts, intro / game /
exit sequences, conditional rendering, and references, see the
**annotated walkthrough** example next door.
