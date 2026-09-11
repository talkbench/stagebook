# Timeline shortcuts follow annotation focus

Status: accepted. Follow-up to the [Timeline accessibility audit (#552)](https://github.com/talkbench/stagebook/issues/552).

Timeline's annotation key bindings stay intact. Enter creates a point or a
press-and-hold range; Space controls playback; arrows, Tab, Delete, Escape,
and undo retain their current meanings when the Timeline itself has focus.
Clicking an annotation continues to focus that surface for keyboard editing.

Its zoom, mute and help buttons have their own focus and native activation.
Timeline must not interpret their bubbled key events as annotation commands.
Previously, Enter could create an annotation instead of activating a button,
and Space controlled playback instead of activating the focused button.
Arrow/Delete could also edit a previously active annotation from a button.
Both keydown and keyup handlers now ignore events originating outside the
Timeline container itself, including events from help content rendered in a
portal.

This fixes event routing rather than changing shortcut assignments. Previous/
next annotation navigation, track choice and screen-reader state feedback
remain separate design work under #552. The existing MediaPlayer bindings
are governed by #553 and are unchanged here.

Browser regressions use actual Tab/Shift+Tab, Enter and Space interactions in
point and range modes. They verify native button actions, absence of unintended
annotation saves, protection of an existing annotation, and return to Enter
annotation after using a button. Existing press-and-hold and editing tests
continue to cover the annotation surface.
