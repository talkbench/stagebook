/**
 * Runtime pairing guard (#499).
 *
 * `checkPairing` is the host-facing half of the treatment-level
 * `compatibleIntroSequences:` declaration: called at batch launch with the
 * already-expanded treatment file, the selected intro sequence (or
 * null for an intro-less launch), and the selected treatment names.
 * It verifies:
 *
 *   1. the named intro sequence exists (when one is selected);
 *   2. every selected treatment exists;
 *   3. every selected treatment LISTS the selected sequence in its
 *      `compatibleIntroSequences:` — or declares `[]` for an intro-less launch
 *      (the declaration is a constraint, not just a data dependency:
 *      a treatment with no intro references still may not run after a
 *      sequence it doesn't list);
 *   4. every reference in each selected treatment resolves under the
 *      selected sequence specifically — by re-running the reference
 *      walker over a synthetic file narrowed to exactly this pairing.
 *
 * Deliberately intro-only: consent arms (#481) have no pairing
 * relationship (negative-only obligations), so there is no
 * `consentName` parameter.
 *
 * Expects EXPANDED input (post `fillTemplates` / import merge — e.g.
 * the output of `expandAndValidateWithImports` or the host's own
 * hydration pipeline). An unresolved `${...}` placeholder in a
 * selected treatment's declaration is reported as an error rather
 * than guessed around: at launch time nothing further will expand it.
 *
 * Diagnostics carry `range: null` — this is a runtime check with no
 * source-position mapping; hosts render messages only.
 */

import { validateTreatmentFileReferences } from "../schemas/validateReferences.js";
import type { Diagnostic } from "./types.js";

export interface PairingSelection {
  /** Name of the selected intro sequence, or null/undefined when the
   *  batch launches without one. Hosts using a `"none"` sentinel
   *  should map it to null before calling. */
  introSequenceName?: string | null;
}

function error(message: string): Diagnostic {
  return { message, severity: "error", range: null };
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

function toArray(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

/** Render a malformed declaration for the error message without
 *  trusting it: JSON.stringify throws on cyclic graphs (YAML anchors
 *  can produce them), and this branch's whole job is to return a
 *  diagnostic rather than crash the host's launch path. */
function describeDeclaration(declared: unknown): string {
  try {
    return JSON.stringify(declared) ?? String(declared);
  } catch {
    return `a cyclic or non-serializable ${typeof declared}`;
  }
}

export function checkPairing(
  file: unknown,
  selection: PairingSelection,
  treatmentNames: string[],
): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  if (!isRecord(file)) {
    return [error("checkPairing: treatment file is not an object.")];
  }

  const sequences = toArray(file.introSequences).filter(isRecord);
  const sequenceNames = sequences
    .map((s) => s.name)
    .filter((n): n is string => typeof n === "string");

  const introSequenceName = selection.introSequenceName ?? null;
  let selectedSequence: Record<string, unknown> | null = null;
  if (introSequenceName !== null) {
    selectedSequence =
      sequences.find((s) => s.name === introSequenceName) ?? null;
    if (selectedSequence === null) {
      return [
        error(
          `Intro sequence "${introSequenceName}" is not defined in this treatment file. ${
            sequenceNames.length > 0
              ? `Defined: ${sequenceNames.join(", ")}.`
              : "The file defines no named intro sequences."
          }`,
        ),
      ];
    }
  }

  const treatments = toArray(file.treatments).filter(isRecord);
  const selectedTreatments: Record<string, unknown>[] = [];
  for (const name of treatmentNames) {
    const treatment = treatments.find((t) => t.name === name);
    if (!treatment) {
      diagnostics.push(
        error(
          `Treatment "${name}" is not defined in this treatment file (after expansion).`,
        ),
      );
      continue;
    }
    selectedTreatments.push(treatment);
  }

  // Constraint check: the selected sequence must be listed (or the
  // declaration must be [] for an intro-less launch).
  const constraintOk: Record<string, unknown>[] = [];
  for (const treatment of selectedTreatments) {
    const name = String(treatment.name);
    const declared = treatment.compatibleIntroSequences;
    if (
      typeof declared === "string" ||
      !Array.isArray(declared) ||
      declared.some((d) => typeof d !== "string")
    ) {
      diagnostics.push(
        error(
          `Treatment "${name}" has an uninterpretable \`compatibleIntroSequences:\` declaration (${describeDeclaration(
            declared,
          )}). Expand templates and bind all \`\${...}\` placeholders before calling checkPairing.`,
        ),
      );
      continue;
    }
    if (declared.some((d) => typeof d === "string" && d.includes("${"))) {
      diagnostics.push(
        error(
          `Treatment "${name}" still carries an unresolved \`\${...}\` placeholder in \`compatibleIntroSequences:\`. Expand templates and bind all placeholders before calling checkPairing.`,
        ),
      );
      continue;
    }
    if (introSequenceName === null) {
      if (declared.length > 0) {
        diagnostics.push(
          error(
            `Treatment "${name}" may only follow intro sequence${
              declared.length > 1 ? "s" : ""
            } ${declared.map((d) => `"${String(d)}"`).join(", ")}. Launching without an intro sequence is only allowed for treatments declaring \`compatibleIntroSequences: []\`.`,
          ),
        );
        continue;
      }
    } else if (!declared.includes(introSequenceName)) {
      diagnostics.push(
        error(
          `Treatment "${name}" does not list intro sequence "${introSequenceName}" in its \`compatibleIntroSequences:\` (${
            declared.length > 0
              ? `allowed: ${declared.map((d) => `"${String(d)}"`).join(", ")}`
              : "it declares `[]` — no intro sequence"
          }). The host may only pair a treatment with a sequence it lists.`,
        ),
      );
      continue;
    }
    constraintOk.push(treatment);
  }

  // Data check: re-run the reference walker over a synthetic file
  // narrowed to exactly this pairing. The synthetic file deliberately
  // omits `consent:` — consent has no pairing relationship (#481), so a
  // treatment reference to a consent key degrades here from the precise
  // audit-only message to a generic unknown-reference error; still an
  // error, launch still refused. Rewriting each treatment's
  // declaration to the selected sequence makes the walker's positive
  // check mean precisely "resolves under THIS sequence".
  if (constraintOk.length > 0) {
    const synthetic = {
      introSequences: selectedSequence ? [selectedSequence] : undefined,
      treatments: constraintOk.map((t) => ({
        ...t,
        compatibleIntroSequences: selectedSequence ? [introSequenceName] : [],
      })),
    };
    for (const issue of validateTreatmentFileReferences(synthetic)) {
      // Translate synthetic-file indices back to names for readability.
      let context = "";
      if (issue.path[0] === "treatments" && typeof issue.path[1] === "number") {
        context = `In treatment "${String(constraintOk[issue.path[1]]?.name)}": `;
      } else if (issue.path[0] === "introSequences") {
        context = `In intro sequence "${introSequenceName ?? ""}": `;
      }
      diagnostics.push(error(`${context}${issue.message}`));
    }
  }

  return diagnostics;
}
