// mulberry32 below uses bit ops by design (small fast PRNG, intentional).

// Generic dispatcher contract harness (#448).
//
// Every dispatcher implementation — `uniform-random`, `weighted-random`,
// `urn`, `softmax-knockdown`, and any future additions — MUST satisfy
// the structural invariants pinned here. The harness is parameterized
// over a *factory* so registering a new algorithm is a matter of
// supplying its scenario-to-dispatcher adapter and re-running the
// gauntlet.
//
// Scope: structural invariants only. Algorithm-specific statistical
// claims (marginal target rate, irrelevant-attribute independence, …)
// live in algorithm-specific test files because each algorithm makes a
// different randomization claim worth a paper-defensible receipt.
//
// History: this harness is the generalization of
// `dispatch.contract.test.js` from deliberation-lab, which was tightly
// coupled to a single algorithm's parameter shape. The scenario was
// shrunk to just `{ players, treatments }`; algorithm-specific params
// come from the registered factory (which can also generate them from
// the seeded rng so the gauntlet's full input space remains
// deterministic).

import { describe, test, expect } from "vitest";
import type { DispatchResult, Treatment } from "./types.js";
import { makeEligibilityTable } from "./makeEligibilityTable.js";
import { evaluateConditions } from "../utils/evaluateConditions.js";
import {
  getNestedValueByPath,
  getReferenceKeyAndPath,
} from "../utils/reference.js";

/** Mulberry32 — small, fast, fully deterministic PRNG. The bit ops are
 *  intentional (PRNG); we don't need cryptographic quality, we need
 *  reproducibility. Returned as a function so callers can pass it
 *  anywhere a `() => number` rng is expected. */
export function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** One harness scenario — players + treatments, nothing else. Each
 *  registered dispatcher's factory builds its own algorithm-specific
 *  params on top. */
export interface ContractScenario {
  players: {
    id: string;
    /** Storage-key indexed snapshot, populated for the keys returned
     *  by `extractConditionKeys` over `treatments`. */
    data: Record<string, Record<string, unknown>>;
  }[];
  treatments: Treatment[];
}

/** The harness calls the factory with a fresh seeded rng for each
 *  scenario. The factory wires up algorithm-specific params and
 *  returns a thunk that performs one dispatch tick. `params` rides
 *  along on assertion-failure messages so the repro is informative
 *  per-algorithm. */
export type ContractDispatcherFactory = (input: {
  scenario: ContractScenario;
  rng: () => number;
}) => {
  dispatch: () => DispatchResult;
  params: Record<string, unknown>;
};

export interface ContractSuiteOptions {
  /** Seed for the scenario generator. Defaults to `0xdeadbeef`. */
  seed?: number;
  /** Number of scenarios to run per invariant test. Defaults to 200. */
  n?: number;
}

const ROLES = ["a", "b", "c", "d"];

function pick<T>(rng: () => number, arr: readonly T[]): T {
  return arr[Math.floor(rng() * arr.length)];
}

function intRange(rng: () => number, min: number, max: number): number {
  return min + Math.floor(rng() * (max - min + 1));
}

function genPlayer(
  rng: () => number,
  idx: number,
): ContractScenario["players"][number] {
  // ~1 in 5 chance of no role, otherwise a uniform pick. Players with
  // no role can't satisfy role conditions — exercises ineligible
  // branches in dispatchers.
  const role = rng() < 0.2 ? null : pick(rng, ROLES);
  return {
    id: `p${idx}`,
    data: role === null ? {} : { prompt_role: { value: role } },
  };
}

function maybeRoleCondition(rng: () => number) {
  // 50/50 whether the slot has a condition. When it does, equality
  // on a random role. Only `equals` here on purpose — broader
  // comparators would require valid value-shape per type, and we'd
  // be testing the comparator surface, not the dispatcher.
  if (rng() < 0.5) return [];
  return [
    {
      reference: "self.prompt.role",
      comparator: "equals",
      value: pick(rng, ROLES),
    },
  ];
}

function genTreatment(rng: () => number, idx: number): Treatment {
  const playerCount = intRange(rng, 1, 4);
  // 30% of the time, omit groupComposition (every player eligible for
  // every slot). Otherwise emit one entry per slot with a 50/50
  // chance of a role condition. An EMPTY array would also be
  // unconstrained but trips a different code path in some validators;
  // either omit entirely or fill to playerCount.
  if (rng() < 0.3) {
    return { name: `t${idx}`, playerCount };
  }
  const groupComposition = [];
  for (let i = 0; i < playerCount; i += 1) {
    groupComposition.push({
      position: i,
      conditions: maybeRoleCondition(rng),
    });
  }
  return { name: `t${idx}`, playerCount, groupComposition };
}

export function genScenario(rng: () => number): ContractScenario {
  const nPlayers = intRange(rng, 0, 25);
  const nTreatments = intRange(rng, 1, 4);
  const players = Array.from({ length: nPlayers }, (_, i) => genPlayer(rng, i));
  const treatments = Array.from({ length: nTreatments }, (_, i) =>
    genTreatment(rng, i),
  );
  return { players, treatments };
}

/** Build the eligibility table the way a host would: extract condition
 *  keys, snapshot each player's data, hand both to `makeEligibilityTable`.
 *  Exposed so per-algorithm factories that wrap a pure dispatcher can
 *  reuse it. */
export function buildEligibilityForScenario(scenario: ContractScenario) {
  const playerIds = scenario.players.map((p) => p.id);
  const playerData: Record<string, Record<string, unknown>> = {};
  for (const p of scenario.players) playerData[p.id] = p.data;
  return makeEligibilityTable({
    playerIds,
    treatments: scenario.treatments,
    playerData,
  });
}

/** Self-resolve a single condition against a single player's data —
 *  used by invariant #4 to verify the dispatcher's eligibility checks
 *  match what the conditions say. Mirrors what `makeEligibilityTable`
 *  does internally; kept as a separate path so the invariant test is
 *  *checking* the table builder, not asking it to mark its own
 *  homework. */
function playerSatisfies(
  player: ContractScenario["players"][number],
  conditions: unknown,
): boolean {
  const resolve = (reference: string): unknown[] => {
    if (!reference.startsWith("self.")) return [];
    try {
      const { referenceKey, path } = getReferenceKeyAndPath(reference);
      const record = player.data[referenceKey];
      if (record === undefined) return [];
      const value = getNestedValueByPath(record, path);
      if (value === undefined) return [];
      return [value];
    } catch {
      return [];
    }
  };
  // evaluateConditions accepts arrays / operator nodes / single leaves.
  return evaluateConditions(
    conditions as Parameters<typeof evaluateConditions>[0],
    resolve,
  );
}

function slotConditionsForAssignment(
  treatment: Treatment,
  position: number,
): unknown {
  const gc = treatment.groupComposition;
  if (Array.isArray(gc)) {
    const slot = gc.find((s) => s?.position === position);
    return slot?.conditions ?? [];
  }
  return [];
}

function formatContext(
  algorithm: string,
  seed: number,
  scenarioIdx: number,
  scenario: ContractScenario,
  params: Record<string, unknown>,
): string {
  return `[algorithm=${algorithm} seed=0x${seed.toString(16)} scenario=${scenarioIdx}]\nscenario: ${JSON.stringify(
    {
      players: scenario.players.map((p) => ({ id: p.id, data: p.data })),
      treatments: scenario.treatments,
    },
    null,
    2,
  )}\nparams: ${JSON.stringify(params, null, 2)}`;
}

function deepClone<T>(obj: T): T {
  return JSON.parse(JSON.stringify(obj)) as T;
}

interface Snapshots {
  treatmentsBefore: Treatment[];
  playerDataBefore: ContractScenario["players"][number]["data"][];
  paramsBefore: Record<string, unknown>;
}

type InvariantCallback = (
  scenario: ContractScenario,
  result: DispatchResult,
  scenarioIdx: number,
  snapshots: Snapshots | null,
  params: Record<string, unknown>,
) => void;

function forEachScenario(
  algorithm: string,
  factory: ContractDispatcherFactory,
  seed: number,
  n: number,
  invariant: InvariantCallback,
  opts: { snapshot?: boolean } = {},
): void {
  const rng = mulberry32(seed);
  for (let i = 0; i < n; i += 1) {
    const scenario = genScenario(rng);
    let dispatchResult: DispatchResult;
    let params: Record<string, unknown> = {};
    let snapshots: Snapshots | null = null;
    try {
      const built = factory({
        scenario,
        // Each scenario gets a derived seed so per-scenario rng state
        // doesn't leak across the suite.
        rng: mulberry32(seed * 1_000_003 + i),
      });
      params = built.params;
      // Snapshot AFTER factory construction (which may legitimately
      // generate algorithm-specific params from the rng) but BEFORE
      // dispatch — so the invariant check sees what dispatch was given.
      if (opts.snapshot) {
        snapshots = {
          treatmentsBefore: deepClone(scenario.treatments),
          playerDataBefore: scenario.players.map((p) => deepClone(p.data)),
          paramsBefore: deepClone(built.params),
        };
      }
      dispatchResult = built.dispatch();
    } catch (err) {
      const e = err as Error;
      e.message = `dispatcher threw: ${e.message}\n${formatContext(algorithm, seed, i, scenario, params)}`;
      throw e;
    }
    try {
      invariant(scenario, dispatchResult, i, snapshots, params);
    } catch (err) {
      const e = err as Error;
      e.message = `${e.message}\n${formatContext(algorithm, seed, i, scenario, params)}`;
      throw e;
    }
  }
}

/**
 * Run the 10 dispatcher-contract invariants against the supplied
 * factory. Call from inside a registering test file:
 *
 * ```ts
 * runContractSuite("urn", ({ scenario, rng }) => {
 *   const eligibility = buildEligibilityForScenario(scenario);
 *   const counts = scenario.treatments.map(() => 4);
 *   return {
 *     params: { counts },
 *     dispatch: () =>
 *       urnRandomization({
 *         playerIds: scenario.players.map((p) => p.id),
 *         treatments: scenario.treatments,
 *         counts,
 *         eligibility,
 *         rng,
 *       }),
 *   };
 * });
 * ```
 */
export function runContractSuite(
  algorithm: string,
  factory: ContractDispatcherFactory,
  options: ContractSuiteOptions = {},
): void {
  const seed = (options.seed ?? 0xdeadbeef) >>> 0;
  const n = options.n ?? 200;

  describe(`Dispatcher contract: ${algorithm} (seed=0x${seed.toString(16)}, N=${n})`, () => {
    test("1. every assignment has exactly treatment.playerCount positionAssignments", () => {
      forEachScenario(
        algorithm,
        factory,
        seed + 0,
        n,
        (_scenario, { assignments }) => {
          for (const a of assignments) {
            expect(a.positionAssignments.length).toBe(a.treatment.playerCount);
          }
        },
      );
    });

    test("2. no player id appears in more than one assignment", () => {
      forEachScenario(
        algorithm,
        factory,
        seed + 1,
        n,
        (_scenario, { assignments }) => {
          const seen = new Set<string>();
          for (const a of assignments) {
            for (const pa of a.positionAssignments) {
              expect(seen.has(pa.playerId)).toBe(false);
              seen.add(pa.playerId);
            }
          }
        },
      );
    });

    test("3. every assignment's treatment is from the input set", () => {
      forEachScenario(
        algorithm,
        factory,
        seed + 2,
        n,
        (scenario, { assignments }) => {
          const validNames = new Set(scenario.treatments.map((t) => t.name));
          for (const a of assignments) {
            expect(validNames.has(a.treatment.name)).toBe(true);
          }
        },
      );
    });

    test("4. every assigned player satisfies the slot conditions they're placed in", () => {
      forEachScenario(
        algorithm,
        factory,
        seed + 3,
        n,
        (scenario, { assignments }) => {
          const playersById = new Map(scenario.players.map((p) => [p.id, p]));
          for (const a of assignments) {
            for (const pa of a.positionAssignments) {
              const player = playersById.get(pa.playerId);
              expect(
                player,
                `assignment references unknown playerId ${pa.playerId}`,
              ).toBeTruthy();
              const conditions = slotConditionsForAssignment(
                a.treatment,
                pa.position,
              );
              expect(
                playerSatisfies(player!, conditions),
                `player ${pa.playerId} at position ${pa.position} of ${a.treatment.name} fails conditions ${JSON.stringify(conditions)}`,
              ).toBe(true);
            }
          }
        },
      );
    });

    test("5. total assigned players never exceeds input player count", () => {
      forEachScenario(
        algorithm,
        factory,
        seed + 4,
        n,
        (scenario, { assignments }) => {
          const total = assignments.reduce(
            (sum, a) => sum + a.positionAssignments.length,
            0,
          );
          expect(total).toBeLessThanOrEqual(scenario.players.length);
        },
      );
    });

    test("6. position uniqueness within an assignment", () => {
      forEachScenario(
        algorithm,
        factory,
        seed + 5,
        n,
        (_scenario, { assignments }) => {
          for (const a of assignments) {
            const positions = a.positionAssignments.map((pa) => pa.position);
            expect(new Set(positions).size).toBe(positions.length);
          }
        },
      );
    });

    test("7. result has an `assignments` array (algorithm extras allowed)", () => {
      forEachScenario(algorithm, factory, seed + 6, n, (_scenario, result) => {
        expect(result).toBeTruthy();
        expect(Array.isArray(result.assignments)).toBe(true);
      });
    });

    test("8. empty input → empty assignments (no crash, no null)", () => {
      const empty: ContractScenario = {
        players: [],
        treatments: [{ name: "t0", playerCount: 2 }],
      };
      const { dispatch } = factory({
        scenario: empty,
        rng: mulberry32(seed + 7),
      });
      const result = dispatch();
      expect(result.assignments).toEqual([]);
    });

    test("9. dispatcher does not mutate input treatments / player data / params", () => {
      forEachScenario(
        algorithm,
        factory,
        seed + 8,
        n,
        (scenario, _result, _idx, snapshots, params) => {
          expect(scenario.treatments).toEqual(snapshots!.treatmentsBefore);
          scenario.players.forEach((p, i) => {
            expect(p.data).toEqual(snapshots!.playerDataBefore[i]);
          });
          // Algorithm-specific params (e.g. urn's `counts` array) must
          // also be left intact — the host carries persistent state by
          // passing the *result*, not by relying on dispatcher mutation.
          expect(params).toEqual(snapshots!.paramsBefore);
        },
        { snapshot: true },
      );
    });

    test("10. every position in positionAssignments is in [0, treatment.playerCount)", () => {
      forEachScenario(
        algorithm,
        factory,
        seed + 9,
        n,
        (_scenario, { assignments }) => {
          for (const a of assignments) {
            for (const pa of a.positionAssignments) {
              expect(pa.position).toBeGreaterThanOrEqual(0);
              expect(pa.position).toBeLessThan(a.treatment.playerCount);
            }
          }
        },
      );
    });
  });
}
