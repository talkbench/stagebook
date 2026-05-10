# Prisoner's Dilemma

A two-player simultaneous-choice example. Each round, both participants independently choose **Cooperate** or **Defect**; payoffs follow the canonical PD matrix (3/3, 5/0, 0/5, 1/1).

Two treatments share a single round template:

- **One-shot** — a single round, then a brief reflection.
- **3-round repeated** — same round structure repeated three times via broadcast.

## What this example demonstrates

| Feature                                                        | Where it lives                                       |
| -------------------------------------------------------------- | ---------------------------------------------------- |
| **Multi-player basics** (`playerCount: 2`)                     | Both treatments                                      |
| **Templates** with `${fieldName}` placeholders                 | `roundTemplate` (`contentType: stages`)              |
| **Template invocation with `fields:`** (single use)            | One-shot treatment                                   |
| **Template invocation with `broadcast:`** (Cartesian expansion) | 3-round treatment                                    |
| **Conditions with `comparator: equals`**                       | Outcome stage's six per-combination cards            |
| **Position-based asymmetry** (`position`, `showToPositions`)   | Partner-choice display + asymmetric outcome cards    |
| **`display` elements** (one player's response shown to another) | Outcome stage                                        |
| **Multi-stage rounds** (choice → outcome)                      | `roundTemplate.content` returns 2 stages per call    |

## How the outcome stage renders

Each round ends in an outcome stage with seven elements:

1. Two `display` elements — each shows the partner's choice to the opposite seat.
2. Four conditional outcome cards — exactly one of these renders for each player, based on the (P0 × P1) choice combination:
   - **Both cooperated** — same card, both players.
   - **Both defected** — same card, both players.
   - **Asymmetric (P0 cooperated, P1 defected)** — two cards, one per perspective ("you were exploited" vs. "you exploited your partner").
   - **Asymmetric (P0 defected, P1 cooperated)** — mirror of the above.

The two asymmetric outcomes use the same prompt files split across both perspectives, so we end up with four prompt files (not eight).

## Running it

From the viewer's landing page click the **prisoners-dilemma** example card, or paste a GitHub URL to this repo's `prisoners-dilemma.stagebook.yaml` into the URL input. To run the dev viewer locally:

```
npm run dev -w stagebook-viewer
```

Once loaded, switch between the two treatments from the picker. The viewer simulates both positions, so you can step through choices and see how each player's outcome card differs.
