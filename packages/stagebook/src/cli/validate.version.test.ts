import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { Readable, Writable } from "node:stream";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { run } from "./validate.js";
import { STAGEBOOK_VERSION } from "../validate/stagebookVersion.js";
import { FIXTURE_VALUE } from "../validate/fixtures/upgradeRuleFixtures.js";

// The `stagebook:` version field (#756) through the CLI. The production
// upgrade-rule table ships empty, so fixture rules stand in for it.
vi.mock("../validate/upgradeRules.js", async (importOriginal) => {
  const fixtures = await import("../validate/fixtures/upgradeRuleFixtures.js");
  return {
    ...(await importOriginal<typeof import("../validate/upgradeRules.js")>()),
    upgradeRules: [
      fixtures.conditionFixtureRule("fixture-old", "0.1"),
      fixtures.conditionFixtureRule("fixture-new", "0.2"),
    ],
  };
});

async function runCli(argv: string[], stdin = "") {
  const out: string[] = [];
  const stdout = new Writable({
    write(chunk: Buffer, _enc, cb) {
      out.push(chunk.toString());
      cb();
    },
  });
  const stderr = new Writable({
    write(_chunk: Buffer, _enc, cb) {
      cb();
    },
  });
  const code = await run({ argv, stdin: Readable.from(stdin), stdout, stderr });
  return { code, stdout: out.join("") };
}

const [major] = STAGEBOOK_VERSION.split(".").map(Number);
const NEWER = `${major + 1}.0`;

const header = (version: string | null) =>
  version === null ? "" : `stagebook: "${version}"\n`;

const QUESTION = `---\ntype: openResponse\nstagebook: "${STAGEBOOK_VERSION}"\n---\nWhy?\n---\n> Because\n`;

const study = (version: string | null) => `${header(version)}treatments:
  - name: t
    playerCount: 1
    compatibleIntroSequences: []
    gameStages:
      - name: g
        duration: 10
        elements:
          - type: prompt
            name: q
            file: q.prompt.md
          - type: submitButton
            conditions:
              - reference: self.prompt.q
                comparator: equals
                value: ${FIXTURE_VALUE}
`;

const module = (version: string | null) => `${header(version)}templates:
  - name: gated_submit
    contentType: element
    content:
      type: submitButton
      conditions:
        - reference: self.prompt.q
          comparator: equals
          value: ${FIXTURE_VALUE}
`;

const templatedStudy = (version: string | null) => `${header(version)}imports:
  - module.stagebook.yaml
treatments:
  - name: t
    playerCount: 1
    compatibleIntroSequences: []
    gameStages:
      - name: g
        duration: 10
        elements:
          - type: prompt
            name: q
            file: q.prompt.md
          - template: gated_submit
`;

/** 1-based line of the first line containing `text`, as the CLI prints it. */
const lineOf = (source: string, text: string) =>
  source.split("\n").findIndex((line) => line.includes(text)) + 1;

let dir: string;
const write = (name: string, content: string) =>
  writeFile(join(dir, name), content);

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "stagebook-cli-version-"));
  await write("q.prompt.md", QUESTION);
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("upgrade warnings", () => {
  it("warn at the condition and keep the exit code 0", async () => {
    await write("study.stagebook.yaml", study(null));
    const r = await runCli([join(dir, "study.stagebook.yaml")]);
    expect(r.code).toBe(0);
    const line = lineOf(study(null), "- reference: self.prompt.q");
    expect(r.stdout).toContain(
      `:${line}:17: warning: Fixture change fixture-old`,
    );
    expect(r.stdout).toContain(
      `:${line}:17: warning: Fixture change fixture-new`,
    );
    expect(r.stdout).toContain("2 warnings in 1 file.");
  });

  it("fire only the changes after the declared version", async () => {
    await write("study.stagebook.yaml", study("0.1"));
    const r = await runCli([join(dir, "study.stagebook.yaml")]);
    expect(r.stdout).not.toContain("fixture-old");
    expect(r.stdout).toContain("fixture-new");
  });

  it("are silent for a file set to the current version", async () => {
    await write("study.stagebook.yaml", study(STAGEBOOK_VERSION));
    const r = await runCli([join(dir, "study.stagebook.yaml")]);
    expect(r.code).toBe(0);
    expect(r.stdout).toBe("");
  });

  it("also run under --no-expand and on stdin, which read the raw source", async () => {
    await write("study.stagebook.yaml", study(null));
    const noExpand = await runCli([
      "--no-expand",
      join(dir, "study.stagebook.yaml"),
    ]);
    expect(noExpand.stdout).toContain("2 warnings in 1 file.");
    const stdin = await runCli(["--type=treatment", "-"], study(null));
    expect(stdin.stdout).toContain("2 warnings in 1 file.");
  });

  it("judge a template by its own file, and report it at the definition", async () => {
    await write("module.stagebook.yaml", module(null));
    await write("study.stagebook.yaml", templatedStudy(STAGEBOOK_VERSION));

    // The up-to-date study doesn't report the module's template; it flags
    // the module as behind instead.
    const fromStudy = await runCli([join(dir, "study.stagebook.yaml")]);
    expect(fromStudy.code).toBe(0);
    expect(fromStudy.stdout).not.toContain("Fixture change");
    expect(fromStudy.stdout).toContain(
      `:${lineOf(templatedStudy(STAGEBOOK_VERSION), "- module.stagebook.yaml")}:5: warning: Imported file "module.stagebook.yaml" doesn't declare`,
    );

    // Validating the module reports its template at the definition.
    const fromModule = await runCli([join(dir, "module.stagebook.yaml")]);
    expect(fromModule.stdout).toContain(
      `module.stagebook.yaml:${lineOf(module(null), "- reference: self.prompt.q")}:11: warning: Fixture change fixture-old`,
    );
    expect(fromModule.stdout).not.toContain("Imported file");
    expect(fromModule.stdout).toContain("2 warnings in 1 file.");
  });

  it("don't judge an up-to-date module's template by an unversioned study", async () => {
    await write("module.stagebook.yaml", module(STAGEBOOK_VERSION));
    await write("study.stagebook.yaml", templatedStudy(null));
    const r = await runCli([join(dir, "study.stagebook.yaml")]);
    expect(r.code).toBe(0);
    expect(r.stdout).toBe("");
  });
});

describe("version consistency", () => {
  it("reports a prompt file on an older version once, in JSON with a range", async () => {
    await write(
      "old.prompt.md",
      '---\ntype: noResponse\nstagebook: "0.1"\n---\n# Hi\n',
    );
    const source = `${header(STAGEBOOK_VERSION)}treatments:
  - name: t
    playerCount: 1
    compatibleIntroSequences: []
    gameStages:
      - name: g
        duration: 10
        elements:
          - type: prompt
            file: old.prompt.md
          - type: submitButton
`;
    await write("study.stagebook.yaml", source);
    const r = await runCli([
      "--format=json",
      join(dir, "study.stagebook.yaml"),
    ]);
    expect(r.code).toBe(0);
    const json = JSON.parse(r.stdout) as {
      files: {
        diagnostics: {
          severity: string;
          message: string;
          range: { startLine: number } | null;
        }[];
      }[];
    };
    expect(json.files[0].diagnostics).toEqual([
      {
        severity: "warning",
        message: expect.stringContaining(
          `Prompt file "old.prompt.md" declares \`stagebook: "0.1"\`, older than this file's "${STAGEBOOK_VERSION}".`,
        ) as unknown,
        range: expect.objectContaining({
          startLine: lineOf(source, "file: old.prompt.md") - 1,
        }) as unknown,
      },
    ]);
  });

  const plainStudy = (version: string | null, imports: string[] = []) =>
    `${header(version)}${
      imports.length
        ? `imports:\n${imports.map((p) => `  - ${p}\n`).join("")}`
        : ""
    }treatments:
  - name: t
    playerCount: 1
    compatibleIntroSequences: []
    gameStages:
      - name: g
        duration: 10
        elements:
          - type: prompt
            file: q.prompt.md
          - type: prompt
            name: again
            file: ./q.prompt.md
          - type: submitButton
`;
  const plainModule = (version: string | null, imports: string[] = []) =>
    `${header(version)}${
      imports.length
        ? `imports:\n${imports.map((p) => `  - ${p}\n`).join("")}`
        : ""
    }templates:
  - name: m_${Math.random().toString(36).slice(2)}
    contentType: element
    content:
      type: submitButton
`;
  const prompt = (version: string | null) =>
    `---\ntype: noResponse\n${header(version)}---\n# Hi\n`;

  it.each<{
    name: string;
    entry: string;
    files: Record<string, string>;
    expected: string[];
  }>([
    {
      name: "flags a transitive import, resolved from its importer's directory",
      entry: plainStudy(STAGEBOOK_VERSION, ["lib/a.stagebook.yaml"]),
      files: {
        "lib/a.stagebook.yaml": plainModule(STAGEBOOK_VERSION, [
          "b.stagebook.yaml",
        ]),
        "lib/b.stagebook.yaml": plainModule("0.1"),
        "q.prompt.md": prompt(STAGEBOOK_VERSION),
      },
      expected: [
        '"lib/b.stagebook.yaml" (imported through "lib/a.stagebook.yaml") declares `stagebook: "0.1"`',
      ],
    },
    {
      name: "flags a prompt file with no version once, however it's spelled",
      entry: plainStudy(STAGEBOOK_VERSION),
      files: { "q.prompt.md": prompt(null) },
      expected: ['Prompt file "q.prompt.md" doesn\'t declare a valid'],
    },
    {
      name: "is silent for files on the same version or a newer one",
      entry: plainStudy("0.1", ["a.stagebook.yaml"]),
      files: {
        "a.stagebook.yaml": plainModule(STAGEBOOK_VERSION),
        "q.prompt.md": prompt("0.1"),
      },
      expected: [],
    },
    {
      name: "doesn't run when the entry file declares no version",
      entry: plainStudy(null, ["a.stagebook.yaml"]),
      files: {
        "a.stagebook.yaml": plainModule(null),
        "q.prompt.md": prompt(null),
      },
      expected: [],
    },
  ])("$name", async ({ entry, files, expected }) => {
    const sub = await mkdtemp(join(dir, "consistency-"));
    await mkdir(join(sub, "lib"));
    for (const [name, content] of Object.entries(files)) {
      await writeFile(join(sub, name), content);
    }
    await writeFile(join(sub, "study.stagebook.yaml"), entry);
    const r = await runCli([join(sub, "study.stagebook.yaml")]);
    expect(r.code).toBe(0);
    const warnings = r.stdout
      .split("\n")
      .filter((line) => line.includes(": warning: "));
    expect(warnings).toHaveLength(expected.length);
    expected.forEach((text, i) => expect(warnings[i]).toContain(text));
  });

  it("doesn't run under --no-expand, like the other cross-file checks", async () => {
    await write("module.stagebook.yaml", module(null));
    await write("study.stagebook.yaml", templatedStudy(STAGEBOOK_VERSION));
    const r = await runCli(["--no-expand", join(dir, "study.stagebook.yaml")]);
    expect(r.stdout).not.toContain("Imported file");
  });
});

describe("the stagebook: field itself", () => {
  it("warns, with exit code 0, when a treatment file is newer than the validator", async () => {
    await write("study.stagebook.yaml", study(NEWER));
    const r = await runCli([join(dir, "study.stagebook.yaml")]);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain(
      `warning: This file declares \`stagebook: "${NEWER}"\`, newer than this validator (Stagebook ${STAGEBOOK_VERSION}).`,
    );
  });

  it("keeps the newer-than-validator warning when expansion fails", async () => {
    // A file written for a newer release is a likely reason expansion fails.
    const source = `# written for a newer release\n${header(NEWER)}treatments:
  - name: t
    playerCount: 1
    compatibleIntroSequences: []
    gameStages:
      - name: g
        duration: 10
        elements:
          - template: from_the_future
`;
    await write("study.stagebook.yaml", source);
    const r = await runCli([join(dir, "study.stagebook.yaml")]);
    expect(r.code).toBe(1);
    expect(r.stdout).toContain("Template expansion failed");
    expect(r.stdout).toContain(
      `study.stagebook.yaml:2:12: warning: This file declares \`stagebook: "${NEWER}"\``,
    );
  });

  it("warns, with exit code 0, when a prompt file is newer than the validator", async () => {
    await write(
      "new.prompt.md",
      `---\ntype: noResponse\nstagebook: "${NEWER}"\n---\n# Hi\n`,
    );
    const r = await runCli([join(dir, "new.prompt.md")]);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain(
      `new.prompt.md:3:1: warning: This file declares \`stagebook: "${NEWER}"\``,
    );
  });

  it("is an error, exit code 1, when malformed in a treatment file", async () => {
    await write("study.stagebook.yaml", `stagebook: 0.30\n${study(null)}`);
    const r = await runCli([join(dir, "study.stagebook.yaml")]);
    expect(r.code).toBe(1);
    expect(r.stdout).toContain(
      'error: `stagebook` must be a quoted "major.minor" string',
    );
  });

  it("is an error, exit code 1, when malformed in a prompt file", async () => {
    await write(
      "bad.prompt.md",
      '---\ntype: noResponse\nstagebook: "v1"\n---\n# Hi\n',
    );
    const r = await runCli([join(dir, "bad.prompt.md")]);
    expect(r.code).toBe(1);
    expect(r.stdout).toContain(
      'bad.prompt.md:3:1: error: `stagebook` must be a quoted "major.minor" string',
    );
  });
});

describe("robustness", () => {
  it("reports a YAML alias bomb as an error and still reports the other files", async () => {
    // Each level multiplies the previous one tenfold; the YAML parser refuses
    // to expand it. That must stay a per-file error, not end the run.
    const bomb = `stagebook: "0.1"
a: &a [x, x, x, x, x, x, x, x, x, x]
b: &b [*a, *a, *a, *a, *a, *a, *a, *a, *a, *a]
c: &c [*b, *b, *b, *b, *b, *b, *b, *b, *b, *b]
d: &d [*c, *c, *c, *c, *c, *c, *c, *c, *c, *c]
e: [*d, *d, *d, *d, *d, *d, *d, *d, *d, *d]
`;
    await write("bomb.stagebook.yaml", bomb);
    await write("study.stagebook.yaml", study(null));
    const r = await runCli([
      join(dir, "bomb.stagebook.yaml"),
      join(dir, "study.stagebook.yaml"),
    ]);
    expect(r.code).toBe(1);
    expect(r.stdout).toContain("bomb.stagebook.yaml:1:1: error:");
    expect(r.stdout).toContain("study.stagebook.yaml");
    expect(r.stdout).toContain("Fixture change fixture-old");
  });

  it("doesn't run upgrade rules into a crash on a YAML syntax error", async () => {
    await write("broken.stagebook.yaml", `${study(null)}  - name: [unclosed\n`);
    const r = await runCli([join(dir, "broken.stagebook.yaml")]);
    expect(r.code).toBe(1);
    expect(r.stdout).toContain("error:");
  });
});
