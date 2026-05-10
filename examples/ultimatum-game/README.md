# Ultimatum Game

A two-player asymmetric example. Position 0 is the **Proposer**: they choose how much of a $10 pot to offer. Position 1 is the **Responder**: they accept or reject. Reject and both earn $0.

Roles are assigned via `groupComposition` from a multipleChoice in the intro — each participant says whether they'd prefer to be the Proposer or Responder, and the host platform matches them into seats accordingly.

## What this example demonstrates

| Feature                                                                        | Where it lives                                                  |
| ------------------------------------------------------------------------------ | --------------------------------------------------------------- |
| **`groupComposition`** with `comparator: equals` on a multipleChoice           | `treatments[0].groupComposition`                                |
| **Position-based asymmetric content** via `showToPositions`                    | Offer + Decision stages                                         |
| **`display` elements referencing other positions** (cross-player view)          | Decision stage's responder view; Outcome stage                  |
| **Conditional outcome cards** (`comparator: equals` on the responder's decision) | Outcome stage                                                   |
| **Two-stage waiting pattern** (one player acts, the other submits "Ready")      | Offer + Decision stages                                         |

## How asymmetric stages work

Stagebook stages advance when **all** positions submit (or `duration` expires). To give each player a different view of the same stage, every element gets a `showToPositions` filter. The responder's "Ready" button on stage 1 isn't a no-op — they have to submit it before the stage will advance, but it doesn't gate the proposer. So the proposer takes their time on the slider while the responder waits.

The decision stage uses two paired patterns at once:

- A `display` element with `position: 0` and `showToPositions: [0]` shows the proposer their own offer back as a recap.
- The same `display` element with `position: 0` and `showToPositions: [1]` shows the proposer's offer to the responder.

Both reference `prompt.offer` at `position: 0`, but the `showToPositions` filter changes who the rendering is for.

## Running it

From the viewer's landing page click the **ultimatum-game** example card, or paste a GitHub URL to this repo's `ultimatum-game.stagebook.yaml` into the URL input. To run the dev viewer locally:

```
npm run dev -w stagebook-viewer
```

Once loaded, the viewer simulates both positions; you can step through the offer + decision + outcome stages and watch the two views diverge.
