import { describe, it, expect } from "vitest";
import { parseTreatmentYaml } from "./treatment";
import { computePreviewState } from "./previewResolution";

// `file:` is fully templated so a host-supplied binding can violate
// the post-fill `.prompt.md` contract (#474) — the scenario where the
// FieldForm submit produces resolved-schema issues.
const TEMPLATED_FILE_YAML = `
templates:
  - name: questionStage
    contentType: stage
    content:
      name: question
      duration: 60
      elements:
        - type: prompt
          name: q1
          file: "\${promptFile}"

treatments:
  - name: treatment1
    playerCount: 1
    gameStages:
      - template: questionStage
        fields:
          promptFile: "\${userPromptFile}"
`;

// Two independent fields so host-vs-user binding splits are testable.
const TWO_FIELD_YAML = `
templates:
  - name: questionStage
    contentType: stage
    content:
      name: "\${stageName}"
      duration: 60
      elements:
        - type: prompt
          name: q1
          file: "\${stagePromptFile}"

treatments:
  - name: treatment1
    playerCount: 1
    gameStages:
      - template: questionStage
        fields:
          stageName: "\${topicName}"
          stagePromptFile: "\${topicPromptFile}"
`;

const TEMPLATED_INTRO_YAML = `
templates:
  - name: introStep
    contentType: introExitStep
    content:
      name: consent
      elements:
        - type: prompt
          name: consentPrompt
          file: "\${introPromptFile}"
        - type: submitButton
          buttonText: Continue

introSequences:
  - name: intro1
    introSteps:
      - template: introStep
        fields:
          introPromptFile: "\${userIntroFile}"

treatments:
  - name: treatment1
    playerCount: 1
    gameStages:
      - name: stage1
        duration: 10
        elements:
          - type: prompt
            name: q1
            file: prompts/q1.prompt.md
`;

// Two stages share one bad binding, so a single submit produces two
// independent post-fill issues.
const TWO_STAGE_YAML = `
templates:
  - name: questionStage
    contentType: stage
    content:
      name: "\${stageName}"
      duration: 60
      elements:
        - type: prompt
          name: q1
          file: "\${promptFile}"

treatments:
  - name: treatment1
    playerCount: 1
    gameStages:
      - template: questionStage
        fields:
          stageName: stageOne
          promptFile: "\${sharedPromptFile}"
      - template: questionStage
        fields:
          stageName: stageTwo
          promptFile: "\${sharedPromptFile}"
`;

const NO_TEMPLATE_YAML = `
treatments:
  - name: treatment1
    playerCount: 1
    gameStages:
      - name: stage1
        duration: 10
        elements:
          - type: prompt
            name: q1
            file: prompts/q1.prompt.md
`;

describe("computePreviewState", () => {
  it("requests form input while fields are unresolved", () => {
    const parsed = parseTreatmentYaml(TEMPLATED_FILE_YAML);
    const state = computePreviewState(parsed);
    expect(state.mode).toBe("form");
    if (state.mode !== "form") return;
    expect(state.formFields).toEqual(["userPromptFile"]);
    expect(state.errors).toEqual([]);
  });

  it("returns ready when user values resolve cleanly", () => {
    const parsed = parseTreatmentYaml(TEMPLATED_FILE_YAML);
    const state = computePreviewState(parsed, undefined, {
      userPromptFile: "prompts/q1.prompt.md",
    });
    expect(state.mode).toBe("ready");
    if (state.mode !== "ready") return;
    expect(
      state.resolved.treatments?.[0].gameStages[0].elements[0],
    ).toMatchObject({ file: "prompts/q1.prompt.md" });
  });

  it("re-shows the form with errors when a value fails post-fill validation", () => {
    const parsed = parseTreatmentYaml(TEMPLATED_FILE_YAML);
    const state = computePreviewState(parsed, undefined, {
      userPromptFile: "prompts/q1.md",
    });
    expect(state.mode).toBe("form");
    if (state.mode !== "form") return;
    expect(state.formFields).toEqual(["userPromptFile"]);
    // Previously-submitted values come back so the user can edit
    // rather than retype.
    expect(state.initialValues).toEqual({ userPromptFile: "prompts/q1.md" });
    expect(state.errors).toHaveLength(1);
    expect(state.errors[0].message).toMatch(/\.prompt\.md/);
    expect(state.errors[0].path).toContain("file");
  });

  it("keeps showing errors on resubmit with unchanged bad values", () => {
    const parsed = parseTreatmentYaml(TEMPLATED_FILE_YAML);
    const first = computePreviewState(parsed, undefined, {
      userPromptFile: "prompts/q1.md",
    });
    const second = computePreviewState(parsed, undefined, {
      userPromptFile: "prompts/q1.md",
    });
    expect(first.mode).toBe("form");
    expect(second.mode).toBe("form");
    if (first.mode !== "form" || second.mode !== "form") return;
    expect(second.formFields).toEqual(first.formFields);
    expect(second.initialValues).toEqual(first.initialValues);
    expect(second.errors).toEqual(first.errors);
  });

  it("only asks for host-unbound fields while fields are unresolved", () => {
    const parsed = parseTreatmentYaml(TWO_FIELD_YAML);
    const state = computePreviewState(parsed, { topicName: "climate" });
    expect(state.mode).toBe("form");
    if (state.mode !== "form") return;
    expect(state.formFields).toEqual(["topicPromptFile"]);
  });

  it("offers host-bound fields for editing after a post-fill failure", () => {
    const parsed = parseTreatmentYaml(TWO_FIELD_YAML);
    // Host supplies a bad file path; the user bound the other field.
    const state = computePreviewState(
      parsed,
      { topicPromptFile: "prompts/climate.md" },
      { topicName: "climate" },
    );
    expect(state.mode).toBe("form");
    if (state.mode !== "form") return;
    expect([...state.formFields].sort()).toEqual([
      "topicName",
      "topicPromptFile",
    ]);
    // Both the host value and the user value come back for editing —
    // overriding a bad host binding is the only recovery path.
    expect(state.initialValues).toEqual({
      topicName: "climate",
      topicPromptFile: "prompts/climate.md",
    });
    expect(state.errors).toHaveLength(1);
  });

  it("gives user values precedence over host bindings", () => {
    const parsed = parseTreatmentYaml(TEMPLATED_FILE_YAML);
    const state = computePreviewState(
      parsed,
      { userPromptFile: "prompts/host.md" },
      { userPromptFile: "prompts/user.prompt.md" },
    );
    expect(state.mode).toBe("ready");
    if (state.mode !== "ready") return;
    expect(
      state.resolved.treatments?.[0].gameStages[0].elements[0],
    ).toMatchObject({ file: "prompts/user.prompt.md" });
  });

  it("excludes non-string host bindings from the error-mode form", () => {
    const parsed = parseTreatmentYaml(TWO_FIELD_YAML);
    // A numeric host binding can't round-trip through a text input;
    // only the string-bound field should be offered for editing.
    const state = computePreviewState(parsed, {
      topicName: 42,
      topicPromptFile: "prompts/climate.md",
    });
    expect(state.mode).toBe("form");
    if (state.mode !== "form") return;
    expect(state.formFields).toEqual(["topicPromptFile"]);
    expect(state.initialValues).toEqual({
      topicPromptFile: "prompts/climate.md",
    });
  });

  it("returns a standalone error when only non-string bindings caused the failure", () => {
    const parsed = parseTreatmentYaml(TEMPLATED_FILE_YAML);
    const state = computePreviewState(parsed, { userPromptFile: 42 });
    expect(state.mode).toBe("error");
    if (state.mode !== "error") return;
    expect(state.errors).toHaveLength(1);
    expect(state.errors[0].message).toMatch(/string/i);
  });

  it("round-trips an empty-string binding through the error-mode form", () => {
    const parsed = parseTreatmentYaml(TEMPLATED_FILE_YAML);
    const state = computePreviewState(parsed, { userPromptFile: "" });
    expect(state.mode).toBe("form");
    if (state.mode !== "form") return;
    expect(state.formFields).toEqual(["userPromptFile"]);
    expect(state.initialValues).toEqual({ userPromptFile: "" });
    expect(state.errors.length).toBeGreaterThanOrEqual(1);
  });

  it("reports every post-fill issue at once", () => {
    const parsed = parseTreatmentYaml(TWO_STAGE_YAML);
    const state = computePreviewState(parsed, undefined, {
      sharedPromptFile: "prompts/shared.md",
    });
    expect(state.mode).toBe("form");
    if (state.mode !== "form") return;
    expect(state.errors).toHaveLength(2);
    expect(state.errors[0].path).toContain("gameStages.0");
    expect(state.errors[1].path).toContain("gameStages.1");
  });

  it("routes intro-sequence post-fill failures back to the form", () => {
    const parsed = parseTreatmentYaml(TEMPLATED_INTRO_YAML);
    const state = computePreviewState(parsed, undefined, {
      userIntroFile: "intro/consent.md",
    });
    expect(state.mode).toBe("form");
    if (state.mode !== "form") return;
    expect(state.formFields).toEqual(["userIntroFile"]);
    expect(state.errors).toHaveLength(1);
    expect(state.errors[0].path).toContain("introSequences");
  });

  it("returns a standalone error when the file has no fillable fields", () => {
    const parsed = parseTreatmentYaml(NO_TEMPLATE_YAML);
    // Force a post-fill violation with no template fields involved:
    // mutate the parsed tree the way a hand-authored bad file would
    // arrive. (Pre-fill schema is relaxed for this path only when a
    // placeholder is present, so craft the object directly.)
    parsed.treatments![0].gameStages[0].elements[0] = {
      ...parsed.treatments![0].gameStages[0].elements[0],
      file: "prompts/q1.md",
    };
    const state = computePreviewState(parsed);
    expect(state.mode).toBe("error");
    if (state.mode !== "error") return;
    expect(state.errors).toHaveLength(1);
    expect(state.errors[0].message).toMatch(/\.prompt\.md/);
  });

  it("returns ready for a clean file with no template fields", () => {
    const parsed = parseTreatmentYaml(NO_TEMPLATE_YAML);
    const state = computePreviewState(parsed);
    expect(state.mode).toBe("ready");
  });
});
