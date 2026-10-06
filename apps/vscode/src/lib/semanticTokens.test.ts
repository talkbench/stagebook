import { describe, it, expect } from "vitest";
import { computeSemanticTokens } from "./semanticTokens";
import { OPERATOR_KEYS } from "stagebook";

describe("computeSemanticTokens", () => {
  describe("element types", () => {
    it("highlights element type values after 'type:' key", () => {
      const src = `elements:
  - type: prompt
    file: q1.prompt.md
  - type: submitButton`;
      const tokens = computeSemanticTokens(src);
      const typeTokens = tokens.filter((t) => t.tokenType === "type");
      expect(typeTokens).toHaveLength(2);
      expect(typeTokens[0]).toMatchObject({ line: 1, text: "prompt" });
      expect(typeTokens[1]).toMatchObject({ line: 3, text: "submitButton" });
    });

    it("does not highlight non-element-type values after 'type:' key", () => {
      const src = `metadata:
  type: openResponse`;
      const tokens = computeSemanticTokens(src);
      const typeTokens = tokens.filter((t) => t.tokenType === "type");
      expect(typeTokens).toHaveLength(0);
    });
  });

  describe("comparators", () => {
    it("highlights comparator values after 'comparator:' key", () => {
      const src = `conditions:
  - comparator: equals
    value: "yes"
  - comparator: isAbove
    value: 5`;
      const tokens = computeSemanticTokens(src);
      const compTokens = tokens.filter((t) => t.tokenType === "keyword");
      expect(compTokens).toHaveLength(2);
      expect(compTokens[0]).toMatchObject({ text: "equals" });
      expect(compTokens[1]).toMatchObject({ text: "isAbove" });
    });
  });

  describe("boolean operators", () => {
    it("highlights nested current operators and preserves quoted key ranges", () => {
      const src = `conditions:
  "all":
    - 'any':
        - none:
            - reference: self.prompt.q1
              comparator: exists`;
      const tokens = computeSemanticTokens(src);
      expect(tokens.filter((token) => token.tokenType === "keyword")).toEqual([
        { line: 1, startCol: 3, length: 3, tokenType: "keyword", text: "all" },
        { line: 2, startCol: 7, length: 3, tokenType: "keyword", text: "any" },
        {
          line: 3,
          startCol: 10,
          length: 4,
          tokenType: "keyword",
          text: "none",
        },
        {
          line: 5,
          startCol: 26,
          length: 6,
          tokenType: "keyword",
          text: "exists",
        },
      ]);
      const lines = src.split("\n");
      for (const token of tokens) {
        expect(
          lines[token.line].slice(
            token.startCol,
            token.startCol + token.length,
          ),
        ).toBe(token.text);
      }
    });

    it("does not highlight unknown operators or ordinary data keys", () => {
      const src = `conditions:
  not:
    subtract: [1, 2]
data:
  all: [1, 2]
  any: [3]
  none: []`;
      expect(
        computeSemanticTokens(src).filter(
          (token) => token.tokenType === "keyword",
        ),
      ).toEqual([]);
    });
    it.each(OPERATOR_KEYS)(
      "highlights the %s expression operator",
      (operator) => {
        const tokens = computeSemanticTokens(`conditions:\n  ${operator}: []`);
        expect(
          tokens.some(
            (token) => token.text === operator && token.tokenType === "keyword",
          ),
        ).toBe(true);
      },
    );
    it("follows named operands and case rules while keeping literal payloads opaque", () => {
      const source = `conditions:
  case:
    rules:
      - when:
          nonIncreasing:
            - sumExisting:
                inputs:
                  - subtract: {from: 8, value: 2}
                atLeast: 1
            - 4
        value:
          allEqual:
            - literal: {sum: [1, 2]}
            - literal: {sum: [1, 2]}
      - default: true
        value: false`;
      expect(
        computeSemanticTokens(source)
          .filter((token) => token.tokenType === "keyword")
          .map((token) => token.text),
      ).toEqual([
        "case",
        "nonIncreasing",
        "sumExisting",
        "subtract",
        "allEqual",
      ]);
    });
  });

  describe("reference strings", () => {
    it("highlights reference values after 'reference:' key", () => {
      const src = `conditions:
  - reference: self.prompt.q1
    comparator: exists`;
      const tokens = computeSemanticTokens(src);
      const refTokens = tokens.filter((t) => t.tokenType === "variable");
      expect(refTokens).toHaveLength(1);
      expect(refTokens[0]).toMatchObject({ text: "self.prompt.q1" });
    });
  });

  describe("file paths", () => {
    it("highlights file values after 'file:' key", () => {
      const src = `elements:
  - type: prompt
    file: prompts/q1.prompt.md`;
      const tokens = computeSemanticTokens(src);
      const fileTokens = tokens.filter((t) => t.tokenType === "string");
      expect(fileTokens).toHaveLength(1);
      expect(fileTokens[0]).toMatchObject({
        text: "prompts/q1.prompt.md",
      });
    });

    it("splits file paths around template variables", () => {
      const src = `file: projects/${"\${topic}"}/q1.prompt.md`;
      const tokens = computeSemanticTokens(src);
      const fileTokens = tokens.filter((t) => t.tokenType === "string");
      const varTokens = tokens.filter((t) => t.tokenType === "variable");
      // "projects/" and "/q1.prompt.md" as string, "${topic}" as variable
      expect(fileTokens).toHaveLength(2);
      expect(fileTokens[0]).toMatchObject({ text: "projects/" });
      expect(fileTokens[1]).toMatchObject({ text: "/q1.prompt.md" });
      expect(varTokens).toHaveLength(1);
      expect(varTokens[0]).toMatchObject({ text: "${topic}" });
    });

    it("highlights simple file paths as a single string token", () => {
      const src = `file: prompts/q1.prompt.md`;
      const tokens = computeSemanticTokens(src);
      const fileTokens = tokens.filter((t) => t.tokenType === "string");
      expect(fileTokens).toHaveLength(1);
      expect(fileTokens[0]).toMatchObject({ text: "prompts/q1.prompt.md" });
    });
  });

  describe("template variables in values", () => {
    it("highlights ${...} placeholders in non-file values", () => {
      const src = `name: \${topicName}_presurvey`;
      const tokens = computeSemanticTokens(src);
      const varTokens = tokens.filter((t) => t.tokenType === "variable");
      expect(varTokens).toHaveLength(1);
      expect(varTokens[0]).toMatchObject({ text: "${topicName}" });
    });

    it("highlights multiple placeholders in one value", () => {
      const src = `name: \${topic}_\${condition}_stage`;
      const tokens = computeSemanticTokens(src);
      const varTokens = tokens.filter((t) => t.tokenType === "variable");
      expect(varTokens).toHaveLength(2);
      expect(varTokens[0]).toMatchObject({ text: "${topic}" });
      expect(varTokens[1]).toMatchObject({ text: "${condition}" });
    });
  });

  describe("section keys", () => {
    it("highlights structural section keys", () => {
      const src = `templates:
  - name: myStage
    content:
      name: stage1
treatments:
  - name: study1
    gameStages:
      - name: s1
        elements:
          - type: submitButton`;
      const tokens = computeSemanticTokens(src);
      const sectionTokens = tokens.filter((t) => t.tokenType === "property");
      const keys = sectionTokens.map((t) => t.text);
      expect(keys).toContain("templates");
      expect(keys).toContain("treatments");
      expect(keys).toContain("gameStages");
      expect(keys).toContain("elements");
    });

    it("does not highlight regular keys like 'name' or 'duration'", () => {
      const src = `name: study1
duration: 300`;
      const tokens = computeSemanticTokens(src);
      const sectionTokens = tokens.filter((t) => t.tokenType === "property");
      expect(sectionTokens).toHaveLength(0);
    });
  });

  describe("conditions key as section key", () => {
    it("highlights 'conditions' as a section key", () => {
      const src = `conditions:
  - comparator: equals
    reference: prompt.q1
    value: "yes"`;
      const tokens = computeSemanticTokens(src);
      const sectionTokens = tokens.filter((t) => t.tokenType === "property");
      const keys = sectionTokens.map((t) => t.text);
      expect(keys).toContain("conditions");
    });

    it("does not highlight comparator or reference as special keys", () => {
      const src = `conditions:
  - comparator: equals
    reference: prompt.q1`;
      const tokens = computeSemanticTokens(src);
      const sectionKeys = tokens
        .filter((t) => t.tokenType === "property")
        .map((t) => t.text);
      expect(sectionKeys).not.toContain("comparator");
      expect(sectionKeys).not.toContain("reference");
    });
  });

  describe("contentType values", () => {
    it("highlights valid contentType values", () => {
      const src = `contentType: elements`;
      const tokens = computeSemanticTokens(src);
      expect(tokens).toContainEqual(
        expect.objectContaining({ text: "elements", tokenType: "type" }),
      );
    });

    it("does not highlight invalid contentType values", () => {
      const src = `contentType: banana`;
      const tokens = computeSemanticTokens(src);
      const typeTokens = tokens.filter((t) => t.tokenType === "type");
      expect(typeTokens).toHaveLength(0);
    });
  });

  describe("separator styles", () => {
    it("highlights separator style values", () => {
      const src = `style: thin`;
      const tokens = computeSemanticTokens(src);
      expect(tokens).toContainEqual(
        expect.objectContaining({ text: "thin", tokenType: "keyword" }),
      );
    });
  });

  describe("enum values", () => {
    it("highlights position enum values", () => {
      const src = `position: shared`;
      const tokens = computeSemanticTokens(src);
      expect(tokens).toContainEqual(
        expect.objectContaining({ text: "shared", tokenType: "keyword" }),
      );
    });

    it("highlights chatType enum values", () => {
      const src = `chatType: video`;
      const tokens = computeSemanticTokens(src);
      expect(tokens).toContainEqual(
        expect.objectContaining({ text: "video", tokenType: "keyword" }),
      );
    });
  });

  describe("negative cases", () => {
    it("does not highlight invalid comparator values", () => {
      const src = `comparator: banana`;
      const tokens = computeSemanticTokens(src);
      expect(tokens.filter((t) => t.tokenType === "keyword")).toHaveLength(0);
    });

    it("does not highlight references with invalid type prefix", () => {
      const src = `reference: invalidType.field`;
      const tokens = computeSemanticTokens(src);
      expect(tokens.filter((t) => t.tokenType === "variable")).toHaveLength(0);
    });
  });

  describe("edge cases", () => {
    it("returns empty tokens for empty input", () => {
      expect(computeSemanticTokens("")).toEqual([]);
    });

    it("returns empty tokens for comment-only YAML", () => {
      expect(computeSemanticTokens("# just a comment")).toEqual([]);
    });
  });

  describe("quoted YAML scalars", () => {
    it("aligns token for double-quoted element type", () => {
      const src = `type: "prompt"`;
      const tokens = computeSemanticTokens(src);
      const typeTokens = tokens.filter((t) => t.tokenType === "type");
      expect(typeTokens).toHaveLength(1);
      expect(typeTokens[0]).toMatchObject({
        line: 0,
        startCol: 7,
        length: 6,
        text: "prompt",
      });
    });

    it("aligns token for single-quoted element type", () => {
      const src = `type: 'prompt'`;
      const tokens = computeSemanticTokens(src);
      const typeTokens = tokens.filter((t) => t.tokenType === "type");
      expect(typeTokens).toHaveLength(1);
      expect(typeTokens[0]).toMatchObject({
        line: 0,
        startCol: 7,
        length: 6,
        text: "prompt",
      });
    });

    it("aligns token for double-quoted file path", () => {
      const src = `file: "prompts/q1.prompt.md"`;
      const tokens = computeSemanticTokens(src);
      const fileTokens = tokens.filter((t) => t.tokenType === "string");
      expect(fileTokens).toHaveLength(1);
      expect(fileTokens[0]).toMatchObject({
        line: 0,
        startCol: 7,
        length: 20,
        text: "prompts/q1.prompt.md",
      });
    });

    it("aligns token for single-quoted file path", () => {
      const src = `file: 'prompts/q1.prompt.md'`;
      const tokens = computeSemanticTokens(src);
      const fileTokens = tokens.filter((t) => t.tokenType === "string");
      expect(fileTokens).toHaveLength(1);
      expect(fileTokens[0]).toMatchObject({
        line: 0,
        startCol: 7,
        length: 20,
        text: "prompts/q1.prompt.md",
      });
    });

    it("aligns token for double-quoted reference", () => {
      const src = `reference: "self.prompt.q1"`;
      const tokens = computeSemanticTokens(src);
      const refTokens = tokens.filter((t) => t.tokenType === "variable");
      expect(refTokens).toHaveLength(1);
      expect(refTokens[0]).toMatchObject({
        line: 0,
        startCol: 12,
        length: "self.prompt.q1".length,
        text: "self.prompt.q1",
      });
    });

    it("aligns token for double-quoted comparator", () => {
      const src = `comparator: "equals"`;
      const tokens = computeSemanticTokens(src);
      const compTokens = tokens.filter((t) => t.tokenType === "keyword");
      expect(compTokens).toHaveLength(1);
      expect(compTokens[0]).toMatchObject({
        line: 0,
        startCol: 13,
        length: 6,
        text: "equals",
      });
    });

    it("aligns template-var tokens inside a double-quoted file path", () => {
      const src = `file: "projects/\${topic}/q1.prompt.md"`;
      const tokens = computeSemanticTokens(src);
      const fileTokens = tokens.filter((t) => t.tokenType === "string");
      const varTokens = tokens.filter((t) => t.tokenType === "variable");
      expect(fileTokens).toHaveLength(2);
      expect(fileTokens[0]).toMatchObject({
        startCol: 7,
        text: "projects/",
      });
      expect(varTokens).toHaveLength(1);
      expect(varTokens[0]).toMatchObject({
        startCol: 16,
        length: 8,
        text: "${topic}",
      });
      expect(fileTokens[1]).toMatchObject({ text: "/q1.prompt.md" });
    });

    it("aligns template-var tokens inside a double-quoted non-file value", () => {
      const src = `name: "\${topic}_suffix"`;
      const tokens = computeSemanticTokens(src);
      const varTokens = tokens.filter((t) => t.tokenType === "variable");
      expect(varTokens).toHaveLength(1);
      expect(varTokens[0]).toMatchObject({
        line: 0,
        startCol: 7,
        length: 8,
        text: "${topic}",
      });
    });
  });

  describe("notes (comment color)", () => {
    it("highlights an inline plain-scalar notes value", () => {
      const src = `treatments:
  - name: t1
    notes: adapted from Smith et al. 2021`;
      const tokens = computeSemanticTokens(src);
      const comment = tokens.filter((t) => t.tokenType === "comment");
      expect(comment).toHaveLength(1);
      expect(comment[0]).toMatchObject({
        line: 2,
        text: "adapted from Smith et al. 2021",
      });
    });

    it("highlights a quoted-scalar notes value and strips the quotes", () => {
      const src = `treatments:
  - name: t1
    notes: "rationale in quotes"`;
      const tokens = computeSemanticTokens(src);
      const comment = tokens.filter((t) => t.tokenType === "comment");
      expect(comment).toHaveLength(1);
      expect(comment[0].text).toBe("rationale in quotes");
    });

    it("highlights every content line of a literal block scalar, skipping the indicator line", () => {
      const src = `treatments:
  - name: t1
    notes: |
      Adapted from the narrative engagement scale.
      We use 5 items instead of 12.
    playerCount: 2`;
      const tokens = computeSemanticTokens(src);
      const comment = tokens.filter((t) => t.tokenType === "comment");
      expect(comment.map((t) => t.text)).toEqual([
        "Adapted from the narrative engagement scale.",
        "We use 5 items instead of 12.",
      ]);
      // First content line starts at col 6 (six-space indent under `notes: |`).
      expect(comment[0]).toMatchObject({ line: 3, startCol: 6 });
      expect(comment[1]).toMatchObject({ line: 4, startCol: 6 });
    });

    it("handles a folded block scalar (`>`) the same way", () => {
      const src = `treatments:
  - name: t1
    notes: >
      Folded paragraph first line
      Folded paragraph second line`;
      const tokens = computeSemanticTokens(src);
      const comment = tokens.filter((t) => t.tokenType === "comment");
      expect(comment.map((t) => t.text)).toEqual([
        "Folded paragraph first line",
        "Folded paragraph second line",
      ]);
    });

    it("highlights a content line that happens to be a single `|` or `>` character", () => {
      // Only the *first* line of the scalar is the indicator. A later
      // content line that is literally just `|` or `>` is legitimate
      // prose (e.g., a table separator drawn in ASCII) and must not be
      // dropped.
      const src = `treatments:
  - name: t1
    notes: |
      header
      |
      >
      footer`;
      const tokens = computeSemanticTokens(src);
      const comment = tokens
        .filter((t) => t.tokenType === "comment")
        .map((t) => t.text);
      expect(comment).toEqual(["header", "|", ">", "footer"]);
    });

    it("strips a trailing CR on CRLF-terminated files", () => {
      const src =
        "treatments:\r\n" +
        "  - name: t1\r\n" +
        "    notes: |\r\n" +
        "      first line\r\n" +
        "      second line\r\n";
      const tokens = computeSemanticTokens(src);
      const comment = tokens.filter((t) => t.tokenType === "comment");
      expect(comment).toHaveLength(2);
      // No carriage return should leak into the token text or its length.
      for (const t of comment) {
        expect(t.text.includes("\r")).toBe(false);
        expect(t.length).toBe(t.text.length);
      }
      expect(comment[0].text).toBe("first line");
      expect(comment[1].text).toBe("second line");
    });

    it("survives blank lines inside a block scalar", () => {
      const src = `treatments:
  - name: t1
    notes: |
      First paragraph.

      Second paragraph.`;
      const tokens = computeSemanticTokens(src);
      const comment = tokens.filter((t) => t.tokenType === "comment");
      expect(comment.map((t) => t.text)).toEqual([
        "First paragraph.",
        "Second paragraph.",
      ]);
    });

    it("does NOT leave the notes: key itself colored", () => {
      const src = `treatments:
  - name: t1
    notes: short`;
      const tokens = computeSemanticTokens(src);
      // No token covers the key text "notes".
      expect(tokens.some((t) => t.text === "notes")).toBe(false);
    });

    it("highlights notes: on stages, elements, intro steps, and templates", () => {
      const src = `templates:
  - name: tpl
    contentType: stage
    notes: template note
    content:
      name: s
      notes: stage-in-template note
      duration: 10
      elements:
        - type: prompt
          notes: element note
          file: p.prompt.md
introSequences:
  - name: i
    introSteps:
      - name: step1
        notes: intro step note
        elements:
          - type: submitButton
treatments:
  - name: t
    notes: treatment note
    playerCount: 1
    gameStages:
      - name: g1
        notes: game stage note
        duration: 5
        elements:
          - type: submitButton`;
      const tokens = computeSemanticTokens(src);
      const commentTexts = new Set(
        tokens.filter((t) => t.tokenType === "comment").map((t) => t.text),
      );
      expect(commentTexts).toEqual(
        new Set([
          "template note",
          "stage-in-template note",
          "element note",
          "intro step note",
          "treatment note",
          "game stage note",
        ]),
      );
    });
  });

  describe("mixed content", () => {
    it("handles a realistic treatment snippet", () => {
      const src = `treatments:
  - name: study1
    playerCount: 3
    gameStages:
      - name: stage1
        duration: 300
        elements:
          - type: prompt
            file: prompts/q1.prompt.md
            conditions:
              - reference: self.prompt.consent
                comparator: equals
                value: "yes"
          - type: submitButton`;
      const tokens = computeSemanticTokens(src);
      expect(tokens.length).toBeGreaterThan(0);

      const types = new Set(tokens.map((t) => t.tokenType));
      expect(types).toContain("property");
      expect(types).toContain("type");
      expect(types).toContain("string");
      expect(types).toContain("variable");
      expect(types).toContain("keyword");
    });
  });
});
