import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { treatmentFileSchema } from "../schemas/treatment.js";
import { safeParseTreatmentFile } from "../schemas/safeParseTreatmentFile.js";
import { validateTreatmentSource } from "./validateTreatment.js";
import { validateTreatmentWithDiff } from "./validateTreatmentDiff.js";

describe("malformed expression diagnostics with Zod 4 (#770)", () => {
  it.each([
    { condition: "[]", suffix: [] },
    {
      condition:
        "{all: [{reference: self.prompt.answer, comparator: unsupported, value: 1}]}",
      suffix: ["all", 0, "comparator"],
    },
  ])(
    "preserves source locations for $condition",
    async ({ condition, suffix }) => {
      const source = `treatments:
  - name: test
    playerCount: 1
    compatibleIntroSequences: []
    gameStages:
      - name: stage
        duration: 10
        conditions: ${condition}
        elements:
          - type: submitButton
`;
      const input: unknown = parse(source);
      for (const safeParse of [
        (value: unknown) => treatmentFileSchema.safeParse(value),
        safeParseTreatmentFile,
      ]) {
        const result = safeParse(input);
        expect(result.success).toBe(false);
        if (result.success)
          throw new Error("Malformed conditions were accepted");
        expect(result.error.issues).toContainEqual(
          expect.objectContaining({
            path: ["treatments", 0, "gameStages", 0, "conditions", ...suffix],
          }),
        );
        expect(result.error.message.length).toBeLessThan(10_000);
      }

      const direct = validateTreatmentSource(source);
      const diff = await validateTreatmentWithDiff({
        source,
        loadImport: async () => {
          throw new Error("This fixture has no imports");
        },
      });
      for (const result of [direct, diff]) {
        expect(result.diagnostics).toContainEqual(
          expect.objectContaining({
            severity: "error",
            message: expect.stringContaining("conditions"),
            range: expect.objectContaining({ startLine: 7, endLine: 7 }),
          }),
        );
        expect(JSON.stringify(result.diagnostics).length).toBeLessThan(10_000);
      }
    },
  );
});
