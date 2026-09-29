import {
  collectReferencedPromptFiles,
  fileSchema,
  promptFileSchema,
  checkSharedPromptValidation,
  type SharedPromptConstraintMetadata,
  type SharedPromptValidationIssue,
} from "../schemas/index.js";

/** Load valid local prompts using the same path gate as locale consistency. */
export async function checkSharedPromptValidationWithLoader({
  fileObj,
  loadPrompt,
}: {
  fileObj: unknown;
  loadPrompt: (relPath: string) => Promise<string | null>;
}): Promise<SharedPromptValidationIssue[]> {
  const metadata = new Map<string, SharedPromptConstraintMetadata>();
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
    if (parsed.success) metadata.set(relPath, parsed.data.metadata);
  }
  return checkSharedPromptValidation(fileObj, metadata);
}
