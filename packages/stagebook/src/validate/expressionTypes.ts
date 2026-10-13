import { fileSchema } from "../schemas/treatment.js";
import type { HostRecordSchemas } from "../schemas/hostRecords.js";
import { collectReferencedPromptFiles } from "../schemas/localeConsistency.js";
import {
  promptFileSchema,
  type PromptFileType,
} from "../schemas/promptFile.js";
import {
  checkExpressionTypes,
  type ExpressionTypeIssue,
} from "../schemas/expressionTypes.js";

/** The host supplies I/O. Never request remote, absolute, or interior-traversal paths;
 * unavailable metadata is represented by the type checker's named warning. */
export async function checkExpressionTypesWithLoader({
  fileObj,
  loadPrompt,
  hostSchemas,
}: {
  fileObj: unknown;
  loadPrompt: (relativePath: string) => Promise<string | null>;
  hostSchemas?: HostRecordSchemas;
}): Promise<ExpressionTypeIssue[]> {
  const prompts = new Map<string, PromptFileType>();
  for (const file of collectReferencedPromptFiles(fileObj)) {
    if (!fileSchema.safeParse(file).success) continue;
    let source: string | null;
    try {
      source = await loadPrompt(file);
    } catch {
      continue;
    }
    if (source === null) continue;
    const parsed = promptFileSchema.safeParse(source);
    if (parsed.success) prompts.set(file, parsed.data);
  }
  return checkExpressionTypes(fileObj, prompts, { hostSchemas });
}
