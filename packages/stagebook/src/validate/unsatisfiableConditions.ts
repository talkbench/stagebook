import {
  fileSchema,
  promptFileSchema,
  collectReferencedPromptFiles,
  checkUnsatisfiableConditions,
  type PromptFileType,
  type UnsatisfiableConditionIssue,
} from "../index.js";

/**
 * Host-side wiring for the unsatisfiable-condition rule (#480).
 *
 * The pure rule ([[unsatisfiableConditions]]) reasons over already-parsed
 * prompt value-domains; the file I/O it needs is host-specific (Node `fs` in
 * the CLI, `vscode.workspace.fs` in the extension, `fetch` in the viewer).
 * This is the shared load-gate-parse loop so the surfaces don't each
 * reimplement it — the same division of labor as
 * `checkPromptLocaleConsistencyWithLoader`:
 *
 *   1. collect the referenced prompt files (scheme-bearing paths excluded —
 *      the host can't read those locally),
 *   2. gate each path through `fileSchema` — never read a path the schema
 *      rejects (absolute, backslash, interior `..`),
 *   3. load + parse via the host's `loadPrompt` callback,
 *   4. run the rule against the parsed value-domains.
 *
 * `loadPrompt` returns the prompt source, or `null` when it can't be read. A
 * throwing loader is treated as unreadable, and an unparseable prompt is
 * skipped: missing-file and invalid-prompt problems are different error
 * classes with their own reporting, so they're not double-reported here.
 *
 * @param fileObj hydrated (post-fillTemplates) treatment file object.
 */
export async function checkUnsatisfiableConditionsWithLoader({
  fileObj,
  loadPrompt,
}: {
  fileObj: unknown;
  loadPrompt: (relPath: string) => Promise<string | null>;
}): Promise<UnsatisfiableConditionIssue[]> {
  const promptDomains = new Map<string, PromptFileType>();
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
    promptDomains.set(relPath, parsed.data);
  }
  return checkUnsatisfiableConditions(fileObj, promptDomains);
}
