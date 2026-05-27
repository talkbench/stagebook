import { describe, it, expect } from "vitest";
import {
  expandTreatmentSource,
  expandTreatmentSourceWithImports,
} from "./expandTreatment.js";

describe("expandTreatmentSource", () => {
  describe("no templates", () => {
    it("returns the YAML unchanged when there are no templates", () => {
      const src = `treatments:
  - name: study1
    playerCount: 1
    gameStages:
      - name: stage1
        duration: 300
        elements:
          - type: submitButton`;
      const result = expandTreatmentSource(src);
      expect(result.error).toBeNull();
      expect(result.yaml).toContain("name: study1");
      expect(result.yaml).toContain("type: submitButton");
      expect(result.truncated).toBe(false);
    });
  });

  describe("simple template expansion", () => {
    it("expands a template context into concrete content", () => {
      const src = `templates:
  - name: myStage
    content:
      name: stage1
      duration: 300
      elements:
        - type: submitButton
treatments:
  - name: study1
    playerCount: 1
    gameStages:
      - template: myStage`;
      const result = expandTreatmentSource(src);
      expect(result.error).toBeNull();
      expect(result.yaml).toContain("name: stage1");
      expect(result.yaml).toContain("duration: 300");
      expect(result.yaml).toContain("type: submitButton");
      // Templates key should be removed from output
      expect(result.yaml).not.toMatch(/^templates:/m);
    });
  });

  describe("field substitution", () => {
    it("substitutes field values into template content", () => {
      const src = `templates:
  - name: topicStage
    content:
      name: \${topic}_stage
      duration: 300
      elements:
        - type: prompt
          file: prompts/\${topic}.prompt.md
treatments:
  - name: study1
    playerCount: 1
    gameStages:
      - template: topicStage
        fields:
          topic: climate`;
      const result = expandTreatmentSource(src);
      expect(result.error).toBeNull();
      expect(result.yaml).toContain("name: climate_stage");
      expect(result.yaml).toContain("file: prompts/climate.prompt.md");
    });
  });

  describe("broadcast expansion", () => {
    it("expands broadcast dimensions into multiple items", () => {
      const src = `templates:
  - name: topicStage
    content:
      name: \${topic}_stage
      duration: 300
      elements:
        - type: submitButton
treatments:
  - name: study1
    playerCount: 1
    gameStages:
      - template: topicStage
        broadcast:
          d0:
            - topic: climate
            - topic: guns
            - topic: immigration`;
      const result = expandTreatmentSource(src);
      expect(result.error).toBeNull();
      expect(result.yaml).toContain("climate_stage");
      expect(result.yaml).toContain("guns_stage");
      expect(result.yaml).toContain("immigration_stage");
    });
  });

  describe("error handling", () => {
    it("returns an error for invalid YAML", () => {
      const src = `[[[invalid`;
      const result = expandTreatmentSource(src);
      expect(result.error).not.toBeNull();
      expect(result.yaml).toBe("");
    });

    it("returns an error for non-object YAML", () => {
      const src = `just a string`;
      const result = expandTreatmentSource(src);
      expect(result.error).not.toBeNull();
    });

    it("returns an error when templates key is not an array", () => {
      const src = `templates: notAnArray
treatments:
  - name: study1`;
      const result = expandTreatmentSource(src);
      expect(result.error).toContain("must be an array");
      expect(result.yaml).toBe("");
    });
  });

  describe("output size limit", () => {
    it("truncates output that exceeds the line limit", () => {
      // Generate a treatment with a large broadcast
      const topics = Array.from({ length: 200 }, (_, i) => `topic${i}`);
      const broadcastItems = topics
        .map((t) => `            - topic: ${t}`)
        .join("\n");
      const src = `templates:
  - name: bigStage
    content:
      name: \${topic}_stage
      duration: 300
      elements:
        - type: prompt
          file: prompts/\${topic}.prompt.md
        - type: submitButton
treatments:
  - name: study1
    playerCount: 1
    gameStages:
      - template: bigStage
        broadcast:
          d0:
${broadcastItems}`;
      const result = expandTreatmentSource(src, { maxLines: 100 });
      expect(result.truncated).toBe(true);
      const lines = result.yaml.split("\n");
      // Should be at or under the limit (plus truncation notice)
      expect(lines.length).toBeLessThanOrEqual(105);
      expect(result.yaml).toContain("# --- Output truncated at 100 lines");
    });
  });

  describe("nested templates", () => {
    it("expands templates that reference other templates", () => {
      const src = `templates:
  - name: innerElem
    content:
      type: submitButton
  - name: outerStage
    content:
      name: stage1
      duration: 300
      elements:
        - template: innerElem
treatments:
  - name: study1
    playerCount: 1
    gameStages:
      - template: outerStage`;
      const result = expandTreatmentSource(src);
      expect(result.error).toBeNull();
      expect(result.yaml).toContain("type: submitButton");
      expect(result.yaml).toContain("name: stage1");
    });
  });

  describe("nonexistent template reference", () => {
    it("returns an error when a template reference does not exist", () => {
      const src = `templates:
  - name: myStage
    content:
      name: stage1
treatments:
  - name: study1
    playerCount: 1
    gameStages:
      - template: nonexistentStage`;
      const result = expandTreatmentSource(src);
      expect(result.error).toContain("not found");
      expect(result.yaml).toBe("");
    });

    // Repro 2 from #321: today, when the file has no root-level `templates:`
    // key, the expander short-circuits and returns the source unchanged —
    // even when the file invokes a template that no one has defined. The
    // user sees their input echoed back and can't tell expansion is broken.
    it("returns an error for an unresolved invocation when no templates key is present (#321 Repro 2)", () => {
      const src = `treatments:
  - template: foo`;
      const result = expandTreatmentSource(src);
      expect(result.error).toContain("not found");
      expect(result.yaml).toBe("");
    });
  });

  describe("unresolved placeholders", () => {
    it("preserves unresolved placeholders in the output", () => {
      const src = `templates:
  - name: myStage
    content:
      name: \${missing}_stage
      duration: 300
      elements:
        - type: submitButton
treatments:
  - name: study1
    playerCount: 1
    gameStages:
      - template: myStage`;
      const result = expandTreatmentSource(src);
      expect(result.error).toBeNull();
      expect(result.yaml).toContain("${missing}_stage");
    });
  });

  describe("multi-dimension broadcast", () => {
    it("expands broadcast with multiple dimensions into cartesian product", () => {
      const src = `templates:
  - name: topicStage
    content:
      name: \${topic}_\${condition}_stage
      duration: 300
      elements:
        - type: submitButton
treatments:
  - name: study1
    playerCount: 1
    gameStages:
      - template: topicStage
        broadcast:
          d0:
            - topic: climate
            - topic: guns
          d1:
            - condition: control
            - condition: treatment`;
      const result = expandTreatmentSource(src);
      expect(result.error).toBeNull();
      expect(result.yaml).toContain("climate_control_stage");
      expect(result.yaml).toContain("climate_treatment_stage");
      expect(result.yaml).toContain("guns_control_stage");
      expect(result.yaml).toContain("guns_treatment_stage");
    });
  });

  describe("broadcast size guard", () => {
    it("rejects broadcasts that would produce too many items", () => {
      const topics = Array.from({ length: 200 }, (_, i) => `topic${i}`);
      const broadcastItems = topics
        .map((t) => `            - topic: ${t}`)
        .join("\n");
      const src = `templates:
  - name: bigStage
    content:
      name: \${topic}_stage
treatments:
  - name: study1
    playerCount: 1
    gameStages:
      - template: bigStage
        broadcast:
          d0:
${broadcastItems}`;
      const result = expandTreatmentSource(src, { maxBroadcastProduct: 100 });
      expect(result.error).toContain("Broadcast expansion would produce");
      expect(result.yaml).toBe("");
    });
  });

  describe("expandTreatmentSourceWithImports", () => {
    const loaderFromMap = (files: Record<string, string>) => {
      // resolveImportPath normalizes paths (strips `./`), so be tolerant
      // of both forms when looking up the fixture.
      return async (path: string): Promise<string> => {
        const normalized = path.replace(/^\.\//, "");
        const content = files[path] ?? files[normalized] ?? files[`./${path}`];
        if (content === undefined) {
          throw new Error(`Mock loader: no entry for ${path}`);
        }
        return content;
      };
    };

    it("resolves a template defined in an imported module (#321 Repro 2 — full fix)", async () => {
      const source = `imports:
  - ./module.stagebook.yaml

treatments:
  - template: makeTreatment`;
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
      const result = await expandTreatmentSourceWithImports({
        source,
        loadImport: loaderFromMap({
          "./module.stagebook.yaml": moduleSrc,
        }),
      });
      expect(result.error).toBeNull();
      expect(result.yaml).toContain("name: t");
      expect(result.yaml).toContain("type: submitButton");
      // Templates key should be stripped from the expanded output.
      expect(result.yaml).not.toMatch(/^templates:/m);
    });

    it("returns an import-read error when an import file is missing", async () => {
      const source = `imports:
  - ./missing.stagebook.yaml

treatments:
  - name: t
    playerCount: 1
    gameStages:
      - name: s
        duration: 10
        elements:
          - type: submitButton`;
      const result = await expandTreatmentSourceWithImports({
        source,
        loadImport: loaderFromMap({}),
      });
      expect(result.error).toContain("missing.stagebook.yaml");
      expect(result.yaml).toBe("");
    });
  });

  describe("templates key removal", () => {
    it("removes the templates key from expanded output", () => {
      const src = `templates:
  - name: myStage
    content:
      name: stage1
      duration: 300
      elements:
        - type: submitButton
treatments:
  - name: study1
    playerCount: 1
    gameStages:
      - template: myStage`;
      const result = expandTreatmentSource(src);
      expect(result.error).toBeNull();
      expect(result.yaml).not.toMatch(/^templates:/m);
      // Template definition itself (- name: myStage at indent 2) is gone;
      // the only `name:` keys remaining belong to the expanded treatment.
      expect(result.yaml).not.toMatch(/^ {2}- name: myStage/m);
    });
  });
});
