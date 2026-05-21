---
type: noResponse
---

# Timer

The `timer` element renders a progress bar that fills as the stage's
elapsed time approaches a configured deadline. Used to communicate
"time pressure" to participants — common on annotation, decision,
and discussion stages where you want a soft cap on time spent.

Key fields:

- `startTime` — seconds into the stage when the timer starts filling.
- `endTime` — seconds into the stage when the timer reaches 100%.
- `warnTimeRemaining` — seconds before `endTime` when the bar
  switches color (default red) to signal "you're running out."

The timer is purely visual; it does not auto-advance the stage when
the time runs out. Pair it with a `stage.duration` if you want the
stage to actually end at a deadline. Screen readers announce the
time remaining via `role="progressbar"` + `aria-valuetext`.

The bar below starts at 0, fills over 30 seconds, and turns red in
the last 10 seconds.
