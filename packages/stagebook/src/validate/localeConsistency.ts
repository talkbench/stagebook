import {
  fileSchema,
  promptFileSchema,
  collectReferencedPromptFiles,
  checkPromptLocaleConsistency,
  type PromptLocaleMismatch,
} from "../index.js";

/**
 * Host-side wiring for the locale-consistency rule (ADR
 * docs/decisions/2026-06-localization.md, decision #6).
 *
 * The pure rule (`checkPromptLocaleConsistency`) compares already-loaded
 * locales; the file I/O it needs is host-specific (Node `fs` in the CLI,
 * `vscode.workspace.fs` in the extension, `fetch` in the viewer). This
 * function is that shared wiring so the three surfaces don't each reimplement
 * the same load-gate-parse loop:
 *
 *   1. collect the referenced prompt files (scheme-bearing paths excluded —
 *      the host can't read those locally),
 *   2. gate each path through `fileSchema` — never read a path the schema
 *      rejects (absolute, backslash, interior `..`); those carry their own
 *      error diagnostics elsewhere, and this keeps the locale rule from being
 *      used to read them anyway (ADR security acceptance condition),
 *   3. load + parse frontmatter via the host's `loadPrompt` callback,
 *   4. run the rule.
 *
 * `loadPrompt` returns the prompt source, or `null` when it can't be read.
 * A throwing loader is also treated as unreadable: missing-file and
 * invalid-prompt problems are different error classes with their own
 * reporting, so they're skipped here rather than reported twice.
 *
 * @param fileObj hydrated (post-fillTemplates) treatment file object — the
 *   same shape the pure rule walks.
 */
export async function checkPromptLocaleConsistencyWithLoader({
  fileObj,
  loadPrompt,
}: {
  fileObj: unknown;
  loadPrompt: (relPath: string) => Promise<string | null>;
}): Promise<PromptLocaleMismatch[]> {
  const promptLocales = new Map<string, string | undefined>();
  for (const relPath of collectReferencedPromptFiles(fileObj)) {
    if (!fileSchema.safeParse(relPath).success) continue;
    let source: string | null;
    try {
      source = await loadPrompt(relPath);
    } catch {
      continue;
    }
    if (source === null) continue;
    const parsed = promptFileSchema.safeParse(source);
    if (!parsed.success) continue;
    promptLocales.set(relPath, parsed.data.metadata.locale);
  }
  return checkPromptLocaleConsistency(fileObj, promptLocales);
}
