import type {
  DispatcherConfig,
  UniformRandomDispatcherConfig,
  UrnDispatcherConfig,
  WeightedKnockdownDispatcherConfig,
  WeightedRandomDispatcherConfig,
} from "./types.js";

/** One validation diagnostic. `path` points into the config object using
 *  the same dotted convention zod does (e.g. `"counts"`,
 *  `"decrements.T_a.T_b"`) so callers can surface it the same way they
 *  surface zod issues.
 *
 *  `severity` defaults to `"error"` when omitted. Most diagnostics are
 *  errors; a handful (e.g. `weighted-random` with all-zero weights —
 *  the "batch is temporarily gated off" case) emit `"warning"` instead
 *  so they surface to authors without failing `ok`. */
export interface DispatcherConfigDiagnostic {
  path: string;
  message: string;
  severity?: "error" | "warning";
}

export interface DispatcherConfigValidationResult {
  /** True iff there are no error-severity diagnostics. */
  ok: boolean;
  diagnostics: DispatcherConfigDiagnostic[];
}

/**
 * Validate a dispatcher config that the host has already resolved
 * (file-reference `{from: "./counts.json"}` shapes substituted with
 * concrete labeled objects).
 *
 * Per-dispatcher rules:
 *   - `urn.counts` — labeled object `{[treatmentName]: nonNegInt}`.
 *     Label set must equal the treatment name set.
 *   - `urn.decrements` (optional) — labeled matrix
 *     `{[rowName]: {[colName]: nonNegInt}}`. Row labels must be a
 *     subset of treatment names (missing rows default to identity);
 *     column labels within a present row must be a subset of treatment
 *     names (missing columns within a present row default to 0).
 *     Initial-balance check: `decrements[i][j] <= counts[j]`.
 *   - `weighted-random.weights` — labeled object
 *     `{[treatmentName]: nonNegFiniteReal}`. Label set must equal the
 *     treatment name set. All-zero is a warning, not an error.
 *   - `uniform-random` — no params; stray fields rejected.
 *   - `local-penalization` — discriminator recognized; deeper
 *     validation lives in deliberation-lab.
 *
 * Old positional-array forms get a clear migration-hint error (we
 * shipped them as the API in v0.12-v0.13 but reject them from v0.14
 * onward to surface batch configs that haven't migrated).
 */
export function validateDispatcherConfig(
  config: unknown,
  treatmentNames: string[],
): DispatcherConfigValidationResult {
  const diagnostics: DispatcherConfigDiagnostic[] = [];
  const push = (path: string, message: string) =>
    diagnostics.push({ path, message });

  if (config === null || typeof config !== "object") {
    push("", "dispatcher config must be an object");
    return { ok: false, diagnostics };
  }
  const c = config as { type?: unknown };
  if (typeof c.type !== "string" || c.type.length === 0) {
    push("type", "dispatcher `type` must be a non-empty string");
    return { ok: false, diagnostics };
  }

  switch (c.type) {
    case "uniform-random":
      return validateUniformRandom(config as UniformRandomDispatcherConfig);
    case "weighted-random":
      return validateWeightedRandom(
        config as WeightedRandomDispatcherConfig,
        treatmentNames,
      );
    case "urn":
      return validateUrn(config as UrnDispatcherConfig, treatmentNames);
    case "weighted-knockdown":
      return validateWeightedKnockdown(
        config as WeightedKnockdownDispatcherConfig,
        treatmentNames,
      );
    default:
      push(
        "type",
        `unknown dispatcher type "${c.type}" — expected one of: uniform-random, weighted-random, urn, weighted-knockdown`,
      );
      return { ok: false, diagnostics };
  }
}

function validateUniformRandom(
  config: UniformRandomDispatcherConfig,
): DispatcherConfigValidationResult {
  const allowed = new Set(["type"]);
  const diagnostics: DispatcherConfigDiagnostic[] = [];
  for (const k of Object.keys(config)) {
    if (!allowed.has(k)) {
      diagnostics.push({
        path: k,
        message: `\`uniform-random\` dispatcher does not accept a \`${k}\` field. Use \`weighted-random\` for unequal-ratio sampling, or \`urn\` for exact-N targets.`,
      });
    }
  }
  return { ok: isOk(diagnostics), diagnostics };
}

function validateWeightedRandom(
  config: WeightedRandomDispatcherConfig,
  treatmentNames: string[],
): DispatcherConfigValidationResult {
  const diagnostics: DispatcherConfigDiagnostic[] = [];
  const push = (path: string, message: string) =>
    diagnostics.push({ path, message });

  if (!("weights" in config)) {
    push(
      "weights",
      "`weighted-random` dispatcher requires a `weights` map keyed by treatment name",
    );
    return { ok: false, diagnostics };
  }
  if (isFileReference(config.weights)) {
    push(
      "weights",
      "`weights` is still a file reference — the host must resolve `{from: ...}` before calling the validator",
    );
    return { ok: false, diagnostics };
  }
  if (Array.isArray(config.weights)) {
    push(
      "weights",
      "`weights` must be a map keyed by treatment name, e.g. `{T_a: 4, T_b: 1, T_control: 1}`. The positional array form was removed in stagebook 0.14 — see docs/researcher/dispatchers.md.",
    );
    return { ok: false, diagnostics };
  }
  if (typeof config.weights !== "object" || config.weights === null) {
    push("weights", "`weights` must be an object keyed by treatment name");
    return { ok: false, diagnostics };
  }

  validateLabeledScalarSet(
    "weights",
    config.weights as Record<string, unknown>,
    treatmentNames,
    diagnostics,
    isNonNegativeFiniteNumber,
    "non-negative finite number",
  );

  const allZero =
    treatmentNames.length > 0 &&
    treatmentNames.every((name) => {
      const v = (config.weights as Record<string, unknown>)[name];
      return isNonNegativeFiniteNumber(v) && (v as number) === 0;
    });
  if (allZero) {
    diagnostics.push({
      path: "weights",
      message:
        "`weights` are all zero — `weighted-random` will produce no assignments. Set at least one weight > 0 to enable a treatment.",
      severity: "warning",
    });
  }

  return { ok: isOk(diagnostics), diagnostics };
}

function validateUrn(
  config: UrnDispatcherConfig,
  treatmentNames: string[],
): DispatcherConfigValidationResult {
  const diagnostics: DispatcherConfigDiagnostic[] = [];
  const push = (path: string, message: string) =>
    diagnostics.push({ path, message });

  if (!("counts" in config)) {
    push(
      "counts",
      "`urn` dispatcher requires a `counts` map keyed by treatment name",
    );
    return { ok: false, diagnostics };
  }
  if (isFileReference(config.counts)) {
    push(
      "counts",
      "`counts` is still a file reference — the host must resolve `{from: ...}` before calling the validator",
    );
    return { ok: false, diagnostics };
  }
  if (Array.isArray(config.counts)) {
    push(
      "counts",
      "`counts` must be a map keyed by treatment name, e.g. `{T_a: 4, T_b: 4, T_control: 8}`. The positional array form was removed in stagebook 0.14 — see docs/researcher/dispatchers.md.",
    );
    return { ok: false, diagnostics };
  }
  if (typeof config.counts !== "object" || config.counts === null) {
    push("counts", "`counts` must be an object keyed by treatment name");
    return { ok: false, diagnostics };
  }

  const counts = config.counts as Record<string, unknown>;
  validateLabeledScalarSet(
    "counts",
    counts,
    treatmentNames,
    diagnostics,
    isNonNegativeInteger,
    "non-negative integer",
  );

  if (config.decrements !== undefined) {
    if (isFileReference(config.decrements)) {
      push(
        "decrements",
        "`decrements` is still a file reference — the host must resolve `{from: ...}` before calling the validator",
      );
      return { ok: isOk(diagnostics), diagnostics };
    }
    if (Array.isArray(config.decrements)) {
      push(
        "decrements",
        "`decrements` must be a map keyed by treatment name on both axes, e.g. `{T_a: {T_a: 1, T_b: 1}, T_b: {...}}`. The positional matrix form was removed in stagebook 0.14 — see docs/researcher/dispatchers.md.",
      );
      return { ok: false, diagnostics };
    }
    if (typeof config.decrements !== "object" || config.decrements === null) {
      push(
        "decrements",
        "`decrements` must be a labeled object keyed by treatment name on both axes",
      );
      return { ok: false, diagnostics };
    }
    const decrements = config.decrements as Record<string, unknown>;
    const nameSet = new Set(treatmentNames);
    const rowKeys = Object.keys(decrements);

    // Strict literal: every treatment must have a row, and only known
    // treatment labels are allowed. Mirrors the counts/weights rule;
    // matches `urnRandomization`'s runtime behavior.
    const missingRows = treatmentNames.filter((n) => !rowKeys.includes(n));
    const extraRows = rowKeys.filter((n) => !nameSet.has(n));
    if (missingRows.length > 0) {
      push(
        "decrements",
        `\`decrements\` is missing a row for ${missingRows.length === 1 ? "treatment" : "treatments"}: ${missingRows.join(", ")}. When you specify \`decrements\`, every treatment must have a row (omit \`decrements\` entirely to use the identity-matrix default).`,
      );
    }
    if (extraRows.length > 0) {
      push(
        "decrements",
        `\`decrements\` has ${extraRows.length === 1 ? "a row" : "rows"} for unknown ${extraRows.length === 1 ? "treatment" : "treatments"}: ${extraRows.join(", ")}. Expected one of: ${treatmentNames.join(", ")}.`,
      );
    }

    for (const [rowName, row] of Object.entries(decrements)) {
      if (!nameSet.has(rowName)) continue; // already reported as extra
      if (typeof row !== "object" || row === null || Array.isArray(row)) {
        push(
          `decrements.${rowName}`,
          `decrements row "${rowName}" must be an object keyed by treatment name`,
        );
        continue;
      }
      const rowObj = row as Record<string, unknown>;
      for (const [colName, v] of Object.entries(rowObj)) {
        if (!nameSet.has(colName)) {
          push(
            `decrements.${rowName}.${colName}`,
            `decrements column label "${colName}" in row "${rowName}" does not match any treatment name. Expected one of: ${treatmentNames.join(", ")}.`,
          );
          continue;
        }
        if (!isNonNegativeInteger(v)) {
          push(
            `decrements.${rowName}.${colName}`,
            `decrements["${rowName}"]["${colName}"] must be a non-negative integer, got ${formatValue(v)}`,
          );
          continue;
        }
        // Initial-balance check: can't decrement more than the column
        // count's starting balls. Mid-dispatch underflow (after
        // multiple picks of the same row) is clamped at the dispatcher.
        const colCount = counts[colName];
        if (
          isNonNegativeInteger(colCount) &&
          (v as number) > (colCount as number)
        ) {
          push(
            `decrements.${rowName}.${colName}`,
            `decrements["${rowName}"]["${colName}"] = ${v as number} exceeds counts["${colName}"] = ${colCount as number} — would underflow on the first use of treatment ${rowName}`,
          );
        }
      }
      // Zero-self-decrement warning: a treatment with positive counts
      // whose row doesn't decrement its own column will never deplete
      // from its own picks. Authors might want this (cross-coupled-only
      // designs) but it's much more often a typo, so we surface it as
      // a warning rather than swallow it silently.
      if (
        isNonNegativeInteger(counts[rowName]) &&
        (counts[rowName] as number) > 0
      ) {
        const selfVal = rowObj[rowName];
        if (selfVal === undefined || selfVal === 0) {
          diagnostics.push({
            path: `decrements.${rowName}.${rowName}`,
            message: `decrements["${rowName}"]["${rowName}"] is ${selfVal === undefined ? "absent (defaults to 0)" : "0"} — treatment "${rowName}" has counts > 0 but its own ball is not decremented when it's picked. The treatment will only deplete via cross-coupled rows, if any.`,
            severity: "warning",
          });
        }
      }
    }
  }

  return { ok: isOk(diagnostics), diagnostics };
}

/** Validate that the keys of a labeled scalar object exactly match
 *  `treatmentNames`, and that each value passes `valueCheck`. Pushes
 *  one diagnostic per missing / extra label and one per malformed
 *  value. */
function validateLabeledScalarSet(
  field: string,
  values: Record<string, unknown>,
  treatmentNames: string[],
  diagnostics: DispatcherConfigDiagnostic[],
  valueCheck: (v: unknown) => boolean,
  valueShape: string,
): void {
  const labelKeys = Object.keys(values);
  const expected = new Set(treatmentNames);
  const actual = new Set(labelKeys);
  const missing = treatmentNames.filter((name) => !actual.has(name));
  const extra = labelKeys.filter((label) => !expected.has(label));
  if (missing.length > 0) {
    diagnostics.push({
      path: field,
      message: `\`${field}\` is missing an entry for ${missing.length === 1 ? "treatment" : "treatments"}: ${missing.join(", ")}`,
    });
  }
  if (extra.length > 0) {
    diagnostics.push({
      path: field,
      message: `\`${field}\` has ${extra.length === 1 ? "an entry" : "entries"} for unknown ${extra.length === 1 ? "treatment" : "treatments"}: ${extra.join(", ")}. Expected one of: ${treatmentNames.join(", ")}.`,
    });
  }
  for (const [name, v] of Object.entries(values)) {
    if (!expected.has(name)) continue; // already reported as extra
    if (!valueCheck(v)) {
      diagnostics.push({
        path: `${field}.${name}`,
        message: `${field}["${name}"] must be a ${valueShape}, got ${formatValue(v)}`,
      });
    }
  }
}

function validateWeightedKnockdown(
  config: WeightedKnockdownDispatcherConfig,
  treatmentNames: string[],
): DispatcherConfigValidationResult {
  const diagnostics: DispatcherConfigDiagnostic[] = [];
  const push = (path: string, message: string) =>
    diagnostics.push({ path, message });
  const nameSet = new Set(treatmentNames);

  // ─── payoffs ───────────────────────────────────────────────────────
  if (!("payoffs" in config)) {
    push(
      "payoffs",
      '`weighted-knockdown` dispatcher requires a `payoffs` field — `"equal"`, a map keyed by treatment name, or a file reference',
    );
    return { ok: false, diagnostics };
  }
  if (isFileReference(config.payoffs)) {
    push(
      "payoffs",
      "`payoffs` is still a file reference — the host must resolve `{from: ...}` before calling the validator",
    );
    return { ok: false, diagnostics };
  }
  if (config.payoffs === "equal") {
    // No additional check; the dispatcher expands this to uniform 1s.
  } else if (Array.isArray(config.payoffs)) {
    push(
      "payoffs",
      '`payoffs` must be a map keyed by treatment name (or the literal `"equal"`), e.g. `{T_a: 1.2, T_b: 0.8}`. The positional array form was never supported on this dispatcher.',
    );
    return { ok: false, diagnostics };
  } else if (typeof config.payoffs !== "object" || config.payoffs === null) {
    push(
      "payoffs",
      '`payoffs` must be `"equal"` or a map keyed by treatment name',
    );
    return { ok: false, diagnostics };
  } else {
    validateLabeledScalarSet(
      "payoffs",
      config.payoffs as Record<string, unknown>,
      treatmentNames,
      diagnostics,
      isNonNegativeFiniteNumber,
      "non-negative finite number",
    );
  }

  // ─── knockdowns ────────────────────────────────────────────────────
  if (!("knockdowns" in config)) {
    push(
      "knockdowns",
      '`weighted-knockdown` dispatcher requires a `knockdowns` field — `"none"`, a scalar in (0, 1], a labeled scalars map, or a labeled matrix',
    );
    return { ok: false, diagnostics };
  }
  if (isFileReference(config.knockdowns)) {
    push(
      "knockdowns",
      "`knockdowns` is still a file reference — the host must resolve `{from: ...}` before calling the validator",
    );
    return { ok: false, diagnostics };
  }
  if (config.knockdowns === "none") {
    // OK.
  } else if (typeof config.knockdowns === "number") {
    if (
      !Number.isFinite(config.knockdowns) ||
      config.knockdowns < 0 ||
      config.knockdowns > 1
    ) {
      push(
        "knockdowns",
        `scalar knockdown must be a finite number in [0, 1], got ${formatValue(config.knockdowns)}`,
      );
    }
  } else if (Array.isArray(config.knockdowns)) {
    push(
      "knockdowns",
      "`knockdowns` must be a map keyed by treatment name (labeled scalars or labeled matrix), not an array",
    );
    return { ok: false, diagnostics };
  } else if (
    typeof config.knockdowns !== "object" ||
    config.knockdowns === null
  ) {
    push(
      "knockdowns",
      '`knockdowns` must be `"none"`, a scalar, a labeled scalars map, or a labeled matrix',
    );
    return { ok: false, diagnostics };
  } else {
    // Discriminate labeled scalars vs labeled matrix by the first
    // value's type. Mixed-type objects are rejected (would be
    // ambiguous and almost certainly a typo).
    const knockdowns = config.knockdowns as Record<string, unknown>;
    const firstKey = Object.keys(knockdowns)[0];
    if (firstKey === undefined) {
      push(
        "knockdowns",
        "`knockdowns` object is empty — expected labels matching the treatment name set",
      );
    } else {
      const firstValue = knockdowns[firstKey];
      const isMatrix =
        typeof firstValue === "object" &&
        firstValue !== null &&
        !Array.isArray(firstValue);
      if (isMatrix) {
        validateKnockdownMatrix(knockdowns, treatmentNames, nameSet, push);
      } else {
        // Labeled scalars: per-treatment self-decay.
        validateLabeledScalarSet(
          "knockdowns",
          knockdowns,
          treatmentNames,
          diagnostics,
          (v) =>
            typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 1,
          "finite number in [0, 1]",
        );
      }
    }
  }

  // ─── temperature ───────────────────────────────────────────────────
  if (config.temperature !== undefined) {
    if (
      typeof config.temperature !== "number" ||
      !Number.isFinite(config.temperature) ||
      config.temperature < 0
    ) {
      push(
        "temperature",
        `\`temperature\` must be a finite number >= 0, got ${formatValue(config.temperature)}`,
      );
    }
  }

  return { ok: isOk(diagnostics), diagnostics };
}

/** Validate a labeled-matrix knockdown. Rules mirror urn's decrements:
 *  row labels must equal the treatment name set (strict literal);
 *  column labels within each row must be a subset of treatment names;
 *  missing column entries default to 1 (multiplicative identity) at
 *  the dispatcher boundary. */
function validateKnockdownMatrix(
  matrix: Record<string, unknown>,
  treatmentNames: string[],
  nameSet: Set<string>,
  push: (path: string, message: string) => void,
): void {
  const rowKeys = Object.keys(matrix);
  const missingRows = treatmentNames.filter((n) => !rowKeys.includes(n));
  const extraRows = rowKeys.filter((n) => !nameSet.has(n));
  if (missingRows.length > 0) {
    push(
      "knockdowns",
      `\`knockdowns\` matrix is missing a row for ${missingRows.length === 1 ? "treatment" : "treatments"}: ${missingRows.join(", ")}. When you specify a matrix, every treatment must have a row.`,
    );
  }
  if (extraRows.length > 0) {
    push(
      "knockdowns",
      `\`knockdowns\` matrix has ${extraRows.length === 1 ? "a row" : "rows"} for unknown ${extraRows.length === 1 ? "treatment" : "treatments"}: ${extraRows.join(", ")}. Expected one of: ${treatmentNames.join(", ")}.`,
    );
  }
  for (const [rowName, row] of Object.entries(matrix)) {
    if (!nameSet.has(rowName)) continue; // already reported as extra
    if (typeof row !== "object" || row === null || Array.isArray(row)) {
      push(
        `knockdowns.${rowName}`,
        `knockdowns row "${rowName}" must be an object keyed by treatment name`,
      );
      continue;
    }
    for (const [colName, v] of Object.entries(row as Record<string, unknown>)) {
      if (!nameSet.has(colName)) {
        push(
          `knockdowns.${rowName}.${colName}`,
          `knockdowns column label "${colName}" in row "${rowName}" does not match any treatment name. Expected one of: ${treatmentNames.join(", ")}.`,
        );
        continue;
      }
      if (typeof v !== "number" || !Number.isFinite(v) || v < 0 || v > 1) {
        push(
          `knockdowns.${rowName}.${colName}`,
          `knockdowns["${rowName}"]["${colName}"] must be a finite number in [0, 1], got ${formatValue(v)}`,
        );
      }
    }
  }
}

function isOk(diagnostics: DispatcherConfigDiagnostic[]): boolean {
  return !diagnostics.some((d) => (d.severity ?? "error") === "error");
}

function isNonNegativeInteger(v: unknown): boolean {
  return typeof v === "number" && Number.isInteger(v) && v >= 0;
}

function isNonNegativeFiniteNumber(v: unknown): boolean {
  return typeof v === "number" && Number.isFinite(v) && v >= 0;
}

function isFileReference(v: unknown): v is { from: string } {
  return (
    typeof v === "object" &&
    v !== null &&
    "from" in v &&
    typeof (v as { from: unknown }).from === "string"
  );
}

function formatValue(v: unknown): string {
  if (typeof v === "string") return JSON.stringify(v);
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (v === null || v === undefined) return String(v);
  try {
    return JSON.stringify(v);
  } catch {
    return Object.prototype.toString.call(v);
  }
}

// Re-export the result type from the public DispatcherConfig union so
// hosts have a single import for the discriminator + validator.
export type { DispatcherConfig };
