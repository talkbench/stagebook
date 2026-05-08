/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-explicit-any */

import { templateContextSchema } from "../schemas/treatment.js";

function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Matches ${...} placeholders. Only alphanumeric + underscore allowed in field names.
// Shared pattern — must match fieldPlaceholderRegex in schemas/treatment.ts
const FIELD_PLACEHOLDER_REGEX = /\$\{([a-zA-Z0-9_]+)\}/g;

export function substituteFields({
  content,
  fields,
}: {
  content: any;
  fields: Record<string, any>;
}): any {
  let expandedTemplate = JSON.parse(JSON.stringify(content));

  for (const [key, value] of Object.entries(fields)) {
    // Skip undefined values — they can't be JSON-serialized and would
    // produce invalid JSON if substituted. Null is valid JSON.
    if (value === undefined) continue;

    let stringifiedTemplate = JSON.stringify(expandedTemplate);
    const stringifiedValue = JSON.stringify(value);

    // replace all instances of `"${key}"` with serialized value
    // this handles objects and arrays, etc.
    const escapedKey = escapeRegExp(key);
    const objectReplacementRegex = new RegExp(`"\\$\\{${escapedKey}\\}"`, "g");
    stringifiedTemplate = stringifiedTemplate.replace(
      objectReplacementRegex,
      stringifiedValue,
    );

    // For scalars (string / number / boolean), also replace `${key}`
    // when it's embedded inside a longer string — e.g.
    // `round_${roundN}_choice` with `roundN: 1` → `round_1_choice`.
    // The earlier whole-value `"${key}"` regex already handles standalone
    // placeholders (and arrays/objects, which can't be string-embedded).
    if (
      typeof value === "string" ||
      typeof value === "number" ||
      typeof value === "boolean"
    ) {
      const stringReplacementRegex = new RegExp(`\\$\\{${escapedKey}\\}`, "g");
      stringifiedTemplate = stringifiedTemplate.replace(
        stringReplacementRegex,
        String(value),
      );
    }

    expandedTemplate = JSON.parse(stringifiedTemplate);
  }
  return expandedTemplate;
}

export function expandTemplate({
  templates,
  context,
}: {
  templates: any[];
  context: any;
}): any {
  // Step 1: Fill in any templates within the context itself
  const newContext = JSON.parse(JSON.stringify(context));
  if (newContext.fields) {
    newContext.fields = recursivelyFillTemplates({
      obj: newContext.fields,
      templates,
    });
  }
  if (newContext.broadcast) {
    newContext.broadcast = recursivelyFillTemplates({
      obj: newContext.broadcast,
      templates,
    });
  }

  // Find the matching template
  const template = templates.find((t: any) => t.name === newContext.template);
  if (!template) {
    throw new Error(`Template "${newContext.template}" not found`);
  }

  let expandedTemplate = JSON.parse(JSON.stringify(template.content));

  // Step 3: Apply given fields if any
  if (newContext.fields) {
    expandedTemplate = substituteFields({
      content: expandedTemplate,
      fields: newContext.fields,
    });
  }

  // Step 4: Handle broadcast fields if any
  function flattenBroadcast(
    dimensions: Record<string, any[]>,
  ): Record<string, any>[] {
    const dimensionIndices = Object.keys(dimensions);
    const dimensionNumbers = dimensionIndices.map((i) => parseInt(i.slice(1)));
    const lowestDimension = Math.min(...dimensionNumbers);

    const currentDimension = dimensions[`d${lowestDimension}`];
    const remainingDimensions = JSON.parse(JSON.stringify(dimensions));
    delete remainingDimensions[`d${lowestDimension}`];

    let partialFields: Record<string, any>[] = [{}];
    if (Object.keys(remainingDimensions).length > 0) {
      partialFields = flattenBroadcast(remainingDimensions);
    }

    const flatFields: Record<string, any>[] = [];
    for (const [index, entry] of currentDimension.entries()) {
      for (const partialField of partialFields) {
        const newField = { ...entry, ...partialField };
        newField[`d${lowestDimension}`] = `${index}`;
        flatFields.push(newField);
      }
    }
    return flatFields;
  }

  if (newContext.broadcast) {
    const broadcastFieldsArray = flattenBroadcast(newContext.broadcast);
    const returnObjects: any[] = [];
    for (const broadcastFields of broadcastFieldsArray) {
      const newObj = substituteFields({
        content: expandedTemplate,
        fields: broadcastFields,
      });
      if (Array.isArray(newObj)) {
        returnObjects.push(...newObj);
      } else if (typeof newObj === "object") {
        returnObjects.push(newObj);
      } else {
        throw new Error("Unexpected type in broadcast fields");
      }
    }
    return returnObjects;
  }

  return expandedTemplate;
}

const MAX_TEMPLATE_DEPTH = 100;

export function recursivelyFillTemplates({
  obj,
  templates,
  depth = 0,
  templateChain = [],
}: {
  obj: any;
  templates: any[];
  depth?: number;
  templateChain?: string[];
}): any {
  if (depth > MAX_TEMPLATE_DEPTH) {
    const chain =
      templateChain.length > 0
        ? ` Template chain: ${templateChain.slice(-10).join(" → ")}`
        : "";
    throw new Error(
      `Maximum template nesting depth (${MAX_TEMPLATE_DEPTH}) exceeded.${chain} Check for circular template references in your treatment file.`,
    );
  }
  let newObj: any;
  try {
    newObj = JSON.parse(JSON.stringify(obj));
  } catch (e) {
    console.log("Error parsing", obj);
    throw e;
  }

  if (!Array.isArray(newObj) && typeof newObj === "object") {
    if (newObj && newObj.template) {
      const templateName = newObj.template as string;
      const context = templateContextSchema.parse(newObj);
      newObj = expandTemplate({ templates, context });
      newObj = recursivelyFillTemplates({
        obj: newObj,
        templates,
        depth: depth + 1,
        templateChain: [...templateChain, templateName],
      });
    } else {
      for (const key in newObj) {
        if (newObj[key] == null) {
          console.log(`key ${key} is undefined in`, newObj);
        }
        newObj[key] = recursivelyFillTemplates({
          obj: newObj[key],
          templates,
          depth: depth + 1,
          templateChain,
        });
      }
    }
  } else if (Array.isArray(newObj)) {
    for (const [index, item] of newObj.entries()) {
      if (item.template) {
        const context = templateContextSchema.parse(item);
        const expandedItem = expandTemplate({ templates, context });
        if (Array.isArray(expandedItem)) {
          newObj.splice(index, 1, ...expandedItem);
        } else if (typeof expandedItem === "object") {
          newObj[index] = expandedItem;
        } else {
          throw new Error("Unexpected type in expanded item");
        }
      } else {
        newObj[index] = recursivelyFillTemplates({
          obj: item,
          templates,
          depth: depth + 1,
          templateChain,
        });
      }
    }
  }

  return newObj;
}

/**
 * Expand all template references and substitute field placeholders.
 *
 * Returns `{ result, unresolvedFields }`:
 * - `result` — the expanded object with all resolvable templates and fields substituted
 * - `unresolvedFields` — names of any `${...}` placeholders that remain after expansion
 *
 * By default, throws if any placeholders remain unresolved. Set `allowUnresolved: true`
 * to get the partially-expanded result instead — useful for two-pass expansion where
 * platform-provided fields are filled in a second call.
 *
 * @example
 * // One-pass: expand everything, throw if anything is missing
 * const { result } = fillTemplates({ obj, templates });
 *
 * @example
 * // Two-pass: expand researcher templates first, fill platform fields second
 * const { result: expanded, unresolvedFields } = fillTemplates({
 *   obj: rawTreatmentFile,
 *   templates: rawTreatmentFile.templates ?? [],
 *   allowUnresolved: true,
 * });
 * // unresolvedFields = ["clipUrl", "clipStartAt", "clipStopAt"]
 *
 * const { result: resolved } = fillTemplates({
 *   obj: expanded,
 *   templates: [],
 *   additionalFields: { clipUrl: "clip1.mp4", clipStartAt: 12.5, clipStopAt: 45.0 },
 * });
 */
export function fillTemplates({
  obj,
  templates,
  additionalFields,
  allowUnresolved = false,
}: {
  obj: any;
  templates: any[];
  additionalFields?: Record<string, any>;
  allowUnresolved?: boolean;
}): { result: any; unresolvedFields: string[] } {
  // Strip `templates:` from the walked object so the recursive walker
  // doesn't try to expand inner template invocations *inside the
  // template definitions* (#304). Definitions are a lookup table, not
  // walkable content — they're accessed on demand by `expandTemplate`,
  // which applies field/broadcast substitution first. Walking them
  // eagerly tries to resolve placeholders (e.g. `template: ${arm}_pre`)
  // before any call site has had a chance to fill them, and trips on
  // both unresolved field names AND parameterized template names.
  // The result intentionally drops `templates:` — the post-fill output
  // is a runtime shape and definitions don't belong in it.
  let walkObj = obj;
  if (
    obj &&
    typeof obj === "object" &&
    !Array.isArray(obj) &&
    "templates" in obj
  ) {
    walkObj = { ...(obj as Record<string, unknown>) };
    delete (walkObj as Record<string, unknown>).templates;
  }

  let newObj = recursivelyFillTemplates({ obj: walkObj, templates });

  // Re-run the walker until no `"template":` strings remain. Compare
  // the serialized object between iterations so a pass that doesn't
  // change anything (e.g. a parameterized template name that never
  // resolves) breaks out instead of looping forever. Counting matches
  // would be wrong: the array branch of `recursivelyFillTemplates`
  // expands an invocation in place but doesn't recurse into the
  // result, so a chained `{template:"A"} → {template:"B"}` expansion
  // leaves the count unchanged across passes even though real
  // progress was made.
  let prevSerialized: string | null = null;
  let currSerialized = JSON.stringify(newObj);
  while (
    currSerialized.includes('"template":') &&
    currSerialized !== prevSerialized
  ) {
    newObj = recursivelyFillTemplates({ obj: newObj, templates });
    prevSerialized = currSerialized;
    currSerialized = JSON.stringify(newObj);
  }
  if (currSerialized.includes('"template":')) {
    throw new Error(
      'fillTemplates: unresolved template invocation remains after expansion. This usually means a parameterized template name (`template: "${...}"`) that no field/broadcast resolves. Move the parameterized invocation into the slot where it\'s used (e.g. into a `broadcast:` dimension) instead of nesting it inside `fields:`.',
    );
  }

  // Apply platform-provided fields after template expansion
  if (additionalFields && Object.keys(additionalFields).length > 0) {
    newObj = substituteFields({
      content: newObj,
      fields: additionalFields,
    });
  }

  // Collect any remaining unresolved field names
  const matches = JSON.stringify(newObj).matchAll(
    new RegExp(FIELD_PLACEHOLDER_REGEX.source, "g"),
  );
  const unresolvedSet = new Set<string>();
  for (const match of matches) {
    unresolvedSet.add(match[1]);
  }
  const unresolvedFields = [...unresolvedSet];

  if (!allowUnresolved && unresolvedFields.length > 0) {
    throw new Error(
      `Missing fields: ${unresolvedFields.map((f) => `\${${f}}`).join(", ")}`,
    );
  }

  return { result: newObj, unresolvedFields };
}

/**
 * Calculate the number of treatments that {@link fillTemplates} would produce
 * from the given object, without actually performing the expansion.
 *
 * For a template context with broadcast dimensions, this returns the cartesian
 * product of the dimension sizes. For an array of template contexts, it sums
 * the sizes. For anything else it returns 1.
 *
 * Broadcast dimensions that are themselves template references are resolved
 * (cheaply — only the dimension arrays, not the full template content) so
 * their lengths can be counted.
 *
 * @example
 * const size = computeBroadcastSize({
 *   obj: {
 *     template: "rating",
 *     broadcast: {
 *       d0: [{ A: "A0" }, { A: "A1" }],
 *       d1: [{ B: "B0" }, { B: "B1" }, { B: "B2" }],
 *     },
 *   },
 *   templates,
 * });
 * // size === 6
 */
export function computeBroadcastSize({
  obj,
  templates,
}: {
  obj: any;
  templates: any[];
}): number {
  if (Array.isArray(obj)) {
    let total = 0;
    for (const item of obj) {
      total += computeBroadcastSize({ obj: item, templates });
    }
    return total;
  }

  if (obj && typeof obj === "object" && "template" in obj) {
    if (!obj.broadcast) return 1;

    // Resolve any template references inside broadcast dimensions
    const resolvedBroadcast = recursivelyFillTemplates({
      obj: obj.broadcast,
      templates,
    });

    let size = 1;
    for (const key of Object.keys(resolvedBroadcast)) {
      const dimension = resolvedBroadcast[key];
      if (!Array.isArray(dimension)) {
        throw new Error(
          `Broadcast dimension "${key}" resolved to ${typeof dimension}, expected an array`,
        );
      }
      size *= dimension.length;
    }
    return size;
  }

  return 1;
}

/**
 * Expand researcher-defined templates and return the set of placeholder
 * names that remain unresolved. Useful for platforms to discover which
 * additionalFields a treatment file expects.
 *
 * Does NOT throw on unresolved fields — that's the point.
 *
 * @deprecated Use `fillTemplates({ ..., allowUnresolved: true })` instead,
 * which returns both the expanded result and unresolved field names.
 */
export function getUnresolvedFields({
  obj,
  templates,
}: {
  obj: any;
  templates: any[];
}): string[] {
  const { unresolvedFields } = fillTemplates({
    obj,
    templates,
    allowUnresolved: true,
  });
  return unresolvedFields;
}
