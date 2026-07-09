import { fillTemplates } from "../../templates/index.js";
import type { TreatmentFileType } from "../../schemas/index.js";

/**
 * Expand templates in a parsed treatment file and detect unresolved fields.
 * Optionally provide additionalFields to resolve remaining placeholders.
 *
 * Lives in its own module so the viewer surface can expand templates
 * without pulling in js-yaml — that dependency belongs to the treatment-
 * YAML parser in the app shell, not to the published preview harness.
 */
export function expandTreatmentFile(
  treatmentFile: TreatmentFileType,
  additionalFields?: Record<string, unknown>,
): { result: TreatmentFileType; unresolvedFields: string[] } {
  // Strip template definitions before expansion — they contain
  // placeholder syntax that would be falsely flagged as unresolved.
  const { templates, ...withoutTemplates } = treatmentFile;
  // fillTemplates is a generic object walker (its `result` is `any`); receive
  // it as `unknown` and re-assert the treatment-file shape on return rather
  // than letting the `any` leak into this typed surface.
  const { result, unresolvedFields } = fillTemplates({
    obj: withoutTemplates,
    templates: templates ?? [],
    additionalFields,
    allowUnresolved: true,
  }) as { result: unknown; unresolvedFields: string[] };
  return { result: result as TreatmentFileType, unresolvedFields };
}
