import {
  upgradeRules,
  type UpgradeRule,
  type UpgradeRuleInput,
} from "./upgradeRules.js";
import {
  STAGEBOOK_VERSION,
  compareStagebookVersions,
  declaredStagebookVersion,
} from "./stagebookVersion.js";
import {
  createPositionMapper,
  resolvePathOrAncestor,
} from "./yamlPositionMap.js";
import type { Diagnostic } from "./types.js";

export interface UpgradeWarning {
  ruleId: string;
  path: (string | number)[];
  message: string;
}

/**
 * Run the upgrade rules (`upgradeRules.ts`, #756) that apply to one file.
 *
 * A rule applies when the file's kind is in its `appliesTo`, and the file
 * declares no valid `stagebook:` version or one older than the rule's
 * `introducedIn`. Each warning names the change and the construct (the rule's
 * message), then the release, then how to silence it.
 */
export function collectUpgradeWarnings(
  input: UpgradeRuleInput,
  rules: readonly UpgradeRule[] = upgradeRules,
): UpgradeWarning[] {
  const declared = declaredStagebookVersion(
    input.kind === "treatment" ? input.file : input.prompt.metadata,
  );
  const where =
    input.kind === "treatment"
      ? "at the top of this file"
      : "in this file's frontmatter";
  const warnings: UpgradeWarning[] = [];
  for (const rule of rules) {
    if (!rule.appliesTo.includes(input.kind)) continue;
    if (
      declared !== undefined &&
      compareStagebookVersions(rule.introducedIn, declared) <= 0
    ) {
      continue;
    }
    for (const hit of rule.detect(input)) {
      warnings.push({
        ruleId: rule.id,
        path: hit.path,
        message: `${hit.message} (Changed in Stagebook ${rule.introducedIn}.) Review it, then set \`stagebook: "${STAGEBOOK_VERSION}"\` ${where} to silence this warning.`,
      });
    }
  }
  return warnings;
}

/**
 * Upgrade warnings for one treatment file's raw source, positioned in that
 * source.
 *
 * Runs on the file as written, never on expanded YAML: a condition is judged
 * by the version of the file that contains it, so a template's conditions are
 * judged, and reported, where the template is defined. That is why the CLI and
 * `validateTreatmentWithDiff` call this on the raw source, and
 * `validateTreatmentSource` (which also sees expanded YAML) doesn't.
 */
export function treatmentUpgradeDiagnostics(source: string): Diagnostic[] {
  const mapper = createPositionMapper(source);
  return collectUpgradeWarnings({
    kind: "treatment",
    file: mapper.toJSON(),
  }).map((warning) => ({
    message: warning.message,
    severity: "warning",
    range: resolvePathOrAncestor(mapper, warning.path),
  }));
}
