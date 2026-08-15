// Host primitive: how long can this treatment run? (#585)
//
// `getTreatmentDurations` is the fourth member of the host-facing
// analysis family stagebook ships alongside `getReferencedAssets` (→
// asset mirror), `checkPairing` (→ intro pairing) and
// `getRequiredServices` (→ infrastructure): read the expanded treatment
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
// read serve both, and it is what makes the field-wise `max` in
// `mergeTreatmentDurations` correct for a launch selection (see below).
//
// READS FIXED POSITIONS, DOES NOT SEARCH. Each arm collection has
// exactly one shape, so this reads named fields off the arm root —
// `treatments[]` → `gameStages` + `exitSequence`, `introSequences[]` →
// `introSteps`, `consent[]` → `steps` — rather than hunting those key
// names through the subtree. That distinction is load-bearing, not
// stylistic: `discussion.layout.feeds[].options` is an open
// `z.record(z.string(), z.unknown())` bag inside a GAME STAGE, so an
// author-controlled key named `steps` in a feed config would otherwise
// be counted as consent steps. Reading fixed positions makes that
// structurally impossible instead of merely untested, and drops the
// recursion (and its cycle guard and stack-depth ceiling) with it.
//
// UN-HYDRATED INPUT IS FLAGGED, NEVER SILENTLY ZERO. The failure that
// matters most here is the quiet one: a caller passes a merely
// import-merged tree whose arms are still template INVOCATIONS
// (`- template: std`), every list this reads is absent, and a
// zero-everything report sails back. The runner would compute
// `max(3600, 0 + slack)` and silently fall back to exactly the
// hard-coded hour #585 exists to remove. So an arm position whose
// contents can't be read counts as one unit AND raises the matching
// `unresolved*` flag for its phase: no position is ever dropped in
// silence.

/** Everything the DSL can tell a host about one scope's length. All
 *  values are UPPER BOUNDS (see the file header). */
export interface TreatmentDurations {
  /**
   * Upper bound on a GAME's wall-clock length, in seconds: the sum of
   * every `gameStages[].duration` in scope. This is the number a
   * per-game runtime resource must cover — the runner's Daily room
   * `exp`, which is stamped at game start (talkbench/runner#542 §3).
   * Always zero for an intro sequence or consent arm; neither hosts
   * game stages. Guaranteed finite and JSON-safe: a sum that would
   * exceed `Number.MAX_SAFE_INTEGER` is clamped there and flagged in
   * `unresolvedStages` rather than escaping as `Infinity` (which
   * `JSON.stringify` would hand a host as `null`).
   */
  gameSeconds: number;
  /** How many game stages are in scope, whether or not each one's
   *  duration could be read. */
  gameStages: number;
  /**
   * Game stages in scope that contributed no seconds — a `duration`
   * that is an unresolved `${field}` placeholder, missing, non-finite
   * or non-positive; a stage position that isn't a record at all; or a
   * whole `gameStages:` list that is still a template invocation rather
   * than an array. **A non-zero value means `gameSeconds` is an
   * UNDER-count and the bound is unsafe** — check it before sizing
   * anything off `gameSeconds`.
   */
  unresolvedStages: number;
  /** Consent steps in scope (`consent[].steps`). Self-paced — the DSL
   *  gives them no duration, so they add nothing to `gameSeconds`. */
  consentSteps: number;
  /** Of those, how many couldn't be read (see `unresolvedIntroSteps`). */
  unresolvedConsentSteps: number;
  /** Intro steps in scope (`introSequences[].introSteps`). Self-paced. */
  introSteps: number;
  /**
   * Of those, how many positions couldn't be read — a step list still
   * held as a template invocation, or a position that isn't a record.
   * The `unresolvedStages` analogue: non-zero means `introSteps` is an
   * UNDER-count.
   *
   * Split per phase rather than one aggregate `unresolvedSteps` so the
   * field-wise `max` in `mergeTreatmentDurations` stays exactly correct.
   * Consent, intro and exit run in SERIES for one participant, so maxing
   * a single shared counter across them would report 1 where three
   * phases each hid a position. Every field in this interface is
   * per-phase for that reason; an aggregate would be the one exception
   * that breaks the merge's correctness argument.
   */
  unresolvedIntroSteps: number;
  /** Exit steps in scope (`treatments[].exitSequence`). Self-paced.
   *  Includes debrief steps, which are authored as the trailing exit
   *  steps (#481). */
  exitSteps: number;
  /** Of those, how many couldn't be read (see `unresolvedIntroSteps`).
   *  An ABSENT `exitSequence:` is not counted — the schema makes it
   *  optional, so a resolved treatment without one genuinely has zero
   *  exit steps. */
  unresolvedExitSteps: number;
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
    unresolvedConsentSteps: 0,
    introSteps: 0,
    unresolvedIntroSteps: 0,
    exitSteps: 0,
    unresolvedExitSteps: 0,
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
 * across phases only because EVERY field is per-phase: a consent arm
 * contributes `consentSteps` / `unresolvedConsentSteps` and nothing else,
 * an intro sequence its two intro fields and nothing else, so maxing them
 * together never lets one phase mask another. That invariant is why the
 * `unresolved*` counters are split per phase too — consent, intro and
 * exit run in SERIES for one participant, so a single shared counter
 * would report 1 where three phases each hid a position.
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
    unresolvedConsentSteps: max((d) => d.unresolvedConsentSteps),
    introSteps: max((d) => d.introSteps),
    unresolvedIntroSteps: max((d) => d.unresolvedIntroSteps),
    exitSteps: max((d) => d.exitSteps),
    unresolvedExitSteps: max((d) => d.unresolvedExitSteps),
  };
}

/**
 * Sum one `gameStages:` list into the accumulator.
 *
 * A stage contributes seconds only when its `duration` is a positive,
 * finite number: a `${field}` placeholder survives un-expanded input as
 * a string, and a non-positive or non-finite value would move the sum in
 * the UNSAFE direction. Anything else counts as a stage (the position is
 * real, so dropping it would under-count) and raises `unresolvedStages`.
 *
 * A `gameStages:` that isn't an array is a surviving template invocation
 * (or junk) — an unknown number of stages, so it counts as one unread
 * stage rather than as nothing.
 */
function sumGameStages(list: unknown, acc: TreatmentDurations): void {
  if (!Array.isArray(list)) {
    acc.gameStages += 1;
    acc.unresolvedStages += 1;
    return;
  }
  for (const item of list) {
    acc.gameStages += 1;
    const duration = isRecord(item) ? item.duration : undefined;
    if (
      typeof duration !== "number" ||
      !Number.isFinite(duration) ||
      duration <= 0
    ) {
      acc.unresolvedStages += 1;
      continue;
    }
    const sum = acc.gameSeconds + duration;
    // `durationSchema` sets no upper bound, so a schema-valid pair of
    // enormous durations can carry the sum past the integer-safe range
    // and on to Infinity — which `JSON.stringify` hands a host as
    // `null`, and `now + Infinity` turns into a nonsense expiry. Clamp
    // to a finite, JSON-safe value and flag it as unreadable instead.
    if (sum > Number.MAX_SAFE_INTEGER) {
      acc.gameSeconds = Number.MAX_SAFE_INTEGER;
      acc.unresolvedStages += 1;
    } else {
      acc.gameSeconds = sum;
    }
  }
}

/**
 * Count one self-paced step list into `field`.
 *
 * `optional` marks a list the schema lets an arm omit (only
 * `exitSequence`): absent means genuinely zero steps. A REQUIRED list
 * that is absent or not an array is un-hydrated or malformed — an
 * unknown number of steps, counted as one unread step rather than as
 * nothing.
 */
const UNRESOLVED_FIELD = {
  consentSteps: "unresolvedConsentSteps",
  introSteps: "unresolvedIntroSteps",
  exitSteps: "unresolvedExitSteps",
} as const;

function countSteps(
  list: unknown,
  acc: TreatmentDurations,
  field: keyof typeof UNRESOLVED_FIELD,
  optional = false,
): void {
  const unread = UNRESOLVED_FIELD[field];
  if (!Array.isArray(list)) {
    if (optional && list === undefined) return;
    acc[field] += 1;
    acc[unread] += 1;
    return;
  }
  for (const item of list) {
    acc[field] += 1;
    // A step position that is still a template invocation counts as one
    // unit here, but a list-valued template (`contentType: exitSteps`) or
    // a `broadcast:` fans it out into several — so the count is an
    // under-count and has to say so.
    if (!isRecord(item) || isTemplateInvocation(item)) acc[unread] += 1;
  }
}

/**
 * Is this node a surviving template invocation
 * (`templateContextSchema` — `{ template, fields?, broadcast? }`)?
 *
 * `altTemplateContext` wraps every arm collection, every step list, and
 * every stage, so any of those positions can still hold one in a merely
 * import-merged tree. A stage invocation is already caught by having no
 * numeric `duration`; a STEP invocation is not, because a step carries no
 * required scalar to miss — `introExitStepSchema` is `.strict()` over
 * name/notes/conditions/elements, so a `template:` key can only be an
 * invocation, never a real step.
 */
function isTemplateInvocation(node: Record<string, unknown>): boolean {
  return typeof node.template === "string";
}

/** Read the duration-bearing fields off one arm root. Which fields
 *  exist is fixed by the collection the arm came from, so each scanner
 *  reads named positions — never a key-name search (see the file
 *  header). A non-record arm entry (a YAML indentation slip that nests
 *  a treatment one level too deep) is an arm whose contents can't be
 *  read, so it is flagged rather than dropped. */
const SCAN_ARM = {
  treatments: (arm: unknown, acc: TreatmentDurations) => {
    // `exitSequence` is the one list the schema lets an arm omit, so
    // "absent" normally means a genuine zero. That exemption is only
    // safe on a RESOLVED treatment: a whole-arm template invocation has
    // no raw `exitSequence` either, and its expansion may well add one —
    // so honouring the exemption there would report `exitSteps: 0` with
    // `unresolvedExitSteps: 0`, and a host checking only the step flags
    // (the documented participant-time path) would trust the under-count.
    const resolved = isRecord(arm) && !isTemplateInvocation(arm);
    sumGameStages(resolved ? arm.gameStages : undefined, acc);
    countSteps(
      resolved ? arm.exitSequence : undefined,
      acc,
      "exitSteps",
      resolved,
    );
  },
  introSequences: (arm: unknown, acc: TreatmentDurations) => {
    countSteps(isRecord(arm) ? arm.introSteps : undefined, acc, "introSteps");
  },
  consent: (arm: unknown, acc: TreatmentDurations) => {
    countSteps(isRecord(arm) ? arm.steps : undefined, acc, "consentSteps");
  },
} as const;

/** Every entry of a top-level arm collection, scanned. `name` is
 *  `undefined` for an entry that can't be a launch-selection target —
 *  those are dropped from the keyed maps but still fold into `overall`,
 *  which is the over-estimating direction. */
function scanEntries(
  root: Record<string, unknown>,
  key: keyof typeof SCAN_ARM,
): { name: string | undefined; durations: TreatmentDurations }[] {
  const raw = root[key];
  // The collection ITSELF is `altTemplateContext`-wrapped, so a merely
  // import-merged tree can hold `treatments: {template: all_arms}` —
  // present, schema-valid, and not an array. Reading that as "no arms"
  // would hand back the same all-zero, all-clear report the un-hydrated
  // guarantee exists to prevent, so scan one unread arm instead.
  if (!Array.isArray(raw)) {
    if (raw === undefined) return [];
    const durations = zero();
    SCAN_ARM[key](undefined, durations);
    return [{ name: undefined, durations }];
  }
  return (raw as unknown[]).map((item) => {
    const durations = zero();
    SCAN_ARM[key](item, durations);
    return {
      name:
        isRecord(item) && typeof item.name === "string" ? item.name : undefined,
      durations,
    };
  });
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
 * Expects a HYDRATED tree — imports merged AND templates expanded
 * (`fillTemplates` run), e.g. `parseTreatmentSource(...).data` or the
 * host's own hydration pipeline.
 *
 * **Check `unresolvedStages` before trusting `gameSeconds`** (and each
 * phase's `unresolved*Steps` before trusting that phase's count). That is
 * not just a
 * guard against being handed the wrong thing: hydrated does NOT mean
 * fully resolved. `parseTreatmentSource` — the recommended entry point
 * above — runs `fillTemplates({ allowUnresolved: true })` on purpose, so
 * that editor and preview surfaces can render a partially-authored file.
 * Its output is in-contract input here and can still carry
 * `duration: "${stageLength}"`. That is also why this reports rather than
 * throws: refusing unresolved input would reject the recommended
 * pipeline's own output.
 *
 * So every position this can't read is counted and flagged rather than
 * silently skipped, whether it came from a legitimate partial parse or
 * from a caller who passed a merely import-merged tree (which still holds
 * arms and stage lists as template invocations). Either way the shortfall
 * is visible instead of a clean-looking zero. Accepts `unknown`; a
 * non-object yields a zero report and empty maps, mirroring the family's
 * tolerance of pre-schema input.
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
  // be able to see and look up every arm. This is load-bearing beyond
  // tidiness: with a plain `{}`, `byTreatment["constructor"]` would
  // return an inherited function, which `mergeTreatmentDurations` (whose
  // only guard is `!== undefined`) would fold into `Math.max(0,
  // undefined)` — handing a host `NaN` in every field, and a `NaN` room
  // expiry. Duplicate names fold field-wise rather than letting a later
  // entry silently shorten the bound.
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
