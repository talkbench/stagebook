import { describe, it, expect } from "vitest";
import { findUnreachableReferences } from "./findUnreachableReferences.js";

/**
 * Strict per-treatment reachable-keys check, applied to a hydrated
 * treatment file (templates expanded into their invocation sites).
 *
 * The check covers what the schema's existing `validateReferences`
 * silently passes via the `globalProducedKeys` fallthrough:
 *
 *   - Cross-treatment leaks (producer in another treatment)
 *   - Producer in a template that this treatment doesn't invoke
 *   - Producer in a template that another treatment invokes
 *
 * All three look the same at runtime — the consumer's participant
 * never traverses the producer — and all three produce the same
 * diagnostic class ("not reachable from this treatment"). Three
 * sub-cases collapsed into one message; users don't need a
 * prescriptive hint to find the bug.
 *
 * Caveat: only sound on the HYDRATED form, where each treatment's
 * `producedAt` is complete. Running on raw source would false-
 * positive on legitimate template-injected references.
 */

describe("findUnreachableReferences", () => {
  describe("happy path", () => {
    it("returns no issues when every reference resolves within its treatment", () => {
      const hydrated = {
        introSequences: [
          {
            name: "i",
            introSteps: [
              {
                name: "s",
                elements: [
                  { type: "prompt", file: "intro.prompt.md", name: "consent" },
                  { type: "submitButton" },
                ],
              },
            ],
          },
        ],
        treatments: [
          {
            name: "t",
            playerCount: 1,
            gameStages: [
              {
                name: "g",
                duration: 10,
                elements: [
                  {
                    type: "display",
                    reference: "self.prompt.consent",
                  },
                  { type: "submitButton" },
                ],
              },
            ],
          },
        ],
      };
      expect(findUnreachableReferences(hydrated)).toEqual([]);
    });
  });

  describe("cross-treatment leaks", () => {
    it("flags a reference produced only by another treatment", () => {
      const hydrated = {
        introSequences: [
          {
            name: "i",
            introSteps: [
              {
                name: "s",
                elements: [{ type: "submitButton" }],
              },
            ],
          },
        ],
        treatments: [
          {
            name: "A",
            playerCount: 1,
            gameStages: [
              {
                name: "g",
                duration: 10,
                elements: [
                  {
                    type: "display",
                    reference: "self.prompt.bOnly",
                  },
                  { type: "submitButton" },
                ],
              },
            ],
          },
          {
            name: "B",
            playerCount: 1,
            gameStages: [
              {
                name: "g",
                duration: 10,
                elements: [
                  {
                    type: "prompt",
                    name: "bOnly",
                    file: "b.prompt.md",
                  },
                  { type: "submitButton" },
                ],
              },
            ],
          },
        ],
      };
      const issues = findUnreachableReferences(hydrated);
      // Treatment A's reference is unreachable; Treatment B doesn't
      // reference anything from outside, so no leak there.
      expect(issues).toHaveLength(1);
      expect(issues[0].message).toContain("prompt.bOnly");
      expect(issues[0].path[0]).toBe("treatments");
      expect(issues[0].path[1]).toBe(0); // treatment A
    });
  });

  describe("self-reachable cases that must not fire", () => {
    it("does not flag a reference to a producer in the same treatment's earlier stage", () => {
      // Same treatment, earlier stage → reachable. The forward-ref
      // rank check is the schema's job; the strict check just
      // requires the producer to be in the reachable set.
      const hydrated = {
        introSequences: [
          {
            name: "i",
            introSteps: [{ name: "s", elements: [{ type: "submitButton" }] }],
          },
        ],
        treatments: [
          {
            name: "t",
            playerCount: 1,
            gameStages: [
              {
                name: "stage1",
                duration: 10,
                elements: [
                  {
                    type: "prompt",
                    name: "earlyAnswer",
                    file: "q.prompt.md",
                  },
                  { type: "submitButton" },
                ],
              },
              {
                name: "stage2",
                duration: 10,
                elements: [
                  {
                    type: "display",
                    reference: "self.prompt.earlyAnswer",
                  },
                  { type: "submitButton" },
                ],
              },
            ],
          },
        ],
      };
      expect(findUnreachableReferences(hydrated)).toEqual([]);
    });

    it("does not flag a reference to an intro-step producer", () => {
      const hydrated = {
        introSequences: [
          {
            name: "i",
            introSteps: [
              {
                name: "consent",
                elements: [
                  { type: "prompt", name: "consent", file: "c.prompt.md" },
                  { type: "submitButton" },
                ],
              },
            ],
          },
        ],
        treatments: [
          {
            name: "t",
            playerCount: 1,
            gameStages: [
              {
                name: "g",
                duration: 10,
                elements: [
                  { type: "display", reference: "self.prompt.consent" },
                  { type: "submitButton" },
                ],
              },
            ],
          },
        ],
      };
      expect(findUnreachableReferences(hydrated)).toEqual([]);
    });

    it("does not flag external references (entryUrl, participantInfo, etc.)", () => {
      const hydrated = {
        introSequences: [
          {
            name: "i",
            introSteps: [{ name: "s", elements: [{ type: "submitButton" }] }],
          },
        ],
        treatments: [
          {
            name: "t",
            playerCount: 1,
            gameStages: [
              {
                name: "g",
                duration: 10,
                elements: [
                  {
                    type: "display",
                    reference: "entryUrl.params.PROLIFIC_PID",
                  },
                  { type: "submitButton" },
                ],
              },
            ],
          },
        ],
      };
      expect(findUnreachableReferences(hydrated)).toEqual([]);
    });
  });

  describe("not duplicating the schema's typo check", () => {
    it("does NOT flag references that no producer exists for (schema already handles)", () => {
      // The schema's existing reference checker emits an
      // "unknown reference" error when the key isn't in
      // globalProducedKeys. We rely on the schema for that diagnostic
      // and only emit for references that ARE in globalProducedKeys
      // but not reachable from this treatment — avoids duplicates.
      const hydrated = {
        introSequences: [
          {
            name: "i",
            introSteps: [{ name: "s", elements: [{ type: "submitButton" }] }],
          },
        ],
        treatments: [
          {
            name: "t",
            playerCount: 1,
            gameStages: [
              {
                name: "g",
                duration: 10,
                elements: [
                  {
                    type: "display",
                    reference: "self.prompt.totallyMadeUp",
                  },
                  { type: "submitButton" },
                ],
              },
            ],
          },
        ],
      };
      expect(findUnreachableReferences(hydrated)).toEqual([]);
    });
  });

  describe("multiple treatments with separate scopes", () => {
    it("flags only the consumer treatment, not the producer treatment", () => {
      const hydrated = {
        introSequences: [
          {
            name: "i",
            introSteps: [{ name: "s", elements: [{ type: "submitButton" }] }],
          },
        ],
        treatments: [
          {
            name: "A",
            playerCount: 1,
            gameStages: [
              {
                name: "g",
                duration: 10,
                elements: [
                  { type: "display", reference: "self.prompt.bOnly" },
                  { type: "submitButton" },
                ],
              },
            ],
          },
          {
            name: "B",
            playerCount: 1,
            gameStages: [
              {
                name: "g",
                duration: 10,
                elements: [
                  { type: "display", reference: "self.prompt.aOnly" },
                  { type: "submitButton" },
                ],
              },
            ],
          },
          {
            name: "C",
            playerCount: 1,
            gameStages: [
              {
                name: "g",
                duration: 10,
                elements: [
                  { type: "prompt", name: "aOnly", file: "a.prompt.md" },
                  { type: "prompt", name: "bOnly", file: "b.prompt.md" },
                  { type: "submitButton" },
                ],
              },
            ],
          },
        ],
      };
      const issues = findUnreachableReferences(hydrated);
      // Both A's ref to bOnly and B's ref to aOnly are unreachable
      // — those keys are produced only in C.
      expect(issues).toHaveLength(2);
      const treatmentIndices = issues.map((i) => i.path[1]);
      expect(treatmentIndices).toContain(0); // A
      expect(treatmentIndices).toContain(1); // B
      expect(treatmentIndices).not.toContain(2); // C produces both
    });
  });

  describe("malformed input", () => {
    it("returns an empty array for non-object input", () => {
      expect(findUnreachableReferences(null)).toEqual([]);
      expect(findUnreachableReferences(undefined)).toEqual([]);
      expect(findUnreachableReferences("not an object")).toEqual([]);
      expect(findUnreachableReferences([])).toEqual([]);
    });

    it("returns an empty array for an empty treatment file", () => {
      expect(findUnreachableReferences({})).toEqual([]);
    });
  });
});
