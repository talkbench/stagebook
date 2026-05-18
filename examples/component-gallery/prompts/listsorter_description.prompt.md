---
type: noResponse
name: listsorter_description
---

# ListSorter

`listSorter`. Drag-to-reorder ranking. The participant produces an
ordered list — the saved response is the array of keys in the
participant's chosen order. Set `shuffle: true` if you want the
starting order randomized per participant (so the position of an
item isn't an anchor on its perceived priority).

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
