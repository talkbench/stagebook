# Choosing a Dispatcher

A **dispatcher** is the algorithm that decides which treatment each group of participants gets routed to. Stagebook ships four:

| Dispatcher           | What you provide                                          | What it guarantees                                                    | When to reach for it                                                                                   |
| -------------------- | --------------------------------------------------------- | --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `uniform-random`     | nothing                                                   | Each group's treatment is an independent uniform draw                 | Quick prototypes; you have no balance claim to make in a methods section                               |
| `weighted-random`    | one weight per treatment                                  | Each group's treatment is an independent draw with `P(T) ∝ weight(T)` | You want unequal long-run rates (e.g. 80/10/10) but don't need exact-N targets                         |
| `urn`                | target counts per treatment (+ optional decrement matrix) | Each treatment is used exactly its target count over the batch        | You want exact target Ns or cross-treatment locality (e.g. "don't pick the same label twice in a row") |
| `weighted-knockdown` | payoffs + knockdowns + optional temperature               | Each pick is softmax-sampled over the running payoffs; picked treatments' payoffs decay per the knockdown rule | You're running a researcher-managed Bayesian-optimization surrogate between batches; want softmax-based exploration within the batch |

The first three are stateless or carry only a small piece of state (urn's remaining counts). All four pre-compute eligibility from each participant's data; the algorithm itself sees only IDs, treatment structure, and a boolean eligibility lookup — never the underlying responses.

> **Stagebook 0.14 breaking change.** `weighted-random`'s `weights` and `urn`'s `counts` and `decrements` are now **labeled objects** keyed by treatment name. The previous positional-array form (`counts: [10, 10, 10]`, `decrements: [[1,0,0], ...]`) was removed because it silently mis-mapped when treatments were renamed or reordered. The validator now rejects old positional configs with a migration hint pointing to this document; see [Why labels?](#why-labels) for the rationale.

> **Stagebook 0.15 breaking change.** The `local-penalization` dispatcher (config-shape placeholder; implementation lived in deliberation-lab) is replaced by `weighted-knockdown` — a simpler, in-stagebook implementation with explicit state-in/state-out and softmax-based exploration. Existing batch configs using `type: "local-penalization"` need to be updated to `type: "weighted-knockdown"` and the optional `temperature` field added. See [`weighted-knockdown` in detail](#weighted-knockdown-in-detail) below for the new shape.

## `weighted-random` in detail

This is the dispatcher most ordinary randomized experiments want when the allocation isn't 50/50. You specify weights up to scale, keyed by treatment name:

```yaml
dispatcher:
  type: weighted-random
  weights:
    T_moderated: 4 # picked four times as often as either of the controls long-run
    T_control_A: 1
    T_control_B: 1
```

The weights are interpreted up to scale — `{T_a: 4, T_b: 1}`, `{T_a: 80, T_b: 20}`, and `{T_a: 0.8, T_b: 0.2}` are all the same sampler. Each round, the dispatcher draws a treatment with probability proportional to its weight, independently of every other round. There is no memory of which treatment was picked last; in particular, a run of three consecutive `T_moderated` draws is not "balanced out" by extra `T_control_*` draws afterward.

A zero weight means "never pick this treatment." This is useful when you want to keep a condition in the file but turn it off for a particular batch without removing it.

### Label discipline

The keys of `weights` must exactly match the names in your `treatments:` block — no missing names (the validator will tell you which are absent) and no extra names (the validator will tell you which don't correspond to a real treatment). This protects you from the silent failure mode where renaming or reordering treatments quietly remaps your weights to the wrong arms.

## Realized vs. target rates under eligibility constraints

The most common gotcha with `weighted-random` (and with `urn`, for the same underlying reason) is that the realized rates only match your target weights when **every round is feasible for every treatment**. Two things can break feasibility:

1. **Tight eligibility conditions** filter the candidate pool down. If only 20% of recruits satisfy treatment T0's role condition, T0 won't see its full target rate no matter how high you set its weight — there aren't enough eligible participants to fill it.
2. **Per-tick player-pool size** can be too small for some treatments. If a treatment requires 6 players but the dispatch tick has only 4 available, that treatment is excluded from this round's pool.

When a treatment drops out of a round's pool, the weight mass is implicitly renormalized across the surviving treatments. So a 4:1:1 batch with a too-tight eligibility on `T_moderated` won't deliver 67/17/17 — it'll deliver something more like 0/50/50 conditional on the tight rounds. The dispatcher is doing what you asked at every round; the design constraint is what's biting.

### A worked example

Suppose you set:

```yaml
dispatcher:
  type: weighted-random
  weights:
    T_moderated: 4
    T_control_A: 1
    T_control_B: 1
```

with three two-player treatments. `T_moderated` requires _both_ slots to be moderators (`self.prompt.role equals "moderator"`); the two controls have no conditions. Recruitment pulls in 100 participants of whom 20 self-report as moderators (a 20% marginal rate).

Each dispatch tick draws 6 available players. For `T_moderated` to be picked _and_ fillable, the tick needs at least 2 moderators among its 6 players. Under independent arrival that's a binomial probability — ~**34%** of ticks.[^1] In the other 66%, `T_moderated` drops out of the pool, and the dispatcher renormalizes the surviving weights `[1, 1]` over the two controls — so they each absorb half the mass `T_moderated` would have taken.

Working that out per round:

- **T_moderated picked & filled**: `0.34 × (4/6) = 23%`
- **T_control_A picked**: `0.34 × (1/6) + 0.66 × (1/2) ≈ 39%`
- **T_control_B picked**: `0.34 × (1/6) + 0.66 × (1/2) ≈ 39%`

Compared to the target weights:

| Treatment   | Target (weight/sum) | Realized | Gap        |
| ----------- | ------------------- | -------- | ---------- |
| T_moderated | 67%                 | 23%      | **−44 pp** |
| T_control_A | 17%                 | 39%      | +22 pp     |
| T_control_B | 17%                 | 39%      | +22 pp     |

The dispatcher is honoring `weights: {T_moderated: 4, T_control_A: 1, T_control_B: 1}` at every feasible round. The 44-percentage-point shortfall on `T_moderated` is a study-design issue — you've asked for more moderator-condition assignments than your recruitment can supply.

[^1]: `P(K ≥ 2 | n=6, p=0.2) = 1 − P(0) − P(1) = 1 − 0.8⁶ − 6·0.2·0.8⁵ ≈ 0.345`. The exact number depends on your tick size and your moderator marginal rate; the qualitative point — that tight eligibility on a high-weight treatment causes its realized rate to fall well below its weight — holds across this whole regime.

### What to do about it

Three options, in increasing order of effort:

1. **Recruit until the rates match.** If your downstream analysis doesn't depend on exact N per cell, just let the batch run longer. Realized rates converge to weights _conditional on feasibility_; the slope is whatever your recruitment pipeline delivers.
2. **Loosen eligibility on the constrained treatment** if the condition is over-specified for what you actually need. The most common case: a condition that _could_ be evaluated post-hoc as a covariate instead of gated upstream.
3. **Use `urn` instead** if you need _exact_ target Ns per treatment. `urn` keeps allocating to a treatment until its target count is drained, so it will sit on a tight-eligibility condition until enough qualifying participants arrive. That comes with the tradeoff that other treatments stop receiving allocations once they hit their targets, even if more participants arrive.

### Diagnostics

The host (deliberation-lab in our deployment) gets the assignments back after every dispatch tick and can compute realized rates directly. If you're partway through a batch and the realized rate looks off relative to your target weights, the most likely cause is one of the two feasibility issues above. Check what fraction of your participants satisfy the constrained treatment's conditions; that fraction is roughly the ceiling on its realized rate.

## `urn` in detail

Reach for `urn` when you need an **exact count** of each treatment rather than a target rate. The algorithm draws from a metaphorical urn of "balls" labeled with treatment names — each successful assignment removes one (or more, see [decrements](#building-decrements)) of the picked treatment's balls. When a treatment's balls are gone, it stops being picked.

The minimal config:

```yaml
treatments: [control, exposure_A, exposure_B]
dispatcher:
  type: urn
  counts:
    control: 10
    exposure_A: 10
    exposure_B: 10
```

That delivers exactly 10 assignments to each treatment over the batch, then stops.

### How draws are picked

Each round, the dispatcher samples one treatment from the size-feasible pool with probability **proportional to its remaining count**. Early in the batch when all counts are equal, the draws look uniform. As one treatment fills up, its count shrinks and it's picked less often; once a count hits zero the treatment drops out of the pool entirely. The arithmetic guarantees that, over the whole batch, each treatment is used exactly its target count of times — there's no slack to converge over a long run, because the urn enforces the target deterministically.

This is the central difference from `weighted-random`: that dispatcher hits target _rates_ in expectation given infinite recruitment; `urn` hits target _counts_ exactly given enough eligible participants.

### Building `counts`

`counts` is a map from treatment name to non-negative integer. The key set must exactly match the names in your `treatments:` block. Most studies fall into one of two patterns.

**Balanced allocation.** All treatments get the same target N:

```yaml
treatments: [control, exposure_A, exposure_B]
dispatcher:
  type: urn
  counts:
    control: 30
    exposure_A: 30
    exposure_B: 30
  # 90 total assignments, 30 each
```

**Asymmetric Ns.** When some conditions need bigger samples than others — e.g., a control plus two main exposures plus two underpowered pilot conditions:

```yaml
treatments: [control, main_A, main_B, pilot_C, pilot_D]
dispatcher:
  type: urn
  counts:
    control: 40
    main_A: 40
    main_B: 40
    pilot_C: 10
    pilot_D: 10
```

The pilot conditions stop drawing once their 10 balls are gone; the main conditions and control keep filling. If your batch over-recruits past 140 total participants, the extra arrivals can't be assigned to anything — see [Exhaustion](#exhaustion) below.

### Building `decrements`

`decrements` is an **optional** labeled matrix that controls how many balls get removed from each bucket after a successful assignment. The shape is `decrements[row][col]` = "how many balls to remove from treatment `col` when treatment `row` is picked." Rows are the _picked_ treatment; columns are the _affected_ buckets.

The choice to specify `decrements` is binary:

- **`decrements` omitted entirely** → the matrix defaults to the **identity matrix**. Picking treatment `T` removes exactly one ball from `T` and leaves all others alone. That's what most studies want, and it's why `decrements` is optional.
- **`decrements` present** → the matrix is taken as a **strict literal**. Every treatment must have a row (no implicit identity for omitted rows); within each row, missing column entries default to 0 (no decrement). If you want identity behavior on a particular row, write it explicitly: `T_a: { T_a: 1 }`.

The "matrix on or off" framing keeps the mental model simple and avoids the footgun where a partial row would silently zero out a self-decrement.

The non-default cases — i.e., the reasons to specify `decrements` at all — are about _coupling_: when picking one treatment should also decrement another, because they share something.

> **Heads-up.** If a treatment's row has a zero (or missing) self-decrement entry, the treatment will never deplete from its own picks — it can only deplete via cross-coupled rows, if any. The validator surfaces this as a warning. This is intentional behavior for cross-coupled-only designs, but it's much more often a typo, so it's worth checking the warning when you see it.

#### Pattern 1: Identity (the default)

For three treatments, the implicit matrix is:

```yaml
decrements:
  control: { control: 1 }
  exposure_A: { exposure_A: 1 }
  exposure_B: { exposure_B: 1 }
```

Each draw consumes exactly one ball from its own bucket. Equivalent to omitting `decrements` entirely — shown here only so the rest of the patterns have a baseline to differ from. In practice you'd never write this out; just omit `decrements` and the dispatcher uses it automatically.

#### Pattern 2: Coupled draws (shared resource)

Suppose `moderated_A` and `moderated_B` both consume the same hard-to-recruit pool — both require participants who self-report as professional moderators, and your overall recruitment ceiling on moderators is 30 people. A naive `counts: {moderated_A: 30, moderated_B: 30, unmoderated: 60}` would imply _60_ moderator assignments, more than your pipeline can supply. Use off-diagonal decrements to encode the shared resource:

```yaml
treatments: [moderated_A, moderated_B, unmoderated]
dispatcher:
  type: urn
  counts:
    moderated_A: 30
    moderated_B: 30
    unmoderated: 60
  decrements:
    moderated_A:
      moderated_A: 1 # self-decrement
      moderated_B: 1 # cross-decrement: picking A also depletes B's bucket
    moderated_B:
      moderated_A: 1 # cross-decrement: picking B also depletes A's bucket
      moderated_B: 1
    unmoderated:
      unmoderated: 1 # explicit identity — required because we specified `decrements`
```

Now `moderated_A` and `moderated_B` deplete together: across the two combined, only 30 moderator assignments are made, matching the actual ceiling. Within those 30, the split between A and B is roughly even because both buckets decrement at the same rate.

The trick generalizes: any off-diagonal entry encodes "this draw also depletes that other bucket."

#### Pattern 3: Spatial / kernel matrices

If your treatments are arranged in a continuous space — for example, 20 prompt phrasings on a one-dimensional sentiment scale, or a 2D grid of (issue × framing) — you may want to spread assignments across the space rather than allow concentration in any one spot. The decrements matrix can encode spatial proximity: drawing one treatment depletes its near-neighbors' buckets too, so the dispatcher naturally avoids clustering.

A common construction is a Gaussian kernel over a pairwise distance, computed offline:

```python
import json
import numpy as np

# Treatment names, in whatever order matches your treatments: block.
names = [f"prompt_{i:02d}" for i in range(20)]

# 1D embedding of treatment positions (could equally be 2D, etc.)
positions = np.linspace(0, 1, len(names))
distances = np.abs(positions[:, None] - positions[None, :])

# Gaussian kernel; sigma controls the "neighborhood radius"
sigma = 0.1
kernel = np.exp(-(distances ** 2) / (2 * sigma ** 2))

# Scale + round to integers — the schema requires non-negative ints.
# Tuning target: the diagonal stays 1 (self-decrement); a treatment's
# immediate neighbors round to 1 (coupled); far treatments round to 0.
scale = 1.0
matrix = np.maximum(0, np.round(kernel * scale)).astype(int)

# Emit labeled JSON: { row_name: { col_name: value, ... }, ... }.
# Every treatment needs a row (strict-literal rule); within each row,
# we omit zero entries to keep the file readable (missing column =>
# 0 inside a row that's present).
decrements = {
    row: {col: int(matrix[i, j]) for j, col in enumerate(names) if matrix[i, j] > 0}
    for i, row in enumerate(names)
}
with open("decrements.json", "w") as f:
    json.dump(decrements, f, indent=2)
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
  counts: { from: "study1/counts.json" }
  decrements: { from: "study1/decrements.json" }
```

Reach for file references when:

- The matrix is computed by an offline solver (Python notebook, R script, etc.) and you want the computation tracked as an artifact in your assets repo
- The matrix is large enough that inlining clutters the batch config (anything past ~5–10 treatments tends to feel that way)
- You want to version the matrix separately from the batch config

The file shape mirrors the inline form — a labeled JSON object whose keys match treatment names:

**`counts.json`** (the asymmetric-N example from earlier):

```json
{
  "control": 40,
  "main_A": 40,
  "main_B": 40,
  "pilot_C": 10,
  "pilot_D": 10
}
```

**`decrements.json`** (the coupled-resource example from Pattern 2):

```json
{
  "moderated_A": { "moderated_A": 1, "moderated_B": 1 },
  "moderated_B": { "moderated_A": 1, "moderated_B": 1 },
  "unmoderated": { "unmoderated": 1 }
}
```

Every treatment with positive counts needs a row when you specify `decrements` — even rows that are just identity (`{"unmoderated": 1}`). If you wanted identity behavior throughout, you'd just omit `decrements` entirely.

<a id="why-labels"></a>**Why labels?** Earlier versions of stagebook (≤ 0.13) accepted positional arrays here (`[30, 30, 30, 10, 10]`). That form silently mis-mapped if the treatment list got reordered or a treatment was renamed — the dispatcher would happily run with the wrong allocation. The labeled form makes the mapping explicit, so the validator catches drift instead of producing wrong assignments. If you have an old positional file, the validator at batch-creation time will refuse it with an error message pointing at this section; the dispatcher itself has a runtime guard for the same case, so even hand-constructed batches that bypass the validator will fail loudly rather than silently mis-route.

File references are resolved by the host (deliberation-lab in our deployment), not by stagebook itself — stagebook's algorithm runs on already-resolved objects. The host enforces these path constraints: must be relative (no leading `/`), must not contain `..` segments, must not begin with a URL scheme (`https:`, `file:`, etc.), and is capped at 512 characters. The path is resolved against the same `assetBaseUrl` your treatment file is served from. The file is fetched at batch creation time and validated; a missing or malformed file fails batch creation rather than a later dispatch tick.

A typical workflow:

1. Compute the matrix in your analysis repo (offline solver — Python, R, etc.)
2. Write the result to `counts.json` / `decrements.json` in labeled form
3. Commit them to your assets repo, alongside your treatment YAML
4. Reference from the batch config via `{ from: "<path>" }`

This keeps the offline computation auditable and the batch config readable.

### Exhaustion

Once every bucket in the urn hits zero, no further assignments can be made. New arrivals to the lobby will sit until they hit the existing `lobbyTimeout`. A dedicated host-side admission gate — including a distinct `lobbyClosed` exit code — is proposed in deliberation-lab/deliberation-lab#269 but isn't shipped yet. For now: size your `counts` so the total matches or exceeds your recruitment target, plan for some over-recruitment slack to handle eligibility-tight conditions, and accept that any excess arrivals beyond `sum(counts)` will time out rather than be assigned.

### Realized vs. target Ns under eligibility constraints

The same feasibility caveat applies to `urn` as it does to `weighted-random` (see [above](#realized-vs-target-rates-under-eligibility-constraints)), with one important difference: `urn` _doesn't renormalize away_ from a constrained treatment. If `T_moderated` has 30 balls and a tight eligibility condition that only 20% of recruits satisfy, the urn keeps `T_moderated` in the pool — and draws it every time the tick happens to include enough eligible players. The other treatments still fill in parallel, and `T_moderated` keeps holding out for qualifying arrivals.

That's the point. The tradeoff is that the batch can't complete until `T_moderated`'s count is drained or no more eligible participants arrive — so either over-recruit by enough margin to satisfy your tightest condition, or accept that the batch may stall on `T_moderated` with un-assignable participants accumulating in the lobby.

## `weighted-knockdown` in detail

Reach for `weighted-knockdown` when you're running a **researcher-managed Bayesian-optimization surrogate** between batches: you have an external model that produces a payoff vector (your current estimate of treatment utility), you ship it to the batch, and you want the dispatcher to sample-with-exploration within the batch while down-weighting treatments you've already assigned to. Between batches, you update your surrogate offline (from collected outcome data) and ship a new payoff vector to the next batch.

This is conceptually [Gonzalez et al. 2016](https://arxiv.org/abs/1505.08052)'s "Batch BO via Local Penalization" with the within-batch acquisition function held static (= the static payoff vector) and the local penalization expressed as a knockdown rule. Stagebook ships the algorithm; your offline solver supplies the payoffs.

The minimal config:

```yaml
dispatcher:
  type: weighted-knockdown
  payoffs:
    T_control: 1
    T_exposure_A: 1.5
    T_exposure_B: 0.8
  knockdowns: 0.5 # scalar self-decay; picking T_x halves its payoff
  temperature: 1 # softmax temperature; 0 = argmax + random tiebreak
```

Each round, the dispatcher samples a treatment by softmax over the running payoff vector, fills it, then multiplies the payoffs by the knockdown rule before the next round. State (the attenuated payoffs) is returned at the end of each tick so the host can persist it across the batch.

### Picking the selection rule

| `temperature` value | Selection rule | Use when |
| --- | --- | --- |
| `0` (default) | Argmax with uniform random tiebreak | You want greedy "always pick the current best"; the surrogate already does the exploration |
| `> 0` (finite) | Softmax: `P(T) ∝ exp(payoff(T) / temperature)` | You want intrinsic exploration; higher `T` flattens the distribution toward uniform |
| Very large (e.g. `1e6`) | Effectively uniform over feasible pool | You're verifying the algorithm's mass-action limit; not generally useful in production |

At `T=0`, ties at the argmax are broken uniformly at random — so a batch with all-equal payoffs and no knockdowns gives a uniform random sampler. As `T` increases, the softmax flattens; in the limit, you get the same uniform behavior.

> **Exhausted treatments are filtered out at every `T`.** Treatments whose payoff has dropped to zero (or below) are excluded from the feasible pool — they can't be argmax-picked at `T=0` and aren't softmax-sampled at `T>0` either, regardless of how large `T` is. This matches the local-penalization convention: payoff `= 0` is the "fully decayed" sentinel, not "low probability." If you want a treatment to remain at a nonzero baseline probability across the batch, keep its payoff strictly above 0; the knockdowns shouldn't drive it to 0 unless you intend for it to drop out of the pool.

### Picking the knockdown rule

Four shapes, in increasing order of expressivity:

| `knockdowns` shape | Effect on picking treatment `T` | When to use |
| --- | --- | --- |
| `"none"` | No change to any payoff | Pure exploitation; your surrogate handles all the spread |
| scalar `k ∈ [0, 1]` | `payoffs[T] *= k` | Uniform self-decay; the simplest "encourage spread" rule |
| labeled scalars `{T_a: k_a, ...}` | `payoffs[T] *= k[T]` | Per-treatment self-decay rate; some treatments decay faster than others |
| labeled matrix `{T_a: {T_a: k_aa, T_b: k_ab, ...}, ...}` | `payoffs[U] *= matrix[T][U]` for every `U` | Pairwise / spatial decay (the load-bearing case for spatially-arranged treatments) |

The matrix form mirrors `urn`'s `decrements` matrix conceptually but multiplicatively rather than subtractively. Strict-literal rule: when you specify a matrix, every treatment must have a row; missing column entries within a row default to `1` (multiplicative identity, no decay on that column).

#### Pattern: cross-treatment spillover

If picking `T_arm_a` should also discourage `T_arm_b` (e.g. because they share an underlying intervention), encode it in the matrix:

```yaml
dispatcher:
  type: weighted-knockdown
  payoffs:
    T_arm_a: 1
    T_arm_b: 1
    T_control: 1
  knockdowns:
    T_arm_a:
      T_arm_a: 0.3 # heavy self-decay
      T_arm_b: 0.7 # picking A also discourages B
    T_arm_b:
      T_arm_a: 0.7 # symmetric
      T_arm_b: 0.3
    T_control:
      T_control: 0.5 # control decays at its own rate, no spillover
```

#### Pattern: spatial kernel (the load-bearing case)

For studies with many treatments arranged in a continuous space, generate the matrix offline (Python solver) and reference it via a file path:

```yaml
dispatcher:
  type: weighted-knockdown
  payoffs: { from: "study1/payoffs.json" }
  knockdowns: { from: "study1/knockdowns.json" }
  temperature: 0.5
```

```python
# Sketch — adapt to your treatment layout
import json
import numpy as np

names = [f"prompt_{i:02d}" for i in range(20)]
positions = np.linspace(0, 1, len(names))
distances = np.abs(positions[:, None] - positions[None, :])

# Gaussian kernel of decay strength; closer neighbors decay more
sigma = 0.1
attenuation = np.exp(-(distances ** 2) / (2 * sigma ** 2))
# Map attenuation strength to knockdown factor — diagonal heavy, off-diagonal light
# Knockdown values must be in [0, 1] (the validator rejects values
# outside that range). Diagonal heavier (more decay), off-diagonal
# lighter — bumping the 0.6 multiplier toward 1 would push some cells
# below 0 and trip validation.
factors = 1.0 - 0.6 * attenuation  # diagonal: 0.4; very-far: 1.0

knockdowns = {
    row: {col: float(factors[i, j]) for j, col in enumerate(names)}
    for i, row in enumerate(names)
}
with open("knockdowns.json", "w") as f:
    json.dump(knockdowns, f, indent=2)
```

The resulting matrix concentrates assignments away from spots you've already covered, naturally spreading exploration.

### State-in / state-out

Like `urn`, the dispatcher is pure: it takes the current payoff vector in, returns the updated payoff vector out. The host persists `newState.payoffs` across dispatch ticks and threads it back in:

```ts
// The first call accepts either the literal "equal" sugar or a
// labeled payoff object; `newState.payoffs` is always returned as
// the expanded labeled form, so subsequent calls keep the same shape.
let payoffs: LabeledScalars | "equal" = "equal";
// (Or, for a non-uniform prior:)
//   let payoffs: LabeledScalars = { T_a: 1.5, T_b: 0.8, T_control: 1.0 };

for (const tick of batch) {
  const result = weightedKnockdown({
    playerIds: tick.playerIds,
    treatments,
    payoffs, // ← carries the within-batch attenuation forward
    knockdowns,
    temperature,
    eligibility,
    rng,
  });
  emit(result.assignments);
  payoffs = result.newState.payoffs; // ← persist for next tick
}
```

Between batches, the host re-initializes `payoffs` from the offline surrogate's next output. Within-batch attenuation is local; cross-batch exploration is the surrogate's job.

### Exhaustion

A treatment whose payoff hits zero is filtered out of the feasible pool — at `T=0`, argmax can't pick it; at `T>0`, the per-round filter excludes non-positive payoffs explicitly to match the LP convention. If you set `knockdowns: 0` (allowed), a single pick zeros that treatment's payoff for the rest of the batch — useful when you want a hard "once each" rule layered on top of softmax sampling.

### Realized vs. target rates

The same feasibility caveats apply as for `weighted-random` and `urn` — if eligibility is tight, the realized rate diverges from the implied softmax distribution. The dispatcher honors the math at every feasible round; the design constraints are what bite.
