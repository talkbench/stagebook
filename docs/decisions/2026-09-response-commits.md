# Components own response commit boundaries

Status: accepted in [#665](https://github.com/talkbench/stagebook/issues/665).

A control renders its current interaction locally and emits a response at a
boundary appropriate to that interaction. Prompt adds record metadata and
saves immediately; it no longer adds another debounce after the control emits.
This keeps the server protected from keystroke/pointer streams without placing
completed responses behind a second timer.

Open-response prompts configure TextArea for a two-second quiet period and a
five-second maximum wait. The first pending edit starts both timers; further
edits restart only the quiet timer. Saving clears both, and idle controls do
not checkpoint. Blur emits current typing statistics before the response so
the synchronous Prompt save includes them. Standalone TextArea keeps its
configurable quiet period (500ms by default) and maximum wait (5 seconds by
default). Unmount cancels pending timers, without flushing.

Slider previews pointer and held-key changes locally and commits on pointer
release or completion of the held adjustment keys. Click-to-jump completes
on release. Native changes without pointer/key events, such as accessibility
tool input, are already completed actions. Cancellation or focus loss restores
the last committed value, including an unanswered state. The range input and
keyboard semantics remain native; pointer capture supports a gesture leaving
the track, and vertical touch scrolling can cancel the adjustment.

Timeline saves completed pointer edits and commits keyboard adjustments on
key release. Cancellation restores both the answer and its undo history.
Interrupted range creation remains a preview, not a saved annotation. Its
250ms screen-reader announcement delay is independent of response commits.

Radio arrow navigation keeps its native selection behavior and emits every
actual selection. Checkboxes and selects emit each change; list sorting emits
a completed reorder. Their former generic 50ms Prompt debounce provided little
coalescing for ordinary discrete actions, and the extra cost of rapid radio
keyboard selections is accepted. No response is emitted merely on focus.

There is no stage submission registry or global flush. Automatic cutoff can
discard the text tail since the last checkpoint, nominally within five seconds
under normal foreground scheduling. That tradeoff is accepted. Unfinished
manipulation gestures must not become answers just because the stage ended.
A normal text-field blur before Continue issues the response immediately.

The host's void-returning save API does not acknowledge network delivery or
server persistence. These component changes do not establish server mutation
ordering or justify removing the runner's submission-settle workaround.

Tests cover quiet/max-wait/blur timing, timer cleanup and fresh telemetry,
response counts during long gestures, cancellation and undo, native discrete
choices, and existing browser interactions. This is a behavioral change for
consumers of Slider.onChange: downstream content sees the committed value,
while intermediate scrub positions remain local to the control.
