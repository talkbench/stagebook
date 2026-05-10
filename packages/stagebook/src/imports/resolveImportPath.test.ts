import { expect, test } from "vitest";
import { resolveImportPath } from "./resolveImportPath.js";

// --- Basic resolution against a parent file ---

test("import sibling file from a top-level parent", () => {
  expect(
    resolveImportPath(
      "main.stagebook.yaml",
      "surveys/tipi/tipi.stagebook.yaml",
    ),
  ).toBe("surveys/tipi/tipi.stagebook.yaml");
});

test("import file from a parent in a subdirectory", () => {
  expect(
    resolveImportPath(
      "study/main.stagebook.yaml",
      "../shared/intro.stagebook.yaml",
    ),
  ).toBe("shared/intro.stagebook.yaml");
});

test("`./` prefix is stripped (no different from a bare path)", () => {
  expect(
    resolveImportPath("main.stagebook.yaml", "./surveys/tipi.stagebook.yaml"),
  ).toBe("surveys/tipi.stagebook.yaml");
});

test("nested subdirectory: parent/A/B + ../C resolves to parent/C", () => {
  expect(resolveImportPath("a/b/c.stagebook.yaml", "../d.stagebook.yaml")).toBe(
    "a/d.stagebook.yaml",
  );
});

test("multi-level relative climb: ../../foo from a deep file", () => {
  expect(
    resolveImportPath("a/b/c/d.stagebook.yaml", "../../foo.stagebook.yaml"),
  ).toBe("a/foo.stagebook.yaml");
});

// --- Deduplication invariant: two routes to the same file canonicalize identically ---

test("dedup: import from main and import via sibling collapse to same canonical path", () => {
  // From main: imports `B/b.stagebook.yaml` directly
  const fromMain = resolveImportPath(
    "main.stagebook.yaml",
    "B/b.stagebook.yaml",
  );
  // From A: imports `../B/b.stagebook.yaml`
  const fromSibling = resolveImportPath(
    "A/a.stagebook.yaml",
    "../B/b.stagebook.yaml",
  );
  expect(fromMain).toBe(fromSibling);
  expect(fromMain).toBe("B/b.stagebook.yaml");
});

// --- Edge cases: extra `.` and `..` segments ---

test("redundant `.` segments collapse", () => {
  expect(
    resolveImportPath(
      "study/main.stagebook.yaml",
      "./surveys/./tipi/./tipi.stagebook.yaml",
    ),
  ).toBe("study/surveys/tipi/tipi.stagebook.yaml");
});

test("`..` after a real segment cancels it", () => {
  expect(
    resolveImportPath(
      "study/main.stagebook.yaml",
      "surveys/extra/../tipi.stagebook.yaml",
    ),
  ).toBe("study/surveys/tipi.stagebook.yaml");
});

test("relative path with leading `..` past parent dir is preserved", () => {
  // From a top-level file, `../foo` exits the working directory entirely.
  // Stagebook keeps the leading `..` in the result so the host can decide
  // whether that escapes its allowed scope.
  expect(
    resolveImportPath("main.stagebook.yaml", "../outside.stagebook.yaml"),
  ).toBe("../outside.stagebook.yaml");
});

// --- Absolute imports ---

test("absolute import discards the parent directory", () => {
  expect(
    resolveImportPath(
      "study/main.stagebook.yaml",
      "/abs/path/to/file.stagebook.yaml",
    ),
  ).toBe("/abs/path/to/file.stagebook.yaml");
});

test("absolute import with `..` clamps at root", () => {
  expect(
    resolveImportPath("main.stagebook.yaml", "/../../escape.stagebook.yaml"),
  ).toBe("/escape.stagebook.yaml");
});

// --- Cross-OS: backslashes from a Windows host get normalized ---

test("Windows-style backslashes in parent path are normalized to posix", () => {
  expect(
    resolveImportPath(
      "study\\main.stagebook.yaml",
      "../shared/intro.stagebook.yaml",
    ),
  ).toBe("shared/intro.stagebook.yaml");
});

test("Windows-style backslashes in import path are normalized", () => {
  expect(
    resolveImportPath(
      "main.stagebook.yaml",
      "surveys\\tipi\\tipi.stagebook.yaml",
    ),
  ).toBe("surveys/tipi/tipi.stagebook.yaml");
});

// --- Identity / no-op cases ---

test("import path equal to the parent's basename resolves to the same dir", () => {
  expect(
    resolveImportPath("study/main.stagebook.yaml", "main.stagebook.yaml"),
  ).toBe("study/main.stagebook.yaml");
});
