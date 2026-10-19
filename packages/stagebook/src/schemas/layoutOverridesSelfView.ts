export interface LayoutOverridesSelfView {
  path: (string | number)[];
  message: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Warn when an authored video discussion sets both layout and showSelfView.
 * Read the authored object: Zod defaults showSelfView to true after parsing.
 * This stays outside superRefine so valid partial layouts never fail parsing.
 * Only concrete game stages can have discussions; template bodies are checked
 * once expanded, like the image-alt-text and YouTube-controls lints.
 */
export function collectLayoutOverridesSelfView(
  data: unknown,
): LayoutOverridesSelfView[] {
  const out: LayoutOverridesSelfView[] = [];
  if (!isRecord(data) || !Array.isArray(data.treatments)) return out;
  data.treatments.forEach((treatment, treatmentIndex) => {
    if (!isRecord(treatment) || !Array.isArray(treatment.gameStages)) return;
    treatment.gameStages.forEach((stage, stageIndex) => {
      if (!isRecord(stage) || !isRecord(stage.discussion)) return;
      const discussion = stage.discussion;
      if (
        discussion.chatType !== "video" ||
        typeof discussion.showSelfView !== "boolean" ||
        !isRecord(discussion.layout)
      )
        return;
      const seats = Object.keys(discussion.layout).sort(
        (a, b) => Number(a) - Number(b),
      );
      out.push({
        path: [
          "treatments",
          treatmentIndex,
          "gameStages",
          stageIndex,
          "discussion",
          "showSelfView",
        ],
        message:
          "`layout` overrides `showSelfView` for every seat it defines " +
          `(${seats.length ? `seats ${seats.join(", ")}` : "no seats"}): ` +
          "those seats show their own tile only if their `feeds` include " +
          '`source: { type: "self" }`. `showSelfView` still applies to seats ' +
          "with no layout entry.",
      });
    });
  });
  return out;
}
