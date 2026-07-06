import { describe, it, expect } from "vitest";
import { createStaticContentFns } from "./contentFns.js";

describe("createStaticContentFns", () => {
  it("resolves getTextContent from the provided file map", async () => {
    const fns = createStaticContentFns({
      "README.md": "# Study",
      "prompts/q1.prompt.md": "Question one",
    });
    await expect(fns.getTextContent("README.md")).resolves.toBe("# Study");
    await expect(fns.getTextContent("prompts/q1.prompt.md")).resolves.toBe(
      "Question one",
    );
  });

  it("rejects with the path when a file is not in the map", async () => {
    const fns = createStaticContentFns({ "a.md": "a" });
    await expect(fns.getTextContent("missing.md")).rejects.toThrow(
      /missing\.md/,
    );
  });

  it("distinguishes an empty-string file from a missing one", async () => {
    const fns = createStaticContentFns({ "empty.md": "" });
    await expect(fns.getTextContent("empty.md")).resolves.toBe("");
    await expect(fns.getTextContent("absent.md")).rejects.toThrow();
  });

  it("returns the path unchanged as an asset URL", () => {
    const fns = createStaticContentFns({});
    expect(fns.getAssetURL("images/logo.png")).toBe("images/logo.png");
  });
});
