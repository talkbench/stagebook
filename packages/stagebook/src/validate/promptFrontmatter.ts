import { load as loadYaml } from "js-yaml";
import { splitOnTopLevelHrules } from "../schemas/promptFile.js";

/**
 * A prompt file's frontmatter as parsed YAML, or undefined when it can't be
 * read. Unvalidated, so callers check what they read. Used where a prompt's
 * `stagebook:` version matters even if the rest of the file fails the prompt
 * schema (#756). Internal: not exported from `stagebook/validate`.
 */
export function readPromptFrontmatter(source: string): unknown {
  const sections = splitOnTopLevelHrules(source.trim());
  if (sections.length < 3) return undefined;
  try {
    return loadYaml(sections[1]);
  } catch {
    return undefined;
  }
}
