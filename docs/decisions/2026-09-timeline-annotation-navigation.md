# Browse Timeline annotations without seeking

Status: accepted in the design discussion for [#552](https://github.com/talkbench/stagebook/issues/552).

With the Timeline annotation surface focused, `[` selects the previous
annotation and `]` the next, in chronological order. With nothing selected,
`]` starts at the earliest and `[` at the latest. Navigation stops at each
end. Equal timestamps retain their saved order. Restored arrays are not
rewritten or saved merely to navigate them.

Selection keeps keyboard focus on the Timeline and reveals an off-screen
point or range start at the current zoom. Playback position and play/pause
state stay unchanged. Existing Enter, arrow, frame, Tab, Escape, delete and
undo actions retain their behavior. Range selection initially has no active
boundary; Tab chooses one, as it does after clicking a range. Escape clears
selection and allows Tab to leave the annotation surface. Modified bracket
keys and events from descendant controls are not intercepted.

A visually hidden, polite, atomic status region reports the selected point
or range, chronological position, timestamps, and active boundary. When
nothing is selected it reports the remaining annotation count, including
after deletion and undo. Changes settle for 250 ms before announcement to
coalesce held-arrow edits; pointer drags announce only after completion.
Playback ticks and pending press-and-hold ranges do not update the status.
Instructions and status messages are available in the English and Hebrew
catalogs, and both help tables list the new shortcuts.

Browser tests cover navigation, focus, unsorted restored data, viewport
reveal, unchanged save data/playhead, editing, deletion, undo, control and
modifier isolation, and quiet playback/dragging. They verify accessible DOM
semantics and status contents; they do not establish how every screen reader
speaks them. A real VoiceOver/NVDA walkthrough remains part of #552.

The waveform's text equivalent, multi-track interaction design, and help
popover layout/focus remain separate work. This does not close #552.
