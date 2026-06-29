import { describe, it, expect } from "vitest";
import { expandAndValidate } from "./expandAndValidate.js";

describe("expandAndValidate", () => {
  describe("valid expansion", () => {
    it("returns no diagnostics when the expanded treatment is valid", () => {
      const src = `templates:
  - name: myStage
    contentType: stage
    content:
      name: stage1
      duration: 300
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
      const result = expandAndValidate(src);
      expect(result.expandError).toBeNull();
      expect(result.diagnostics.filter((d) => d.severity === "error")).toEqual(
        [],
      );
      expect(result.yaml).toContain("name: stage1");
    });
  });

  describe("invalid expanded output from valid-looking source", () => {
    it("surfaces schema errors that only appear after template expansion", () => {
      // Source validates: the template is typed (contentType: stage) and the
      // duration is a ${placeholder}, which the stage schema allows. After
      // field substitution the expanded stage has duration: -1, which is
      // invalid per durationSchema.
      const src = `templates:
  - name: badStage
    contentType: stage
    content:
      name: stage1
      duration: \${duration}
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
      - template: badStage
        fields:
          duration: -1`;
      const result = expandAndValidate(src);
      expect(result.expandError).toBeNull();
      const errors = result.diagnostics.filter((d) => d.severity === "error");
      expect(errors.length).toBeGreaterThan(0);
    });

    it("positions diagnostics within the expanded YAML (not the source)", () => {
      // Same pattern: source is valid (duration uses a placeholder), but the
      // field value ("notANumber") makes the expanded duration a string where
      // a number is required. The diagnostic should land on the expanded
      // duration: line in result.yaml.
      const src = `templates:
  - name: badStage
    contentType: stage
    content:
      name: stage1
      duration: \${duration}
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
      - template: badStage
        fields:
          duration: notANumber`;
      const result = expandAndValidate(src);
      const errors = result.diagnostics.filter(
        (d) => d.severity === "error" && d.range !== null,
      );
      expect(errors.length).toBeGreaterThan(0);
      // The diagnostic should point into the expanded yaml. Find the line in
      // result.yaml that contains "duration:" and verify at least one error
      // targets it.
      const expandedLines = result.yaml.split("\n");
      const durationLine = expandedLines.findIndex((l) =>
        l.includes("duration:"),
      );
      expect(durationLine).toBeGreaterThanOrEqual(0);
      const hasRangeNearDuration = errors.some(
        (d) => d.range && d.range.startLine === durationLine,
      );
      expect(hasRangeNearDuration).toBe(true);
    });
  });

  describe("expansion errors", () => {
    it("returns the expansion error and no diagnostics when expansion fails", () => {
      const src = `templates:
  - name: myStage
    content:
      name: stage1
treatments:
  - name: study1
    playerCount: 1
    gameStages:
      - template: nonexistentStage`;
      const result = expandAndValidate(src);
      expect(result.expandError).not.toBeNull();
      expect(result.diagnostics).toEqual([]);
    });

    it("returns an error when YAML is unparseable", () => {
      const result = expandAndValidate("[[[invalid");
      expect(result.expandError).not.toBeNull();
      expect(result.diagnostics).toEqual([]);
    });
  });

  describe("full expansion validation (not truncated)", () => {
    it("validates the full expansion even when display output is truncated", () => {
      // Broadcast that produces many stages, one of which will have an invalid
      // duration derived from a field. The truncated display cuts off early,
      // but we should still catch the error.
      const topics = Array.from({ length: 50 }, (_, i) => ({
        topic: `topic${i}`,
        duration: i === 49 ? -1 : 300,
      }));
      const broadcastItems = topics
        .map(
          (t) =>
            `            - topic: ${t.topic}\n              duration: ${t.duration}`,
        )
        .join("\n");
      const src = `templates:
  - name: manyStage
    contentType: stage
    content:
      name: \${topic}_stage
      duration: \${duration}
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
      - template: manyStage
        broadcast:
          d0:
${broadcastItems}`;
      const result = expandAndValidate(src, { maxLines: 50 });
      expect(result.expandError).toBeNull();
      expect(result.truncated).toBe(true);
      const errors = result.diagnostics.filter((d) => d.severity === "error");
      expect(errors.length).toBeGreaterThan(0);

      // `fullYaml` is the complete expansion (what diagnostics positions and
      // post-hydration passes like the locale rule consume); `yaml` is the
      // truncated display form carrying the marker. A consumer that
      // "simplifies" to `yaml` would silently skip late content on big
      // studies — pin the distinction.
      expect(result.yaml).toContain("# --- Output truncated at 50 lines");
      expect(result.fullYaml).not.toContain("# --- Output truncated");
      expect(result.fullYaml.split("\n").length).toBeGreaterThan(
        result.yaml.split("\n").length,
      );
      expect(result.fullYaml).toContain("topic49_stage");
    });
  });
});
