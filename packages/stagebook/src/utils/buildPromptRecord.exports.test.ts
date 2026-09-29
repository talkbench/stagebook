import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { execFileSync } from "node:child_process";
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "tsup";

const require = createRequire(import.meta.url);
const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
let fixture: string;

beforeAll(async () => {
  fixture = mkdtempSync(join(tmpdir(), "stagebook-record-exports-"));
  const installed = join(fixture, "node_modules", "stagebook");
  mkdirSync(installed, { recursive: true });
  // Use the actual published entrypoint/config. Disable only declarations:
  // these tests exercise the runtime build; the normal build checks DTS.
  await build({
    config: join(packageRoot, "tsup.config.ts"),
    outDir: join(installed, "dist"),
    dts: false,
    silent: true,
  });
  writeFileSync(
    join(installed, "package.json"),
    readFileSync(join(packageRoot, "package.json")),
  );
  // The main entry uses these runtime dependencies. Copy only them so React
  // and react-dom genuinely cannot resolve from this consumer installation.
  for (const dependency of ["zod", "js-yaml", "argparse"]) {
    cpSync(
      dirname(require.resolve(`${dependency}/package.json`)),
      join(fixture, "node_modules", dependency),
      { recursive: true },
    );
  }
}, 30_000);

afterAll(() => {
  if (fixture) rmSync(fixture, { recursive: true, force: true });
});

const assertion = `
  assert.throws(() => require.resolve('react'), { code: 'MODULE_NOT_FOUND' });
  assert.throws(() => require.resolve('react-dom'), { code: 'MODULE_NOT_FOUND' });
  const record = buildPromptRecord({ metadata: { type: 'openResponse' }, name: 'shared', body: 'Question', responses: [], value: 'merged', shared: true, step: 'game_1', stageTimeElapsed: 0 });
  assert.deepEqual(record, { type: 'openResponse', name: 'shared', file: undefined, shared: true, prompt: 'Question', responses: [], debugMessages: [], value: 'merged', step: 'game_1', stageTimeElapsed: 0 });
  process.stdout.write('ok');
`;

describe("buildPromptRecord published main entry (#697)", () => {
  test("CJS loads and builds records in Node without React installed", () => {
    const script = `const assert = require('node:assert/strict'); const { buildPromptRecord } = require('stagebook'); ${assertion}`;
    expect(
      execFileSync(process.execPath, ["--input-type=commonjs", "-e", script], {
        cwd: fixture,
        encoding: "utf8",
      }),
    ).toBe("ok");
  });
  test("ESM loads and builds records in Node without React installed", () => {
    const script = `import assert from 'node:assert/strict'; import { createRequire } from 'node:module'; import { buildPromptRecord } from 'stagebook'; const require = createRequire(import.meta.url); ${assertion}`;
    expect(
      execFileSync(process.execPath, ["--input-type=module", "-e", script], {
        cwd: fixture,
        encoding: "utf8",
      }),
    ).toBe("ok");
  });
});
