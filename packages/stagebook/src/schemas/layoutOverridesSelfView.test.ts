import { describe, expect, it } from "vitest";
import { stringify } from "yaml";
import { collectLayoutOverridesSelfView } from "./layoutOverridesSelfView.js";
import { safeParseTreatmentFile } from "./safeParseTreatmentFile.js";
import { validateTreatmentSource } from "../validate/validateTreatment.js";
import { validateTreatmentWithDiff } from "../validate/validateTreatmentDiff.js";
import { expandAndValidate } from "../validate/expandAndValidate.js";

const seatLayout = {
  grid: { rows: 1, cols: 1 },
  feeds: [{ source: { type: "self" }, displayRegion: { rows: 0, cols: 0 } }],
};
const layout = { "0": seatLayout, "1": seatLayout };
const discussion = { chatType: "video", showNickname: true, showTitle: false };

function fileWith(options: Record<string, unknown>) {
  return {
    treatments: [
      {
        name: "study",
        playerCount: 3,
        compatibleIntroSequences: [],
        gameStages: [
          {
            name: "conversation",
            duration: 60,
            elements: [{ type: "submitButton" }],
            discussion: { ...discussion, ...options },
          },
        ],
      },
    ],
  };
}

describe("layout overrides explicitly authored showSelfView (#794)", () => {
  it.each([true, false])("warns once for showSelfView: %s", (showSelfView) => {
    const data = fileWith({ showSelfView, layout });
    expect(safeParseTreatmentFile(data).success).toBe(true);
    const issues = collectLayoutOverridesSelfView(data);
    expect(issues).toHaveLength(1);
    expect(issues[0].path).toEqual([
      "treatments",
      0,
      "gameStages",
      0,
      "discussion",
      "showSelfView",
    ]);
    expect(issues[0].message).toContain("seats 0, 1");
    expect(issues[0].message).toContain('`source: { type: "self" }`');
    expect(issues[0].message).toContain(
      "`showSelfView` still applies to seats with no layout entry",
    );
  });

  it.each([
    {},
    { layout },
    { showSelfView: false },
    { chatType: "text", showSelfView: true, layout },
    { chatType: "audio", showSelfView: true, layout },
    { showSelfView: null, layout },
    { showSelfView: true, layout: null },
    { showSelfView: true, layout: [] },
  ])("stays silent for %j", (options) => {
    expect(collectLayoutOverridesSelfView(fileWith(options))).toEqual([]);
  });

  it.each([undefined, null, "invalid", [], {}, { treatments: [null, {}] }])(
    "tolerates malformed input %j",
    (data) => expect(collectLayoutOverridesSelfView(data)).toEqual([]),
  );

  it("describes an empty layout without inventing seat numbers", () => {
    const data = fileWith({ showSelfView: false, layout: {} });
    expect(safeParseTreatmentFile(data).success).toBe(true);
    expect(collectLayoutOverridesSelfView(data)[0].message).toContain(
      "no seats",
    );
  });

  const validators = [
    ["source", (source: string) => validateTreatmentSource(source)],
    [
      "editor",
      (source: string) =>
        validateTreatmentWithDiff({
          source,
          loadImport: () => Promise.reject(new Error("Unexpected import")),
        }),
    ],
    ["expanded", (source: string) => expandAndValidate(source)],
  ] as const;

  describe.each(validators)("%s validation", (_name, validate) => {
    it.each([true, false])(
      "anchors a single warning on showSelfView: %s",
      async (showSelfView) => {
        const source = stringify(fileWith({ showSelfView, layout }));
        const { diagnostics } = await validate(source);
        expect(diagnostics).toHaveLength(1);
        expect(diagnostics[0].message).toContain(
          "`layout` overrides `showSelfView`",
        );
        expect(diagnostics[0]).toMatchObject({
          severity: "warning",
          range: {
            startLine: source
              .split("\n")
              .findIndex((line) => line.includes("showSelfView:")),
          },
        });
      },
    );

    it("does not warn about the default inserted by Zod", async () => {
      const { diagnostics } = await validate(stringify(fileWith({ layout })));
      expect(diagnostics).toEqual([]);
    });
  });

  it.each([true, false, undefined])(
    "checks template discussions only after expansion (showSelfView: %s)",
    async (showSelfView) => {
      const data = fileWith({
        layout,
        ...(showSelfView === undefined ? {} : { showSelfView }),
      });
      const stage = data.treatments[0].gameStages[0];
      const source = stringify({
        templates: [{ name: "call", contentType: "stage", content: stage }],
        treatments: [
          { ...data.treatments[0], gameStages: [{ template: "call" }] },
        ],
      });
      expect(validateTreatmentSource(source).diagnostics).toEqual([]);
      const editor = await validateTreatmentWithDiff({
        source,
        loadImport: () => Promise.reject(new Error("Unexpected import")),
      });
      expect(editor.diagnostics).toEqual([]);
      const expanded = expandAndValidate(source);
      expect(expanded.expandError).toBeNull();
      expect(expanded.diagnostics).toHaveLength(
        showSelfView === undefined ? 0 : 1,
      );
      if (showSelfView !== undefined) {
        expect(expanded.diagnostics[0]).toMatchObject({
          severity: "warning",
          range: {
            startLine: expanded.fullYaml
              .split("\n")
              .findIndex((line) => line.includes("showSelfView:")),
          },
        });
      }
    },
  );
});
