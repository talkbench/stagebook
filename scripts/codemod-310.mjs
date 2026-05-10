#!/usr/bin/env node
/**
 * Codemod for #310 — rename `*.treatments.yaml` files to
 * `*.stagebook.yaml` recursively under the given root(s).
 *
 * The file extension is the only thing that changes; YAML contents
 * are untouched. Skips `node_modules/`, `.git/`, and any path the
 * caller passes via `--ignore`. Idempotent: running twice on the
 * same tree is a no-op.
 *
 * Usage:
 *   node scripts/codemod-310.mjs <root> [<root2> ...]
 *   node scripts/codemod-310.mjs --check <root>      # exit 1 if any rename needed; no writes
 *   node scripts/codemod-310.mjs --ignore=substring <root>
 *
 * `--ignore` takes a literal substring matched against each candidate
 * path (POSIX-normalized — forward slashes — so the same flag works
 * on Windows). Not a glob matcher; deliberately simple. Common
 * directories (`node_modules`, `.git`, `dist`, etc.) are skipped
 * automatically.
 *
 * Designed to be run from any repo (stagebook itself, deliberation-
 * assets, backchannel-manipulation, private study folders) — has no
 * dependencies on stagebook's source.
 */
import * as fs from "node:fs";
import * as path from "node:path";

const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  ".cache",
  ".next",
  "coverage",
]);

function* walk(root, extraIgnores) {
  const stack = [root];
  while (stack.length > 0) {
    const dir = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (err) {
      // Surface readdir failures (missing dir, permission) but keep
      // going — a partial migration is better than aborting the run.
      console.warn(`[skip] ${dir}: ${err.message}`);
      continue;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      // Normalize to posix (forward slashes) so a Windows user's
      // `--ignore=foo/bar` matches `foo\bar` paths from readdir.
      const normalized = full.split(path.sep).join("/");
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) continue;
        if (extraIgnores.some((ignore) => normalized.includes(ignore)))
          continue;
        stack.push(full);
      } else if (entry.isFile() && entry.name.endsWith(".treatments.yaml")) {
        if (extraIgnores.some((ignore) => normalized.includes(ignore)))
          continue;
        yield full;
      }
    }
  }
}

function renameTarget(filePath) {
  return filePath.replace(/\.treatments\.yaml$/, ".stagebook.yaml");
}

function main() {
  const argv = process.argv.slice(2);
  const checkOnly = argv.includes("--check");
  const ignoreFlags = argv
    .filter((a) => a.startsWith("--ignore="))
    .map((a) => a.slice("--ignore=".length));
  const roots = argv.filter((a) => !a.startsWith("--"));

  if (roots.length === 0) {
    console.error(
      "Usage: codemod-310.mjs [--check] [--ignore=substring] <root> [...]",
    );
    process.exit(2);
  }

  let renamed = 0;
  let conflicts = 0;
  for (const root of roots) {
    if (!fs.existsSync(root)) {
      console.error(`Skipping missing root: ${root}`);
      continue;
    }
    for (const oldPath of walk(root, ignoreFlags)) {
      const newPath = renameTarget(oldPath);
      if (fs.existsSync(newPath)) {
        // Refusing to overwrite is the safe default — caller decides.
        console.error(
          `[conflict] ${newPath} already exists; ${oldPath} not renamed`,
        );
        conflicts++;
        continue;
      }
      if (checkOnly) {
        console.log(`[would rename] ${oldPath} -> ${newPath}`);
      } else {
        fs.renameSync(oldPath, newPath);
        console.log(`[renamed] ${oldPath} -> ${newPath}`);
      }
      renamed++;
    }
  }

  if (renamed === 0) {
    console.log("Nothing to rename.");
  } else {
    console.log(
      `${checkOnly ? "Would rename" : "Renamed"} ${renamed} file(s)${
        conflicts > 0 ? ` (${conflicts} conflict(s))` : ""
      }.`,
    );
  }

  if (conflicts > 0) process.exit(1);
  if (checkOnly && renamed > 0) process.exit(1);
}

main();
