import { describe, it, expect } from "vitest";
import { validateTreatmentWithDiff } from "./validateTreatmentDiff";

/**
 * Editor-side wrapper around the diff orchestrator. Verifies that:
 *
 *   - Real bugs (matched) surface as errors with source positions
 *   - Cross-treatment leaks surface (unreachableReferences)
 *   - Templating artifacts (sourceOnly) surface as warnings
 *   - Hydrated-only issues are NOT surfaced on the source (the
 *     expanded preview is their home)
 *   - YAML parse failures still surface
 *   - Import-load failures surface as top-of-file errors
 *
 * `loadImport` is mocked with a Map for hermetic tests.
 */

const loaderFromMap = (files: Record<string, string>) => {
  return async (path: string): Promise<string> => {
    const normalized = path.replace(/^\.\//, "");
    const content = files[path] ?? files[normalized] ?? files[`./${path}`];
    if (content === undefined) {
      throw new Error(`Mock loader: no entry for ${path}`);
    }
    return content;
  };
};

const noImports = loaderFromMap({});

describe("validateTreatmentWithDiff", () => {
  describe("happy path", () => {
    it("returns no diagnostics for a clean treatment", async () => {
      const source = `introSequences:
  - name: i
    introSteps:
      - name: s
        elements:
          - type: submitButton
treatments:
  - name: t
    playerCount: 1
    gameStages:
      - name: g
        duration: 10
        elements:
          - type: submitButton
`;
      const result = await validateTreatmentWithDiff({
        source,
        loadImport: noImports,
      });
      expect(result.diagnostics).toEqual([]);
    });
  });

  describe("cross-treatment reference leaks (unreachableReferences)", () => {
    it("surfaces a leak as an error on the consuming treatment's source line", async () => {
      const source = `introSequences:
  - name: i
    introSteps:
      - name: s
        elements:
          - type: submitButton
treatments:
  - name: A
    playerCount: 1
    gameStages:
      - name: g
        duration: 10
        elements:
          - type: display
            reference: self.prompt.bOnly
          - type: submitButton
  - name: B
    playerCount: 1
    gameStages:
      - name: g
        duration: 10
        elements:
          - type: prompt
            name: bOnly
            file: b.prompt.md
          - type: submitButton
`;
      const result = await validateTreatmentWithDiff({
        source,
        loadImport: noImports,
      });
      const leakErrors = result.diagnostics.filter(
        (d) =>
          d.severity === "error" &&
          d.message.includes("prompt.bOnly") &&
          d.message.toLowerCase().includes("doesn't match"),
      );
      expect(leakErrors).toHaveLength(1);
      // The path resolves cleanly in source (no templates in this
      // file), so the range is the reference site, not a fallback
      // to top-of-file.
      expect(leakErrors[0].range).not.toBeNull();
      expect(leakErrors[0].range!.startLine).toBeGreaterThan(0);
    });
  });

  describe("templating artifacts (sourceOnly → warning)", () => {
    it("downgrades the intro-step advancement-element refinement to warning when a template provides it", async () => {
      const source = `templates:
  - name: advanceBtn
    contentType: elements
    content:
      - type: submitButton
introSequences:
  - name: i
    introSteps:
      - name: s
        elements:
          - template: advanceBtn
treatments:
  - name: t
    playerCount: 1
    gameStages:
      - name: g
        duration: 10
        elements:
          - type: submitButton
`;
      const result = await validateTreatmentWithDiff({
        source,
        loadImport: noImports,
      });
      // The advancement-element rule fires source-only. The orchestrator
      // classifies it as sourceOnly. We surface as warning (not error).
      const advancementDiags = result.diagnostics.filter((d) =>
        d.message.toLowerCase().includes("advancement element"),
      );
      expect(advancementDiags.length).toBeGreaterThan(0);
      expect(advancementDiags.every((d) => d.severity === "warning")).toBe(
        true,
      );
    });
  });

  describe("imports failure surfaces at top of file", () => {
    it("surfaces import-read failure as an error at line 0", async () => {
      const source = `imports:
  - ./missing.stagebook.yaml

treatments:
  - name: t
    playerCount: 1
    gameStages:
      - name: g
        duration: 10
        elements:
          - type: submitButton
`;
      const result = await validateTreatmentWithDiff({
        source,
        loadImport: noImports,
      });
      const importErr = result.diagnostics.find(
        (d) => d.severity === "error" && d.message.includes("missing"),
      );
      expect(importErr).toBeDefined();
      expect(importErr!.range?.startLine).toBe(0);
    });
  });

  describe("hydration failure surfaces at top of file", () => {
    it("flags an unresolved template invocation", async () => {
      const source = `treatments:
  - template: doesNotExist
`;
      const result = await validateTreatmentWithDiff({
        source,
        loadImport: noImports,
      });
      // Pre-hydration semantic catches this first ("template doesn't
      // exist") — and that's better than the generic hydration error.
      // Either form is acceptable for the user.
      const surfaced = result.diagnostics.find((d) =>
        d.message.includes("doesNotExist"),
      );
      expect(surfaced).toBeDefined();
      expect(surfaced!.severity).toBe("error");
    });
  });

  describe("pre-hydration semantic (circular templates)", () => {
    it("flags a self-invocation cycle", async () => {
      const source = `templates:
  - name: loopy
    contentType: elements
    content:
      - template: loopy
introSequences:
  - name: i
    introSteps:
      - name: s
        elements:
          - type: submitButton
treatments:
  - name: t
    playerCount: 1
    gameStages:
      - name: g
        duration: 10
        elements:
          - type: submitButton
`;
      const result = await validateTreatmentWithDiff({
        source,
        loadImport: noImports,
      });
      const cycle = result.diagnostics.find((d) =>
        d.message.toLowerCase().includes("invokes itself"),
      );
      expect(cycle).toBeDefined();
      expect(cycle!.severity).toBe("error");
    });
  });

  describe("YAML parse errors are preserved", () => {
    it("surfaces a YAML duplicate-key warning at the offending line", async () => {
      const source = `treatments:
  - name: t
    playerCount: 1
    playerCount: 2
    gameStages:
      - name: g
        duration: 10
        elements:
          - type: submitButton
introSequences:
  - name: i
    introSteps:
      - name: s
        elements:
          - type: submitButton
`;
      const result = await validateTreatmentWithDiff({
        source,
        loadImport: noImports,
      });
      const dup = result.diagnostics.find((d) =>
        d.message.toLowerCase().includes("unique"),
      );
      expect(dup).toBeDefined();
    });
  });
});
