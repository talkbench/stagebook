import type { PromptFileType } from "../schemas/index.js";

/**
 * The table of silent changes by release (#756).
 *
 * Some releases change what valid YAML means: the same file runs differently
 * after an upgrade, with no error. Each such change gets an upgrade rule here,
 * a lint that finds the affected construct and warns the author to review it.
 *
 * A rule fires on files written for an older release: files that declare an
 * older `stagebook:` version, or none. Once the author has reviewed a file and
 * set its `stagebook:` field to the current release, the warnings stop. The
 * runner (`collectUpgradeWarnings`) does the version filtering and finishes
 * each message; a rule only finds the construct.
 *
 * To add a rule:
 *   - set `introducedIn` to the release that ships the change, and raise
 *     `STAGEBOOK_VERSION` (`stagebookVersion.ts`) to match if it's behind;
 *   - describe the change, and how to review it, under that release in
 *     docs/researcher/upgrading.md (`upgradeWarnings.test.ts` checks that every
 *     rule id appears there).
 */

/** The kinds of file a `stagebook:` field can appear in. */
export type StagebookFileKind = "treatment" | "prompt";

/** What a rule inspects: one file, on its own. */
export type UpgradeRuleInput =
  | {
      kind: "treatment";
      /**
       * One treatment file's parsed YAML, as written: unvalidated, with its own
       * `templates:` as definitions, and nothing imported or expanded. A
       * condition is judged by the version of the file that contains it, so a
       * template's conditions are checked in the file that defines it.
       *
       * A template definition may hold `${field}` placeholders where a value
       * goes (`value: ${answer}`); its real value is only known at each
       * invocation. When a placeholder could hide an affected construct,
       * flag it: an extra warning is reviewed once, a missed one is a silent
       * change.
       *
       * Parsed with the `yaml` package (so paths map to source positions),
       * not js-yaml as at runtime. The two agree on plain YAML; they differ
       * on merge keys (`<<`) and timestamps.
       */
      file: unknown;
    }
  | {
      kind: "prompt";
      /** A prompt file that passed the prompt schema. */
      prompt: PromptFileType;
    };

export interface UpgradeRuleHit {
  /**
   * Where the affected construct is: a path into the treatment file, or, for a
   * prompt file, `["metadata", <key>]`, `["body"]` or `["responses"]`.
   */
  path: (string | number)[];
  /**
   * Names the change and the construct it affects, e.g. "`none:` around a
   * positive comparison is now true before anyone answers: this condition
   * shows the element as soon as the stage starts." The runner adds the
   * release and how to silence the warning.
   */
  message: string;
}

export interface UpgradeRule {
  /** Stable kebab-case id, listed in docs/researcher/upgrading.md. */
  id: string;
  /** The release whose behavior differs, as `major.minor`. */
  introducedIn: string;
  appliesTo: readonly StagebookFileKind[];
  /**
   * Find every affected construct. Treatment input is unvalidated YAML, so
   * check shapes before reading them, and never throw.
   */
  detect: (input: UpgradeRuleInput) => UpgradeRuleHit[];
}

/** Ordered by release. The #299 condition-grammar rules land in #690. */
export const upgradeRules: readonly UpgradeRule[] = [];
