import { describe, it, expect } from "vitest";
import { collectMissingImageAltText } from "./imageAltText.js";
import { validateTreatmentSource } from "../validate/validateTreatment.js";
import { safeParseTreatmentFile } from "./safeParseTreatmentFile.js";

describe("collectMissingImageAltText", () => {
  it("returns nothing for empty/invalid input", () => {
    expect(collectMissingImageAltText(undefined)).toEqual([]);
    expect(collectMissingImageAltText(null)).toEqual([]);
    expect(collectMissingImageAltText("not an object")).toEqual([]);
    expect(collectMissingImageAltText({})).toEqual([]);
  });

  it("warns when an image element has no altText key", () => {
    const data = {
      treatments: [
        {
          name: "t1",
          gameStages: [
            {
              name: "s1",
              elements: [{ type: "image", file: "shared/diagram.png" }],
            },
          ],
        },
      ],
    };
    const issues = collectMissingImageAltText(data);
    expect(issues).toHaveLength(1);
    expect(issues[0].path).toEqual([
      "treatments",
      0,
      "gameStages",
      0,
      "elements",
      0,
    ]);
    expect(issues[0].message).toMatch(/altText/);
  });

  it("does NOT warn when altText is a non-empty string", () => {
    const data = {
      treatments: [
        {
          name: "t1",
          gameStages: [
            {
              name: "s1",
              elements: [
                {
                  type: "image",
                  file: "shared/diagram.png",
                  altText: "Bar chart: 2020 vs 2024 turnout",
                },
              ],
            },
          ],
        },
      ],
    };
    expect(collectMissingImageAltText(data)).toEqual([]);
  });

  it("does NOT warn when altText is an explicit empty string (decorative)", () => {
    const data = {
      treatments: [
        {
          name: "t1",
          gameStages: [
            {
              name: "s1",
              elements: [
                { type: "image", file: "shared/divider.png", altText: "" },
              ],
            },
          ],
        },
      ],
    };
    expect(collectMissingImageAltText(data)).toEqual([]);
  });

  it("ignores non-image elements", () => {
    const data = {
      treatments: [
        {
          name: "t1",
          gameStages: [
            {
              name: "s1",
              elements: [
                { type: "prompt", file: "q.prompt.md", name: "q" },
                { type: "submitButton" },
              ],
            },
          ],
        },
      ],
    };
    expect(collectMissingImageAltText(data)).toEqual([]);
  });

  it("scans exit sequences, intro sequences, and consent arms", () => {
    const data = {
      introSequences: [
        {
          name: "i1",
          introSteps: [
            { name: "s", elements: [{ type: "image", file: "a.png" }] },
          ],
        },
      ],
      consent: [
        {
          name: "c1",
          steps: [{ name: "s", elements: [{ type: "image", file: "b.png" }] }],
        },
      ],
      treatments: [
        {
          name: "t1",
          gameStages: [],
          exitSequence: [
            { name: "s", elements: [{ type: "image", file: "c.png" }] },
          ],
        },
      ],
    };
    const issues = collectMissingImageAltText(data);
    expect(issues).toHaveLength(3);
    expect(issues.map((i) => i.path[0])).toEqual(
      expect.arrayContaining(["introSequences", "consent", "treatments"]),
    );
  });
});

describe("missing altText is a WARNING, never a schema failure", () => {
  const src = `
treatments:
  - name: t
    playerCount: 1
    compatibleIntroSequences: []
    gameStages:
      - name: s1
        duration: 60
        elements:
          - type: image
            file: shared/diagram.png
          - type: submitButton
`;

  it("safeParseTreatmentFile SUCCEEDS for a treatment whose image lacks altText", () => {
    // The load-bearing regression guard: the lint lives OUTSIDE the schema, so
    // it never flips `safeParse` to `success: false`. Consumers that gate on
    // that boolean (VS Code preview via parseTreatmentSource, the viewer example
    // catalog, external manager/runner/annotator) keep working on a common,
    // harmless input — an un-annotated image.
    const parsed = safeParseTreatmentFile({
      treatments: [
        {
          name: "t",
          playerCount: 1,
          compatibleIntroSequences: [],
          gameStages: [
            {
              name: "s1",
              duration: 60,
              elements: [
                { type: "image", file: "shared/diagram.png" },
                { type: "submitButton" },
              ],
            },
          ],
        },
      ],
    });
    expect(parsed.success).toBe(true);
  });

  it("validateTreatmentSource surfaces it as a WARNING (the shared CLI / expanded-preview chokepoint)", () => {
    const { diagnostics } = validateTreatmentSource(src);
    expect(diagnostics.some((d) => d.severity === "error")).toBe(false);
    const warn = diagnostics.find((d) => /altText/i.test(d.message));
    expect(warn).toBeDefined();
    expect(warn?.severity).toBe("warning");
  });

  it("validateTreatmentSource is silent when the image is explicitly decorative", () => {
    const decorative = src.replace(
      "            file: shared/diagram.png",
      '            file: shared/diagram.png\n            altText: ""',
    );
    const { diagnostics } = validateTreatmentSource(decorative);
    expect(diagnostics.find((d) => /altText/i.test(d.message))).toBeUndefined();
  });
});
