import { describe, expect, test } from "vitest";

import { treatmentFileSchema } from "./treatment.js";
import { resolvedStageSchema, resolvedTreatmentSchema } from "./resolved.js";

/**
 * `notes` is researcher-facing metadata. It's valid in authoring schemas so
 * researchers can document rationale, citations, and design decisions inline
 * in their treatment YAML, but it MUST be stripped from the output when
 * parsed through the resolved schemas — that's the security boundary that
 * keeps notes from reaching participants. See #158 / #136.
 */
describe("resolved schemas strip researcher `notes`", () => {
  // A minimally-valid treatment file that exercises `notes` at every
  // authoring level mentioned in #158: treatments, stages, intro/exit
  // steps, elements, introSequences, and templates.
  const authoringYaml = {
    templates: [
      {
        name: "tpl_with_notes",
        notes: "Template rationale for researchers.",
        contentType: "stage" as const,
        content: {
          name: "tpl_stage",
          duration: 30,
          elements: [
            { type: "prompt", file: "prompts/tpl.prompt.md" },
            { type: "submitButton" },
          ],
        },
      },
    ],
    introSequences: [
      {
        name: "seq_with_notes",
        notes: "Intro sequence rationale.",
        introSteps: [
          {
            name: "welcome",
            notes: "Step-level note on intro.",
            elements: [
              {
                type: "prompt",
                name: "intro_prompt",
                notes: "Element-level note on intro.",
                file: "prompts/welcome.prompt.md",
              },
              { type: "submitButton" },
            ],
          },
        ],
      },
    ],
    treatments: [
      {
        name: "t_with_notes",
        notes: "Top-level treatment rationale.",
        playerCount: 2,
        gameStages: [
          {
            name: "s_with_notes",
            notes: "Adapted from Smith et al. (2020).",
            duration: 60,
            elements: [
              {
                type: "prompt",
                name: "p_with_notes",
                notes: "Pilot showed N=32 was adequate.",
                file: "prompts/q.prompt.md",
              },
              { type: "submitButton" },
            ],
          },
        ],
        exitSequence: [
          {
            name: "e_with_notes",
            notes: "Debrief copy pending IRB approval.",
            elements: [
              { type: "prompt", file: "prompts/debrief.prompt.md" },
              { type: "submitButton" },
            ],
          },
        ],
      },
    ],
  };

  test("authoring schema accepts `notes` on treatments, stages, intro/exit steps, elements, introSequences, and templates", () => {
    const result = treatmentFileSchema.safeParse(authoringYaml);
    if (!result.success) console.error(result.error.issues);
    expect(result.success).toBe(true);
  });

  test("resolvedTreatmentSchema strips every `notes` in the output tree", () => {
    const result = resolvedTreatmentSchema.safeParse(
      authoringYaml.treatments[0],
    );
    if (!result.success) console.error(result.error.issues);
    expect(result.success).toBe(true);

    // Walk the whole parsed object and confirm no `notes` key survived.
    function findNotesKey(value: unknown, path = "$"): string | null {
      if (Array.isArray(value)) {
        for (let i = 0; i < value.length; i++) {
          const found = findNotesKey(value[i], `${path}[${String(i)}]`);
          if (found) return found;
        }
        return null;
      }
      if (value && typeof value === "object") {
        for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
          if (k === "notes") return `${path}.notes`;
          const found = findNotesKey(v, `${path}.${k}`);
          if (found) return found;
        }
      }
      return null;
    }

    expect(findNotesKey(result.data)).toBe(null);
  });

  test("legacy `desc:` is rejected (and the same fixture without `desc` would validate)", () => {
    // Build a minimally-valid treatment file without `desc` first, then
    // confirm the same fixture with an added `desc:` at treatment level
    // fails — so we isolate the cause of failure to the `desc` field.
    const baseFixture = {
      introSequences: [
        {
          name: "seq",
          introSteps: [
            {
              name: "welcome",
              elements: [
                { type: "prompt", file: "p.prompt.md" },
                { type: "submitButton" },
              ],
            },
          ],
        },
      ],
      treatments: [
        {
          name: "t",
          playerCount: 2,
          gameStages: [
            {
              name: "s",
              duration: 60,
              elements: [
                { type: "prompt", file: "p.prompt.md" },
                { type: "submitButton" },
              ],
            },
          ],
        },
      ],
    };

    // Sanity check: without `desc`, the fixture validates.
    const withoutDesc = treatmentFileSchema.safeParse(baseFixture);
    if (!withoutDesc.success) console.error(withoutDesc.error.issues);
    expect(withoutDesc.success).toBe(true);

    // Now add `desc:` at treatment level. Should fail specifically
    // because `desc` is no longer a recognized key.
    const withDesc = {
      ...baseFixture,
      treatments: [
        { ...baseFixture.treatments[0], desc: "legacy description field" },
      ],
    };
    const result = treatmentFileSchema.safeParse(withDesc);
    expect(result.success).toBe(false);
    if (!result.success) {
      // Confirm the failure is specifically "unrecognized key `desc`"
      // — not an unrelated problem with the fixture.
      const descIssue = result.error.issues.find(
        (i) =>
          i.code === "unrecognized_keys" &&
          (i as { keys?: string[] }).keys?.includes("desc"),
      );
      expect(descIssue).toBeDefined();
    }
  });
});

// =====================================================================
// #284 — resolved schemas reject `${field}` placeholders that survived
// fillTemplates. The authoring schemas accept placeholders so a template
// field can carry the structured value at substitution time; the
// resolved schemas are the safety net for unbound fields.
// =====================================================================

describe("resolved schemas reject unresolved ${field} placeholders (#284)", () => {
  test("resolvedStageSchema rejects discussion.rooms as a placeholder string", () => {
    const stage = {
      name: "stage1",
      duration: 60,
      discussion: {
        chatType: "video",
        showNickname: true,
        showTitle: true,
        rooms: "${unboundRoomAssignments}",
      },
      elements: [{ type: "submitButton" }],
    };
    const result = resolvedStageSchema.safeParse(stage);
    expect(result.success).toBe(false);
    if (!result.success) {
      const issue = result.error.issues.find((i) =>
        i.message.includes("unresolved"),
      );
      expect(issue).toBeDefined();
      expect(issue?.path).toEqual(["discussion", "rooms"]);
    }
  });

  test("resolvedStageSchema rejects discussion.layout.feeds as a placeholder string", () => {
    const stage = {
      name: "stage1",
      duration: 60,
      discussion: {
        chatType: "video",
        showNickname: true,
        showTitle: true,
        layout: {
          "0": {
            grid: { rows: 2, cols: 2 },
            feeds: "${unboundFeeds}",
          },
        },
      },
      elements: [{ type: "submitButton" }],
    };
    const result = resolvedStageSchema.safeParse(stage);
    expect(result.success).toBe(false);
    if (!result.success) {
      const issue = result.error.issues.find((i) =>
        i.message.includes("unresolved"),
      );
      expect(issue).toBeDefined();
      expect(issue?.path).toEqual(["discussion", "layout", "0", "feeds"]);
    }
  });

  test("resolvedStageSchema accepts discussion.rooms as a literal array (no regression)", () => {
    const stage = {
      name: "stage1",
      duration: 60,
      discussion: {
        chatType: "video",
        showNickname: true,
        showTitle: true,
        rooms: [{ includePositions: [0, 1] }, { includePositions: [2, 3] }],
      },
      elements: [{ type: "submitButton" }],
    };
    const result = resolvedStageSchema.safeParse(stage);
    expect(result.success).toBe(true);
  });
});
