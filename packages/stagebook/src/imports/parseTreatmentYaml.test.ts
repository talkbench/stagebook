import { expect, test } from "vitest";
import { parseTreatmentYaml } from "./parseTreatmentYaml.js";

// --- Basic parsing ---

test("parses a simple treatment file with no imports", () => {
  const yaml = `
treatments:
  - name: t1
    playerCount: 1
    gameStages:
      - name: stage1
        duration: 60
        elements:
          - type: submitButton
`;
  const { parsed, imports } = parseTreatmentYaml(yaml);
  expect(imports).toEqual([]);
  expect(parsed.treatments).toBeDefined();
});

test("extracts imports as a separate field", () => {
  const yaml = `
imports:
  - ./surveys/tipi/tipi.stagebook.yaml
  - ./scoring/partisan-7pt/scoring.stagebook.yaml

treatments: []
`;
  const { parsed, imports } = parseTreatmentYaml(yaml);
  expect(imports).toEqual([
    "./surveys/tipi/tipi.stagebook.yaml",
    "./scoring/partisan-7pt/scoring.stagebook.yaml",
  ]);
  // The imports field is also kept on the parsed object so downstream
  // helpers can find it without re-reading the YAML.
  expect(parsed.imports).toEqual(imports);
});

test("file with only imports + templates (no treatments) still parses", () => {
  // A "module-shape" file — the unified-file-shape direction from #277.
  const yaml = `
imports:
  - ./shared/base.stagebook.yaml

templates:
  - name: tipi_q1
    contentType: elements
    content:
      - type: prompt
        file: q1.prompt.md
`;
  const { parsed, imports } = parseTreatmentYaml(yaml);
  expect(imports).toEqual(["./shared/base.stagebook.yaml"]);
  expect(parsed.templates).toBeDefined();
  expect(parsed.treatments).toBeUndefined();
});

test("empty file produces empty parsed object and no imports", () => {
  expect(parseTreatmentYaml("")).toEqual({ parsed: {}, imports: [] });
});

test("file with only comments produces empty parsed object", () => {
  expect(parseTreatmentYaml("# just a comment\n")).toEqual({
    parsed: {},
    imports: [],
  });
});

// --- Top-level shape validation ---

test("rejects a top-level array (must be an object)", () => {
  expect(() => parseTreatmentYaml("- foo\n- bar\n")).toThrow(
    /must parse to an object at the top level/,
  );
});

test("rejects a top-level scalar", () => {
  expect(() => parseTreatmentYaml("just a string")).toThrow(
    /must parse to an object at the top level/,
  );
});

// --- imports: shape validation ---

test("rejects non-array `imports:`", () => {
  const yaml = `
imports: not-an-array
treatments: []
`;
  expect(() => parseTreatmentYaml(yaml)).toThrow(
    /`imports:` must be an array of relative path strings/,
  );
});

test("rejects a non-string entry in imports", () => {
  const yaml = `
imports:
  - ./surveys/tipi.stagebook.yaml
  - { from: ./other.stagebook.yaml }
treatments: []
`;
  expect(() => parseTreatmentYaml(yaml)).toThrow(
    /Every `imports:` entry must be a non-empty string/,
  );
});

test("rejects an empty string in imports", () => {
  const yaml = `
imports:
  - ""
treatments: []
`;
  expect(() => parseTreatmentYaml(yaml)).toThrow(
    /Every `imports:` entry must be a non-empty string/,
  );
});

// --- YAML safety ---

test("does NOT execute arbitrary YAML constructors (safe load)", () => {
  // js-yaml v4's default load already disallows arbitrary types;
  // this test pins that behavior so a future config change can't
  // silently turn it back on.
  const yaml = "danger: !!js/function 'function () { return 42 }'";
  expect(() => parseTreatmentYaml(yaml)).toThrow();
});
