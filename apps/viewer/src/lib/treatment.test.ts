import { describe, it, expect } from "vitest";
import { parseTreatmentYaml, expandTreatmentFile } from "./treatment";

const MINIMAL_YAML = `
introSequences:
  - name: intro1
    introSteps:
      - name: consent
        elements:
          - type: submitButton
            buttonText: Continue

treatments:
  - name: treatment1
    playerCount: 2
    introSequences: [intro1]
    gameStages:
      - name: stage1
        duration: 10
        elements:
          - type: prompt
            name: q1
            file: prompts/q1.prompt.md
`;

const MULTI_TREATMENT_YAML = `
introSequences:
  - name: intro1
    introSteps:
      - name: consent
        elements:
          - type: submitButton
            buttonText: Continue

treatments:
  - name: control
    playerCount: 1
    introSequences: [intro1]
    gameStages:
      - name: stage1
        duration: 10
        elements:
          - type: prompt
            name: q1
            file: prompts/q1.prompt.md
  - name: experimental
    playerCount: 2
    introSequences: [intro1]
    gameStages:
      - name: stage1
        duration: 15
        elements:
          - type: prompt
            name: q1
            file: prompts/q1.prompt.md
`;

const TEMPLATE_YAML = `
templates:
  - name: questionStage
    contentType: stage
    content:
      name: "\${topic}"
      duration: 60
      elements:
        - type: prompt
          name: "\${topic}"
          file: "prompts/\${topic}.prompt.md"

introSequences:
  - name: intro1
    introSteps:
      - name: consent
        elements:
          - type: submitButton
            buttonText: Continue

treatments:
  - name: treatment1
    playerCount: 1
    introSequences: [intro1]
    gameStages:
      - template: questionStage
        fields:
          topic: climate
      - template: questionStage
        fields:
          topic: economy
`;

const UNRESOLVED_FIELD_YAML = `
templates:
  - name: questionStage
    contentType: stage
    content:
      name: "\${topic}"
      duration: 60
      elements:
        - type: prompt
          name: "\${topic}"
          file: "prompts/\${topic}.prompt.md"

introSequences:
  - name: intro1
    introSteps:
      - name: consent
        elements:
          - type: submitButton
            buttonText: Continue

treatments:
  - name: treatment1
    playerCount: 1
    introSequences: [intro1]
    gameStages:
      - template: questionStage
        fields:
          topic: "\${userTopic}"
`;

describe("parseTreatmentYaml", () => {
  it("parses a minimal valid treatment file", () => {
    const result = parseTreatmentYaml(MINIMAL_YAML);
    expect(result.introSequences).toHaveLength(1);
    expect(result.introSequences[0].name).toBe("intro1");
    expect(result.treatments).toHaveLength(1);
    expect(result.treatments[0].name).toBe("treatment1");
    expect(result.treatments[0].gameStages).toHaveLength(1);
  });

  it("parses multiple treatments", () => {
    const result = parseTreatmentYaml(MULTI_TREATMENT_YAML);
    expect(result.treatments).toHaveLength(2);
    expect(result.treatments[0].name).toBe("control");
    expect(result.treatments[1].name).toBe("experimental");
  });

  it("throws on invalid YAML", () => {
    expect(() => parseTreatmentYaml("{{not: valid: yaml:")).toThrow();
  });

  it("throws on valid YAML that fails schema validation", () => {
    const badYaml = `
introSequences:
  - name: intro1
    introSteps: []
treatments: []
`;
    expect(() => parseTreatmentYaml(badYaml)).toThrow();
  });
});

describe("expandTreatmentFile", () => {
  it("passes through a file with no templates", () => {
    const parsed = parseTreatmentYaml(MINIMAL_YAML);
    const { result, unresolvedFields } = expandTreatmentFile(parsed);
    expect(unresolvedFields).toEqual([]);
    expect(result.treatments).toHaveLength(1);
  });

  it("expands templates into concrete stages", () => {
    const parsed = parseTreatmentYaml(TEMPLATE_YAML);
    const { result, unresolvedFields } = expandTreatmentFile(parsed);
    expect(unresolvedFields).toEqual([]);
    expect(result.treatments[0].gameStages).toHaveLength(2);
    expect(result.treatments[0].gameStages[0].name).toBe("climate");
    expect(result.treatments[0].gameStages[1].name).toBe("economy");
  });

  it("detects unresolved fields", () => {
    const parsed = parseTreatmentYaml(UNRESOLVED_FIELD_YAML);
    const { unresolvedFields } = expandTreatmentFile(parsed);
    expect(unresolvedFields).toContain("userTopic");
  });

  it("resolves fields when additionalFields are provided", () => {
    const parsed = parseTreatmentYaml(UNRESOLVED_FIELD_YAML);
    const { result, unresolvedFields } = expandTreatmentFile(parsed, {
      userTopic: "housing",
    });
    expect(unresolvedFields).toEqual([]);
    expect(result.treatments[0].gameStages[0].name).toBe("housing");
  });
});
