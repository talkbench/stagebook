import { mediaPlayerRecordSchema } from "../schemas/mediaPlayerRecord.js";
import {
  enumerateConditionReferenceSites,
  enumerateStepSites,
} from "../schemas/validateReferences.js";

export interface HostReferenceFieldIssue {
  path: (string | number)[];
  message: string;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const toArray = (value: unknown): unknown[] =>
  Array.isArray(value) ? value : [];

const mediaPlayerFields = Object.keys(mediaPlayerRecordSchema.shape);
const knownMediaPlayerFields = new Set(mediaPlayerFields);

/** Only suggest nearby spellings, including capitalization mistakes. */
function closestField(field: string): string | undefined {
  let closest: string | undefined;
  let bestDistance = 3;
  for (const candidate of mediaPlayerFields) {
    let row = Array.from({ length: field.length + 1 }, (_, i) => i);
    for (let i = 1; i <= candidate.length; i++) {
      const next = [i];
      for (let j = 1; j <= field.length; j++) {
        next[j] = Math.min(
          next[j - 1] + 1,
          row[j] + 1,
          row[j - 1] + (candidate[i - 1] === field[j - 1] ? 0 : 1),
        );
      }
      row = next;
    }
    const distance = row[field.length];
    if (distance < bestDistance) {
      closest = candidate;
      bestDistance = distance;
    }
  }
  return closest;
}

/**
 * Warn about unknown top-level mediaPlayer fields (#730), using the actual
 * saved-record schema. Keep this outside superRefine so older or host-extended
 * records remain valid. Nested paths and other sources are deliberately left
 * to their own typing rules. Raw template bodies are checked after expansion.
 */
export function collectUnknownHostReferenceFields(
  fileObj: unknown,
): HostReferenceFieldIssue[] {
  if (!isRecord(fileObj)) return [];
  const issues: HostReferenceFieldIssue[] = [];
  const check = (
    sites: ReturnType<typeof enumerateConditionReferenceSites>,
  ) => {
    for (const { reference, path } of sites) {
      const field = reference.path?.[0];
      if (
        reference.source !== "mediaPlayer" ||
        !field ||
        field.includes("${") ||
        knownMediaPlayerFields.has(field)
      )
        continue;
      const suggestion = closestField(field);
      issues.push({
        path,
        message:
          `Unknown field '${field}' on mediaPlayer record.` +
          (suggestion ? ` Did you mean '${suggestion}'?` : "") +
          ` Valid fields: ${mediaPlayerFields.join(", ")}.`,
      });
    }
  };

  const collections = [
    { key: "treatments", lists: ["gameStages", "exitSequence"] },
    { key: "introSequences", lists: ["introSteps"] },
    { key: "consent", lists: ["steps"] },
  ];
  for (const { key, lists } of collections) {
    toArray(fileObj[key]).forEach((container, containerIndex) => {
      if (!isRecord(container)) return;
      if (key === "treatments") {
        toArray(container.groupComposition).forEach((player, playerIndex) => {
          if (!isRecord(player)) return;
          check(
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
        toArray(container[list]).forEach((stage, stageIndex) => {
          if (!isRecord(stage)) return;
          const stagePath = [key, containerIndex, list, stageIndex];
          check(enumerateStepSites(stage, stagePath));
          if (list === "gameStages" && isRecord(stage.discussion)) {
            check(
              enumerateConditionReferenceSites(stage.discussion.conditions, [
                ...stagePath,
                "discussion",
                "conditions",
              ]),
            );
          }
        });
      }
    });
  }
  return issues;
}
