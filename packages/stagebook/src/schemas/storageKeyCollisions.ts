/**
 * Storage-key collision detection.
 *
 * Two elements that resolve to the same `{type}_{name}` storage key silently
 * overwrite each other's saved data when both are encountered by the same
 * participant. Storage keys must be unique within the scope a single
 * participant traverses:
 *
 *   - within a single intro sequence (one solo phase, all steps)
 *   - within a single treatment (game stages + exit sequence combined)
 *   - within each (intro sequence × treatment) pair, since a participant
 *     who flows from one intro into one treatment encounters both sets
 *
 * Collisions ACROSS intro sequences (or across treatments) are NOT
 * collisions for any single participant — each participant only ever
 * encounters one of each — so they're allowed.
 *
 * Authors who need the same prompt file in multiple places use the
 * per-element `name:` override (e.g. `name: pretest_q1` vs
 * `name: posttest_q1`) to disambiguate.
 *
 * Key derivation mirrors the runtime `save()` calls. The `name` is
 * computed in `Element.tsx` before each element dispatches; the actual
 * `save()` invocation lives in the matching component under
 * `src/components/elements/` (except surveys, which are rendered via
 * the host-supplied `renderSurvey` slot — Element.tsx derives the key
 * before handing off). Per-type rules:
 *
 *   audio        → checked when `name:` is set. Unnamed audios fall
 *                   back to a position-based key
 *                   (`audio_<progressLabel>_<file>`) at runtime
 *                   (Element.tsx:audio case), so two unnamed audios
 *                   with the same file in different stages get
 *                   distinct storage keys naturally.
 *   prompt       → `prompt_${name}` (runtime fallback uses progressLabel +
 *                   metadata, which isn't derivable from the YAML alone, so
 *                   we only check explicitly-named prompts)
 *   survey       → checked when `name:` is set. Unnamed surveys fall
 *                   back to a position-based key at runtime, like audio.
 *   submitButton → `submitButton_${name}` (runtime fallback is progressLabel;
 *                   only checked when `name` is set)
 *   mediaPlayer  → checked when `name:` is set. Unnamed mediaPlayers fall
 *                   back to a position-based key at runtime, like audio.
 *   qualtrics    → fixed key `qualtricsDataReady` (Qualtrics.tsx:50). Any
 *                   two qualtrics elements in the same scope collide
 *                   regardless of name/url, since the key is constant.
 *   timeline     → `timeline_${name}` (name is required by the schema)
 *   trackedLink  → `trackedLink_${name}` (name is required by the schema)
 *
 * Why the file/surveyName fallbacks aren't checked: a researcher who
 * doesn't `name:` an audio is opting out of cross-stage data
 * tracking — they just want the sound to play. The runtime gives
 * each occurrence a unique position-derived key, so there's no
 * silent overwrite to flag. Researchers who want stable cross-stage
 * names set `name:` explicitly, at which point the collision
 * detector kicks in.
 */

export interface StorageKeyCollision {
  /** The duplicated storage key, e.g. "prompt_q1". */
  key: string;
  /** Human-readable description. */
  message: string;
  /** Paths within the treatment file where the duplicate occurs. */
  paths: (string | number)[][];
}

type Path = (string | number)[];

function strField(obj: Record<string, unknown>, field: string): string | null {
  const val = obj[field];
  return typeof val === "string" && val.length > 0 ? val : null;
}

function storageKeyFor(element: unknown): string | null {
  if (!element || typeof element !== "object") return null;
  const el = element as Record<string, unknown>;
  if (typeof el.type !== "string") return null;
  const name = strField(el, "name");
  switch (el.type) {
    // For these types, only check collisions when the researcher set
    // `name:` explicitly. Unnamed elements get a position-based key
    // at runtime (Element.tsx prepends `progressLabel`), so there's
    // no collision to flag — opt in to cross-stage tracking by
    // naming.
    case "audio":
    case "survey":
    case "mediaPlayer":
    case "prompt":
    case "submitButton":
    case "timeline":
    case "trackedLink":
      return name ? `${el.type}_${name}` : null;
    case "qualtrics":
      // Qualtrics writes to a fixed key regardless of element identity, so
      // any two qualtrics elements in the same scope collide. Return a
      // synthetic key that's identical for every qualtrics element.
      return "qualtrics_qualtricsDataReady";
    default:
      return null;
  }
}

function scanElements(
  elements: unknown,
  basePath: Path,
  into: Map<string, Path[]>,
): void {
  if (!Array.isArray(elements)) return;
  elements.forEach((el, idx) => {
    const key = storageKeyFor(el);
    if (!key) return;
    const path: Path = [...basePath, idx];
    const existing = into.get(key);
    if (existing) {
      existing.push(path);
    } else {
      into.set(key, [path]);
    }
  });
}

function emitDuplicates(
  keys: Map<string, Path[]>,
  scopeDescription: string,
): StorageKeyCollision[] {
  const out: StorageKeyCollision[] = [];
  keys.forEach((paths, key) => {
    if (paths.length < 2) return;
    out.push({
      key,
      paths,
      message: `Duplicate storage key "${key}" in ${scopeDescription}: ${paths.length} elements share this key. Storage keys must be unique within every (intro sequence × treatment) pair a participant can traverse. Use the per-element \`name:\` override to disambiguate.`,
    });
  });
  return out;
}

/**
 * Merge two key maps and return a *new* map containing only entries whose
 * combined paths come from BOTH inputs (i.e., the cross-scope duplicates).
 * Within-scope duplicates are caller's job to surface separately.
 */
function crossDuplicates(
  a: Map<string, Path[]>,
  b: Map<string, Path[]>,
): Map<string, Path[]> {
  const out = new Map<string, Path[]>();
  a.forEach((aPaths, key) => {
    const bPaths = b.get(key);
    if (bPaths && bPaths.length > 0 && aPaths.length > 0) {
      out.set(key, [...aPaths, ...bPaths]);
    }
  });
  return out;
}

function describe(name: unknown, fallbackIndex: number): string {
  return typeof name === "string" && name.length > 0
    ? `"${name}"`
    : `#${fallbackIndex}`;
}

export function collectStorageKeyCollisions(
  data: unknown,
): StorageKeyCollision[] {
  if (!data || typeof data !== "object") return [];
  const root = data as Record<string, unknown>;
  const out: StorageKeyCollision[] = [];

  // Build per-introSequence key maps; surface within-introSequence duplicates.
  const introMaps: { name: unknown; idx: number; keys: Map<string, Path[]> }[] =
    [];
  const introSequences = Array.isArray(root.introSequences)
    ? root.introSequences
    : [];
  introSequences.forEach((seq, seqIdx) => {
    if (!seq || typeof seq !== "object") return;
    const s = seq as { name?: unknown; introSteps?: unknown };
    const steps = Array.isArray(s.introSteps) ? s.introSteps : [];
    if (steps.length === 0) return;
    const keys = new Map<string, Path[]>();
    steps.forEach((step, stepIdx) => {
      if (!step || typeof step !== "object") return;
      const st = step as { elements?: unknown };
      scanElements(
        st.elements,
        ["introSequences", seqIdx, "introSteps", stepIdx, "elements"],
        keys,
      );
    });
    out.push(
      ...emitDuplicates(keys, `introSequence ${describe(s.name, seqIdx)}`),
    );
    introMaps.push({ name: s.name, idx: seqIdx, keys });
  });

  // Build per-treatment key maps; surface within-treatment duplicates.
  const treatmentMaps: {
    name: unknown;
    idx: number;
    keys: Map<string, Path[]>;
    /** Concrete declared `introSequences:` names (#499), or null when
     *  the declaration can't be interpreted statically (missing field,
     *  whole-field or per-item `${...}` placeholder) — cross-pair
     *  checks are skipped for that treatment rather than guessed. */
    declared: string[] | null;
  }[] = [];
  const treatments = Array.isArray(root.treatments) ? root.treatments : [];
  treatments.forEach((treatment, tIdx) => {
    if (!treatment || typeof treatment !== "object") return;
    const t = treatment as {
      name?: unknown;
      gameStages?: unknown;
      exitSequence?: unknown;
      introSequences?: unknown;
      debrief?: unknown;
    };
    const declaredRaw = t.introSequences;
    const declared =
      Array.isArray(declaredRaw) &&
      declaredRaw.every(
        (n): n is string => typeof n === "string" && !n.includes("${"),
      )
        ? declaredRaw
        : null;
    const keys = new Map<string, Path[]>();
    const gameStages = Array.isArray(t.gameStages) ? t.gameStages : [];
    gameStages.forEach((stage, stageIdx) => {
      if (!stage || typeof stage !== "object") return;
      const s = stage as { elements?: unknown };
      scanElements(
        s.elements,
        ["treatments", tIdx, "gameStages", stageIdx, "elements"],
        keys,
      );
    });
    const exitSequence = Array.isArray(t.exitSequence) ? t.exitSequence : [];
    exitSequence.forEach((step, stepIdx) => {
      if (!step || typeof step !== "object") return;
      const st = step as { elements?: unknown };
      scanElements(
        st.elements,
        ["treatments", tIdx, "exitSequence", stepIdx, "elements"],
        keys,
      );
    });
    // Debrief (#481) shares the treatment's key scope, like exitSequence.
    const debrief = Array.isArray(t.debrief) ? t.debrief : [];
    debrief.forEach((step, stepIdx) => {
      if (!step || typeof step !== "object") return;
      const st = step as { elements?: unknown };
      scanElements(
        st.elements,
        ["treatments", tIdx, "debrief", stepIdx, "elements"],
        keys,
      );
    });
    if (keys.size === 0) return;
    out.push(...emitDuplicates(keys, `treatment ${describe(t.name, tIdx)}`));
    treatmentMaps.push({ name: t.name, idx: tIdx, keys, declared });
  });

  // Consent arms (#481): per-arm key maps. Within-arm duplicates are
  // collisions (internal gating references + one audit record per key);
  // arm × arm reuse is legal (a participant sees exactly one arm), same
  // as intro × intro.
  const consentMaps: {
    name: unknown;
    idx: number;
    keys: Map<string, Path[]>;
  }[] = [];
  const consentArms = Array.isArray(root.consent) ? root.consent : [];
  consentArms.forEach((arm, armIdx) => {
    if (!arm || typeof arm !== "object") return;
    const a = arm as { name?: unknown; steps?: unknown };
    const steps = Array.isArray(a.steps) ? a.steps : [];
    if (steps.length === 0) return;
    const keys = new Map<string, Path[]>();
    steps.forEach((step, stepIdx) => {
      if (!step || typeof step !== "object") return;
      const st = step as { elements?: unknown };
      scanElements(
        st.elements,
        ["consent", armIdx, "steps", stepIdx, "elements"],
        keys,
      );
    });
    out.push(
      ...emitDuplicates(keys, `consent arm ${describe(a.name, armIdx)}`),
    );
    consentMaps.push({ name: a.name, idx: armIdx, keys });
  });

  // Consent × EVERYTHING (#481): consent has no pairing relationship, so
  // its keys are checked against every intro sequence and every treatment
  // — conservative, cheap, and never wrong (no treatment can "need" a
  // consent arm, so a false conflict just prompts a rename). This is the
  // "collision scope follows pairing scope" principle: universal where
  // the relationship is independent.
  // Capped per pair: unlike the treatment × intro check (scoped to the
  // author's declared pairings), this product is unconditional — C arms
  // × (I + T) containers. An adversarial file (hundreds of arms ×
  // hundreds of containers × shared keys) would otherwise amplify into
  // millions of diagnostics and gigabytes of message text inside the
  // editor/manager process. Twenty per pair is far beyond anything an
  // author needs to see; the summary entry says what was elided.
  const MAX_CROSS_PER_PAIR = 20;
  const emitCapped = (
    cross: Map<string, Path[]>,
    pairLabel: string,
    summaryPath: Path,
  ) => {
    const emitted = emitDuplicates(cross, pairLabel);
    if (emitted.length <= MAX_CROSS_PER_PAIR) {
      out.push(...emitted);
      return;
    }
    out.push(...emitted.slice(0, MAX_CROSS_PER_PAIR));
    out.push({
      key: "…",
      paths: [summaryPath],
      message: `…and ${String(emitted.length - MAX_CROSS_PER_PAIR)} more storage-key collisions for the ${pairLabel}. Fix the ones above and re-validate.`,
    });
  };
  for (const consentArm of consentMaps) {
    for (const intro of introMaps) {
      emitCapped(
        crossDuplicates(consentArm.keys, intro.keys),
        `pair of consent arm ${describe(consentArm.name, consentArm.idx)} × introSequence ${describe(intro.name, intro.idx)}`,
        ["consent", consentArm.idx],
      );
    }
    for (const treatment of treatmentMaps) {
      emitCapped(
        crossDuplicates(consentArm.keys, treatment.keys),
        `pair of consent arm ${describe(consentArm.name, consentArm.idx)} × treatment ${describe(treatment.name, treatment.idx)}`,
        ["consent", consentArm.idx],
      );
    }
  }

  // Cross-pair: each treatment × the intro sequences it DECLARES via
  // `introSequences:` (#499) — collision scope follows pairing scope. A
  // participant only ever flows from a declared sequence into the
  // treatment, so a key shared with a never-paired sequence is not a
  // collision anyone can experience. Treatments whose declaration isn't
  // statically interpretable (placeholder / missing field) skip the
  // cross-pair check — can't-prove posture, matching the reference
  // validator.
  for (const intro of introMaps) {
    for (const treatment of treatmentMaps) {
      if (
        treatment.declared === null ||
        typeof intro.name !== "string" ||
        !treatment.declared.includes(intro.name)
      ) {
        continue;
      }
      const cross = crossDuplicates(intro.keys, treatment.keys);
      out.push(
        ...emitDuplicates(
          cross,
          `pair of introSequence ${describe(intro.name, intro.idx)} × treatment ${describe(treatment.name, treatment.idx)}`,
        ),
      );
    }
  }

  return out;
}
