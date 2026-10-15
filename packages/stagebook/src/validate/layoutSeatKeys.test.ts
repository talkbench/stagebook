import { describe, expect, it } from "vitest";
import { validateTreatmentSource } from "./validateTreatment.js";

const layoutDefinition =
  "{ grid: { rows: 1, cols: 1 }, feeds: [{ source: { type: self }, displayRegion: { rows: 0, cols: 0 } }] }";

function sourceWithLayoutKey(key: string): string {
  return `treatments:
  - name: pair
    playerCount: 2
    compatibleIntroSequences: []
    gameStages:
      - name: discuss
        duration: 60
        elements:
          - type: submitButton
        discussion:
          chatType: video
          showNickname: true
          showTitle: true
          layout:
            ${key}: ${layoutDefinition}
`;
}

describe("discussion layout seat-key diagnostics (#796)", () => {
  it.each(["", " ", "01", "+1", "-0", "1.0", "1e0", "0x1", " 1 "])(
    "rejects the quoted noncanonical key %j at its layout definition",
    (key) => {
      const source = sourceWithLayoutKey(JSON.stringify(key));
      const { diagnostics } = validateTreatmentSource(source);
      const line = source.split("\n")[14];

      expect(diagnostics).toContainEqual({
        severity: "error",
        message: expect.stringContaining(
          `treatments[0].gameStages[0].discussion.layout.${key}`,
        ),
        range: {
          startLine: 14,
          startCol: line.indexOf(layoutDefinition),
          endLine: 14,
          endCol: line.length,
        },
      });
    },
  );

  it("rejects a seat equal to playerCount at its layout definition", () => {
    const source = sourceWithLayoutKey('"2"');
    const { diagnostics } = validateTreatmentSource(source);
    const line = source.split("\n")[14];

    expect(diagnostics).toContainEqual({
      severity: "error",
      message: expect.stringContaining(
        "treatments[0].gameStages[0].discussion.layout.2",
      ),
      range: {
        startLine: 14,
        startCol: line.indexOf(layoutDefinition),
        endLine: 14,
        endCol: line.length,
      },
    });
  });

  it.each(["01", "0x1", "1.0", "+1"])(
    "accepts the unquoted YAML numeric key %s after parsing to seat 1",
    (key) => {
      const { diagnostics, parsedObj } = validateTreatmentSource(
        sourceWithLayoutKey(key),
      );

      expect(diagnostics).toEqual([]);
      expect(parsedObj).toMatchObject({
        treatments: [
          {
            gameStages: [
              { discussion: { layout: { "1": expect.any(Object) } } },
            ],
          },
        ],
      });
    },
  );
});
