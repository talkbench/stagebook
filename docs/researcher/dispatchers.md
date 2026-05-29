# Choosing a Dispatcher

A **dispatcher** is the algorithm that decides which treatment each group of participants gets routed to. Stagebook ships four:

| Dispatcher | What you provide | What it guarantees | When to reach for it |
|---|---|---|---|
| `uniform-random` | nothing | Each group's treatment is an independent uniform draw | Quick prototypes; you have no balance claim to make in a methods section |
| `weighted-random` | one weight per treatment | Each group's treatment is an independent draw with `P(T) ∝ weight(T)` | You want unequal long-run rates (e.g. 80/10/10) but don't need exact-N targets |
| `urn` | target counts per treatment (+ optional decrement matrix) | Each treatment is used exactly its target count over the batch | You want exact target Ns or cross-treatment locality (e.g. "don't pick the same label twice in a row") |
| `local-penalization` | acquisition values + penalization matrix | One batch step of an iterated Bayesian-optimization loop | You're running a researcher-managed BO surrogate between batches |

The first three are stateless or carry only a small piece of state (urn's remaining counts). All four pre-compute eligibility from each participant's data; the algorithm itself sees only IDs, treatment structure, and a boolean eligibility lookup — never the underlying responses.

## `weighted-random` in detail

This is the dispatcher most ordinary randomized experiments want when the allocation isn't 50/50. You specify weights up to scale:

```yaml
dispatcher:
  type: weighted-random
  weights: [4, 1, 1]   # T0 four times as often as T1 or T2 long-run
```

The weights are interpreted up to scale — `[4, 1, 1]`, `[80, 20, 20]`, and `[0.67, 0.17, 0.17]` are all the same sampler. Each round, the dispatcher draws a treatment with probability proportional to its weight, independently of every other round. There is no memory of which treatment was picked last; in particular, a run of three consecutive `T0` draws is not "balanced out" by extra `T1`/`T2` draws afterward.

A zero weight means "never pick this treatment." This is useful when you want to keep a condition in the file but turn it off for a particular batch without renumbering everything.

## Realized vs. target rates under eligibility constraints

The most common gotcha with `weighted-random` (and with `urn`, for the same underlying reason) is that the realized rates only match your target weights when **every round is feasible for every treatment**. Two things can break feasibility:

1. **Tight eligibility conditions** filter the candidate pool down. If only 20% of recruits satisfy treatment T0's role condition, T0 won't see its full target rate no matter how high you set its weight — there aren't enough eligible participants to fill it.
2. **Per-tick player-pool size** can be too small for some treatments. If a treatment requires 6 players but the dispatch tick has only 4 available, that treatment is excluded from this round's pool.

When a treatment drops out of a round's pool, the weight mass is implicitly renormalized across the surviving treatments. So a 4:1:1 batch with a too-tight eligibility on T0 won't deliver 67/17/17 — it'll deliver something more like 0/50/50 conditional on the tight rounds. The dispatcher is doing what you asked at every round; the design constraint is what's biting.

### A worked example

Suppose you set:

```yaml
dispatcher:
  type: weighted-random
  weights: [4, 1, 1]
```

with three two-player treatments. T0 requires *both* slots to be moderators (`self.prompt.role equals "moderator"`); T1 and T2 have no conditions. Recruitment pulls in 100 participants of whom 20 self-report as moderators (a 20% marginal rate).

Each dispatch tick draws 6 available players. For T0 to be picked *and* fillable, the tick needs at least 2 moderators among its 6 players. Under independent arrival that's a binomial probability — ~**34%** of ticks.[^1] In the other 66%, T0 drops out of the pool, and the dispatcher renormalizes the surviving weights `[1, 1]` over T1 and T2 — so T1 and T2 each absorb half the mass T0 would have taken.

Working that out per round:

- **T0 picked & filled**: `0.34 × (4/6) = 23%`
- **T1 picked**: `0.34 × (1/6) + 0.66 × (1/2) ≈ 39%`
- **T2 picked**: `0.34 × (1/6) + 0.66 × (1/2) ≈ 39%`

Compared to the target weights:

| | Target (weights/sum) | Realized | Gap |
|---|---|---|---|
| T0 | 67% | 23% | **−44 pp** |
| T1 | 17% | 39% | +22 pp |
| T2 | 17% | 39% | +22 pp |

The dispatcher is honoring `weights: [4, 1, 1]` at every feasible round. The 44-percentage-point shortfall on T0 is a study-design issue — you've asked for more moderator-condition assignments than your recruitment can supply.

[^1]: `P(K ≥ 2 | n=6, p=0.2) = 1 − P(0) − P(1) = 1 − 0.8⁶ − 6·0.2·0.8⁵ ≈ 0.345`. The exact number depends on your tick size and your moderator marginal rate; the qualitative point — that tight eligibility on a high-weight treatment causes its realized rate to fall well below its weight — holds across this whole regime.

### What to do about it

Three options, in increasing order of effort:

1. **Recruit until the rates match.** If your downstream analysis doesn't depend on exact N per cell, just let the batch run longer. Realized rates converge to weights *conditional on feasibility*; the slope is whatever your recruitment pipeline delivers.
2. **Loosen eligibility on the constrained treatment** if the condition is over-specified for what you actually need. The most common case: a condition that *could* be evaluated post-hoc as a covariate instead of gated upstream.
3. **Use `urn` instead** if you need *exact* target Ns per treatment. `urn` keeps allocating to a treatment until its target count is drained, so it will sit on a tight-eligibility condition until enough qualifying participants arrive. That comes with the tradeoff that other treatments stop receiving allocations once they hit their targets, even if more participants arrive.

### Diagnostics

The host (deliberation-lab in our deployment) gets the assignments back after every dispatch tick and can compute realized rates directly. If you're partway through a batch and the realized rate looks off relative to your target weights, the most likely cause is one of the two feasibility issues above. Check what fraction of your participants satisfy the constrained treatment's conditions; that fraction is roughly the ceiling on its realized rate.

## `urn` in detail

Reach for `urn` when you need an **exact count** of each treatment rather than a target rate. The algorithm draws from a metaphorical urn of "balls" labeled with treatment names — each successful assignment removes one (or more, see [decrements](#building-decrements)) of the picked treatment's balls. When a treatment's balls are gone, it stops being picked.

The minimal config:

```yaml
dispatcher:
  type: urn
  counts: [10, 10, 10]
```

That delivers exactly 10 assignments to each treatment over the batch, then stops.

### How draws are picked

Each round, the dispatcher samples one treatment from the size-feasible pool with probability **proportional to its remaining count**. Early in the batch when all counts are equal, the draws look uniform. As one treatment fills up, its count shrinks and it's picked less often; once a count hits zero the treatment drops out of the pool entirely. The arithmetic guarantees that, over the whole batch, each treatment is used exactly its target count of times — there's no slack to converge over a long run, because the urn enforces the target deterministically.

This is the central difference from `weighted-random`: that dispatcher hits target *rates* in expectation given infinite recruitment; `urn` hits target *counts* exactly given enough eligible participants.

### Building `counts`

`counts` is a non-negative integer array with one entry per treatment, in the same order as `treatments` in your batch config. Most studies fall into one of two patterns.

**Balanced allocation.** All treatments get the same target N:

```yaml
treatments: [control, exposure_A, exposure_B]
dispatcher:
  type: urn
  counts: [30, 30, 30]   # 90 total assignments, 30 each
```

**Asymmetric Ns.** When some conditions need bigger samples than others — e.g., a control plus two main exposures plus two underpowered pilot conditions:

```yaml
treatments: [control, main_A, main_B, pilot_C, pilot_D]
dispatcher:
  type: urn
  counts: [40, 40, 40, 10, 10]
```

The pilot conditions stop drawing once their 10 balls are gone; the main conditions and control keep filling. If your batch over-recruits past 140 total participants, the extra arrivals can't be assigned to anything — see [Exhaustion](#exhaustion) below.

### Building `decrements`

`decrements` is an **optional** square matrix that controls how many balls get removed from each bucket after a successful assignment. The shape is `decrements[i][j]` = "how many balls to remove from treatment `j` when treatment `i` is picked." Rows are the *picked* treatment; columns are the *affected* buckets.

When omitted, the default is the **identity matrix** — picking treatment `i` removes exactly one ball from treatment `i` and leaves all others alone. That's what most studies want, and it's why `decrements` is optional.

The non-default cases are all about *coupling*: when picking one treatment should also decrement another, because they share something.

#### Pattern 1: Identity (the default)

For three treatments, the implicit matrix is:

```json
[[1, 0, 0],
 [0, 1, 0],
 [0, 0, 1]]
```

Each draw consumes exactly one ball from its own bucket. Equivalent to omitting `decrements` entirely; shown here only so the rest of the patterns have a baseline to differ from.

#### Pattern 2: Coupled draws (shared resource)

Suppose `moderated_A` and `moderated_B` both consume the same hard-to-recruit pool — both require participants who self-report as professional moderators, and your overall recruitment ceiling on moderators is 30 people. A naive `counts: [30, 30, 60]` would imply *60* moderator assignments, more than your pipeline can supply. Use off-diagonal decrements to encode the shared resource:

```yaml
treatments: [moderated_A, moderated_B, unmoderated]
dispatcher:
  type: urn
  counts: [30, 30, 60]
  decrements:
    - [1, 1, 0]   # picking moderated_A removes 1 ball from A *and* 1 from B
    - [1, 1, 0]   # picking moderated_B removes 1 ball from A *and* 1 from B
    - [0, 0, 1]   # picking unmoderated only removes 1 from its own bucket
```

Now `moderated_A` and `moderated_B` deplete together: across the two combined, only 30 moderator assignments are made, matching the actual ceiling. Within those 30, the split between A and B is roughly even because both buckets decrement at the same rate.

The trick generalizes: any off-diagonal entry encodes "this draw also depletes that other bucket."

#### Pattern 3: Spatial / kernel matrices

If your treatments are arranged in a continuous space — for example, 20 prompt phrasings on a one-dimensional sentiment scale, or a 2D grid of (issue × framing) — you may want to spread assignments across the space rather than allow concentration in any one spot. The decrements matrix can encode spatial proximity: drawing one treatment depletes its near-neighbors' buckets too, so the dispatcher naturally avoids clustering.

A common construction is a Gaussian kernel over a pairwise distance, computed offline:

```python
import numpy as np

# 1D embedding of treatment positions (could equally be 2D, etc.)
positions = np.linspace(0, 1, 20)
distances = np.abs(positions[:, None] - positions[None, :])

# Gaussian kernel; sigma controls the "neighborhood radius"
sigma = 0.1
kernel = np.exp(-(distances ** 2) / (2 * sigma ** 2))

# Scale + round to integers — the schema requires non-negative ints.
# Tuning target: the diagonal stays 1 (self-decrement); a treatment's
# immediate neighbors round to 1 (coupled); far treatments round to 0.
scale = 1.0
decrements = np.maximum(0, np.round(kernel * scale)).astype(int).tolist()
```

The resulting matrix is mostly identity-like along the diagonal with small positive off-diagonals between near-neighbors. This is the load-bearing case for studies with hundreds of treatments arranged in a continuous space.

A few caveats specific to kernel constructions:

1. **Integer arithmetic.** The schema requires non-negative integers, so rounding a continuous kernel will introduce small distortions. For typical research scales the broad-coverage property is robust; if you need higher fidelity, scale `counts` and `decrements` by a common integer factor before rounding.
2. **Watch the row sums.** `decrements.sum(axis=1)` for each row tells you how many balls each pick removes in total across all buckets. If you intended each pick to remove approximately one ball net, every row sum should be near 1. Off-diagonals that are too large can deplete your urn far faster than your `counts` total suggests.
3. **Underflow is silently clamped.** If a draw would push some `counts[j]` below zero — possible with coupled draws — the dispatcher clamps to zero rather than throwing. You can detect this by comparing the input `counts` to the output `remainingCounts` and looking for picks where the net change was less than what `decrements` should have removed.

### Using file references for large matrices

Both `counts` and `decrements` can be supplied inline (as in the examples above) or as a reference to a JSON file in your assets repo:

```yaml
dispatcher:
  type: urn
  counts:     { file: "study1/counts.json" }
  decrements: { file: "study1/decrements.json" }
```

Reach for file references when:

- The matrix is computed by an offline solver (Python notebook, R script, etc.) and you want the computation tracked as an artifact in your assets repo
- The matrix is large enough that inlining clutters the batch config (anything past ~5–10 treatments tends to feel that way)
- You want to version the matrix separately from the batch config

The file shape is just a JSON array (for `counts`) or array-of-arrays (for `decrements`):

**`counts.json`:**

```json
[30, 30, 30, 10, 10]
```

**`decrements.json`** (the coupled-resource example from Pattern 2):

```json
[[1, 1, 0],
 [1, 1, 0],
 [0, 0, 1]]
```

File references are resolved by the host (deliberation-lab in our deployment), not by stagebook itself — stagebook's algorithm runs on already-resolved arrays. The host enforces these path constraints: must be relative (no leading `/`), must not contain `..` segments, must not begin with a URL scheme (`https:`, `file:`, etc.), and is capped at 512 characters. The path is resolved against the same `assetBaseUrl` your treatment file is served from. The file is fetched at batch creation time and validated; a missing or malformed file fails batch creation rather than a later dispatch tick.

A typical workflow:

1. Compute the matrix in your analysis repo (offline solver — Python, R, etc.)
2. Write the result to `counts.json` / `decrements.json`
3. Commit them to your assets repo, alongside your treatment YAML
4. Reference from the batch config via `{ file: "<path>" }`

This keeps the offline computation auditable and the batch config readable.

### Exhaustion

Once every bucket in the urn hits zero, no further assignments can be made. New arrivals to the lobby will sit until they hit the existing `lobbyTimeout`. A dedicated host-side admission gate — including a distinct `lobbyClosed` exit code — is proposed in deliberation-lab/deliberation-lab#269 but isn't shipped yet. For now: size your `counts` so the total matches or exceeds your recruitment target, plan for some over-recruitment slack to handle eligibility-tight conditions, and accept that any excess arrivals beyond `sum(counts)` will time out rather than be assigned.

### Realized vs. target Ns under eligibility constraints

The same feasibility caveat applies to `urn` as it does to `weighted-random` (see [above](#realized-vs-target-rates-under-eligibility-constraints)), with one important difference: `urn` *doesn't renormalize away* from a constrained treatment. If treatment T0 has 30 balls and a tight eligibility condition that only 20% of recruits satisfy, the urn keeps T0 in the pool — and draws T0 every time the tick happens to include enough eligible players. The other treatments still fill in parallel, and T0 keeps holding out for qualifying arrivals.

That's the point. The tradeoff is that the batch can't complete until T0's count is drained or no more eligible participants arrive — so either over-recruit by enough margin to satisfy your tightest condition, or accept that the batch may stall on T0 with un-assignable participants accumulating in the lobby.
