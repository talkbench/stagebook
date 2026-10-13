import { describe, expect, it } from "vitest";
import { mediaPlayerRecordSchema } from "../schemas/mediaPlayerRecord.js";
import { collectUnknownHostReferenceFields } from "./hostReferenceFields.js";

const typo = "self.mediaPlayer.clip.firstplay";
const leaf = (reference: unknown) => ({ reference, comparator: "exists" });
const inStage = (stage: unknown) => ({
  treatments: [{ name: "test", gameStages: [stage] }],
});

describe("collectUnknownHostReferenceFields", () => {
  it("warns about firstplay and suggests the schema's firstPlay field", () => {
    expect(
      collectUnknownHostReferenceFields(inStage({ conditions: leaf(typo) })),
    ).toEqual([
      {
        path: ["treatments", 0, "gameStages", 0, "conditions", "reference"],
        message: expect.stringContaining("Did you mean 'firstPlay'?"),
      },
    ]);
  });

  it.each(Object.keys(mediaPlayerRecordSchema.shape))(
    "accepts declared top-level field %s",
    (field) => {
      expect(
        collectUnknownHostReferenceFields(
          inStage({ conditions: leaf(`self.mediaPlayer.clip.${field}`) }),
        ),
      ).toEqual([]);
    },
  );

  it.each([
    "self.mediaPlayer.clip",
    "self.mediaPlayer.clip.events.0.type",
    "self.mediaPlayer.clip.firstPlay.videoTime",
    "self.mediaPlayer.clip.firstPlay.futureNestedField",
    "self.mediaPlayer.clip.${milestone}",
    "self.trackedLink.clip.firstplay",
    "self.attributes.hostExtension",
  ])("leaves supported or out-of-scope reference %s quiet", (reference) => {
    expect(
      collectUnknownHostReferenceFields(
        inStage({ conditions: leaf(reference) }),
      ),
    ).toEqual([]);
  });

  it("normalizes structured references and points to the full reference", () => {
    const issues = collectUnknownHostReferenceFields(
      inStage({
        elements: [
          {
            type: "display",
            reference: {
              position: "0",
              source: "mediaPlayer",
              name: "clip",
              path: ["firstplay"],
            },
          },
        ],
      }),
    );
    expect(issues).toHaveLength(1);
    expect(issues[0].path).toEqual([
      "treatments",
      0,
      "gameStages",
      0,
      "elements",
      0,
      "reference",
    ]);
  });

  it("visits stage, element, discussion, display, and outgoing URL references", () => {
    const issues = collectUnknownHostReferenceFields(
      inStage({
        conditions: leaf(typo),
        discussion: { conditions: leaf(typo) },
        elements: [
          { type: "display", reference: typo, conditions: leaf(typo) },
          {
            type: "trackedLink",
            urlParams: [{ key: "played", reference: typo }],
          },
          {
            type: "qualtrics",
            urlParams: [{ key: "played", reference: typo }],
          },
        ],
      }),
    );
    expect(issues).toHaveLength(6);
    expect(new Set(issues.map(({ path }) => JSON.stringify(path))).size).toBe(
      6,
    );
  });

  it("visits consent, intro, game, exit, and group composition conditions", () => {
    const step = { conditions: leaf(typo) };
    const issues = collectUnknownHostReferenceFields({
      consent: [{ steps: [step] }],
      introSequences: [{ introSteps: [step] }],
      treatments: [
        {
          groupComposition: [{ conditions: leaf(typo) }],
          gameStages: [step],
          exitSequence: [step],
        },
      ],
      templates: [{ content: step }],
    });
    expect(issues).toHaveLength(5);
  });

  it("visits calculation and case operands but leaves literal payloads opaque", () => {
    const issues = collectUnknownHostReferenceFields(
      inStage({
        conditions: {
          allEqual: [
            {
              case: {
                rules: [
                  { when: leaf(typo), value: { length: { reference: typo } } },
                  { default: true, value: { literal: { reference: typo } } },
                ],
              },
            },
            { literal: { reference: typo } },
          ],
        },
      }),
    );
    expect(issues).toHaveLength(2);
  });

  it("lists known fields without an unrelated suggestion", () => {
    const issues = collectUnknownHostReferenceFields(
      inStage({
        conditions: leaf("self.mediaPlayer.clip.completelyUnrelatedField"),
      }),
    );
    expect(issues).toHaveLength(1);
    expect(issues[0].message).toContain("Valid fields:");
    expect(issues[0].message).toContain("firstPlay");
    expect(issues[0].message).not.toContain("Did you mean");
  });

  it.each([null, "bad", { treatments: [null, { gameStages: [null] }] }])(
    "is safe on malformed input %j",
    (input) => {
      expect(collectUnknownHostReferenceFields(input)).toEqual([]);
    },
  );
});
