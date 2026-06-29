import { describe, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { validateTreatmentWithDiff } from "./validateTreatmentDiff.js";

/**
 * Regression test: every bundled example treatment file must pass the
 * full editor pipeline with zero error-level diagnostics. Mirrors
 * `apps/viewer/src/examples.test.ts` (which checks the schema
 * directly) but exercises the diff orchestrator, the pre-hydration
 * semantic checks, the unreachable-references check, and the source-
 * position mapping — the entire path the in-editor validator runs on
 * every keystroke.
 *
 * Closes the gap the schema-only test left: a regression that affects
 * only the new pipeline (e.g., an incorrect rule in
 * `findUnreachableReferences`, or a normalization bug in the diff
 * matcher) wouldn't have failed the existing tests. This one will.
 *
 * Warnings are not asserted-against — the `sourceOnly` bucket
 * legitimately produces warnings in some examples (templating
 * artifacts the diff can't conclusively classify as bugs).
 */

const examplesRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../../../examples",
);

const EXAMPLES = [
  "annotated-walkthrough/walkthrough.stagebook.yaml",
  "i18n-gallery/i18n-gallery.stagebook.yaml",
  "imports-walkthrough/imports-walkthrough.stagebook.yaml",
  "prisoners-dilemma/prisoners-dilemma.stagebook.yaml",
  "survey-experiment/survey-experiment.stagebook.yaml",
  "ultimatum-game/ultimatum-game.stagebook.yaml",
];

describe.each(EXAMPLES)("editor pipeline: %s", (relPath) => {
  it("produces zero error-level diagnostics", async () => {
    const fullPath = resolve(examplesRoot, relPath);
    const source = readFileSync(fullPath, "utf8");
    const rootDir = dirname(fullPath);

    const result = await validateTreatmentWithDiff({
      source,
      loadImport: async (importPath) =>
        readFileSync(resolve(rootDir, importPath), "utf8"),
    });

    const errors = result.diagnostics.filter((d) => d.severity === "error");
    if (errors.length > 0) {
      const summary = errors
        .map((d) => `  L${d.range?.startLine ?? "?"}: ${d.message}`)
        .join("\n");
      throw new Error(
        `Expected zero errors from the editor pipeline, got ${errors.length}:\n${summary}`,
      );
    }
  });
});
