import { describe, it, expect } from "vitest";
import { parseTreatmentSource } from "./parseTreatmentSource.js";

/**
 * Tests for the host-agnostic source parser/expander/validator that backs
 * the VS Code preview command. The same helper is also the testable core
 * for the larger validation pipeline in #321.
 *
 * Each failure path returns a structured `{ ok: false, stage, message }`
 * result so callers can surface specific error text instead of a generic
 * "could not parse" notification (the previous behavior, which masked all
 * six failure modes and was the root cause of #321 Repro 1).
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

const validTreatment = `treatments:
  - name: t
    playerCount: 1
    gameStages:
      - name: s
        duration: 10
        elements:
          - type: submitButton
`;

describe("parseTreatmentSource", () => {
  describe("success", () => {
    it("returns ok with the parsed treatment when the source is valid", async () => {
      const result = await parseTreatmentSource({
        source: validTreatment,
        loadImport: loaderFromMap({}),
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data).toBeDefined();
    });

    it("loads imports and merges their templates", async () => {
      const source = `imports:
  - ./module.stagebook.yaml

treatments:
  - template: makeTreatment
`;
      const moduleSrc = `templates:
  - name: makeTreatment
    contentType: treatment
    content:
      name: t
      playerCount: 1
      gameStages:
        - name: s
          duration: 10
          elements:
            - type: submitButton
`;
      const result = await parseTreatmentSource({
        source,
        loadImport: loaderFromMap({
          "./module.stagebook.yaml": moduleSrc,
        }),
      });
      expect(result.ok).toBe(true);
    });
  });

  describe("structured failures", () => {
    it("returns parse failure when the root YAML is malformed", async () => {
      const result = await parseTreatmentSource({
        source: "[[[invalid",
        loadImport: loaderFromMap({}),
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.stage).toBe("parse");
      expect(result.message).toMatch(/yaml|parse/i);
    });

    it("returns import-read failure when an imported file is missing (#321 Repro 1)", async () => {
      const source = `imports:
  - ./does-not-exist.stagebook.yaml

treatments:
  - name: t
    playerCount: 1
    gameStages:
      - name: s
        duration: 10
        elements:
          - type: submitButton
`;
      const result = await parseTreatmentSource({
        source,
        loadImport: loaderFromMap({}),
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.stage).toBe("import-read");
      expect(result.message).toContain("does-not-exist.stagebook.yaml");
    });

    it("returns import-parse failure when an imported file has malformed YAML", async () => {
      const source = `imports:
  - ./broken.stagebook.yaml

treatments:
  - name: t
    playerCount: 1
    gameStages:
      - name: s
        duration: 10
        elements:
          - type: submitButton
`;
      const result = await parseTreatmentSource({
        source,
        loadImport: loaderFromMap({
          "./broken.stagebook.yaml": "[[[malformed",
        }),
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.stage).toBe("import-parse");
      expect(result.message).toContain("broken.stagebook.yaml");
    });

    it("returns resolve failure when an import duplicates a template name from the root", async () => {
      // `resolveImports` throws when a template name is defined twice
      // across the root + imports tree. The pipeline maps that to the
      // `resolve` stage. Surfaces as a precise message rather than
      // letting the duplicate quietly win one definition over the other.
      const source = `imports:
  - ./module.stagebook.yaml

templates:
  - name: dup
    contentType: treatment
    content:
      name: t
      playerCount: 1
      gameStages:
        - name: s
          duration: 10
          elements:
            - type: submitButton

treatments:
  - template: dup
`;
      const moduleSrc = `templates:
  - name: dup
    contentType: treatment
    content:
      name: t2
      playerCount: 1
      gameStages:
        - name: s
          duration: 10
          elements:
            - type: submitButton
`;
      const result = await parseTreatmentSource({
        source,
        loadImport: loaderFromMap({
          "./module.stagebook.yaml": moduleSrc,
        }),
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.stage).toBe("resolve");
      expect(result.message).toContain("dup");
    });

    it("returns hydration failure when a template invocation cannot be resolved", async () => {
      const source = `imports:
  - ./module.stagebook.yaml

treatments:
  - template: doesNotExist
`;
      const moduleSrc = `templates:
  - name: someOtherTemplate
    contentType: treatment
    content:
      name: t
      playerCount: 1
      gameStages:
        - name: s
          duration: 10
          elements:
            - type: submitButton
`;
      const result = await parseTreatmentSource({
        source,
        loadImport: loaderFromMap({
          "./module.stagebook.yaml": moduleSrc,
        }),
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.stage).toBe("hydration");
      expect(result.message).toContain("doesNotExist");
    });

    it("returns schema failure when the hydrated form violates the schema", async () => {
      // Hydrated form: playerCount is a string, which violates the schema.
      const source = `treatments:
  - name: t
    playerCount: notANumber
    gameStages:
      - name: s
        duration: 10
        elements:
          - type: submitButton
`;
      const result = await parseTreatmentSource({
        source,
        loadImport: loaderFromMap({}),
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.stage).toBe("schema");
      expect(result.message.length).toBeGreaterThan(0);
    });
  });

  describe("transitive imports", () => {
    it("loads imports recursively through the tree", async () => {
      const source = `imports:
  - ./a.stagebook.yaml

treatments:
  - template: fromB
`;
      const a = `imports:
  - ./b.stagebook.yaml
`;
      const b = `templates:
  - name: fromB
    contentType: treatment
    content:
      name: t
      playerCount: 1
      gameStages:
        - name: s
          duration: 10
          elements:
            - type: submitButton
`;
      const result = await parseTreatmentSource({
        source,
        loadImport: loaderFromMap({
          "./a.stagebook.yaml": a,
          "./b.stagebook.yaml": b,
        }),
      });
      expect(result.ok).toBe(true);
    });
  });
});
