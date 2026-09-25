# Marks made with Enter are not selected

Status: accepted in [#678](https://github.com/talkbench/stagebook/issues/678).

Enter creates a point, or a press-and-hold range, at the playhead without
selecting it. Nothing is selected afterwards, so the arrow and frame keys keep
scrubbing the playhead. Previously the new mark was selected: in real-time
marking, pressing `←` to go back and re-watch moved the mark just made, and
because the player seeks with an edited mark, it looked like an ordinary
scrub. In range mode the selected range had no active boundary, so the arrows
did nothing at all.

Marks created by clicking or dragging are still selected: the pointer is
already on the mark, and adjusting it next is the likely intent. To adjust a
mark made with Enter, select it with `[` / `]` (which don't seek) or a click.
After Enter the status region names the new mark with the existing
position-and-time text, then reports that nothing is selected ("Point 1 of 1,
12 seconds. No annotation selected. 1 annotation."), so each mark is heard,
including a single-select point that replaces the last one. No new catalog
strings were needed. Undo removes the new mark as before.

This supersedes, for Enter only, the note in
[Browse Timeline annotations without seeking](2026-09-timeline-annotation-navigation.md)
that existing Enter actions keep their behavior. Enter still releases a
browsed annotation and reveals the playhead.
