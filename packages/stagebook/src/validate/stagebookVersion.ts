import { STAGEBOOK_VERSION_REGEX } from "../schemas/primitives.js";

/**
 * The Stagebook release whose rules this validator implements, as
 * `major.minor` (#756). It decides which files are "newer than the validator"
 * and is the version upgrade warnings tell authors to declare.
 *
 * Keep it in step with `package.json`: a release bumps the package version, and
 * `stagebookVersion.test.ts` fails until this catches up. Between releases it
 * may run ahead of the package: a change for the next release lands with its
 * upgrade rules (`upgradeRules.ts`) and raises this to that release.
 */
export const STAGEBOOK_VERSION = "0.35";

function parseVersion(version: string): [number, number] | undefined {
  const match = STAGEBOOK_VERSION_REGEX.exec(version);
  return match ? [Number(match[1]), Number(match[2])] : undefined;
}

/**
 * Compare two `major.minor` versions numerically (`"0.9"` < `"0.10"`).
 * Negative when `a` is older, zero when equal, positive when `a` is newer.
 * Throws on a malformed version; check with `declaredStagebookVersion` first.
 */
export function compareStagebookVersions(a: string, b: string): number {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  if (!pa || !pb) {
    throw new Error(
      `Not a "major.minor" Stagebook version: ${JSON.stringify(pa ? b : a)}`,
    );
  }
  return pa[0] - pb[0] || pa[1] - pb[1];
}

/**
 * The version a file declares in its `stagebook:` field. Pass the treatment
 * file's top-level object or a prompt file's frontmatter.
 *
 * Undefined when the field is absent or malformed. Validators treat both the
 * same way: as a file written before the first versioned change, so every
 * upgrade warning applies. The schema reports a malformed value as an error.
 */
export function declaredStagebookVersion(file: unknown): string | undefined {
  if (typeof file !== "object" || file === null) return undefined;
  const value = (file as Record<string, unknown>).stagebook;
  return typeof value === "string" && STAGEBOOK_VERSION_REGEX.test(value)
    ? value
    : undefined;
}

/**
 * The warning for a file that declares a version newer than this validator,
 * or undefined. Such a file may rely on rules this validator doesn't know.
 * A per-file check: `validateTreatmentSource`, `validateTreatmentWithDiff` and
 * `validatePromptSource` report it, never a schema refinement.
 */
export function newerThanValidatorWarning(file: unknown): string | undefined {
  const declared = declaredStagebookVersion(file);
  if (
    declared === undefined ||
    compareStagebookVersions(declared, STAGEBOOK_VERSION) <= 0
  ) {
    return undefined;
  }
  return `This file declares \`stagebook: "${declared}"\`, newer than this validator (Stagebook ${STAGEBOOK_VERSION}). It may rely on rules this validator doesn't know, so some problems may go unreported. Update Stagebook (the npm package or the VS Code extension) to validate it fully.`;
}
