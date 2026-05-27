import { describe, it, expect } from "vitest";
import { validateTreatmentSource } from "./validateTreatment.js";

describe("validateTreatmentSource", () => {
  describe("valid treatment files", () => {
    it("returns no diagnostics for a minimal valid treatment", () => {
      const src = `introSequences:
  - name: intro1
    introSteps:
      - name: welcome
        elements:
          - type: submitButton
treatments:
  - name: study1
    playerCount: 1
    gameStages:
      - name: stage1
        duration: 300
        elements:
          - type: submitButton`;
      const result = validateTreatmentSource(src);
      expect(result.diagnostics).toEqual([]);
    });
  });

  describe("YAML syntax errors", () => {
    it("reports YAML parse errors with positions", () => {
      const src = `treatments:
  - name: study1
    playerCount: 3
  bad indentation`;
      const result = validateTreatmentSource(src);
      expect(result.diagnostics.length).toBeGreaterThan(0);
      expect(result.diagnostics[0].severity).toBe("error");
    });

    it("reports duplicate YAML keys", () => {
      const src = `introSequences:
  - name: intro1
    introSteps:
      - name: welcome
        elements:
          - type: submitButton
treatments:
  - name: study1
    playerCount: 1
    playerCount: 2
    gameStages:
      - name: stage1
        duration: 300
        elements:
          - type: submitButton`;
      const result = validateTreatmentSource(src);
      const dupeWarnings = result.diagnostics.filter((d) =>
        d.message.match(/unique|duplicate/i),
      );
      expect(dupeWarnings.length).toBeGreaterThan(0);
    });
  });

  describe("schema validation errors", () => {
    it("reports missing required fields", () => {
      const src = `treatments:
  - name: study1
    gameStages:
      - name: stage1
        duration: 300
        elements:
          - type: submitButton`;
      // Missing playerCount and introSequences
      const result = validateTreatmentSource(src);
      expect(result.diagnostics.length).toBeGreaterThan(0);
      expect(result.diagnostics[0].severity).toBe("error");
    });

    it("maps schema errors to source positions", () => {
      const src = `introSequences:
  - name: intro1
    introSteps:
      - name: welcome
        elements:
          - type: submitButton
treatments:
  - name: study1
    playerCount: not_a_number
    gameStages:
      - name: stage1
        duration: 300
        elements:
          - type: submitButton`;
      // playerCount must be a number — error should have a source range
      const result = validateTreatmentSource(src);
      const rangedErrors = result.diagnostics.filter(
        (d) => d.severity === "error" && d.range !== null,
      );
      expect(rangedErrors.length).toBeGreaterThan(0);
    });

    it("reports invalid element types", () => {
      const src = `introSequences:
  - name: intro1
    introSteps:
      - name: welcome
        elements:
          - type: submitButton
treatments:
  - name: study1
    playerCount: 1
    gameStages:
      - name: stage1
        duration: 300
        elements:
          - type: notARealType`;
      const result = validateTreatmentSource(src);
      expect(result.diagnostics.length).toBeGreaterThan(0);
    });
  });

  describe("template content validation", () => {
    it("validates template content based on contentType", () => {
      const src = `templates:
  - name: myStage
    contentType: stage
    content:
      name: stage1
      duration: -1
      elements:
        - type: submitButton
introSequences:
  - name: intro1
    introSteps:
      - name: welcome
        elements:
          - type: submitButton
treatments:
  - name: study1
    playerCount: 1
    gameStages:
      - template: myStage`;
      const result = validateTreatmentSource(src);
      // duration: -1 is invalid in the template content
      const templateErrors = result.diagnostics.filter(
        (d) => d.severity === "error",
      );
      expect(templateErrors.length).toBeGreaterThan(0);
    });
  });

  describe("returned JSON object", () => {
    it("returns the parsed JS object for downstream use", () => {
      const src = `introSequences:
  - name: intro1
    introSteps:
      - name: welcome
        elements:
          - type: submitButton
treatments:
  - name: study1
    playerCount: 1
    gameStages:
      - name: stage1
        duration: 300
        elements:
          - type: submitButton`;
      const result = validateTreatmentSource(src);
      expect(result.parsedObj).toBeDefined();
      expect(
        (result.parsedObj as Record<string, unknown>).treatments,
      ).toBeDefined();
    });

    it("returns diagnostics for completely invalid YAML", () => {
      const src = `[[[`;
      const result = validateTreatmentSource(src);
      expect(result.diagnostics.length).toBeGreaterThan(0);
    });
  });

  describe("edge cases", () => {
    it("reports schema error for empty YAML source", () => {
      const result = validateTreatmentSource("");
      // Empty YAML parses to null — Zod produces a schema error
      expect(result.diagnostics.length).toBeGreaterThan(0);
      expect(result.diagnostics[0].severity).toBe("error");
    });

    it("reports schema error when YAML parses to a scalar", () => {
      const result = validateTreatmentSource("hello world");
      expect(result.diagnostics.length).toBeGreaterThan(0);
      expect(result.diagnostics[0].severity).toBe("error");
    });

    it("reports schema errors when YAML parses to an array", () => {
      const result = validateTreatmentSource("- item1\n- item2");
      expect(result.diagnostics.length).toBeGreaterThan(0);
      expect(result.diagnostics[0].severity).toBe("error");
    });

    it("accepts file with only templates (introSequences and treatments are optional)", () => {
      const src = `templates:
  - name: myStage
    contentType: stage
    content:
      name: stage1
      duration: 300
      elements:
        - type: submitButton`;
      const result = validateTreatmentSource(src);
      const errors = result.diagnostics.filter((d) => d.severity === "error");
      expect(errors).toEqual([]);
    });

    it("reports error for empty templates array", () => {
      const src = `templates: []
introSequences:
  - name: intro1
    introSteps:
      - name: welcome
        elements:
          - type: submitButton
treatments:
  - name: study1
    playerCount: 1
    gameStages:
      - name: stage1
        duration: 300
        elements:
          - type: submitButton`;
      const result = validateTreatmentSource(src);
      expect(result.diagnostics).toContainEqual(
        expect.objectContaining({
          message: expect.stringContaining("Templates cannot be empty"),
        }),
      );
    });
  });

  describe("diagnostic quality", () => {
    it("missing required fields produce messages mentioning 'required'", () => {
      const src = `treatments:
  - name: study1
    gameStages:
      - name: stage1
        duration: 300
        elements:
          - type: submitButton`;
      const result = validateTreatmentSource(src);
      expect(result.diagnostics).toContainEqual(
        expect.objectContaining({
          severity: "error",
          message: expect.stringMatching(/required/i),
        }),
      );
    });

    it("includes the formatted field path in missing-field messages", () => {
      // A survey element is missing its required surveyName field.
      const src = `introSequences:
  - name: intro1
    introSteps:
      - name: welcome
        elements:
          - type: submitButton
treatments:
  - name: study1
    playerCount: 1
    gameStages:
      - name: stage1
        duration: 300
        elements:
          - type: survey`;
      const result = validateTreatmentSource(src);
      // The diagnostic message should include the full formatted path
      // (dotted segments + bracketed array indices) so the user can locate
      // the missing field in the schema hierarchy.
      const pathedError = result.diagnostics.find((d) =>
        d.message.includes(
          "treatments[0].gameStages[0].elements[0].surveyName",
        ),
      );
      expect(pathedError).toBeDefined();
    });

    it("places missing-field errors on the missing-field's parent element, not (0,0)", () => {
      const src = `introSequences:
  - name: intro1
    introSteps:
      - name: welcome
        elements:
          - type: submitButton
treatments:
  - name: study1
    playerCount: 1
    gameStages:
      - name: stage1
        duration: 300
        elements:
          - type: prompt`;
      // The prompt element is missing its required "file" field.
      // The diagnostic for that specific missing field should be attached
      // to the prompt element (the nearest existing ancestor), not (0,0).
      const result = validateTreatmentSource(src);
      const fileError = result.diagnostics.find((d) =>
        d.message.includes("treatments[0].gameStages[0].elements[0].file"),
      );
      expect(fileError).toBeDefined();
      expect(fileError!.range).not.toBeNull();
      expect(fileError!.range!.startLine).toBeGreaterThan(0);
    });

    it("classifies duplicate key diagnostics as warnings", () => {
      const src = `introSequences:
  - name: intro1
    introSteps:
      - name: welcome
        elements:
          - type: submitButton
treatments:
  - name: study1
    playerCount: 1
    playerCount: 2
    gameStages:
      - name: stage1
        duration: 300
        elements:
          - type: submitButton`;
      const result = validateTreatmentSource(src);
      const dupeWarnings = result.diagnostics.filter((d) =>
        d.message.match(/unique|duplicate/i),
      );
      expect(dupeWarnings.length).toBeGreaterThan(0);
      expect(dupeWarnings.every((d) => d.severity === "warning")).toBe(true);
    });
  });
});
