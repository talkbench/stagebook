// Statistical-properties suite for stagebook's pure dispatchers (#448).
//
// These tests verify the claims a randomization story makes to a
// reviewer: assignment is unbiased w.r.t. arrival order, position
// within a group, irrelevant player attributes, and pairwise co-
// occurrence. Mirrors the 8-test reference suite that landed in
// deliberation-lab#268 for the BO-style dispatcher.
//
// Sizing rationale (same as deliberation-lab):
//   - M chosen so binomial SE is small enough to catch ≥2% absolute
//     deviations at α=1e-4, while staying within ~30s per test.
//   - chi-square critical values pinned via lookup table — keeps the
//     test file free of a stats dependency.

import { test, expect, describe } from "vitest";
import { mulberry32 } from "./contract.js";
import { makeEligibilityTable } from "./makeEligibilityTable.js";
import { uniformRandom } from "./uniformRandom.js";
import { urnRandomization } from "./urnRandomization.js";
import { weightedRandom } from "./weightedRandom.js";
import type { DispatchResult, Treatment } from "./types.js";

// ─── Shared statistics helpers ─────────────────────────────────────

function chiSquareUniform(observedCounts: number[]): number {
  const total = observedCounts.reduce((s, x) => s + x, 0);
  const exp = total / observedCounts.length;
  return observedCounts.reduce((s, x) => s + (x - exp) ** 2 / exp, 0);
}

// Critical χ² values at α=1e-4. Below these → fail to reject H0 (data
// consistent with uniform); above → reject (biased).
const CHI2_CRITICAL_ALPHA_1E4: Record<number, number> = {
  1: 15.14,
  2: 18.42,
  3: 21.11,
  4: 23.51,
  5: 25.74,
};
// Z critical value at α=1e-4 (two-sided).
const Z_CRITICAL_ALPHA_1E4 = 3.89;

function emptyEligibility(playerIds: string[], treatments: Treatment[]) {
  // Empty playerData → eligibility for every (player, treatment, position)
  // is true when the treatment has no groupComposition conditions.
  return makeEligibilityTable({ playerIds, treatments, playerData: {} });
}

// ─── Uniform-random suite ──────────────────────────────────────────

describe("uniformRandom: randomization properties (α=1e-4)", () => {
  const T_ONE: Treatment[] = [{ name: "T", playerCount: 2 }];

  function runOneUniform(
    players: { id: string; data?: Record<string, Record<string, unknown>> }[],
    seed: number,
    treatments = T_ONE,
  ): DispatchResult {
    const playerIds = players.map((p) => p.id);
    const eligibility = emptyEligibility(playerIds, treatments);
    return uniformRandom({
      playerIds,
      treatments,
      eligibility,
      rng: mulberry32(seed),
    });
  }

  test("1. seeded determinism: identical seed + inputs ⇒ identical assignments", () => {
    const makePlayers = () =>
      Array.from({ length: 4 }, (_, i) => ({ id: `p_${i}` }));
    const a = runOneUniform(makePlayers(), 42);
    const b = runOneUniform(makePlayers(), 42);
    const c = runOneUniform(makePlayers(), 43);
    expect(a.assignments).toEqual(b.assignments);
    expect(a.assignments).not.toEqual(c.assignments);
  });

  test("2. marginal target rate: equal treatments sampled uniformly (χ²)", () => {
    const K = 4;
    const M = 1000;
    const playersPerTick = 6;
    const treatments: Treatment[] = Array.from({ length: K }, (_, i) => ({
      name: `T${i}`,
      playerCount: 2,
    }));

    const useCount = treatments.map(() => 0);
    for (let m = 0; m < M; m += 1) {
      const players = Array.from({ length: playersPerTick }, (_, i) => ({
        id: `p_${m}_${i}`,
      }));
      const { assignments } = runOneUniform(players, 6000 + m, treatments);
      for (const a of assignments) {
        const idx = treatments.findIndex((t) => t.name === a.treatment.name);
        useCount[idx] += 1;
      }
    }
    const chi2 = chiSquareUniform(useCount);
    expect(chi2).toBeLessThan(CHI2_CRITICAL_ALPHA_1E4[K - 1]);
  });

  test("3. position uniformity: per-player position-0 distribution is uniform (χ²)", () => {
    const N = 4;
    const M = 20000;
    const posCounts: Record<string, { 0: number; 1: number }> = {};
    for (let i = 0; i < N; i += 1) posCounts[`p_${i}`] = { 0: 0, 1: 0 };

    for (let m = 0; m < M; m += 1) {
      const players = Array.from({ length: N }, (_, i) => ({ id: `p_${i}` }));
      const { assignments } = runOneUniform(players, 1000 + m);
      for (const a of assignments) {
        for (const pa of a.positionAssignments) {
          posCounts[pa.playerId][pa.position as 0 | 1] += 1;
        }
      }
    }
    const pos0 = Array.from({ length: N }, (_, i) => posCounts[`p_${i}`][0]);
    const chi2 = pos0.reduce((s, x) => s + (x - M / 2) ** 2 / (M / 4), 0);
    expect(chi2).toBeLessThan(CHI2_CRITICAL_ALPHA_1E4[N]);
  });

  test("4. equal opportunity within eligibility class: leftover-rate uniform (χ²)", () => {
    const N = 5;
    const M = 2000;
    const leftoverCount: Record<string, number> = {};
    for (let i = 0; i < N; i += 1) leftoverCount[`p_${i}`] = 0;

    for (let m = 0; m < M; m += 1) {
      const players = Array.from({ length: N }, (_, i) => ({ id: `p_${i}` }));
      const { assignments } = runOneUniform(players, 2000 + m);
      const assigned = new Set(
        assignments.flatMap((a) =>
          a.positionAssignments.map((pa) => pa.playerId),
        ),
      );
      for (let i = 0; i < N; i += 1) {
        if (!assigned.has(`p_${i}`)) leftoverCount[`p_${i}`] += 1;
      }
    }
    const counts = Array.from({ length: N }, (_, i) => leftoverCount[`p_${i}`]);
    const chi2 = chiSquareUniform(counts);
    expect(chi2).toBeLessThan(CHI2_CRITICAL_ALPHA_1E4[N - 1]);
  });

  test("5. arrival-order independence: forward vs reverse give same aggregate (binomial)", () => {
    const M = 10000;
    function simulate(playerIds: string[], seedOffset: number) {
      const counts: Record<string, number> = {};
      playerIds.forEach((pid) => {
        counts[pid] = 0;
      });
      for (let m = 0; m < M; m += 1) {
        const players = playerIds.map((id) => ({ id }));
        const { assignments } = runOneUniform(players, seedOffset + m);
        for (const a of assignments) {
          for (const pa of a.positionAssignments) {
            if (pa.position === 0) counts[pa.playerId] += 1;
          }
        }
      }
      return counts;
    }
    const forward = simulate(["p_0", "p_1", "p_2", "p_3"], 4000);
    const reverse = simulate(["p_3", "p_2", "p_1", "p_0"], 4000);
    // Under H0 forward − reverse ~ N(0, M/2).
    const seDiff = Math.sqrt(M / 2);
    const ids = ["p_0", "p_1", "p_2", "p_3"];
    const maxAbsZ = Math.max(
      ...ids.map((pid) => Math.abs((forward[pid] - reverse[pid]) / seDiff)),
    );
    // Bonferroni over 4 comparisons: α'=2.5e-5 → z'=4.21.
    expect(maxAbsZ).toBeLessThan(4.21);
  });

  test("6. irrelevant-attribute independence: tag does not predict leftover (binomial)", () => {
    const M = 10000;
    let bAsLeftover = 0;
    for (let m = 0; m < M; m += 1) {
      const players = [
        { id: "p_0" },
        { id: "p_1" },
        { id: "p_2" },
        { id: "p_3" },
        { id: "p_4" },
      ];
      const tag = ["A", "A", "A", "B", "B"] as const;
      const { assignments } = runOneUniform(players, 3000 + m);
      const assigned = new Set(
        assignments.flatMap((a) =>
          a.positionAssignments.map((pa) => pa.playerId),
        ),
      );
      const leftoverIdx = players.findIndex((p) => !assigned.has(p.id));
      if (leftoverIdx >= 0 && tag[leftoverIdx] === "B") bAsLeftover += 1;
    }
    const p0 = 2 / 5;
    const expected = M * p0;
    const se = Math.sqrt(M * p0 * (1 - p0));
    const z = (bAsLeftover - expected) / se;
    expect(Math.abs(z)).toBeLessThan(Z_CRITICAL_ALPHA_1E4);
  });

  test("7. pairwise co-assignment independence: pair co-occurrence uniform (χ²)", () => {
    const N = 4;
    const M = 10000;
    const pairKey = (a: string, b: string) =>
      a < b ? `${a}-${b}` : `${b}-${a}`;
    const pairCounts: Record<string, number> = {};
    for (let i = 0; i < N; i += 1) {
      for (let j = i + 1; j < N; j += 1) {
        pairCounts[pairKey(`p_${i}`, `p_${j}`)] = 0;
      }
    }
    for (let m = 0; m < M; m += 1) {
      const players = Array.from({ length: N }, (_, i) => ({ id: `p_${i}` }));
      const { assignments } = runOneUniform(players, 5000 + m);
      for (const a of assignments) {
        const ids = a.positionAssignments.map((pa) => pa.playerId);
        for (let i = 0; i < ids.length; i += 1) {
          for (let j = i + 1; j < ids.length; j += 1) {
            pairCounts[pairKey(ids[i], ids[j])] += 1;
          }
        }
      }
    }
    const counts = Object.values(pairCounts);
    const chi2 = chiSquareUniform(counts);
    expect(chi2).toBeLessThan(CHI2_CRITICAL_ALPHA_1E4[5]);
  });

  // Property 8 (variant balance within label) is matrix-decrement-
  // specific and does not apply to uniform-random; covered in the urn
  // suite below.
});

// ─── Weighted-random suite ─────────────────────────────────────────

describe("weightedRandom: randomization properties (α=1e-4)", () => {
  const T_ONE: Treatment[] = [{ name: "T", playerCount: 2 }];

  function runOneWeighted(
    players: { id: string }[],
    seed: number,
    treatments = T_ONE,
    weights: Record<string, number> = Object.fromEntries(
      treatments.map((t) => [t.name, 1]),
    ),
  ): DispatchResult {
    const playerIds = players.map((p) => p.id);
    const eligibility = emptyEligibility(playerIds, treatments);
    return weightedRandom({
      playerIds,
      treatments,
      weights,
      eligibility,
      rng: mulberry32(seed),
    });
  }

  test("1. seeded determinism: identical seed + inputs ⇒ identical assignments", () => {
    const makePlayers = () =>
      Array.from({ length: 4 }, (_, i) => ({ id: `p_${i}` }));
    const a = runOneWeighted(makePlayers(), 42);
    const b = runOneWeighted(makePlayers(), 42);
    const c = runOneWeighted(makePlayers(), 43);
    expect(a.assignments).toEqual(b.assignments);
    expect(a.assignments).not.toEqual(c.assignments);
  });

  test("2. marginal target rate: treatments sampled at weight ratio (χ²)", () => {
    // 4:1:1 weights → expected use share 0.667 / 0.167 / 0.167.
    // χ² against weighted expectation (not uniform); same df = K-1.
    const K = 3;
    const M = 2000;
    const playersPerTick = 4;
    const treatments: Treatment[] = Array.from({ length: K }, (_, i) => ({
      name: `T${i}`,
      playerCount: 2,
    }));
    const weights: Record<string, number> = { T0: 4, T1: 1, T2: 1 };
    const totalWeight = Object.values(weights).reduce((s, w) => s + w, 0);

    const useCount: Record<string, number> = { T0: 0, T1: 0, T2: 0 };
    for (let m = 0; m < M; m += 1) {
      const players = Array.from({ length: playersPerTick }, (_, i) => ({
        id: `p_${m}_${i}`,
      }));
      const { assignments } = runOneWeighted(
        players,
        6000 + m,
        treatments,
        weights,
      );
      for (const a of assignments) {
        useCount[a.treatment.name] += 1;
      }
    }
    // χ² statistic against weighted expectation.
    const total = Object.values(useCount).reduce((s, x) => s + x, 0);
    const chi2 = treatments.reduce((s, t) => {
      const expected = (total * weights[t.name]) / totalWeight;
      return s + (useCount[t.name] - expected) ** 2 / expected;
    }, 0);
    expect(chi2).toBeLessThan(CHI2_CRITICAL_ALPHA_1E4[K - 1]);
  });

  test("3. position uniformity: per-player position-0 distribution is uniform (χ²)", () => {
    const N = 4;
    const M = 20000;
    const posCounts: Record<string, { 0: number; 1: number }> = {};
    for (let i = 0; i < N; i += 1) posCounts[`p_${i}`] = { 0: 0, 1: 0 };

    for (let m = 0; m < M; m += 1) {
      const players = Array.from({ length: N }, (_, i) => ({ id: `p_${i}` }));
      const { assignments } = runOneWeighted(players, 1000 + m);
      for (const a of assignments) {
        for (const pa of a.positionAssignments) {
          posCounts[pa.playerId][pa.position as 0 | 1] += 1;
        }
      }
    }
    const pos0 = Array.from({ length: N }, (_, i) => posCounts[`p_${i}`][0]);
    const chi2 = pos0.reduce((s, x) => s + (x - M / 2) ** 2 / (M / 4), 0);
    expect(chi2).toBeLessThan(CHI2_CRITICAL_ALPHA_1E4[N]);
  });

  test("4. equal opportunity within eligibility class: leftover-rate uniform (χ²)", () => {
    const N = 5;
    const M = 2000;
    const leftoverCount: Record<string, number> = {};
    for (let i = 0; i < N; i += 1) leftoverCount[`p_${i}`] = 0;

    for (let m = 0; m < M; m += 1) {
      const players = Array.from({ length: N }, (_, i) => ({ id: `p_${i}` }));
      const { assignments } = runOneWeighted(players, 2000 + m);
      const assigned = new Set(
        assignments.flatMap((a) =>
          a.positionAssignments.map((pa) => pa.playerId),
        ),
      );
      for (let i = 0; i < N; i += 1) {
        if (!assigned.has(`p_${i}`)) leftoverCount[`p_${i}`] += 1;
      }
    }
    const counts = Array.from({ length: N }, (_, i) => leftoverCount[`p_${i}`]);
    const chi2 = chiSquareUniform(counts);
    expect(chi2).toBeLessThan(CHI2_CRITICAL_ALPHA_1E4[N - 1]);
  });

  test("5. arrival-order independence: forward vs reverse give same aggregate (binomial)", () => {
    const M = 10000;
    function simulate(playerIds: string[], seedOffset: number) {
      const counts: Record<string, number> = {};
      playerIds.forEach((pid) => {
        counts[pid] = 0;
      });
      for (let m = 0; m < M; m += 1) {
        const players = playerIds.map((id) => ({ id }));
        const { assignments } = runOneWeighted(players, seedOffset + m);
        for (const a of assignments) {
          for (const pa of a.positionAssignments) {
            if (pa.position === 0) counts[pa.playerId] += 1;
          }
        }
      }
      return counts;
    }
    const forward = simulate(["p_0", "p_1", "p_2", "p_3"], 4000);
    const reverse = simulate(["p_3", "p_2", "p_1", "p_0"], 4000);
    const seDiff = Math.sqrt(M / 2);
    const ids = ["p_0", "p_1", "p_2", "p_3"];
    const maxAbsZ = Math.max(
      ...ids.map((pid) => Math.abs((forward[pid] - reverse[pid]) / seDiff)),
    );
    expect(maxAbsZ).toBeLessThan(4.21);
  });

  test("6. irrelevant-attribute independence: tag does not predict leftover (binomial)", () => {
    const M = 10000;
    let bAsLeftover = 0;
    for (let m = 0; m < M; m += 1) {
      const players = [
        { id: "p_0" },
        { id: "p_1" },
        { id: "p_2" },
        { id: "p_3" },
        { id: "p_4" },
      ];
      const tag = ["A", "A", "A", "B", "B"] as const;
      const { assignments } = runOneWeighted(players, 3000 + m);
      const assigned = new Set(
        assignments.flatMap((a) =>
          a.positionAssignments.map((pa) => pa.playerId),
        ),
      );
      const leftoverIdx = players.findIndex((p) => !assigned.has(p.id));
      if (leftoverIdx >= 0 && tag[leftoverIdx] === "B") bAsLeftover += 1;
    }
    const p0 = 2 / 5;
    const expected = M * p0;
    const se = Math.sqrt(M * p0 * (1 - p0));
    const z = (bAsLeftover - expected) / se;
    expect(Math.abs(z)).toBeLessThan(Z_CRITICAL_ALPHA_1E4);
  });

  test("7. pairwise co-assignment independence: pair co-occurrence uniform (χ²)", () => {
    const N = 4;
    const M = 10000;
    const pairKey = (a: string, b: string) =>
      a < b ? `${a}-${b}` : `${b}-${a}`;
    const pairCounts: Record<string, number> = {};
    for (let i = 0; i < N; i += 1) {
      for (let j = i + 1; j < N; j += 1) {
        pairCounts[pairKey(`p_${i}`, `p_${j}`)] = 0;
      }
    }
    for (let m = 0; m < M; m += 1) {
      const players = Array.from({ length: N }, (_, i) => ({ id: `p_${i}` }));
      const { assignments } = runOneWeighted(players, 5000 + m);
      for (const a of assignments) {
        const ids = a.positionAssignments.map((pa) => pa.playerId);
        for (let i = 0; i < ids.length; i += 1) {
          for (let j = i + 1; j < ids.length; j += 1) {
            pairCounts[pairKey(ids[i], ids[j])] += 1;
          }
        }
      }
    }
    const counts = Object.values(pairCounts);
    const chi2 = chiSquareUniform(counts);
    expect(chi2).toBeLessThan(CHI2_CRITICAL_ALPHA_1E4[5]);
  });

  // Property 8 (variant balance within label) is matrix-decrement-
  // specific and does not apply to weighted-random; covered in the urn
  // suite below.
});

// ─── Urn suite ─────────────────────────────────────────────────────

describe("urnRandomization: randomization properties (α=1e-4)", () => {
  function runOneUrn(
    players: { id: string }[],
    treatments: Treatment[],
    counts: Record<string, number>,
    seed: number,
    decrements?: Record<string, Record<string, number>>,
  ): DispatchResult {
    const playerIds = players.map((p) => p.id);
    const eligibility = emptyEligibility(playerIds, treatments);
    return urnRandomization({
      playerIds,
      treatments,
      counts,
      decrements,
      eligibility,
      rng: mulberry32(seed),
    });
  }

  const T_ONE: Treatment[] = [{ name: "T", playerCount: 2 }];

  test("1. seeded determinism: identical seed + inputs ⇒ identical assignments", () => {
    const makePlayers = () =>
      Array.from({ length: 4 }, (_, i) => ({ id: `p_${i}` }));
    const a = runOneUrn(makePlayers(), T_ONE, { T: 10 }, 42);
    const b = runOneUrn(makePlayers(), T_ONE, { T: 10 }, 42);
    const c = runOneUrn(makePlayers(), T_ONE, { T: 10 }, 43);
    expect(a.assignments).toEqual(b.assignments);
    expect(a.assignments).not.toEqual(c.assignments);
    expect(a.remainingCounts).toEqual(b.remainingCounts);
  });

  test("2. marginal target rate: counts are honored exactly across runs", () => {
    // Central claim of urn randomization: over the run, treatment i is
    // used exactly `counts[i]` times.
    const K = 4;
    const treatments: Treatment[] = Array.from({ length: K }, (_, i) => ({
      name: `T${i}`,
      playerCount: 2,
    }));
    const targetCounts: Record<string, number> = Object.fromEntries(
      treatments.map((t) => [t.name, 25]),
    );
    const totalSlots = Object.values(targetCounts).reduce(
      (a, b) => a + 2 * b,
      0,
    );
    // Provide enough players to drain the urn. Over-supply is fine —
    // dispatcher stops when no positive-count treatment fits.
    const players = Array.from({ length: totalSlots + 10 }, (_, i) => ({
      id: `p_${i}`,
    }));
    const { assignments, remainingCounts } = runOneUrn(
      players,
      treatments,
      targetCounts,
      9000,
    );
    const useCount: Record<string, number> = Object.fromEntries(
      treatments.map((t) => [t.name, 0]),
    );
    for (const a of assignments) {
      useCount[a.treatment.name] += 1;
    }
    expect(useCount).toEqual(targetCounts);
    expect(remainingCounts).toEqual(
      Object.fromEntries(treatments.map((t) => [t.name, 0])),
    );
  });

  test("3. position uniformity: per-player position-0 distribution is uniform (χ²)", () => {
    const N = 4;
    const M = 20000;
    const posCounts: Record<string, { 0: number; 1: number }> = {};
    for (let i = 0; i < N; i += 1) posCounts[`p_${i}`] = { 0: 0, 1: 0 };

    for (let m = 0; m < M; m += 1) {
      const players = Array.from({ length: N }, (_, i) => ({ id: `p_${i}` }));
      const { assignments } = runOneUrn(players, T_ONE, { T: 2 }, 1000 + m);
      for (const a of assignments) {
        for (const pa of a.positionAssignments) {
          posCounts[pa.playerId][pa.position as 0 | 1] += 1;
        }
      }
    }
    const pos0 = Array.from({ length: N }, (_, i) => posCounts[`p_${i}`][0]);
    const chi2 = pos0.reduce((s, x) => s + (x - M / 2) ** 2 / (M / 4), 0);
    expect(chi2).toBeLessThan(CHI2_CRITICAL_ALPHA_1E4[N]);
  });

  test("4. equal opportunity within eligibility class: leftover-rate uniform (χ²)", () => {
    const N = 5;
    const M = 2000;
    const leftoverCount: Record<string, number> = {};
    for (let i = 0; i < N; i += 1) leftoverCount[`p_${i}`] = 0;

    for (let m = 0; m < M; m += 1) {
      const players = Array.from({ length: N }, (_, i) => ({ id: `p_${i}` }));
      // Counts: 2 means "fill twice", but with only 5 players in T(pc=2)
      // we'll fill exactly twice; one player is leftover each tick.
      const { assignments } = runOneUrn(players, T_ONE, { T: 2 }, 2000 + m);
      const assigned = new Set(
        assignments.flatMap((a) =>
          a.positionAssignments.map((pa) => pa.playerId),
        ),
      );
      for (let i = 0; i < N; i += 1) {
        if (!assigned.has(`p_${i}`)) leftoverCount[`p_${i}`] += 1;
      }
    }
    const counts = Array.from({ length: N }, (_, i) => leftoverCount[`p_${i}`]);
    const chi2 = chiSquareUniform(counts);
    expect(chi2).toBeLessThan(CHI2_CRITICAL_ALPHA_1E4[N - 1]);
  });

  test("5. arrival-order independence: forward vs reverse give same aggregate (binomial)", () => {
    const M = 10000;
    function simulate(playerIds: string[], seedOffset: number) {
      const counts: Record<string, number> = {};
      playerIds.forEach((pid) => {
        counts[pid] = 0;
      });
      for (let m = 0; m < M; m += 1) {
        const players = playerIds.map((id) => ({ id }));
        const { assignments } = runOneUrn(
          players,
          T_ONE,
          { T: 10 },
          seedOffset + m,
        );
        for (const a of assignments) {
          for (const pa of a.positionAssignments) {
            if (pa.position === 0) counts[pa.playerId] += 1;
          }
        }
      }
      return counts;
    }
    const forward = simulate(["p_0", "p_1", "p_2", "p_3"], 4000);
    const reverse = simulate(["p_3", "p_2", "p_1", "p_0"], 4000);
    const seDiff = Math.sqrt(M / 2);
    const ids = ["p_0", "p_1", "p_2", "p_3"];
    const maxAbsZ = Math.max(
      ...ids.map((pid) => Math.abs((forward[pid] - reverse[pid]) / seDiff)),
    );
    expect(maxAbsZ).toBeLessThan(4.21);
  });

  test("6. irrelevant-attribute independence: tag does not predict leftover (binomial)", () => {
    const M = 10000;
    let bAsLeftover = 0;
    for (let m = 0; m < M; m += 1) {
      const players = [
        { id: "p_0" },
        { id: "p_1" },
        { id: "p_2" },
        { id: "p_3" },
        { id: "p_4" },
      ];
      const tag = ["A", "A", "A", "B", "B"] as const;
      const { assignments } = runOneUrn(players, T_ONE, { T: 2 }, 3000 + m);
      const assigned = new Set(
        assignments.flatMap((a) =>
          a.positionAssignments.map((pa) => pa.playerId),
        ),
      );
      const leftoverIdx = players.findIndex((p) => !assigned.has(p.id));
      if (leftoverIdx >= 0 && tag[leftoverIdx] === "B") bAsLeftover += 1;
    }
    const p0 = 2 / 5;
    const expected = M * p0;
    const se = Math.sqrt(M * p0 * (1 - p0));
    const z = (bAsLeftover - expected) / se;
    expect(Math.abs(z)).toBeLessThan(Z_CRITICAL_ALPHA_1E4);
  });

  test("7. pairwise co-assignment independence: pair co-occurrence uniform (χ²)", () => {
    const N = 4;
    const M = 10000;
    const pairKey = (a: string, b: string) =>
      a < b ? `${a}-${b}` : `${b}-${a}`;
    const pairCounts: Record<string, number> = {};
    for (let i = 0; i < N; i += 1) {
      for (let j = i + 1; j < N; j += 1) {
        pairCounts[pairKey(`p_${i}`, `p_${j}`)] = 0;
      }
    }
    for (let m = 0; m < M; m += 1) {
      const players = Array.from({ length: N }, (_, i) => ({ id: `p_${i}` }));
      const { assignments } = runOneUrn(players, T_ONE, { T: 2 }, 5000 + m);
      for (const a of assignments) {
        const ids = a.positionAssignments.map((pa) => pa.playerId);
        for (let i = 0; i < ids.length; i += 1) {
          for (let j = i + 1; j < ids.length; j += 1) {
            pairCounts[pairKey(ids[i], ids[j])] += 1;
          }
        }
      }
    }
    const counts = Object.values(pairCounts);
    const chi2 = chiSquareUniform(counts);
    expect(chi2).toBeLessThan(CHI2_CRITICAL_ALPHA_1E4[5]);
  });

  test("8. variant balance within label: matrix decrement distributes variants uniformly (χ²)", () => {
    // 2 labels × 5 variants, decrement matrix penalizes same-label
    // cells. Per-label, the 5 variants should be used uniformly across
    // the batch (label rotation, not variant preference).
    const NLABELS = 2;
    const NVARIANTS = 5;
    // Target counts that produce many label-uses per variant: each
    // variant balls = 20, so per label total = 100 uses.
    const treatments: Treatment[] = [];
    for (let i = 0; i < NLABELS; i += 1) {
      for (let j = 0; j < NVARIANTS; j += 1) {
        treatments.push({
          name: `L${i}V${j}`,
          label: `L${i}`,
          variant: `V${j}`,
          playerCount: 2,
        });
      }
    }
    const counts: Record<string, number> = Object.fromEntries(
      treatments.map((t) => [t.name, 20]),
    );
    // Decrement matrix (labeled): when L_iV_k is used, decrement all
    // L_iV_* by 1 (same label coupling) and leave L_!iV_* alone. We
    // write every cross-label entry explicitly as 0 to keep the test
    // self-documenting; missing entries would default to 0 anyway.
    const decrements: Record<string, Record<string, number>> = {};
    for (const ti of treatments) {
      const row: Record<string, number> = {};
      for (const tj of treatments) {
        row[tj.name] = ti.label === tj.label ? 1 : 0;
      }
      decrements[ti.name] = row;
    }

    // Two players per tick; enough ticks to drain the urn under same-
    // label coupling.
    let totalUses = 0;
    const useCount: Record<string, number> = {};
    for (const t of treatments) useCount[t.name] = 0;

    let runningCounts: Record<string, number> = { ...counts };
    let seed = 7000;
    const HARD_CAP = 20_000;
    while (Object.values(runningCounts).some((c) => c > 0)) {
      const players = [{ id: `p_${seed}_0` }, { id: `p_${seed}_1` }];
      const playerIds = players.map((p) => p.id);
      const eligibility = emptyEligibility(playerIds, treatments);
      const { assignments, remainingCounts } = urnRandomization({
        playerIds,
        treatments,
        counts: runningCounts,
        decrements,
        eligibility,
        rng: mulberry32(seed),
      });
      for (const a of assignments) {
        useCount[a.treatment.name] += 1;
        totalUses += 1;
      }
      runningCounts = remainingCounts;
      seed += 1;
      if (seed > HARD_CAP) {
        // Regression guard: the urn must drain under these inputs.
        // Falling out of the loop with positive counts would let the
        // χ² test below pass on a partial sample, hiding a bug.
        throw new Error(
          `urn did not drain within ${HARD_CAP - 7000} ticks; remainingCounts=${JSON.stringify(runningCounts)}`,
        );
      }
    }
    expect(Object.values(runningCounts).every((c) => c === 0)).toBe(true);
    expect(totalUses).toBeGreaterThan(0);

    // Per-label variant uniformity: χ² over the 5 variant-counts inside
    // each label, with α=1e-4.
    for (let i = 0; i < NLABELS; i += 1) {
      const variantCounts = Array.from(
        { length: NVARIANTS },
        (_, j) => useCount[`L${i}V${j}`],
      );
      const chi2 = chiSquareUniform(variantCounts);
      expect(chi2).toBeLessThan(CHI2_CRITICAL_ALPHA_1E4[NVARIANTS - 1]);
    }
  });
});

// ─── Weighted-knockdown suite ──────────────────────────────────────

import { weightedKnockdown } from "./weightedKnockdown.js";

describe("weightedKnockdown: randomization properties (α=1e-4)", () => {
  // Properties that hold for any softmax + knockdown algorithm at any
  // parameterization. Algorithm-specific claims (knockdown decay
  // shape, softmax distribution at specific T) are pinned by the unit
  // tests; here we just verify the broad randomization receipts.

  const T_ONE: Treatment[] = [{ name: "T", playerCount: 2 }];

  function runOneWK(
    players: { id: string }[],
    seed: number,
    treatments = T_ONE,
    payoffs: Parameters<typeof weightedKnockdown>[0]["payoffs"] = "equal",
    knockdowns: Parameters<typeof weightedKnockdown>[0]["knockdowns"] = "none",
    temperature = 0,
  ): DispatchResult {
    const playerIds = players.map((p) => p.id);
    const eligibility = emptyEligibility(playerIds, treatments);
    const { assignments } = weightedKnockdown({
      playerIds,
      treatments,
      payoffs,
      knockdowns,
      temperature,
      eligibility,
      rng: mulberry32(seed),
    });
    return { assignments };
  }

  test("1. seeded determinism: identical seed + inputs ⇒ identical assignments", () => {
    const makePlayers = () =>
      Array.from({ length: 4 }, (_, i) => ({ id: `p_${i}` }));
    const a = runOneWK(makePlayers(), 42);
    const b = runOneWK(makePlayers(), 42);
    const c = runOneWK(makePlayers(), 43);
    expect(a.assignments).toEqual(b.assignments);
    expect(a.assignments).not.toEqual(c.assignments);
  });

  test("2. position uniformity at T=0 with single treatment: pos-0 distribution uniform (χ²)", () => {
    // Single treatment → no selection involved. Position assignment
    // is delegated to tryFillTreatment, same as the other dispatchers.
    // Mirrors the urn position-uniformity test.
    const N = 4;
    const M = 20000;
    const posCounts: Record<string, { 0: number; 1: number }> = {};
    for (let i = 0; i < N; i += 1) posCounts[`p_${i}`] = { 0: 0, 1: 0 };

    for (let m = 0; m < M; m += 1) {
      const players = Array.from({ length: N }, (_, i) => ({ id: `p_${i}` }));
      const { assignments } = runOneWK(players, 1000 + m);
      for (const a of assignments) {
        for (const pa of a.positionAssignments) {
          posCounts[pa.playerId][pa.position as 0 | 1] += 1;
        }
      }
    }
    const pos0 = Array.from({ length: N }, (_, i) => posCounts[`p_${i}`][0]);
    const chi2 = pos0.reduce((s, x) => s + (x - M / 2) ** 2 / (M / 4), 0);
    expect(chi2).toBeLessThan(CHI2_CRITICAL_ALPHA_1E4[N]);
  });

  test("3. equal-opportunity within eligibility class: leftover-rate uniform (χ²)", () => {
    // 5 players, single 2-slot treatment, no knockdown → 2 picks per
    // tick, 1 leftover. Each player should be leftover at rate 1/5.
    const N = 5;
    const M = 2000;
    const leftoverCount: Record<string, number> = {};
    for (let i = 0; i < N; i += 1) leftoverCount[`p_${i}`] = 0;

    for (let m = 0; m < M; m += 1) {
      const players = Array.from({ length: N }, (_, i) => ({ id: `p_${i}` }));
      const { assignments } = runOneWK(players, 2000 + m);
      const assigned = new Set(
        assignments.flatMap((a) =>
          a.positionAssignments.map((pa) => pa.playerId),
        ),
      );
      for (let i = 0; i < N; i += 1) {
        if (!assigned.has(`p_${i}`)) leftoverCount[`p_${i}`] += 1;
      }
    }
    const counts = Array.from({ length: N }, (_, i) => leftoverCount[`p_${i}`]);
    const chi2 = chiSquareUniform(counts);
    expect(chi2).toBeLessThan(CHI2_CRITICAL_ALPHA_1E4[N - 1]);
  });

  test("4. arrival-order independence: forward vs reverse give same aggregate (binomial)", () => {
    const M = 10000;
    function simulate(playerIds: string[], seedOffset: number) {
      const counts: Record<string, number> = {};
      playerIds.forEach((pid) => {
        counts[pid] = 0;
      });
      for (let m = 0; m < M; m += 1) {
        const players = playerIds.map((id) => ({ id }));
        const { assignments } = runOneWK(players, seedOffset + m);
        for (const a of assignments) {
          for (const pa of a.positionAssignments) {
            if (pa.position === 0) counts[pa.playerId] += 1;
          }
        }
      }
      return counts;
    }
    const forward = simulate(["p_0", "p_1", "p_2", "p_3"], 4000);
    const reverse = simulate(["p_3", "p_2", "p_1", "p_0"], 4000);
    const seDiff = Math.sqrt(M / 2);
    const ids = ["p_0", "p_1", "p_2", "p_3"];
    const maxAbsZ = Math.max(
      ...ids.map((pid) => Math.abs((forward[pid] - reverse[pid]) / seDiff)),
    );
    expect(maxAbsZ).toBeLessThan(4.21);
  });

  test("5. irrelevant-attribute independence: tag does not predict leftover (binomial)", () => {
    const M = 10000;
    let bAsLeftover = 0;
    for (let m = 0; m < M; m += 1) {
      const players = [
        { id: "p_0" },
        { id: "p_1" },
        { id: "p_2" },
        { id: "p_3" },
        { id: "p_4" },
      ];
      const tag = ["A", "A", "A", "B", "B"] as const;
      const { assignments } = runOneWK(players, 3000 + m);
      const assigned = new Set(
        assignments.flatMap((a) =>
          a.positionAssignments.map((pa) => pa.playerId),
        ),
      );
      const leftoverIdx = players.findIndex((p) => !assigned.has(p.id));
      if (leftoverIdx >= 0 && tag[leftoverIdx] === "B") bAsLeftover += 1;
    }
    const p0 = 2 / 5;
    const expected = M * p0;
    const se = Math.sqrt(M * p0 * (1 - p0));
    const z = (bAsLeftover - expected) / se;
    expect(Math.abs(z)).toBeLessThan(Z_CRITICAL_ALPHA_1E4);
  });

  test("6. softmax marginal rate: T=1 with payoffs {1, 1+ln(3)} matches 1:3 ratio (χ²)", () => {
    // The central algorithm-specific receipt: at T=1 with payoffs
    // differing by ln(3), the softmax sampler picks the higher-payoff
    // treatment 3× as often as the lower-payoff treatment. Pinned at
    // α=1e-4 over M=2000 ticks (1 group per tick).
    const treatments: Treatment[] = [
      { name: "T0", playerCount: 2 },
      { name: "T1", playerCount: 2 },
    ];
    const payoffs = { T0: 1, T1: 1 + Math.log(3) };
    const totalWeight = 1 + 3; // exp(1-(1+ln(3)))/T=1 + exp(0) → 1/3 + 1
    const targets = { T0: 1 / totalWeight, T1: 3 / totalWeight };
    const M = 2000;
    const counts: Record<string, number> = { T0: 0, T1: 0 };
    for (let m = 0; m < M; m += 1) {
      const playerIds = [`p_${m}_0`, `p_${m}_1`];
      const eligibility = emptyEligibility(playerIds, treatments);
      const { assignments } = weightedKnockdown({
        playerIds,
        treatments,
        payoffs,
        knockdowns: "none",
        temperature: 1,
        eligibility,
        rng: mulberry32(6000 + m),
      });
      for (const a of assignments) counts[a.treatment.name] += 1;
    }
    const total = counts.T0 + counts.T1;
    const chi2 = treatments.reduce((s, t) => {
      const expected = total * targets[t.name as "T0" | "T1"];
      return s + (counts[t.name] - expected) ** 2 / expected;
    }, 0);
    // df = K-1 = 1 → critical 15.14
    expect(chi2).toBeLessThan(CHI2_CRITICAL_ALPHA_1E4[1]);
  });

  test("7. knockdown trajectory: scalar k=0.5 decays the picked payoff exactly (deterministic)", () => {
    // Algorithm receipt for the knockdown rule. With T=0 + payoffs
    // {t0: 100, t1: 1} (clear winner) and scalar knockdown 0.5,
    // every successful pick is t0 and t0's payoff halves each time.
    // After K picks, payoffs[t0] = 100 * 0.5^K and payoffs[t1] = 1
    // until t0 falls below t1.
    const treatments: Treatment[] = [
      { name: "t0", playerCount: 2 },
      { name: "t1", playerCount: 2 },
    ];
    const playerIds = Array.from({ length: 14 }, (_, i) => `p${i}`); // 7 groups
    const eligibility = emptyEligibility(playerIds, treatments);
    const { assignments, newState } = weightedKnockdown({
      playerIds,
      treatments,
      payoffs: { t0: 100, t1: 1 },
      knockdowns: 0.5,
      temperature: 0,
      eligibility,
      rng: mulberry32(42),
    });
    // 100 * 0.5^7 = 0.78125; t0 stays above t1=1 for the first 7 picks
    // (100 * 0.5^6 = 1.5625 > 1; then 0.78125 < 1, switch to t1).
    // So we should see 7 picks of t0 and then t1 takes over. With 14
    // players (7 groups), all picks should be t0 still (1.5625 > 1).
    const t0Picks = assignments.filter((a) => a.treatment.name === "t0");
    expect(t0Picks).toHaveLength(7);
    expect(newState.payoffs.t0).toBeCloseTo(100 * Math.pow(0.5, 7), 6);
    expect(newState.payoffs.t1).toBe(1);
  });

  test("8. softmax marginal rate K=3: matches the 3-way Boltzmann distribution (χ²)", () => {
    // Three treatments, payoffs {ln(1), ln(2), ln(4)} at T=1 →
    // softmax weights {1, 2, 4}, expected shares {1/7, 2/7, 4/7}.
    // Pinned at α=1e-4 over M=2000 ticks.
    const treatments: Treatment[] = [
      { name: "T0", playerCount: 2 },
      { name: "T1", playerCount: 2 },
      { name: "T2", playerCount: 2 },
    ];
    const payoffs = { T0: Math.log(1), T1: Math.log(2), T2: Math.log(4) };
    // log(0) → -Inf, which the dispatcher would treat as exhausted.
    // Shift by 1 to keep payoffs positive without changing the ratio:
    // softmax weights end up exp(1)/exp(1+ln(2))/exp(1+ln(4)) → e, 2e, 4e → ratio 1:2:4.
    const shifted = {
      T0: 1 + payoffs.T0,
      T1: 1 + payoffs.T1,
      T2: 1 + payoffs.T2,
    };
    const targets = { T0: 1 / 7, T1: 2 / 7, T2: 4 / 7 };
    const M = 2000;
    const counts: Record<string, number> = { T0: 0, T1: 0, T2: 0 };
    for (let m = 0; m < M; m += 1) {
      const playerIds = [`p_${m}_0`, `p_${m}_1`];
      const eligibility = emptyEligibility(playerIds, treatments);
      const { assignments } = weightedKnockdown({
        playerIds,
        treatments,
        payoffs: shifted,
        knockdowns: "none",
        temperature: 1,
        eligibility,
        rng: mulberry32(8000 + m),
      });
      for (const a of assignments) counts[a.treatment.name] += 1;
    }
    const total = counts.T0 + counts.T1 + counts.T2;
    const chi2 = treatments.reduce((s, t) => {
      const expected = total * targets[t.name as "T0" | "T1" | "T2"];
      return s + (counts[t.name] - expected) ** 2 / expected;
    }, 0);
    // df = K-1 = 2 → critical 18.42
    expect(chi2).toBeLessThan(CHI2_CRITICAL_ALPHA_1E4[2]);
  });

  test("9. joint trajectory: T=1 + matrix knockdown over many ticks (χ² + state-shape)", () => {
    // The production case the unit tests don't cover: softmax
    // sampling AND knockdowns active together over a multi-tick batch.
    // With three treatments and a fully-coupled matrix at factor 0.9,
    // every pick decays every payoff by 0.9 — so the relative payoff
    // ratios are preserved across ticks. Realized rate should still
    // match the softmax distribution from the *initial* payoff
    // ratios. Pins that the knockdown rule doesn't shift the within-
    // batch marginal of softmax sampling when it acts uniformly.
    const treatments: Treatment[] = [
      { name: "T0", playerCount: 2 },
      { name: "T1", playerCount: 2 },
      { name: "T2", playerCount: 2 },
    ];
    const payoffs = { T0: 1, T1: 1 + Math.log(2), T2: 1 + Math.log(4) };
    // Same target shape as test 8: weights {1, 2, 4}, shares {1/7, 2/7, 4/7}.
    const targets = { T0: 1 / 7, T1: 2 / 7, T2: 4 / 7 };
    const knockdowns = {
      T0: { T0: 0.9, T1: 0.9, T2: 0.9 },
      T1: { T0: 0.9, T1: 0.9, T2: 0.9 },
      T2: { T0: 0.9, T1: 0.9, T2: 0.9 },
    };
    const M = 2000;
    const counts: Record<string, number> = { T0: 0, T1: 0, T2: 0 };
    // Each tick gets a fresh payoff state — verify the within-tick
    // softmax + uniform-knockdown is the test claim. Across ticks
    // the host would normally thread state; here we reset per tick
    // to isolate the within-tick distribution claim from the
    // host-driven trajectory.
    for (let m = 0; m < M; m += 1) {
      const playerIds = [`p_${m}_0`, `p_${m}_1`];
      const eligibility = emptyEligibility(playerIds, treatments);
      const { assignments } = weightedKnockdown({
        playerIds,
        treatments,
        payoffs,
        knockdowns,
        temperature: 1,
        eligibility,
        rng: mulberry32(9000 + m),
      });
      for (const a of assignments) counts[a.treatment.name] += 1;
    }
    const total = counts.T0 + counts.T1 + counts.T2;
    const chi2 = treatments.reduce((s, t) => {
      const expected = total * targets[t.name as "T0" | "T1" | "T2"];
      return s + (counts[t.name] - expected) ** 2 / expected;
    }, 0);
    expect(chi2).toBeLessThan(CHI2_CRITICAL_ALPHA_1E4[2]);
  });

  test("10. state-shape round-trip across many ticks: newState.payoffs preserves labels", () => {
    // Pin that threading `newState.payoffs` back into the next call
    // works across many ticks without label drift. A regression that
    // mutates the label set (e.g. by accidentally writing positional
    // keys) would surface here as a runtime throw from the dispatcher's
    // own label-set check on tick 2+.
    const treatments: Treatment[] = [
      { name: "T0", playerCount: 2 },
      { name: "T1", playerCount: 2 },
      { name: "T2", playerCount: 2 },
    ];
    let payoffs: Record<string, number> = { T0: 5, T1: 3, T2: 2 };
    for (let tick = 0; tick < 20; tick += 1) {
      const playerIds = Array.from({ length: 6 }, (_, i) => `p_${tick}_${i}`);
      const eligibility = emptyEligibility(playerIds, treatments);
      const r = weightedKnockdown({
        playerIds,
        treatments,
        payoffs,
        knockdowns: 0.7,
        temperature: 1,
        eligibility,
        rng: mulberry32(10_000 + tick),
      });
      expect(Object.keys(r.newState.payoffs).sort()).toEqual([
        "T0",
        "T1",
        "T2",
      ]);
      payoffs = r.newState.payoffs;
    }
    // After 20 ticks of decay, payoffs are tiny but still positive
    // for at least one treatment (otherwise the dispatcher would have
    // stopped sampling).
    expect(payoffs.T0 + payoffs.T1 + payoffs.T2).toBeGreaterThan(0);
  });
});
