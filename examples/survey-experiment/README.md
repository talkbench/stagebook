# Survey experiment

A single-player pre/post attitude study. The participant answers an attitude question, reads a short passage, then answers the same question again.

A single template generates both arms of the experiment by broadcasting over a `condition` field. The control arm reads an unrelated history-of-clocks passage; the treatment arm reads a one-page summary of the public-health argument for later school start times.

## What this example demonstrates

| Feature                                                                  | Where it lives                                        |
| ------------------------------------------------------------------------ | ----------------------------------------------------- |
| **Single-player flow** (`playerCount: 1`)                                | `studyTreatment.content`                              |
| **Templates with broadcast** (one template → two treatments)             | `treatments:` → `broadcast: { d0: [...] }`            |
| **Pre/post design** (same prompt file, distinct response names)          | `pre_attitude` and `post_attitude` stages             |
| **Timed reveals** (`displayTime`, `hideTime` on elements within a stage) | `${condition}_reading` stage                          |
| **Forced dwell** (`displayTime` on `submitButton` to prevent skipping)   | `${condition}_reading` stage                          |
| **Comprehension check** (open-response gate)                             | `comprehension` stage                                 |
| **Per-arm response naming** (`${condition}_reflection`)                  | `exitSequence`                                        |

## How the timed reading stage works

The `${condition}_reading` stage sequences three reveals over its 120-second duration:

- **0–5 s**: reading instructions (`hideTime: 5`)
- **5–30 s**: the article (`displayTime: 5` makes it appear at 5s)
- **30 s onward**: the **Continue** button becomes available (`displayTime: 30`)

The viewer's time scrubber lets you preview the participant's view at each breakpoint without waiting in real time.

## Running it

From the viewer's landing page click the **survey-experiment** example card, or paste a GitHub URL to this repo's `survey-experiment.stagebook.yaml` into the URL input. To run the dev viewer locally:

```
npm run dev -w stagebook-viewer
```

Once loaded, switch between the **control** and **treatment** arms from the picker; both share the same stage structure but read different articles. The pre and post attitude responses save under distinct names so you can see the manipulation effect in the State Inspector.
