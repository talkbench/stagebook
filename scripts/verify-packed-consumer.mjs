#!/usr/bin/env node
// Exercise the published package boundary, with no workspace links or aliases.
// Run after `npm run build -w stagebook`; see docs/engineer/zod4-migration.md.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const workdir = mkdtempSync(join(tmpdir(), "stagebook-packed-consumer-"));
const zodVersion = process.env.STAGEBOOK_ZOD_VERSION ?? "4.3.6";
assert.match(zodVersion, /^4\.\d+\.\d+$/, "Use an exact Zod 4 version");

function run(command, args, cwd = workdir, capture = false) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    stdio: capture ? "pipe" : "inherit",
    env: { ...process.env, npm_config_update_notifier: "false" },
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(
      `${command} ${args.join(" ")} failed (${result.status})\n${result.stdout ?? ""}${result.stderr ?? ""}`,
    );
  }
  return result.stdout;
}

function write(name, text) {
  writeFileSync(join(workdir, name), text);
}

console.log(`Packed-consumer artifacts: ${workdir}`);
const pack = JSON.parse(
  run(
    "npm",
    [
      "pack",
      "--workspace",
      "stagebook",
      "--ignore-scripts",
      "--json",
      "--pack-destination",
      workdir,
    ],
    root,
    true,
  ),
)[0];
const tarball = join(workdir, pack.filename);
write(
  "package.json",
  JSON.stringify(
    {
      name: "stagebook-packed-consumer",
      private: true,
      type: "module",
      dependencies: {
        stagebook: `file:${tarball}`,
        zod: zodVersion,
        react: "19.2.4",
        "react-dom": "19.2.4",
      },
      devDependencies: {
        "@types/react": "19.2.14",
        "@types/react-dom": "19.2.3",
        esbuild: "0.27.7",
        typescript: "5.9.3",
      },
    },
    null,
    2,
  ),
);
run("npm", ["install", "--ignore-scripts", "--no-audit", "--no-fund"]);
run("npm", ["ls", "stagebook", "zod", "--all"]);

// A real .mts and .cts consumer composes the exported schemas with its own
// Zod import. skipLibCheck=false also checks both declaration export targets.
const composition = `import { z } from "zod";
import { conditionSchema, treatmentFileSchema, promptFileSchema, promptSchema } from "stagebook";
import type { StageConfig, StagebookContext } from "stagebook/components";
import type { ViewerProps } from "stagebook/viewer";
import type { ParseResult } from "stagebook/validate";
import type { DispatchResult } from "stagebook/dispatch";
import type { ProbeReport } from "stagebook/audio-probe";

const acceptsConsumerSchema = <T extends z.ZodType>(schema: T): T => schema;
export const envelope = z.object({
  condition: acceptsConsumerSchema(conditionSchema),
  treatment: acceptsConsumerSchema(treatmentFileSchema),
  prompt: acceptsConsumerSchema(promptFileSchema),
  host: z.string(),
});
export type HostInput = z.input<typeof envelope>;
export type HostOutput = z.output<typeof envelope>;
export type Rendering = [StageConfig, StagebookContext, ViewerProps, ParseResult, DispatchResult, ProbeReport];
export const promptInput: z.input<typeof promptFileSchema> = "---\\ntype: noResponse\\n---\\nHello";
const output: HostOutput = envelope.parse({});
export const host: string = output.host;
export const promptBody: string = output.prompt.body;
type PromptInput = z.input<typeof promptSchema>;
export const validPrompt: PromptInput = { type: "prompt", file: "x.prompt.md", displayTime: 1 };
// @ts-expect-error Numeric fields cannot accept arbitrary booleans at the input boundary.
export const invalidPrompt: PromptInput = { ...validPrompt, displayTime: true };
`;
write("composition.mts", composition);
write("composition.cts", composition);
write(
  "tsconfig.json",
  JSON.stringify({
    compilerOptions: {
      target: "ES2022",
      module: "NodeNext",
      moduleResolution: "NodeNext",
      strict: true,
      skipLibCheck: false,
      noEmit: true,
      esModuleInterop: true,
      jsx: "react-jsx",
    },
    files: ["composition.mts", "composition.cts"],
  }),
);
run(process.execPath, [
  "node_modules/typescript/bin/tsc",
  "-p",
  "tsconfig.json",
]);

write(
  "runtime.mjs",
  `import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { realpathSync } from "node:fs";
import { z } from "zod";
import * as esm from "stagebook";
const require = createRequire(import.meta.url);
const stagebookRequire = createRequire(require.resolve("stagebook"));
assert.equal(realpathSync(require.resolve("zod")), realpathSync(stagebookRequire.resolve("zod")), "Stagebook must resolve the consumer's Zod peer");
const cjs = require("stagebook");
const prompt = "---\\ntype: noResponse\\n---\\nHello";
const treatment = { treatments: [{ name: "packed", playerCount: 1, compatibleIntroSequences: [], gameStages: [{ name: "stage", duration: 10, elements: [{ type: "prompt", file: "hello.prompt.md" }] }] }] };
const condition = { reference: "self.prompt.answer", comparator: "equals", value: "yes" };
for (const [name, api] of [["esm", esm], ["cjs", cjs]]) {
  const composed = z.object({ treatment: api.treatmentFileSchema, prompt: api.promptFileSchema, condition: api.conditionSchema });
  const parsed = composed.parse({ treatment, prompt, condition });
  assert.equal(parsed.treatment.treatments[0].name, "packed");
  assert.equal(parsed.prompt.body.trim(), "Hello");
  // Zod 4.4 changed missing-key handling for unknown/any fields. These
  // deferred values must preserve the authored field presence on both peers.
  for (const [schema, input] of [
    [api.templateSchema, { name: "question", contentType: "element" }],
    [api.templateSchema, { name: "question", contentType: "element", content: undefined }],
    [api.baseTreatmentSchema, { name: "arm", playerCount: 1, compatibleIntroSequences: [] }],
    [api.introExitStepSchema, { name: "step" }],
    [api.introSequenceSchema, { name: "sequence" }],
    [api.consentArmSchema, { name: "consent" }],
  ]) {
    assert.deepEqual(schema.parse(input), input, name + " deferred fields preserve omission");
  }
  for (const [schema, invalid] of [[api.treatmentFileSchema, []], [api.treatmentFileSchema, { treatments: [{ name: "broken", gameStages: "bad" }] }], [api.promptFileSchema, "not a prompt"], [api.conditionSchema, { reference: "self.prompt.answer", comparator: "equals" }]]) {
    const result = schema.safeParse(invalid);
    assert.equal(result.success, false, name + " malformed input must fail");
    assert.ok(result.error.issues.length > 0);
    assert.ok(result.error.issues.every((issue) => typeof issue.message === "string" && Array.isArray(issue.path)));
  }
  const invalidCondition = structuredClone(treatment);
  invalidCondition.treatments[0].gameStages[0].elements[0].conditions = [{ reference: "self.prompt.answer", comparator: "unsupported", value: [] }];
  const invalidResult = api.treatmentFileSchema.safeParse(invalidCondition);
  assert.equal(invalidResult.success, false, name + " unsupported comparator must fail without throwing");
  assert.ok(invalidResult.error.issues.length > 0 && invalidResult.error.issues.length < 100, "bounded diagnostic count");
  assert.ok(invalidResult.error.issues.some((issue) => issue.path[0] === "treatments" && issue.path[1] === 0), "diagnostic identifies the treatment");
}
for (const entry of ["stagebook/components", "stagebook/viewer", "stagebook/validate", "stagebook/dispatch", "stagebook/audio-probe"]) {
  assert.ok(Object.keys(await import(entry)).length, entry + " ESM exports");
  assert.ok(Object.keys(require(entry)).length, entry + " CJS exports");
}
const { parseTreatmentSource, validatePromptSource } = await import("stagebook/validate");
assert.equal((await parseTreatmentSource({ source: JSON.stringify(treatment), loadImport: async () => { throw new Error("unexpected import"); } })).ok, true);
assert.equal((await parseTreatmentSource({ source: "treatments: invalid", loadImport: async () => "" })).ok, false);
assert.equal(validatePromptSource(prompt).diagnostics.filter((d) => d.severity === "error").length, 0);
assert.ok(validatePromptSource("not a prompt").diagnostics.length > 0);
console.log("ESM/CJS schemas, host composition, diagnostics, and peer identity passed");
`,
);
run(process.execPath, ["runtime.mjs"]);

// Keep namespaces live so tree shaking cannot hide an incompatible import.
write(
  "browser.mjs",
  [
    'import * as schemas from "stagebook";',
    'import * as components from "stagebook/components";',
    'import * as viewer from "stagebook/viewer";',
    'import * as validate from "stagebook/validate";',
    'import * as dispatch from "stagebook/dispatch";',
    'import * as audioProbe from "stagebook/audio-probe";',
    "globalThis.stagebookConsumer = { schemas, components, viewer, validate, dispatch, audioProbe };",
  ].join("\n"),
);
write(
  "bundle.mjs",
  `import { build } from "esbuild";
import { writeFileSync } from "node:fs";
const result = await build({ entryPoints: ["browser.mjs"], outfile: "browser.js", platform: "browser", format: "esm", bundle: true, metafile: true, define: { "process.env.NODE_ENV": '"production"' } });
writeFileSync("browser-meta.json", JSON.stringify(result.metafile, null, 2));
`,
);
run(process.execPath, ["bundle.mjs"]);
const browserMeta = JSON.parse(
  readFileSync(join(workdir, "browser-meta.json"), "utf8"),
);
assert.ok(
  Object.keys(browserMeta.inputs).some((path) =>
    path.includes("node_modules/zod/"),
  ),
);
assert.ok(
  !Object.keys(browserMeta.inputs).some((path) => /zod\/v3\//.test(path)),
  "Browser bundle must use the Zod 4 boundary",
);
console.log(
  `Packed Stagebook ${pack.version} passed with Zod ${zodVersion}. Artifacts retained in ${workdir}`,
);
