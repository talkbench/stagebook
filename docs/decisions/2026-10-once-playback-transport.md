# Once playback applies to attached timelines

Status: implements [#779](https://github.com/talkbench/stagebook/issues/779).

A MediaPlayer in `playback: once` mode exposes a participant-facing handle
that rejects play, pause and seek. Previously only the player's own controls
were restricted; a Timeline could pause, rewind and replay through its
registered handle. The restriction belongs at that shared boundary so it
covers every timeline attached to the same source, including transport
triggered indirectly by editing an annotation.

`PlaybackHandle.getTransportCapabilities()` reports which of play, pause and
seek are available. It is optional for compatibility with existing external
handles, which retain their unrestricted behavior. The window wrapper checks
capabilities on each call, before touching the source or logging a seek.
MediaPlayer publishes all three as unavailable in once mode. Manual mode
keeps its existing play/pause, seek-window and replay behavior.

Timeline consumes those capabilities to disable transport shortcuts, remove
ruler/playhead drag affordances and show only applicable help rows. Enter
marking, selection navigation, annotation editing, zoom and pan remain
available. Editing a mark cannot move the once-mode player's playhead.
Annotation editing is intentionally independent of transport permission.

Initial positioning, autoplay, the first-viewing fallback button and the
normal stop at `stopAt` use the player's private source handle. These are
player lifecycle operations, not participant transport. A blocked autoplay
can be retried through the player's fallback button; a successful first start
removes that route. Timeline Space does not start a once-mode player, even
before the first viewing. Clicking the fallback preserves timeline focus.

HTML5 uses the rejected `play()` promise to reveal the fallback. YouTube uses
its documented [onAutoplayBlocked event](https://developers.google.com/youtube/iframe_api_reference#onAutoplayBlocked)
and starts once the API handle is ready. YouTube native controls and keyboard
are disabled in once mode, and its iframe is shielded from participant clicks
using the existing Stagebook click-layer pattern. Manual YouTube behavior is
unchanged.

This contract covers Stagebook's mounted player and participant UI. It does
not persist viewing attempts across reloads/remounts, automatically focus a
timeline, require a user-armed start, or make annotations append-only. Those
are separate study-policy features.

Unit and component tests cover boundary enforcement, initial positioning,
blocked-autoplay fallback, both media backends, multiple attached timelines,
stopAt and natural end, annotation/focus preservation, and manual playback.
YouTube component tests use a deterministic IFrame API stub.
