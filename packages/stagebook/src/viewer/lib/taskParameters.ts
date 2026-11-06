import type { TreatmentFileType } from "../../schemas/index.js";
import { getUnresolvedFields } from "../../templates/index.js";
import { expandTreatmentFile } from "./expandTreatmentFile.js";

// Preview a parameterized workflow against the same task file Annotator
// takes (#815). The file is a JSON array of task entries — Annotator's
// task-file upload — or an object with a `tasks` array — its /api/v1
// submission body. Each entry names a treatment and supplies `fields`, the
// values for that treatment's `${field}` placeholders:
//
//   [{ "callerTaskId": "clip-01", "treatment": "review",
//      "fields": { "clipUrl": "asset://…", "clipStartAt": 15.82 },
//      "targetReplications": 1, "metadata": {} }]
//
// Only `treatment` and `fields` affect the preview. `callerTaskId` identifies
// the entry; deployment-only keys (`targetReplications`, `exportPath`,
// `metadata`, a template's `_comment`) are ignored and never become bindings.
// Field values keep their JSON types: 15.82 binds a number, "15.82" a string.

/** One entry from a task parameter file. */
export interface TaskParameterEntry {
  /**
   * Stable identity for selecting the entry across reloads of the file:
   * `id:<callerTaskId>`, or `entry:<n>` (1-based position) when the entry
   * has no usable callerTaskId.
   */
  key: string;
  /** The callerTaskId, or "Entry <n>". */
  label: string;
  /** 0-based position in the file. */
  index: number;
  /** The treatment the entry names, when it's a string. */
  treatment?: string;
  /** The entry's `fields`, values as parsed, when it's an object. */
  fields?: Record<string, unknown>;
  /** What's wrong with the entry's shape. An entry with any can't be previewed. */
  problems: string[];
}

export type ParsedTaskParameters =
  | { ok: true; entries: TaskParameterEntry[] }
  | { ok: false; error: string };

const SHAPE_ERROR =
  'Expected a JSON array of task entries (an Annotator task file) or an object with a "tasks" array (an Annotator API submission).';

/** Parse a task parameter file. Never throws. */
export function parseTaskParameters(text: string): ParsedTaskParameters {
  // Editors on Windows may save JSON with a byte-order mark, which
  // JSON.parse rejects.
  const source = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  let json: unknown;
  try {
    json = JSON.parse(source);
  } catch (err) {
    return {
      ok: false,
      error: `Invalid JSON: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  const items = Array.isArray(json)
    ? json
    : isObject(json) && Array.isArray(json.tasks)
      ? (json.tasks as unknown[])
      : null;
  if (items === null) return { ok: false, error: SHAPE_ERROR };
  if (items.length === 0) {
    return { ok: false, error: "The file has no task entries." };
  }

  // Where each callerTaskId is used. A repeated one is flagged on every use,
  // so which copy "wins" never depends on the order of entries.
  const usesOfId = new Map<string, number[]>();
  items.forEach((item, index) => {
    if (isObject(item) && typeof item.callerTaskId === "string") {
      usesOfId.set(item.callerTaskId, [
        ...(usesOfId.get(item.callerTaskId) ?? []),
        index + 1,
      ]);
    }
  });

  const entries = items.map((item, index): TaskParameterEntry => {
    const position = `Entry ${index + 1}`;
    if (!isObject(item)) {
      return {
        key: `entry:${index + 1}`,
        label: position,
        index,
        problems: ["The entry must be a JSON object."],
      };
    }

    const problems: string[] = [];
    let callerTaskId: string | undefined;
    if (item.callerTaskId !== undefined) {
      if (typeof item.callerTaskId !== "string" || item.callerTaskId === "") {
        problems.push('"callerTaskId" must be a non-empty string.');
      } else if (usesOfId.get(item.callerTaskId)!.length > 1) {
        const uses = usesOfId.get(item.callerTaskId)!;
        problems.push(
          `Duplicate callerTaskId "${item.callerTaskId}" (entries ${uses.slice(0, -1).join(", ")} and ${uses[uses.length - 1]}).`,
        );
      } else {
        callerTaskId = item.callerTaskId;
      }
    }

    const treatment =
      typeof item.treatment === "string" && item.treatment !== ""
        ? item.treatment
        : undefined;
    if (treatment === undefined) {
      problems.push(
        'Missing "treatment" (the name of a treatment in this workflow).',
      );
    }

    let fields: Record<string, unknown> | undefined;
    if (item.fields === undefined) {
      problems.push(
        'Missing "fields" (an object mapping each field name to its value).',
      );
    } else if (isObject(item.fields)) {
      fields = item.fields;
    } else {
      problems.push(
        '"fields" must be an object mapping each field name to its value.',
      );
    }

    return {
      key:
        callerTaskId === undefined
          ? `entry:${index + 1}`
          : `id:${callerTaskId}`,
      label: callerTaskId ?? position,
      index,
      treatment,
      fields,
      problems,
    };
  });

  return { ok: true, entries };
}

/** The label of the entry a key selects, for when that entry is gone. */
export function describeTaskParameterKey(key: string): string {
  if (key.startsWith("id:")) return key.slice("id:".length);
  if (key.startsWith("entry:")) return `Entry ${key.slice("entry:".length)}`;
  return key;
}

export type TaskParameterResolution =
  | {
      ok: true;
      /**
       * The workflow with templates expanded and `treatments` narrowed to the
       * entry's treatment; its `${field}` placeholders are still unfilled.
       */
      treatmentFile: TreatmentFileType;
      /** The bindings to fill it with: host fields, overlaid by the entry's. */
      fields: Record<string, unknown>;
      /** Problems that don't block the preview. */
      warnings: string[];
    }
  | { ok: false; errors: string[] };

/**
 * Pick out the entry's treatment and check its fields against it, the way
 * Annotator does on upload: the treatment must exist, and the entry must
 * supply every `${field}` the treatment uses. A field the treatment doesn't
 * use is only a warning here (Annotator rejects it) and isn't bound.
 *
 * Narrowing matters because treatments in one workflow can use different
 * fields; binding a task's fields to the whole file would leave the other
 * treatments' placeholders unresolved. Intro sequences are kept as they are —
 * tasks don't bind into them.
 *
 * `hostFields` are bindings the host already supplies (PreviewHost's
 * `additionalFields`); they count as provided.
 */
export function resolveTaskParameterEntry(
  treatmentFile: TreatmentFileType,
  entry: TaskParameterEntry,
  hostFields?: Record<string, unknown>,
): TaskParameterResolution {
  if (entry.problems.length > 0) return { ok: false, errors: entry.problems };
  // Unreachable with no problems; narrows the optional properties.
  if (entry.treatment === undefined || entry.fields === undefined) {
    return { ok: false, errors: ["The entry is incomplete."] };
  }

  let expanded: TreatmentFileType;
  try {
    expanded = expandTreatmentFile(treatmentFile).result;
  } catch (err) {
    return {
      ok: false,
      errors: [err instanceof Error ? err.message : String(err)],
    };
  }

  // The raw schema types `treatments` as `any` (it accepts template
  // invocations); after expansion each is a concrete treatment object.
  const treatments = (expanded.treatments ?? []) as Record<string, unknown>[];
  const treatment = treatments.find((t) => t.name === entry.treatment);
  if (treatment === undefined) {
    const names = treatments
      .map((t) => t.name)
      .filter((name): name is string => typeof name === "string");
    return {
      ok: false,
      errors: [
        names.length > 0
          ? `Treatment "${entry.treatment}" isn't defined in this workflow. Treatments: ${names.join(", ")}.`
          : `Treatment "${entry.treatment}" isn't defined in this workflow, which has no treatments.`,
      ],
    };
  }

  const used = getUnresolvedFields({ obj: treatment, templates: [] });
  const usedSet = new Set(used);
  const errors = used
    .filter(
      // Own keys only: `${constructor}` isn't supplied by an inherited method.
      (field) =>
        !Object.hasOwn(entry.fields!, field) &&
        !Object.hasOwn(hostFields ?? {}, field),
    )
    .sort()
    .map(
      (field) =>
        `Missing field "${field}", used by treatment "${entry.treatment}".`,
    );
  if (errors.length > 0) return { ok: false, errors };

  // Null prototype, so a `__proto__` field from the file is just a field.
  const fields: Record<string, unknown> = Object.assign(
    Object.create(null) as Record<string, unknown>,
    hostFields,
  );
  const warnings: string[] = [];
  for (const [field, value] of Object.entries(entry.fields)) {
    if (usedSet.has(field)) {
      fields[field] = value;
    } else {
      warnings.push(
        `Field "${field}" isn't used by treatment "${entry.treatment}" (Annotator rejects unused fields).`,
      );
    }
  }

  return {
    ok: true,
    treatmentFile: { ...expanded, treatments: [treatment] },
    fields,
    warnings,
  };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
