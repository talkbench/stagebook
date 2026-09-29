import {
  enumerateConditionReferenceSites,
  enumerateStepSites,
} from "./validateReferences.js";

/** Post-hydration authoring rules for shared validation (#668, #687). No I/O. */
export interface SharedPromptConstraintMetadata {
  type?: string;
  required?: boolean;
  minLength?: number;
  maxLength?: number;
}

export interface SharedPromptValidationIssue {
  promptFile: string;
  /** Points to the prompt file or the invalid shared validity reference. */
  path: (string | number)[];
  message: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function toArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

/** Explicit names only: runtime-derived keys also contain host progressLabel.
 * Reuse with distinct files is ambiguous, as in unsatisfiableConditions; don't
 * invent a uniqueness rule or assume that the earliest producer owns the data. */
function collectPromptFiles(
  stages: unknown[],
  files: Map<string, Set<string>>,
): void {
  for (const stage of stages) {
    if (!isRecord(stage)) continue;
    for (const element of toArray(stage.elements)) {
      if (
        !isRecord(element) ||
        element.type !== "prompt" ||
        typeof element.name !== "string" ||
        typeof element.file !== "string"
      )
        continue;
      const namedFiles = files.get(element.name) ?? new Set<string>();
      namedFiles.add(element.file);
      files.set(element.name, namedFiles);
    }
  }
}

function promptFilesInScope(
  fileObj: Record<string, unknown>,
  container: Record<string, unknown>,
  lists: string[],
  kind: string,
): Map<string, Set<string>> {
  const files = new Map<string, Set<string>>();
  for (const list of lists) collectPromptFiles(toArray(container[list]), files);
  if (kind === "treatment") {
    const declared = container.compatibleIntroSequences;
    // Match validateReferences' can't-prove posture for unresolved pairings.
    const concretePairing =
      Array.isArray(declared) &&
      declared.every(
        (name: unknown) => typeof name === "string" && !name.includes("${"),
      );
    for (const sequence of toArray(fileObj.introSequences)) {
      if (!isRecord(sequence)) continue;
      if (concretePairing && !declared.includes(sequence.name)) continue;
      collectPromptFiles(toArray(sequence.introSteps), files);
    }
  }
  return files;
}

/**
 * Only numericResponse supports constraints and isValid on shared prompts.
 * Other types still permit explicit `required: false` (#668).
 * Missing/invalid prompt files are omitted from the map by the host and have
 * separate diagnostics. Walk concrete stage lists only, never template bodies.
 */
export function checkSharedPromptValidation(
  fileObj: unknown,
  promptMetadata: ReadonlyMap<string, SharedPromptConstraintMetadata>,
): SharedPromptValidationIssue[] {
  if (!isRecord(fileObj)) return [];
  const issues: SharedPromptValidationIssue[] = [];
  const collections = [
    {
      key: "treatments",
      kind: "treatment",
      lists: ["gameStages", "exitSequence"],
    },
    { key: "introSequences", kind: "intro sequence", lists: ["introSteps"] },
    { key: "consent", kind: "consent arm", lists: ["steps"] },
  ];
  for (const { key, kind, lists } of collections) {
    const containers = fileObj[key];
    if (!Array.isArray(containers)) continue;
    containers.forEach((container: unknown, containerIndex) => {
      if (!isRecord(container)) return;
      const filesInScope = promptFilesInScope(fileObj, container, lists, kind);
      const checkReferences = (
        sites: ReturnType<typeof enumerateConditionReferenceSites>,
      ) => {
        for (const { reference, path } of sites) {
          if (
            !("position" in reference) ||
            reference.position !== "shared" ||
            reference.source !== "prompt" ||
            reference.path?.[0] !== "isValid" ||
            typeof reference.name !== "string" ||
            reference.name.includes("${")
          )
            continue;
          const files = filesInScope.get(reference.name);
          if (files?.size !== 1) continue;
          const promptFile = [...files][0];
          const metadata = promptMetadata.get(promptFile);
          // Unknown metadata is not evidence of a nonnumeric prompt. Loading
          // and prompt syntax problems have their own reporting paths.
          if (!metadata?.type || metadata.type === "numericResponse") continue;
          issues.push({
            promptFile,
            path,
            message: `Shared prompt "${reference.name}" (${promptFile}) has type ${metadata.type}, whose records do not carry isValid. Only numericResponse supports shared validity; use a player-scoped reference for this prompt (#668).`,
          });
        }
      };
      if (kind === "treatment") {
        toArray(container.groupComposition).forEach((player, playerIndex) => {
          if (!isRecord(player)) return;
          checkReferences(
            enumerateConditionReferenceSites(player.conditions, [
              key,
              containerIndex,
              "groupComposition",
              playerIndex,
              "conditions",
            ]),
          );
        });
      }
      for (const list of lists) {
        const stages = container[list];
        if (!Array.isArray(stages)) continue;
        stages.forEach((stage: unknown, stageIndex) => {
          if (!isRecord(stage)) return;
          const stagePath = [key, containerIndex, list, stageIndex];
          checkReferences(enumerateStepSites(stage, stagePath));
          if (list === "gameStages" && isRecord(stage.discussion)) {
            checkReferences(
              enumerateConditionReferenceSites(stage.discussion.conditions, [
                ...stagePath,
                "discussion",
                "conditions",
              ]),
            );
          }
          if (!Array.isArray(stage.elements)) return;
          stage.elements.forEach((element: unknown, elementIndex) => {
            if (
              !isRecord(element) ||
              element.type !== "prompt" ||
              element.shared !== true ||
              typeof element.file !== "string"
            )
              return;
            const metadata = promptMetadata.get(element.file);
            if (!metadata || metadata.type === "numericResponse") return;
            const constraints = [
              ...(metadata.required === true ? ["required"] : []),
              ...(metadata.minLength !== undefined ? ["minLength"] : []),
              ...(metadata.maxLength !== undefined ? ["maxLength"] : []),
            ];
            if (constraints.length === 0) return;
            const name =
              typeof container.name === "string" ? container.name : "(unnamed)";
            issues.push({
              promptFile: element.file,
              path: [
                key,
                containerIndex,
                list,
                stageIndex,
                "elements",
                elementIndex,
                "file",
              ],
              message: `Prompt "${element.file}" in ${kind} "${name}" is shared but declares ${constraints.map((constraint) => `\`${constraint}\``).join(", ")}. For this prompt type, response validation is only supported on player-scoped prompts. Remove the constraints or set \`shared: false\`; explicit \`required: false\` is allowed (#668).`,
            });
          });
        });
      }
    });
  }
  return issues;
}
