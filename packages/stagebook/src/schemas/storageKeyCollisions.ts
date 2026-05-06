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
 * Key derivation mirrors the save() calls in src/components/elements/:
 *   audio        → `audio_${name ?? file}`
 *   prompt       → `prompt_${name}` (runtime fallback uses progressLabel +
 *                   metadata, which isn't derivable from the YAML alone, so
 *                   we only check explicitly-named prompts)
 *   survey       → `survey_${name ?? surveyName}`
 *   submitButton → `submitButton_${name}` (runtime fallback is progressLabel;
 *                   only checked when `name` is set)
 *   mediaPlayer  → `mediaPlayer_${name ?? file}` (runtime falls back to the
 *                   raw `file` field at Element.tsx:277, before URL resolution)
 *   qualtrics    → fixed key `qualtricsDataReady` (Qualtrics.tsx:50). Any
 *                   two qualtrics elements in the same scope collide
 *                   regardless of name/url, since the key is constant.
 *   timeline     → `timeline_${name}` (name is required by the schema)
 *   trackedLink  → `trackedLink_${name}` (name is required by the schema)
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
  let suffix: string | null;
  switch (el.type) {
    case "audio":
      suffix = name ?? strField(el, "file");
      break;
    case "survey":
      suffix = name ?? strField(el, "surveyName");
      break;
    case "mediaPlayer":
      suffix = name ?? strField(el, "file");
      break;
    case "prompt":
    case "submitButton":
    case "timeline":
    case "trackedLink":
      suffix = name;
      break;
    case "qualtrics":
      // Qualtrics writes to a fixed key regardless of element identity, so
      // any two qualtrics elements in the same scope collide. Return a
      // synthetic key that's identical for every qualtrics element.
      return "qualtrics_qualtricsDataReady";
    default:
      return null;
  }
  return suffix ? `${el.type}_${suffix}` : null;
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
  }[] = [];
  const treatments = Array.isArray(root.treatments) ? root.treatments : [];
  treatments.forEach((treatment, tIdx) => {
    if (!treatment || typeof treatment !== "object") return;
    const t = treatment as {
      name?: unknown;
      gameStages?: unknown;
      exitSequence?: unknown;
    };
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
    if (keys.size === 0) return;
    out.push(...emitDuplicates(keys, `treatment ${describe(t.name, tIdx)}`));
    treatmentMaps.push({ name: t.name, idx: tIdx, keys });
  });

  // Cross-pair: every (introSequence × treatment) combination. A participant
  // who flows from intro_i into treatment_j sees both sets, so any key
  // appearing in both is a collision for that participant.
  for (const intro of introMaps) {
    for (const treatment of treatmentMaps) {
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
