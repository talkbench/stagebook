import type { UpgradeRule, UpgradeRuleHit } from "../upgradeRules.js";

/**
 * Test-only upgrade rules (#756). The production table ships empty; these
 * exercise its plumbing. Both fire on a marker value, so they never touch a
 * file that doesn't opt in.
 */

export const FIXTURE_VALUE = "upgrade-fixture";

/**
 * Flags every condition that compares against `FIXTURE_VALUE`, wherever the
 * file writes it: in a stage, or in a template definition.
 */
export function conditionFixtureRule(
  id: string,
  introducedIn: string,
): UpgradeRule {
  return {
    id,
    introducedIn,
    appliesTo: ["treatment"],
    detect(input) {
      if (input.kind !== "treatment") return [];
      const hits: UpgradeRuleHit[] = [];
      const walk = (node: unknown, path: (string | number)[]): void => {
        if (Array.isArray(node)) {
          node.forEach((child, i) => walk(child, [...path, i]));
          return;
        }
        if (typeof node !== "object" || node === null) return;
        const record = node as Record<string, unknown>;
        if (
          typeof record.comparator === "string" &&
          record.value === FIXTURE_VALUE
        ) {
          hits.push({
            path,
            message: `Fixture change ${id}: \`${record.comparator}\` against "${FIXTURE_VALUE}" now behaves differently.`,
          });
        }
        for (const [key, child] of Object.entries(record)) {
          walk(child, [...path, key]);
        }
      };
      walk(input.file, []);
      return hits;
    },
  };
}

/** Flags a prompt file whose `notes:` is `FIXTURE_VALUE`. */
export function promptFixtureRule(
  id: string,
  introducedIn: string,
): UpgradeRule {
  return {
    id,
    introducedIn,
    appliesTo: ["prompt"],
    detect(input) {
      if (input.kind !== "prompt") return [];
      return input.prompt.metadata.notes === FIXTURE_VALUE
        ? [
            {
              path: ["metadata", "notes"],
              message: `Fixture change ${id}: this prompt now behaves differently.`,
            },
          ]
        : [];
    },
  };
}
