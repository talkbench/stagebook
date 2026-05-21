---
type: noResponse
---

# TrackedLink

The `trackedLink` element renders an external link that records the
participant's interaction with it: when they clicked it, when they
left the page (blur), when they came back (focus), and the total
time spent away from the study tab. Used to route participants to
external resources (surveys, consent forms, reading material) while
keeping a measurement of engagement.

Key fields:

- `url` — the destination. Opens in a new tab (`target="_blank"`
  with `rel="noreferrer noopener"`).
- `displayText` — what the participant sees as the link label.
- `helperText` — optional sub-line below the link. Defaults to
  "Link opens in a new tab. Return to this tab to complete the
  study." Set to an empty string to hide it.
- `urlParams` — append query parameters to the destination URL,
  with values either literal or pulled from a reference.

The link surface itself is keyboard-focusable (Tab), shows a focus
ring on keyboard focus, and an underline + color shift on hover
— matching standard browser link conventions.
