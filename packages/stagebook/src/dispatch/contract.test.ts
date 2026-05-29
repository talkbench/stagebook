// Run the generic dispatcher-contract gauntlet (10 structural
// invariants) against each dispatcher stagebook ships. Adding a new
// dispatcher means appending one `runContractSuite(...)` call; the
// same invariants run automatically.

import { buildEligibilityForScenario, runContractSuite } from "./contract.js";
import { uniformRandom } from "./uniformRandom.js";
import { weightedRandom } from "./weightedRandom.js";
import { urnRandomization } from "./urnRandomization.js";
import { weightedKnockdown } from "./weightedKnockdown.js";
import type { LabeledMatrix, LabeledScalars } from "./types.js";

runContractSuite("uniform-random", ({ scenario, rng }) => {
  const eligibility = buildEligibilityForScenario(scenario);
  return {
    params: {},
    dispatch: () =>
      uniformRandom({
        playerIds: scenario.players.map((p) => p.id),
        treatments: scenario.treatments,
        eligibility,
        rng,
      }),
  };
});

runContractSuite("weighted-random", ({ scenario, rng }) => {
  const eligibility = buildEligibilityForScenario(scenario);
  // Random per-scenario weights, keyed by treatment name. Mix of
  // distributions:
  //   - 25% all-equal (degenerate uniform-random case)
  //   - 25% one zero weight (de-activated treatment)
  //   - 50% random floats in [0.1, 4.0]
  // Avoids all-zero (which yields no assignments — trivially passes
  // every invariant but doesn't exercise the algorithm).
  const r = rng();
  const weights: LabeledScalars = {};
  scenario.treatments.forEach((t, i) => {
    if (r < 0.25) weights[t.name] = 1;
    else if (r < 0.5 && i === 0) weights[t.name] = 0;
    else weights[t.name] = 0.1 + rng() * 3.9;
  });
  return {
    params: { weights },
    dispatch: () =>
      weightedRandom({
        playerIds: scenario.players.map((p) => p.id),
        treatments: scenario.treatments,
        weights,
        eligibility,
        rng,
      }),
  };
});

runContractSuite("urn", ({ scenario, rng }) => {
  const eligibility = buildEligibilityForScenario(scenario);
  // Random per-scenario counts in [0, 5], keyed by treatment name.
  // Some zeros so the dispatcher exercises the "no balls left for
  // this treatment" branch.
  const counts: LabeledScalars = {};
  scenario.treatments.forEach((t) => {
    counts[t.name] = Math.floor(rng() * 6);
  });
  // Random decrement matrix: either identity (50% — use undefined to
  // exercise the dispatcher's identity-default code path) or a sparse
  // labeled matrix with integer entries small enough to avoid
  // validation rejections.
  let decrements: LabeledMatrix | undefined;
  if (rng() < 0.5) {
    decrements = undefined;
  } else {
    decrements = buildSafeDecrementMatrix(
      counts,
      scenario.treatments.map((t) => t.name),
      rng,
    );
  }
  return {
    params: { counts, decrements },
    dispatch: () =>
      urnRandomization({
        playerIds: scenario.players.map((p) => p.id),
        treatments: scenario.treatments,
        counts,
        decrements,
        eligibility,
        rng,
      }),
  };
});

runContractSuite("weighted-knockdown", ({ scenario, rng }) => {
  const eligibility = buildEligibilityForScenario(scenario);
  // Random per-scenario payoffs and knockdowns. Mix:
  //   - 30% all-equal payoffs (the "no prior" base case)
  //   - 70% labeled-scalars payoffs in [0.5, 5.0]
  // Knockdowns:
  //   - 33% "none"
  //   - 33% scalar in (0, 1]
  //   - 33% labeled-matrix with diagonal-leaning structure
  // Temperature:
  //   - 50% T=0 (argmax + tiebreak)
  //   - 50% T in [0.1, 5.0]
  let payoffs: LabeledScalars | "equal";
  if (rng() < 0.3) {
    payoffs = "equal";
  } else {
    const obj: LabeledScalars = {};
    for (const t of scenario.treatments) obj[t.name] = 0.5 + rng() * 4.5;
    payoffs = obj;
  }
  const knockdownChoice = rng();
  let knockdowns: number | "none" | LabeledMatrix;
  if (knockdownChoice < 0.33) {
    knockdowns = "none";
  } else if (knockdownChoice < 0.66) {
    knockdowns = 0.3 + rng() * 0.7; // scalar in [0.3, 1.0]
  } else {
    const m: LabeledMatrix = {};
    for (const ti of scenario.treatments) {
      const row: Record<string, number> = {};
      for (const tj of scenario.treatments) {
        // Diagonal heavier, off-diagonal lighter — common LP shape
        row[tj.name] =
          ti.name === tj.name ? 0.3 + rng() * 0.5 : 0.8 + rng() * 0.2;
      }
      m[ti.name] = row;
    }
    knockdowns = m;
  }
  const temperature = rng() < 0.5 ? 0 : 0.1 + rng() * 4.9;
  return {
    params: { payoffs, knockdowns, temperature },
    dispatch: () =>
      weightedKnockdown({
        playerIds: scenario.players.map((p) => p.id),
        treatments: scenario.treatments,
        payoffs,
        knockdowns,
        temperature,
        eligibility,
        rng,
      }),
  };
});

/** Build a labeled random decrement matrix where each
 *  `decrements[row][col] ≤ counts[col]`. Diagonal entries are 1 so a
 *  treatment's own counter actually decreases when the treatment is
 *  used (assuming positive count); off-diagonal entries are 0 or 1
 *  at 25% probability. */
function buildSafeDecrementMatrix(
  counts: LabeledScalars,
  names: string[],
  rng: () => number,
): LabeledMatrix {
  const m: LabeledMatrix = {};
  for (const rowName of names) {
    const row: Record<string, number> = {};
    for (const colName of names) {
      if (rowName === colName) {
        row[colName] = counts[colName] > 0 ? 1 : 0;
      } else if (rng() < 0.25 && counts[colName] > 0) {
        row[colName] = 1;
      }
      // omitted entries default to 0 at the dispatcher boundary
    }
    m[rowName] = row;
  }
  return m;
}
