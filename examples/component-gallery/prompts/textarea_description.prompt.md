---
type: noResponse
name: textarea_description
---

# TextArea

`openResponse`. Free-text input.

Optional `minLength` / `maxLength` bounds set the participant-facing
constraints; the character counter appears automatically when bounds
are set. Optional `rows:` sets the initial visible height.

Stagebook also bakes in **typing telemetry** on every TextArea —
paste detection, typing-interval quantiles, first-keystroke delay,
focused-duration. Those land alongside the response value in the
saved record; researchers can inspect them in the analysis pipeline
or in the viewer's state inspector after submission. The telemetry
is part of the component (not an opt-in setting) so every study
using stagebook collects the same signals.
