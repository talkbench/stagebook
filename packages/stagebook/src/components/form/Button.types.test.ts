// The icon-only contract lives in the type (#622): `icon: true` requires
// `aria-label`, so a TypeScript consumer can't ship a nameless icon button.
// Nothing in CI type-checks a `.ct.tsx` file — ESLint ignores them and the
// build only follows the entry graph — so a `@ts-expect-error` there is
// inert. This drives the compiler over a snippet that imports the real
// Button, and pins which lines it rejects.
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const here = path.dirname(fileURLToPath(import.meta.url));
// Forward slashes: TypeScript normalizes file names that way, and the
// virtual path is compared by string equality below.
const SNIPPET = path
  .join(here, "__button_types_snippet__.tsx")
  .split(path.sep)
  .join("/");

// One JSX element per line; the assertions are on line numbers.
const cases = [
  `<Button icon>+</Button>`,
  // A tooltip is not a name: touch and screen-reader users never get it.
  `<Button icon title="Refresh devices">+</Button>`,
  `<Button icon aria-label="Refresh devices">+</Button>`,
  `<Button icon aria-label="Refresh devices" title="Refresh devices">+</Button>`,
  `<Button>Continue</Button>`,
  `<Button aria-label="Continue to the next stage" title="Continue">Continue</Button>`,
  `<Button icon={false}>Continue</Button>`,
  // Control: a plain prop-type error. If the import ever resolved to `any`
  // the whole snippet would go green and the nameless case above would
  // pass for the wrong reason; this line has to stay red for the test to
  // mean anything.
  `<Button primary="yes">Continue</Button>`,
];
const NAMELESS_LINES = [3, 4];
const CONTROL_LINE = 2 + cases.length;

const source =
  `import React from "react";\n` +
  `import { Button } from "./Button.js";\n` +
  cases.map((jsx, i) => `export const c${i} = ${jsx};`).join("\n") +
  "\n";

function snippetDiagnostics(): { line: number; message: string }[] {
  const configPath = ts.findConfigFile(here, (f) => ts.sys.fileExists(f));
  if (!configPath) throw new Error("tsconfig.json not found");
  const configJson: unknown = ts.readConfigFile(configPath, (f) =>
    ts.sys.readFile(f),
  ).config;
  const parsed = ts.parseJsonConfigFileContent(
    configJson,
    ts.sys,
    path.dirname(configPath),
  );
  const options: ts.CompilerOptions = { ...parsed.options, noEmit: true };
  // The snippet lives in memory, under the package so that `react` and
  // `./Button.js` resolve exactly as they do for the real sources.
  const host = ts.createCompilerHost(options);
  const baseReadFile = host.readFile.bind(host);
  const baseFileExists = host.fileExists.bind(host);
  host.readFile = (f) => (f === SNIPPET ? source : baseReadFile(f));
  host.fileExists = (f) => f === SNIPPET || baseFileExists(f);
  const program = ts.createProgram([SNIPPET], options, host);
  return ts
    .getPreEmitDiagnostics(program)
    .filter((d) => d.file?.fileName === SNIPPET)
    .map((d) => ({
      line: d.file!.getLineAndCharacterOfPosition(d.start!).line + 1,
      message: ts.flattenDiagnosticMessageText(d.messageText, "\n"),
    }));
}

describe("Button props: icon-only requires aria-label (#622)", () => {
  const diagnostics = snippetDiagnostics();

  it("rejects an icon button without aria-label (or with only a title), and nothing else", () => {
    const lines = [...new Set(diagnostics.map((d) => d.line))].sort(
      (a, b) => a - b,
    );
    expect(lines).toEqual([...NAMELESS_LINES, CONTROL_LINE]);
  });

  it.each(NAMELESS_LINES)("names the missing prop on line %i", (line) => {
    const nameless = diagnostics.filter((d) => d.line === line);
    expect(nameless.length).toBeGreaterThan(0);
    expect(nameless.map((d) => d.message).join("\n")).toMatch(/aria-label/);
  });
});
