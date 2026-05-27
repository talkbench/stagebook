import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Readable, Writable } from "node:stream";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { run } from "./validate.js";

interface CapturedRun {
  code: number;
  stdout: string;
  stderr: string;
}

async function runCli(
  argv: string[],
  options: { stdin?: string; cwd?: string } = {},
): Promise<CapturedRun> {
  const stdoutChunks: string[] = [];
  const stderrChunks: string[] = [];
  const stdout = new Writable({
    write(chunk: Buffer, _enc, cb) {
      stdoutChunks.push(chunk.toString());
      cb();
    },
  });
  const stderr = new Writable({
    write(chunk: Buffer, _enc, cb) {
      stderrChunks.push(chunk.toString());
      cb();
    },
  });
  const stdin = Readable.from(options.stdin ?? "");
  const code = await run({ argv, stdin, stdout, stderr, cwd: options.cwd });
  return {
    code,
    stdout: stdoutChunks.join(""),
    stderr: stderrChunks.join(""),
  };
}

let tmp: string;

const MINIMAL_TREATMENT = `treatments:
  - name: t1
    playerCount: 1
    gameStages:
      - name: s1
        duration: 10
        elements:
          - type: submitButton
introSequences:
  - name: i1
    introSteps:
      - name: s
        elements:
          - type: submitButton
`;

const TREATMENT_WITH_SCHEMA_ERROR = `treatments:
  - name: t1
    playerCount: 1
    gameStages:
      - name: s1
        duration: 10
        elements:
          - type: bogusElementType
introSequences:
  - name: i1
    introSteps:
      - name: s
        elements:
          - type: submitButton
`;

const VALID_PROMPT = `---
type: noResponse
---
# Welcome
Some markdown body.
`;

const PROMPT_WITH_BAD_TYPE = `---
type: prompt
---
# Welcome
Body.
`;

beforeAll(async () => {
  tmp = await mkdtemp(join(tmpdir(), "stagebook-cli-"));
  await writeFile(join(tmp, "valid.stagebook.yaml"), MINIMAL_TREATMENT);
  await writeFile(join(tmp, "bad.stagebook.yaml"), TREATMENT_WITH_SCHEMA_ERROR);
  await writeFile(join(tmp, "good.prompt.md"), VALID_PROMPT);
  await writeFile(join(tmp, "bad.prompt.md"), PROMPT_WITH_BAD_TYPE);
  await writeFile(join(tmp, "unknown.txt"), "hello");
});

afterAll(async () => {
  await rm(tmp, { recursive: true, force: true });
});

describe("stagebook validate CLI", () => {
  describe("exit codes", () => {
    it("exits 0 for a clean treatment file", async () => {
      const r = await runCli([join(tmp, "valid.stagebook.yaml")]);
      expect(r.code).toBe(0);
      expect(r.stdout).toBe("");
    });

    it("exits 0 for a clean prompt file", async () => {
      const r = await runCli([join(tmp, "good.prompt.md")]);
      expect(r.code).toBe(0);
      expect(r.stdout).toBe("");
    });

    it("exits 1 when a file has schema errors", async () => {
      const r = await runCli([join(tmp, "bad.stagebook.yaml")]);
      expect(r.code).toBe(1);
      expect(r.stdout).toContain("error:");
    });

    it("exits 1 for a prompt with wrong type", async () => {
      const r = await runCli([join(tmp, "bad.prompt.md")]);
      expect(r.code).toBe(1);
      expect(r.stdout).toContain("error:");
    });

    it("exits 2 when a literal file path doesn't exist", async () => {
      const r = await runCli([join(tmp, "does-not-exist.stagebook.yaml")]);
      expect(r.code).toBe(2);
      expect(r.stdout).toContain("could not read");
    });

    it("exits 2 for unknown file suffix", async () => {
      const r = await runCli([join(tmp, "unknown.txt")]);
      expect(r.code).toBe(2);
      expect(r.stdout).toContain("unknown file type");
    });

    it("exits 2 when no inputs are given", async () => {
      const r = await runCli([]);
      expect(r.code).toBe(2);
      expect(r.stderr).toContain("no file paths");
    });

    it("exits 2 when --format is invalid", async () => {
      const r = await runCli([
        "--format=xml",
        join(tmp, "valid.stagebook.yaml"),
      ]);
      expect(r.code).toBe(2);
      expect(r.stderr).toContain("must be 'text' or 'json'");
    });

    it("exits 2 when a glob matches zero files", async () => {
      const r = await runCli(["nothing-here-*.stagebook.yaml"], { cwd: tmp });
      expect(r.code).toBe(2);
      expect(r.stderr).toContain("matched no files");
    });

    it("exits 0 when --allow-empty is set and a glob matches zero files", async () => {
      const r = await runCli(
        ["--allow-empty", "nothing-here-*.stagebook.yaml"],
        { cwd: tmp },
      );
      expect(r.code).toBe(0);
    });
  });

  describe("text output", () => {
    it("formats one diagnostic per line with 1-based line:col", async () => {
      const r = await runCli([join(tmp, "bad.stagebook.yaml")]);
      // Each diagnostic line should match path:line:col: severity: message
      const lines = r.stdout.split("\n").filter((l) => l.includes(": error:"));
      expect(lines.length).toBeGreaterThan(0);
      for (const line of lines) {
        expect(line).toMatch(/.+:\d+:\d+: error: /);
      }
    });

    it("emits a per-run summary line", async () => {
      const r = await runCli([join(tmp, "bad.stagebook.yaml")]);
      expect(r.stdout).toMatch(/\d+ errors? in \d+ files?\./);
    });
  });

  describe("JSON output", () => {
    it("emits a parseable JSON object with files + summary + unreadable", async () => {
      const r = await runCli([
        "--format=json",
        join(tmp, "bad.stagebook.yaml"),
      ]);
      expect(r.code).toBe(1);
      const parsed = JSON.parse(r.stdout) as {
        files: { path: string; diagnostics: unknown[] }[];
        unreadable: { path: string; message: string }[];
        summary: { errors: number; warnings: number; files: number };
      };
      expect(parsed.summary.errors).toBeGreaterThan(0);
      expect(parsed.files).toHaveLength(1);
      expect(parsed.files[0].diagnostics.length).toBeGreaterThan(0);
      expect(parsed.unreadable).toEqual([]);
    });

    it("uses 0-based positions in JSON (matches Diagnostic shape)", async () => {
      const r = await runCli([
        "--format=json",
        join(tmp, "bad.stagebook.yaml"),
      ]);
      const parsed = JSON.parse(r.stdout) as {
        files: {
          diagnostics: {
            range: { startLine: number; startCol: number } | null;
          }[];
        }[];
      };
      const firstWithRange = parsed.files[0].diagnostics.find(
        (d) => d.range !== null,
      );
      expect(firstWithRange?.range?.startLine).toBeGreaterThanOrEqual(0);
    });

    it("emits unreadable entries in their own list, not under files", async () => {
      const r = await runCli([
        "--format=json",
        join(tmp, "does-not-exist.stagebook.yaml"),
      ]);
      expect(r.code).toBe(2);
      const parsed = JSON.parse(r.stdout) as {
        files: unknown[];
        unreadable: { path: string; message: string }[];
        summary: { errors: number };
      };
      expect(parsed.files).toEqual([]);
      expect(parsed.unreadable).toHaveLength(1);
      expect(parsed.unreadable[0].message).toContain("could not read");
      expect(parsed.summary.errors).toBe(1);
    });
  });

  describe("stdin", () => {
    it("validates treatment YAML from stdin with --type=treatment", async () => {
      const r = await runCli(["--type=treatment", "-"], {
        stdin: MINIMAL_TREATMENT,
      });
      expect(r.code).toBe(0);
    });

    it("validates prompt markdown from stdin with --type=prompt", async () => {
      const r = await runCli(["--type=prompt", "-"], { stdin: VALID_PROMPT });
      expect(r.code).toBe(0);
    });

    it("surfaces schema errors from stdin", async () => {
      const r = await runCli(["--type=treatment", "-"], {
        stdin: TREATMENT_WITH_SCHEMA_ERROR,
      });
      expect(r.code).toBe(1);
      expect(r.stdout).toContain("<stdin>:");
    });

    it("rejects stdin without --type", async () => {
      const r = await runCli(["-"], { stdin: MINIMAL_TREATMENT });
      expect(r.code).toBe(2);
      expect(r.stderr).toContain("--type=treatment or --type=prompt");
    });
  });

  describe("multiple inputs", () => {
    it("groups output by file and surfaces errors from any", async () => {
      const r = await runCli([
        join(tmp, "valid.stagebook.yaml"),
        join(tmp, "bad.stagebook.yaml"),
        join(tmp, "good.prompt.md"),
      ]);
      expect(r.code).toBe(1);
      expect(r.stdout).toContain("bad.stagebook.yaml:");
      // valid + good produce no output (silent success)
      expect(r.stdout).not.toContain("valid.stagebook.yaml:");
      expect(r.stdout).not.toContain("good.prompt.md:");
    });
  });

  describe("--help", () => {
    it("exits 0 and writes usage to stdout for --help", async () => {
      const r = await runCli(["--help"]);
      expect(r.code).toBe(0);
      expect(r.stdout).toContain("Usage: stagebook validate");
    });

    it("exits 0 and writes usage to stdout for -h short flag", async () => {
      const r = await runCli(["-h"]);
      expect(r.code).toBe(0);
      expect(r.stdout).toContain("Usage: stagebook validate");
    });
  });

  describe("argv parsing", () => {
    it("exits 2 and writes USAGE on unknown flag", async () => {
      const r = await runCli(["--bogus", join(tmp, "valid.stagebook.yaml")]);
      expect(r.code).toBe(2);
      expect(r.stderr).toContain("Error:");
      expect(r.stderr).toContain("Usage: stagebook validate");
    });
  });

  describe("template expansion failures", () => {
    it("surfaces expansion errors as their own diagnostic, distinct from schema errors", async () => {
      // A treatment with `imports:` pointing at a missing file fails
      // expansion (loadImport throws → expandTreatmentSourceWithImports
      // sets expanded.error). This exercises the synthesized
      // "Template expansion failed:" diagnostic in validate.ts.
      const treatment = `imports:
  - ./nonexistent-import.stagebook.yaml
treatments:
  - name: t
    playerCount: 1
    gameStages:
      - name: s
        duration: 10
        elements:
          - type: submitButton
introSequences:
  - name: i
    introSteps:
      - name: s
        elements:
          - type: submitButton
`;
      const file = join(tmp, "missing-import.stagebook.yaml");
      await writeFile(file, treatment);
      const r = await runCli([file]);
      expect(r.code).toBe(1);
      expect(r.stdout).toContain("Template expansion failed");
    });
  });

  describe("terminal-control sanitisation", () => {
    it("strips ANSI / control chars from text-mode output", async () => {
      // A YAML key containing a terminal-clear sequence would otherwise
      // reach the researcher's terminal raw. Validator embeds the key
      // verbatim in "Unrecognized key '<key>'" messages.
      const evil = `treatments:
  - name: t
    playerCount: 1
    gameStages:
      - name: s
        duration: 10
        "evil\\u001b[2J\\u001b[Hkey": bad
        elements:
          - type: submitButton
introSequences:
  - name: i
    introSteps:
      - name: s
        elements:
          - type: submitButton
`;
      const file = join(tmp, "evil.stagebook.yaml");
      await writeFile(file, evil);
      const r = await runCli([file]);
      // Whatever the validator does with the key, the CLI must not emit
      // raw ESC (\x1b) into stdout. We don't assert anything about JSON
      // since JSON.stringify already escapes control chars.
      expect(r.stdout).not.toMatch(/\x1b/);
    });
  });

  describe("--no-expand", () => {
    it("succeeds on a treatment that would fail expand-and-validate but passes raw schema", async () => {
      // A treatment with an undefined template reference fails expansion
      // but the raw schema accepts the template-reference shape.
      const tplRefTreatment = `treatments:
  - name: t
    playerCount: 1
    gameStages:
      - template: missing_template
introSequences:
  - name: i
    introSteps:
      - template: missing_template
`;
      const file = join(tmp, "tpl-ref.stagebook.yaml");
      await writeFile(file, tplRefTreatment);
      const expanded = await runCli([file]);
      const raw = await runCli(["--no-expand", file]);
      // Expanded mode catches the missing template; raw mode doesn't try.
      expect(expanded.code).toBe(1);
      expect(raw.code).toBe(0);
    });
  });
});
