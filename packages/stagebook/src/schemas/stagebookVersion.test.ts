import { describe, it, expect } from "vitest";
import { promptFileSchema, treatmentFileSchema } from "./index.js";

// The optional `stagebook:` version field (#756): a quoted `major.minor`
// string, accepted at the treatment file's top level and in prompt frontmatter.

const promptWith = (frontmatter: string) =>
  `---\ntype: noResponse\n${frontmatter}\n---\n# Welcome\n`;

describe("stagebook: version field — treatment file", () => {
  it("accepts a quoted major.minor version and keeps it", () => {
    const result = treatmentFileSchema.safeParse({ stagebook: "0.34" });
    expect(result.success).toBe(true);
    expect(result.success && result.data.stagebook).toBe("0.34");
  });

  it("is optional", () => {
    expect(treatmentFileSchema.safeParse({}).success).toBe(true);
  });

  it.each(["0.34.1", "v0.34", "0.034", "1", "0.x", ""])(
    "rejects the malformed version %j",
    (value) => {
      const result = treatmentFileSchema.safeParse({ stagebook: value });
      expect(result.success).toBe(false);
      const issue = !result.success ? result.error.issues[0] : undefined;
      expect(issue?.path).toEqual(["stagebook"]);
      expect(issue?.message).toMatch(/"major\.minor"/);
    },
  );

  it("rejects an unquoted number and says to quote it", () => {
    // YAML reads `stagebook: 0.30` as the number 0.3.
    const result = treatmentFileSchema.safeParse({ stagebook: 0.3 });
    expect(result.success).toBe(false);
    const issue = !result.success ? result.error.issues[0] : undefined;
    expect(issue?.path).toEqual(["stagebook"]);
    expect(issue?.message).toMatch(/quoted/);
  });
});

describe("stagebook: version field — prompt frontmatter", () => {
  it("accepts a quoted major.minor version and keeps it", () => {
    const result = promptFileSchema.safeParse(promptWith('stagebook: "0.34"'));
    expect(result.success).toBe(true);
    expect(result.success && result.data.metadata.stagebook).toBe("0.34");
  });

  it("is accepted on every prompt type", () => {
    const source = `---\ntype: multipleChoice\nstagebook: "1.2"\n---\nPick one\n---\n- A\n- B\n`;
    expect(promptFileSchema.safeParse(source).success).toBe(true);
  });

  it("rejects a malformed version", () => {
    const result = promptFileSchema.safeParse(
      promptWith('stagebook: "0.34.1"'),
    );
    expect(result.success).toBe(false);
    const issue = !result.success ? result.error.issues[0] : undefined;
    expect(issue?.path).toEqual(["metadata", "stagebook"]);
    expect(issue?.message).toMatch(/"major\.minor"/);
  });

  it("rejects an unquoted number", () => {
    const result = promptFileSchema.safeParse(promptWith("stagebook: 0.30"));
    expect(result.success).toBe(false);
    const issue = !result.success ? result.error.issues[0] : undefined;
    expect(issue?.path).toEqual(["metadata", "stagebook"]);
    expect(issue?.message).toMatch(/quoted/);
  });
});
