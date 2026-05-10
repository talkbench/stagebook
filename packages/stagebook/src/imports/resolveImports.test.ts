import { describe, expect, test } from "vitest";
import { resolveImports, type ParsedFile } from "./resolveImports.js";

// --- Basic merge: main-only and main + one import ---

test("main-only file (no imports) returns inline templates unchanged", () => {
  const main: ParsedFile = {
    templates: [
      { name: "stage", content: { name: "${idx}" } },
      { name: "elements", content: [{ type: "submitButton" }] },
    ],
  };
  const result = resolveImports({ main, files: new Map() });
  expect(result).toEqual(main.templates);
});

test("merges templates from one imported file", () => {
  const main: ParsedFile = {
    templates: [{ name: "outer", content: { x: 1 } }],
    imports: ["surveys/tipi/tipi.stagebook.yaml"],
  };
  const files = new Map<string, ParsedFile>([
    [
      "surveys/tipi/tipi.stagebook.yaml",
      { templates: [{ name: "tipi_q1", content: { y: 2 } }] },
    ],
  ]);
  const result = resolveImports({ main, files });
  expect(result).toHaveLength(2);
  expect(result).toContainEqual({ name: "outer", content: { x: 1 } });
  expect(result).toContainEqual({ name: "tipi_q1", content: { y: 2 } });
});

test("main file without templates still merges imported templates", () => {
  // A file can have only `imports:` and no `templates:` of its own.
  const main: ParsedFile = { imports: ["module.stagebook.yaml"] };
  const files = new Map<string, ParsedFile>([
    [
      "module.stagebook.yaml",
      { templates: [{ name: "from_module", content: {} }] },
    ],
  ]);
  const result = resolveImports({ main, files });
  expect(result).toEqual([{ name: "from_module", content: {} }]);
});

test("imported file with no templates contributes nothing", () => {
  const main: ParsedFile = {
    templates: [{ name: "inline", content: {} }],
  };
  const files = new Map<string, ParsedFile>([
    ["module.stagebook.yaml", {}], // empty file
  ]);
  const result = resolveImports({ main, files });
  expect(result).toEqual([{ name: "inline", content: {} }]);
});

// --- Path rewriting: file: fields get prefixed with the import directory ---

describe("path rewriting", () => {
  test("rewrites `file:` paths to be relative to the main file", () => {
    const main: ParsedFile = {};
    const files = new Map<string, ParsedFile>([
      [
        "surveys/tipi/tipi.stagebook.yaml",
        {
          templates: [
            {
              name: "tipi_q1",
              content: { type: "prompt", file: "q1.prompt.md" },
            },
          ],
        },
      ],
    ]);
    const result = resolveImports({ main, files });
    expect(result).toEqual([
      {
        name: "tipi_q1",
        content: { type: "prompt", file: "surveys/tipi/q1.prompt.md" },
      },
    ]);
  });

  test("rewrites `captionsFile:` for mediaPlayer", () => {
    const main: ParsedFile = {};
    const files = new Map<string, ParsedFile>([
      [
        "videos/intro.stagebook.yaml",
        {
          templates: [
            {
              name: "intro_video",
              content: {
                type: "mediaPlayer",
                file: "intro.mp4",
                captionsFile: "intro.vtt",
              },
            },
          ],
        },
      ],
    ]);
    const result = resolveImports({ main, files });
    const template = (result[0] as { content: Record<string, string> }).content;
    expect(template.file).toBe("videos/intro.mp4");
    expect(template.captionsFile).toBe("videos/intro.vtt");
  });

  test("walks deeply nested structures (template content with stages → elements)", () => {
    const main: ParsedFile = {};
    const files = new Map<string, ParsedFile>([
      [
        "modules/round.stagebook.yaml",
        {
          templates: [
            {
              name: "round_template",
              content: [
                {
                  name: "stage1",
                  elements: [
                    { type: "prompt", file: "intro.prompt.md" },
                    { type: "image", file: "diagram.png" },
                  ],
                },
              ],
            },
          ],
        },
      ],
    ]);
    const result = resolveImports({ main, files });
    const template = result[0] as { content: { elements: unknown }[] };
    expect(template.content[0]).toEqual({
      name: "stage1",
      elements: [
        { type: "prompt", file: "modules/intro.prompt.md" },
        { type: "image", file: "modules/diagram.png" },
      ],
    });
  });

  test("inline templates (from main) are NOT path-rewritten", () => {
    // Main file's templates are already relative to main's location;
    // rewriting them would be wrong.
    const main: ParsedFile = {
      templates: [
        { name: "main_t", content: { type: "prompt", file: "local.md" } },
      ],
    };
    const result = resolveImports({ main, files: new Map() });
    expect(result).toEqual([
      { name: "main_t", content: { type: "prompt", file: "local.md" } },
    ]);
  });

  test("absolute paths and URLs are NOT prefixed", () => {
    const main: ParsedFile = {};
    const files = new Map<string, ParsedFile>([
      [
        "modules/m.stagebook.yaml",
        {
          templates: [
            {
              name: "with_url",
              content: {
                relative: { type: "image", file: "logo.png" },
                absolute: { type: "prompt", file: "/abs/path.md" },
                http: { type: "image", file: "http://cdn/x.png" },
                https: { type: "image", file: "https://cdn/y.png" },
                // Stagebook's platform-provided assets use the
                // `asset://` scheme — must not be re-prefixed.
                asset: { type: "image", file: "asset://hosted/logo.png" },
                // Case-insensitive scheme detection.
                upperHttp: { type: "image", file: "HTTP://cdn/u.png" },
                upperAsset: { type: "image", file: "ASSET://hosted/y.png" },
              },
            },
          ],
        },
      ],
    ]);
    const result = resolveImports({ main, files });
    const c = (result[0] as { content: Record<string, { file: string }> })
      .content;
    expect(c.relative.file).toBe("modules/logo.png"); // prefixed
    expect(c.absolute.file).toBe("/abs/path.md"); // unchanged
    expect(c.http.file).toBe("http://cdn/x.png"); // unchanged
    expect(c.https.file).toBe("https://cdn/y.png"); // unchanged
    expect(c.asset.file).toBe("asset://hosted/logo.png"); // unchanged
    expect(c.upperHttp.file).toBe("HTTP://cdn/u.png"); // unchanged
    expect(c.upperAsset.file).toBe("ASSET://hosted/y.png"); // unchanged
  });

  test("path rewriting does not mutate the input", () => {
    const main: ParsedFile = {};
    const importedTemplate = {
      name: "t",
      content: { type: "prompt", file: "q.prompt.md" },
    };
    const files = new Map<string, ParsedFile>([
      ["module.stagebook.yaml", { templates: [importedTemplate] }],
    ]);
    resolveImports({ main, files });
    // Original is untouched — the result is a new object
    expect(importedTemplate.content.file).toBe("q.prompt.md");
  });
});

// --- Duplicate template name detection ---

describe("duplicate name detection", () => {
  test("rejects duplicate names across main + import", () => {
    const main: ParsedFile = {
      templates: [{ name: "stage", content: {} }],
    };
    const files = new Map<string, ParsedFile>([
      [
        "module.stagebook.yaml",
        { templates: [{ name: "stage", content: {} }] },
      ],
    ]);
    expect(() => resolveImports({ main, files })).toThrow(
      /Duplicate template name "stage".*\(main\).*module\.stagebook\.yaml/s,
    );
  });

  test("rejects duplicate names across two imports", () => {
    const main: ParsedFile = {};
    const files = new Map<string, ParsedFile>([
      ["a.stagebook.yaml", { templates: [{ name: "shared", content: {} }] }],
      ["b.stagebook.yaml", { templates: [{ name: "shared", content: {} }] }],
    ]);
    expect(() => resolveImports({ main, files })).toThrow(
      /Duplicate template name "shared".*a\.stagebook\.yaml.*b\.stagebook\.yaml/s,
    );
  });

  test("rejects duplicate names within a single file", () => {
    // Even within main, two templates with the same name is unambiguous.
    const main: ParsedFile = {
      templates: [
        { name: "x", content: {} },
        { name: "x", content: {} },
      ],
    };
    expect(() => resolveImports({ main, files: new Map() })).toThrow(
      /Duplicate template name "x"/,
    );
  });

  test("error message suggests namespace prefix as a fix", () => {
    const main: ParsedFile = { templates: [{ name: "q1", content: {} }] };
    const files = new Map<string, ParsedFile>([
      ["tipi.stagebook.yaml", { templates: [{ name: "q1", content: {} }] }],
    ]);
    expect(() => resolveImports({ main, files })).toThrow(
      /Rename one to disambiguate.*tipi_q1/s,
    );
  });
});

// --- Edge cases ---

test("empty inputs (no main templates, no files) returns empty array", () => {
  expect(resolveImports({ main: {}, files: new Map() })).toEqual([]);
});

test("template without a name is allowed but not registered for collision check", () => {
  // Schema validation handles required-name; this function shouldn't crash
  // on a template lacking a name field. (Useful when a host calls
  // resolveImports before validating the merged result.)
  const main: ParsedFile = {
    templates: [{ content: { x: 1 } }, { name: "named", content: {} }],
  };
  expect(resolveImports({ main, files: new Map() })).toHaveLength(2);
});
