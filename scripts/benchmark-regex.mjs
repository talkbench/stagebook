#!/usr/bin/env node
/**
 * Benchmark the built public expression API. Every evaluation runs in a fresh
 * subprocess with an external deadline; the parent never evaluates a pattern.
 *
 * npm run build -w stagebook
 * node scripts/benchmark-regex.mjs [--timeout-ms=2000]
 */
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const cases = [
  {
    name: "input-at-cap",
    input: "a".repeat(4096),
    pattern: "^a+$",
    expected: true,
  },
  {
    name: "input-over-cap",
    input: "a".repeat(4097),
    pattern: "^a+$",
    expected: false,
  },
  {
    name: "pattern-over-cap",
    input: "a",
    pattern: "a".repeat(1025),
    expected: "Missing",
  },
  ...[20, 24, 32].map((length) => ({
    name: `nested-repetition-${length + 1}`,
    input: `${"a".repeat(length)}!`,
    pattern: "^(a+)+$",
    expected: false,
    adversarial: true,
  })),
];

if (process.argv[2] === "--case") {
  // This branch is run only in a subprocess. Its caller owns the timeout:
  // a timer in this process could not interrupt synchronous RegExp.test().
  const sample = cases[Number(process.argv[3])];
  if (!sample) throw new Error("Unknown benchmark case.");
  const { evaluateExpression, Missing } =
    await import("../packages/stagebook/dist/index.js");
  const start = performance.now();
  const value = evaluateExpression(
    {
      matches: {
        string: { reference: "self.prompt.answer" },
        patterns: [sample.pattern],
      },
    },
    { readReference: () => sample.input },
  );
  process.stdout.write(
    JSON.stringify({
      result: value === Missing ? "Missing" : value,
      evaluationMs: Number((performance.now() - start).toFixed(3)),
    }),
  );
} else {
  const args = process.argv.slice(2);
  const timeoutMs = args.length
    ? Number(args[0].slice("--timeout-ms=".length))
    : 2000;
  if (
    args.length > 1 ||
    (args.length === 1 && !args[0].startsWith("--timeout-ms=")) ||
    !Number.isInteger(timeoutMs) ||
    timeoutMs < 100 ||
    timeoutMs > 10_000
  ) {
    throw new Error("Usage: benchmark-regex.mjs [--timeout-ms=100..10000]");
  }

  console.log(
    JSON.stringify({
      node: process.version,
      v8: process.versions.v8,
      platform: process.platform,
      architecture: process.arch,
      timeoutMs,
      timeoutIncludesStartup: true,
    }),
  );
  const rows = [];
  for (const [index, sample] of cases.entries()) {
    const start = performance.now();
    const child = spawnSync(
      process.execPath,
      [fileURLToPath(import.meta.url), "--case", String(index)],
      {
        encoding: "utf8",
        timeout: timeoutMs,
        killSignal: "SIGKILL",
        maxBuffer: 64 * 1024,
      },
    );
    const row = {
      case: sample.name,
      inputLength: sample.input.length,
      patternLength: sample.pattern.length,
      wallMs: Number((performance.now() - start).toFixed(3)),
    };
    if (child.error?.code === "ETIMEDOUT") {
      rows.push({ ...row, result: "external timeout", evaluationMs: null });
      // Timing out on an adversarial example is a benchmark observation.
      // Timing out on a cap/control case means this run cannot verify it.
      if (!sample.adversarial) process.exitCode = 1;
      continue;
    }
    if (child.error || child.status !== 0) {
      rows.push({ ...row, result: "error", evaluationMs: null });
      console.error(child.error?.message ?? child.stderr);
      process.exitCode = 1;
      continue;
    }
    try {
      const result = JSON.parse(child.stdout);
      rows.push({ ...row, ...result });
      if (result.result !== sample.expected) process.exitCode = 1;
    } catch (error) {
      console.error(
        `Invalid child output for ${sample.name}: ${error.message}`,
      );
      process.exitCode = 1;
    }
  }
  console.table(rows);
  console.log(
    "Each case uses a fresh subprocess. An external timeout is not an evaluator timeout. " +
      "Timings vary by engine and machine; completing these samples does not prove a hard time bound.",
  );
}
