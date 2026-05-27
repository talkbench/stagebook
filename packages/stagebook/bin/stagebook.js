#!/usr/bin/env node
// Thin dispatcher for the stagebook CLI. The actual command lives in
// dist/cli/validate.js as a `run({argv, stdin, stdout, stderr})` function;
// this wrapper exists so the bin entry can stay JS (no transpile step at
// install time) while keeping the shebang.
//
// `npx --package=stagebook stagebook validate ...` resolves the bin via
// the package's "bin" field, which points here.

const subcommand = process.argv[2];

if (!subcommand || subcommand === "--help" || subcommand === "-h") {
  process.stderr.write(
    "Usage: stagebook <command> [options]\n\n" +
      "Commands:\n" +
      "  validate   Validate treatment (.stagebook.yaml) and prompt (.prompt.md) files\n" +
      "\nRun 'stagebook <command> --help' for command-specific options.\n",
  );
  process.exit(subcommand ? 0 : 2);
}

if (subcommand === "validate") {
  import("../dist/cli/validate.js")
    .then(({ run }) =>
      run({
        argv: process.argv.slice(3),
        stdin: process.stdin,
        stdout: process.stdout,
        stderr: process.stderr,
      }),
    )
    .then((code) => process.exit(code))
    .catch((err) => {
      process.stderr.write(
        `stagebook validate: unexpected error: ${err && err.stack ? err.stack : err}\n`,
      );
      process.exit(2);
    });
} else {
  process.stderr.write(`stagebook: unknown command '${subcommand}'.\n`);
  process.stderr.write("Available commands: validate\n");
  process.exit(2);
}
