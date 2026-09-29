/** Post-hydration authoring rule for player-only validation (#668). No I/O. */
export interface SharedPromptConstraintMetadata {
  type?: string;
  required?: boolean;
  minLength?: number;
  maxLength?: number;
}

export interface SharedPromptValidationIssue {
  promptFile: string;
  /** Points to the shared prompt element's file reference. */
  path: (string | number)[];
  message: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/**
 * Reject constraints on shared prompts, except explicit `required: false`.
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
      for (const list of lists) {
        const stages = container[list];
        if (!Array.isArray(stages)) continue;
        stages.forEach((stage: unknown, stageIndex) => {
          if (!isRecord(stage) || !Array.isArray(stage.elements)) return;
          stage.elements.forEach((element: unknown, elementIndex) => {
            if (
              !isRecord(element) ||
              element.type !== "prompt" ||
              element.shared !== true ||
              typeof element.file !== "string"
            )
              return;
            const metadata = promptMetadata.get(element.file);
            if (!metadata) return;
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
              message: `Prompt "${element.file}" in ${kind} "${name}" is shared but declares ${constraints.map((constraint) => `\`${constraint}\``).join(", ")}. Response validation is only supported on player-scoped prompts. Remove the constraints or set \`shared: false\`; explicit \`required: false\` is allowed (#668).`,
            });
          });
        });
      }
    });
  }
  return issues;
}
