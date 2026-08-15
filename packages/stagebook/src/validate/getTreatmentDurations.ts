// Host primitive: how long can this treatment run? (#585)
//
// `getTreatmentDurations` is the fourth member of the host-facing
// analysis family stagebook ships alongside `getReferencedAssets` (→
// asset mirror), `checkPairing` (→ intro pairing) and
// `getRequiredServices` (→ infrastructure): walk the expanded treatment
// tree, hand the host a fact about the design it would otherwise
// re-derive itself.
//
// A host that provisions infrastructure has runtime bounds the design
// knows nothing about and has to check the design against them. The
// concrete case: the runner creates a Daily room per game with a
// hard-coded one-hour `exp`, and nothing checks a treatment's total
// stage duration against it — a study longer than 60 minutes loses its
// room mid-session (talkbench/runner#542 §3). Deriving the number
// host-side is exactly the rot this family exists to prevent: where
// durations live, which of them bound a GAME versus a whole session,
// and how templates expand into stages are all facts about the DSL.
//
// UPPER BOUND, NOT A PREDICTION. Every number here is the most the
// design can consume, never the expected value:
//
//   * A game stage ends early when every player submits, so the real
//     game is usually shorter than `gameSeconds`.
//   * A stage with `conditions:` can be skipped entirely at runtime.
//     It still counts — over-provisioning is the safe direction for a
//     resource bound.
//
// WHAT THE DSL DOES AND DOESN'T TIME. `duration` exists on exactly one
// node: a game stage (`treatments[].gameStages[]`, seconds). Intro,
// exit and consent steps are SELF-PACED — `introExitStepSchema` has no
// duration field at all — so no honest number can be summed for them.
// Rather than report a structurally-zero "intro seconds" that a caller
// would read as "the intro is instant", this reports the self-paced
// steps as COUNTS (`consentSteps` / `introSteps` / `exitSteps`) and
// leaves the per-step estimate to the host, which is the only layer
// that has one (pilot timings, a payment model). A host doing payment
// estimation therefore composes `gameSeconds` with its own estimate
// over those counts.
//
// (Element-level `displayTime` / `hideTime` / `timer.endTime` inside a
// self-paced step are deliberately ignored: an element that appears at
// t=60 implies the step lasts AT LEAST 60s. That's a lower bound, and
// mixing it into an upper bound would produce a number that is neither.)
//
// PHASES ARE SEPARATE FIELDS ON PURPOSE. The game sum and the
// intro/exit/consent counts answer different questions for different
// consumers — the runner sizes a call room, which is created at game
// start, so intro time is irrelevant to it; the manager wants total
// participant time for payment estimation. Keeping them apart lets one
// walk serve both, and it is what makes the field-wise `max` in
// `mergeTreatmentDurations` correct for a launch selection (see below).

/** Everything the DSL can tell a host about one scope's length. All
 *  values are UPPER BOUNDS (see the file header). */
export interface TreatmentDurations {
  /**
   * Upper bound on a GAME's wall-clock length, in seconds: the sum of
   * every `gameStages[].duration` in scope. This is the number a
   * per-game runtime resource must cover — the runner's Daily room
   * `exp`, which is stamped at game start (talkbench/runner#542 §3).
   * Zero for an intro sequence or consent arm, which host no game
   * stages.
   */
  gameSeconds: number;
  /** How many game stages are in scope (whether or not their duration
   *  was usable). */
  gameStages: number;
  /**
   * Game stages in scope whose `duration` is not a usable number — an
   * unresolved `${field}` placeholder in un-expanded input, or a
   * missing / non-finite / non-positive value. They contribute 0
   * seconds, so a non-zero count means `gameSeconds` is an UNDER-count
   * and the host should treat the bound as unsafe rather than trust it.
   */
  unresolvedStages: number;
  /** Consent steps in scope (`consent[].steps`). Self-paced — the DSL
   *  gives them no duration, so they add nothing to `gameSeconds`. */
  consentSteps: number;
  /** Intro steps in scope (`introSequences[].introSteps`). Self-paced. */
  introSteps: number;
  /** Exit steps in scope (`treatments[].exitSequence`). Self-paced.
   *  Includes debrief steps, which are authored as the trailing exit
   *  steps (#481). */
  exitSteps: number;
}

export interface TreatmentDurationsReport {
  /**
   * The worst case any single launch from this file could produce: the
   * field-wise MAX over every arm in the file, including unnamed ones
   * the keyed maps below drop.
   *
   * Deliberately NOT the whole-file union `getRequiredServices.overall`
   * is. Services are additive across arms (a file that uses video
   * anywhere may need a Daily key); durations are not — a participant
   * runs ONE treatment, so summing two arms' game stages would describe
   * a session nobody experiences and inflate a provisioning bound by a
   * factor of the arm count.
   */
  overall: TreatmentDurations;
  /**
   * Per-treatment, keyed by treatment `name`. The only axis that can
   * carry `gameSeconds` / `gameStages` (game stages live on a
   * treatment) or `exitSteps` (so does `exitSequence`).
   */
  byTreatment: Record<string, TreatmentDurations>;
  /** Per-intro-sequence, keyed by intro sequence `name`. Only
   *  `introSteps` can originate here. */
  byIntroSequence: Record<string, TreatmentDurations>;
  /** Per-consent-arm, keyed by consent arm `name` (the top-level
   *  `consent:` collection, #481 — a launch axis selected by
   *  `consentName`). Only `consentSteps` can originate here. */
  byConsent: Record<string, TreatmentDurations>;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

function zero(): TreatmentDurations {
  return {
    gameSeconds: 0,
    gameStages: 0,
    unresolvedStages: 0,
    consentSteps: 0,
    introSteps: 0,
    exitSteps: 0,
  };
}

/**
 * Field-wise MAX of several `TreatmentDurations` — the bound for a
 * launch's selection:
 *
 *   const bound = mergeTreatmentDurations(
 *     ...treatmentNames.map((t) => report.byTreatment[t]),
 *     report.byIntroSequence[introSequenceName],
 *     report.byConsent[consentName],
 *   );
 *
 * Max rather than sum because a launch's arms are ALTERNATIVES a
 * participant is assigned between, not phases they run in series — the
 * bound must cover the longest one, not their total. That stays correct
 * across phases only because each phase is its own field: a consent arm
 * contributes `consentSteps` and nothing else, an intro sequence
 * `introSteps` and nothing else, so maxing them together never lets one
 * phase mask another.
 *
 * Undefined entries (an unknown arm name) are skipped, so a missing key
 * contributes nothing rather than throwing; no arguments yields zeros.
 */
export function mergeTreatmentDurations(
  ...durations: (TreatmentDurations | undefined)[]
): TreatmentDurations {
  const present = durations.filter(
    (d): d is TreatmentDurations => d !== undefined,
  );
  const max = (pick: (d: TreatmentDurations) => number) =>
    present.reduce((acc, d) => Math.max(acc, pick(d)), 0);
  return {
    gameSeconds: max((d) => d.gameSeconds),
    gameStages: max((d) => d.gameStages),
    unresolvedStages: max((d) => d.unresolvedStages),
    consentSteps: max((d) => d.consentSteps),
    introSteps: max((d) => d.introSteps),
    exitSteps: max((d) => d.exitSteps),
  };
}

/** The DSL key a list of timed/self-paced units sits under → the field
 *  its members count toward. Single source of truth for the walk; a new
 *  phase collection is one row here. */
const STEP_LIST_KEYS: Record<
  string,
  "consentSteps" | "introSteps" | "exitSteps"
> = {
  // `steps:` is the consent arm's list; no other DSL node uses it.
  steps: "consentSteps",
  introSteps: "introSteps",
  exitSequence: "exitSteps",
};

/** Add one `gameStages:` item's duration, or record it as unresolved.
 *  Only a finite, positive number is usable: a `${field}` placeholder
 *  survives un-expanded input as a string, and a non-positive or
 *  non-finite value would corrupt the sum in the UNSAFE direction. */
function countStage(node: unknown, acc: TreatmentDurations): void {
  acc.gameStages += 1;
  const duration = isRecord(node) ? node.duration : undefined;
  if (
    typeof duration === "number" &&
    Number.isFinite(duration) &&
    duration > 0
  ) {
    acc.gameSeconds += duration;
  } else {
    acc.unresolvedStages += 1;
  }
}

function walk(
  node: unknown,
  acc: TreatmentDurations,
  seen: WeakSet<object>,
): void {
  if (node === null || typeof node !== "object") return;
  // Guard against cyclic object graphs. YAML anchors/aliases can produce
  // genuine cycles (e.g. `a: &x { child: [*x] }`), which would otherwise
  // stack-overflow this recursive walk — and the input is treatment
  // source a study author controls.
  if (seen.has(node)) return;
  seen.add(node);

  if (Array.isArray(node)) {
    for (const item of node) walk(item, acc, seen);
    return;
  }

  // Classify by the KEY a list sits under, not by finding `duration:`
  // anywhere — so only real DSL positions count, and an opaque
  // `z.unknown()` config bag that happens to carry a `duration` (or a
  // `mediaPlayer`'s `stepDuration`, or a `timer`'s `endTime`) can never
  // inflate the bound. Still recurse into every value so units nested
  // deeper in the tree are reached.
  const record = node as Record<string, unknown>;
  for (const [key, value] of Object.entries(record)) {
    if (key === "gameStages" && Array.isArray(value)) {
      for (const item of value) countStage(item, acc);
    } else if (Array.isArray(value) && key in STEP_LIST_KEYS) {
      // Only records are steps; a stray scalar in the list isn't one.
      for (const item of value)
        if (isRecord(item)) acc[STEP_LIST_KEYS[key]] += 1;
    }
    walk(value, acc, seen);
  }
}

/** Walk one arm subtree into a fresh accumulator. */
function scan(node: unknown): TreatmentDurations {
  const acc = zero();
  walk(node, acc, new WeakSet<object>());
  return acc;
}

/** Every entry of a top-level arm collection, scanned. `name` is
 *  `undefined` for an entry that can't be a launch-selection target —
 *  those are dropped from the keyed maps but still fold into `overall`,
 *  which is the over-estimating direction. */
function scanEntries(
  root: Record<string, unknown>,
  key: string,
): { name: string | undefined; durations: TreatmentDurations }[] {
  const list = Array.isArray(root[key]) ? (root[key] as unknown[]) : [];
  return list.filter(isRecord).map((item) => ({
    name: typeof item.name === "string" ? item.name : undefined,
    durations: scan(item),
  }));
}

/**
 * Report how long a hydrated treatment file can run, keyed by arm.
 *
 * Every number is an UPPER BOUND, not an expected duration: stages end
 * early when all players submit, and a stage with `conditions:` may be
 * skipped entirely yet still counts. Use it to size a resource against
 * the design (the runner's Daily room `exp`), not to tell a participant
 * how long the study takes.
 *
 * Pure and synchronous — unlike `getRequiredServices`, every duration is
 * already in the treatment tree, so there is no loader to inject.
 *
 * Expects a fully HYDRATED tree — imports merged AND templates expanded
 * (`fillTemplates` run), e.g. `parseTreatmentSource(...).data` or the
 * host's own hydration pipeline. A merely import-merged tree
 * (`loadAndMergeImports().merged`) still carries `${field}` placeholders
 * where durations belong; those are counted in `unresolvedStages` rather
 * than guessed at, so the shortfall is visible instead of silent.
 * Accepts `unknown`; a non-object yields a zero report and empty maps,
 * mirroring the family's tolerance of pre-schema input.
 *
 * Returns `{ overall, byTreatment, byIntroSequence, byConsent }`.
 * `overall` is the field-wise max over every arm (the worst case one
 * launch could produce); the keyed maps let a host narrow to the arms a
 * batch actually selects and combine them with `mergeTreatmentDurations`
 * — the treatment × intro selection is the same one it passes to
 * `checkPairing`, and consent is selected by `consentName`.
 */
export function getTreatmentDurations(
  hydratedFile: unknown,
): TreatmentDurationsReport {
  const root = isRecord(hydratedFile) ? hydratedFile : {};
  // Note there is no whole-file walk to guard: every scan starts at an
  // ARM, so template definitions (`templates:`, which a merely
  // import-merged tree still carries) can't contribute — an uninvoked
  // template describes no launchable session.
  const treatments = scanEntries(root, "treatments");
  const introSequences = scanEntries(root, "introSequences");
  const consent = scanEntries(root, "consent");

  // Key by arm `name` into a null-prototype map so a schema-valid but
  // hostile arm name (`__proto__`, `constructor`) can't rebind the map's
  // prototype and become enumeration-invisible — a narrowing host must
  // be able to see and look up every arm. Duplicate names fold to the
  // longer arm rather than letting a later entry silently shorten the
  // bound.
  const keyed = (
    entries: { name: string | undefined; durations: TreatmentDurations }[],
  ): Record<string, TreatmentDurations> => {
    const map: Record<string, TreatmentDurations> = Object.create(null);
    for (const { name, durations } of entries) {
      if (name === undefined) continue;
      map[name] = mergeTreatmentDurations(map[name], durations);
    }
    return map;
  };

  return {
    overall: mergeTreatmentDurations(
      ...[...treatments, ...introSequences, ...consent].map((e) => e.durations),
    ),
    byTreatment: keyed(treatments),
    byIntroSequence: keyed(introSequences),
    byConsent: keyed(consent),
  };
}
