# Navigation and participant input take precedence over auto-peek

Decision for [#713](https://github.com/talkbench/stagebook/issues/713).

Auto-peek is an optional reading aid. Its delayed animation must not move a
submit button during activation or restore an old position after navigation.
The Viewer also needs an explicit reset: remounting Stage does not reset the
host's persistent scroll container.

`useScrollAwareness` accepts an optional string or number `resetKey`. A change
starts a new stage at the top, cancels pending work, and clears scroll history
and engagement. The Viewer uses the same identity for this key and its Stage
remount. Internal Stage scrolling uses the context's stage ID, falling back to
the stage name. Ordinary answer, time, and participant-position updates retain
the key and scroll position. Hosts with repeated stage names must supply a
distinct stage-instance ID.

The hook tracks its delay, animation frame, and queued mutation check. Cleanup
cancels all three. Pointer, wheel, touch, keyboard, and focus input interrupt
the animation. Before each write, it also checks whether another actor moved
the container; programmatic focus, scrollIntoView, and host resets take
precedence, including resets before the first peek is scheduled. Observed
position is retained while idle. Browser clamping after content removal and
restoration on subsequent growth are accounted for separately from external
scrolling. Animation writes and navigation resets use instant scrolling so CSS
smooth scrolling does not introduce a competing animation.

The hook checks the actual ref target after each layout commit and reattaches
only when the container, key, or threshold changes. This covers waiting
screens and conditional discussion layouts without restarting on response
updates. The conditional discussion fallback receives the same scroll support
as the ordinary single-column layout.

Canceled peeks can leave the new-content indicator visible. The indicator's
own insertion must not start another peek. Normal uninterrupted near-bottom
peeking and keyboard submission remain available.

Browser regressions cover persistent-container navigation, pending and active
animation cancellation, cleanup, conditional container replacement, and a
single pointer down/up activation of the real SubmitButton. The pointer test
keeps the button visible and focused before growth so setup cannot cancel the
peek. Controlled clock advancement exercises the vulnerable interval; it does
not retry clicks or wait for the target to stop moving. These are automated
browser reproductions, not evidence of the frequency of the problem in live
participant sessions.
