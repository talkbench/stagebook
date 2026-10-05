import { describe, expect, test } from "vitest";

import {
  elementSchema,
  treatmentFileSchema,
  promptFilePathSchema,
  SURVEY_ELEMENT_REMOVED_MESSAGE,
  NON_FINITE_SECONDS_MESSAGE,
} from "./treatment.js";
import {
  resolvedElementSchema,
  resolvedStageSchema,
  resolvedTreatmentSchema,
  resolvedTreatmentFileSchema,
  validateResolvedTreatmentFile,
} from "./resolved.js";
import { fillTemplates } from "../templates/fillTemplates.js";

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
        compatibleIntroSequences: [],
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
          compatibleIntroSequences: [],
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

  test("resolvedStageSchema rejects discussion.showTitle as a placeholder string (#565)", () => {
    const stage = {
      name: "stage1",
      duration: 60,
      discussion: {
        chatType: "video",
        showNickname: true,
        showTitle: "${unboundShowTitle}",
        rooms: [{ includePositions: [0, 1] }],
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
      expect(issue?.path).toEqual(["discussion", "showTitle"]);
    }
  });

  test("resolvedStageSchema rejects discussion.showNickname as a placeholder string (#565)", () => {
    const stage = {
      name: "stage1",
      duration: 60,
      discussion: {
        chatType: "video",
        showNickname: "${unboundShowNickname}",
        showTitle: true,
        rooms: [{ includePositions: [0, 1] }],
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
      expect(issue?.path).toEqual(["discussion", "showNickname"]);
    }
  });

  test("resolvedStageSchema accepts discussion.showTitle as a literal boolean (no regression)", () => {
    const stage = {
      name: "stage1",
      duration: 60,
      discussion: {
        chatType: "video",
        showNickname: false,
        showTitle: true,
        rooms: [{ includePositions: [0, 1] }],
      },
      elements: [{ type: "submitButton" }],
    };
    const result = resolvedStageSchema.safeParse(stage);
    expect(result.success).toBe(true);
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

// ----------- Resolved prompt.file checks (#398) -----------------
//
// The resolved schema enforces what the pre-fill schema relaxes for
// `${field}`-bearing strings: every `prompt.file:` reaching post-fill
// must end in `.prompt.md` and must carry no surviving `${...}`
// placeholder. Mirror of the `resolvedDiscussionSchema.superRefine`
// pattern for `discussion.rooms` / `layout.feeds`.

describe("resolvedElementSchema — prompt.file enforcement (#398)", () => {
  const baseStage = {
    name: "stage1",
    duration: 60,
  };

  test("accepts a fully-resolved prompt.file with .prompt.md extension", () => {
    const result = resolvedStageSchema.safeParse({
      ...baseStage,
      elements: [
        { type: "prompt", file: "prompts/welcome.prompt.md" },
        { type: "submitButton" },
      ],
    });
    expect(result.success).toBe(true);
  });

  test("rejects a prompt.file missing the .prompt.md extension", () => {
    const result = resolvedStageSchema.safeParse({
      ...baseStage,
      elements: [
        { type: "prompt", file: "prompts/welcome.md" },
        { type: "submitButton" },
      ],
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const fileIssue = result.error.issues.find((i) =>
        i.path.join(".").endsWith("file"),
      );
      expect(fileIssue?.message).toContain(".prompt.md");
    }
  });

  test("rejects a prompt.file that still contains a `${field}` placeholder", () => {
    // Annotator/host left the slot unbound. The pre-fill schema
    // accepts `${field}` as a deferred check; the post-fill schema
    // catches the leak before participants see a broken page.
    const result = resolvedStageSchema.safeParse({
      ...baseStage,
      elements: [
        { type: "prompt", file: "${unboundPath}" },
        { type: "submitButton" },
      ],
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const fileIssue = result.error.issues.find((i) =>
        i.path.join(".").endsWith("file"),
      );
      expect(fileIssue?.message).toContain("unresolved");
      expect(fileIssue?.message).toContain("${unboundPath}");
    }
  });

  test("rejects a prompt.file with a placeholder mid-string (partial substitution)", () => {
    // Even if `${field}` appears mid-path (`prefix/${unbound}.prompt.md`),
    // the resolved form is still considered unresolved.
    const result = resolvedStageSchema.safeParse({
      ...baseStage,
      elements: [
        { type: "prompt", file: "prefix/${unbound}.prompt.md" },
        { type: "submitButton" },
      ],
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const fileIssue = result.error.issues.find((i) =>
        i.path.join(".").endsWith("file"),
      );
      expect(fileIssue?.message).toContain("unresolved");
    }
  });

  test("file check only applies to prompt elements (not submitButton, audio, etc.)", () => {
    // A non-prompt element with a `file` field (e.g. audio, image,
    // mediaPlayer) doesn't go through the prompt-file extension
    // contract. The resolved schema's stringly `file:` is unchecked
    // for those; their own validators in treatment.ts handle their
    // path rules.
    const result = resolvedStageSchema.safeParse({
      ...baseStage,
      elements: [
        { type: "audio", file: "audio/clip.mp3" },
        { type: "submitButton" },
      ],
    });
    expect(result.success).toBe(true);
  });
});

// ----------- Pre-fill / post-fill split (#398) ------------------
//
// The pre-fill schema now accepts `${field}` placeholders in
// `prompt.file:`; the resolved schema enforces `.prompt.md` and
// flags unresolved placeholders.

describe("promptFilePathSchema pre-fill: `${field}` deferred to post-fill (#398)", () => {
  test("accepts a bare `${field}` placeholder", () => {
    // Was the user's annotation-workflow case before #398. Pre-fill
    // would reject this with "Prompt files must use the .prompt.md
    // extension" because the unbound `${field}` doesn't match the
    // extension regex.
    expect(promptFilePathSchema.safeParse("${field}").success).toBe(true);
  });

  test("accepts a mid-path placeholder (`prefix/${name}.prompt.md`)", () => {
    expect(
      promptFilePathSchema.safeParse("prefix/${name}.prompt.md").success,
    ).toBe(true);
  });

  test("accepts a placeholder without the extension (`prefix/${name}`)", () => {
    // The extension might be inside the placeholder's filled value.
    // Deferred to post-fill.
    expect(promptFilePathSchema.safeParse("prefix/${name}").success).toBe(true);
  });

  test("still rejects a literal path without .prompt.md", () => {
    // No placeholder, no .prompt.md — pre-fill catches it.
    const result = promptFilePathSchema.safeParse("prompts/foo.md");
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toContain(".prompt.md");
    }
  });

  test("still rejects an empty string", () => {
    expect(promptFilePathSchema.safeParse("").success).toBe(false);
  });

  test("still rejects a literal absolute path", () => {
    expect(
      promptFilePathSchema.safeParse("/prompts/foo.prompt.md").success,
    ).toBe(false);
  });
});

describe("validateResolvedTreatmentFile (#398)", () => {
  const filledTreatmentFile = {
    treatments: [
      {
        name: "t",
        playerCount: 1,
        compatibleIntroSequences: [],
        gameStages: [
          {
            name: "stage1",
            duration: 60,
            elements: [
              { type: "prompt", file: "prompts/welcome.prompt.md" },
              { type: "submitButton" },
            ],
          },
        ],
      },
    ],
  };

  test("clean fully-filled tree validates with no issues", () => {
    const result = validateResolvedTreatmentFile(filledTreatmentFile);
    expect(result.success).toBe(true);
    expect(result.issues).toEqual([]);
  });

  test("rejects a tree with a surviving `${field}` placeholder by default", () => {
    const tree = JSON.parse(JSON.stringify(filledTreatmentFile)) as {
      treatments: {
        gameStages: { elements: { file?: string }[] }[];
      }[];
    };
    tree.treatments[0].gameStages[0].elements[0].file = "${unbound}";
    const result = validateResolvedTreatmentFile(tree);
    expect(result.success).toBe(false);
    expect(result.issues[0]?.reason).toBe("unresolved-placeholder");
    expect(result.issues[0]?.message).toContain("unresolved");
  });

  test("with skipUnresolved: true, surviving placeholders are filtered out", () => {
    const tree = JSON.parse(JSON.stringify(filledTreatmentFile)) as {
      treatments: {
        gameStages: { elements: { file?: string }[] }[];
      }[];
    };
    tree.treatments[0].gameStages[0].elements[0].file = "${unbound}";
    const result = validateResolvedTreatmentFile(tree, {
      skipUnresolved: true,
    });
    expect(result.success).toBe(true);
    expect(result.issues).toEqual([]);
  });

  test("with skipUnresolved: true, non-placeholder issues still surface", () => {
    // A path that's not templated but lacks .prompt.md should still
    // be caught even in authoring (skipUnresolved) mode. That's the
    // whole point — the VS Code extension can surface this kind of
    // bug to the author even when they have other unbound fields.
    const tree = JSON.parse(JSON.stringify(filledTreatmentFile)) as {
      treatments: {
        gameStages: { elements: { file?: string }[] }[];
      }[];
    };
    tree.treatments[0].gameStages[0].elements[0].file = "prompts/foo.md";
    const result = validateResolvedTreatmentFile(tree, {
      skipUnresolved: true,
    });
    expect(result.success).toBe(false);
    expect(result.issues[0]?.message).toContain(".prompt.md");
  });

  test("normalized issue path points at the offending element's file", () => {
    const tree = JSON.parse(JSON.stringify(filledTreatmentFile)) as {
      treatments: {
        gameStages: { elements: { file?: string }[] }[];
      }[];
    };
    tree.treatments[0].gameStages[0].elements[0].file = "prompts/foo.md";
    const result = validateResolvedTreatmentFile(tree);
    expect(result.issues[0]?.path).toEqual([
      "treatments",
      0,
      "gameStages",
      0,
      "elements",
      0,
      "file",
    ]);
  });
});

// =====================================================================
// #568 — resolved placeholder-leak sweep. Before this, a surviving
// `${field}` in a *string-typed* slot (condition `value`, `buttonText`,
// `url`, `displayText`, …) passed the resolved schema silently, because
// `"${x}"` is a structurally valid string. A global scan now flags any
// surviving `${…}` in any post-fill string, tagged `unresolved-placeholder`.
// =====================================================================

describe("resolved placeholder-leak sweep — string-typed slots (#568)", () => {
  const base = {
    treatments: [
      {
        name: "t",
        playerCount: 1,
        compatibleIntroSequences: [],
        gameStages: [
          {
            name: "stage1",
            duration: 60,
            elements: [
              { type: "prompt", file: "prompts/welcome.prompt.md" },
              { type: "submitButton" },
            ],
          },
        ],
      },
    ],
  };
  const clone = () => JSON.parse(JSON.stringify(base)) as typeof base;

  test("rejects a surviving `${field}` in a condition value", () => {
    const tree = clone();
    (tree.treatments[0].gameStages[0].elements[1] as Record<string, unknown>) =
      {
        type: "submitButton",
        conditions: [
          {
            reference: "0.prompt.welcome.value",
            comparator: "equals",
            value: "${leak}",
          },
        ],
      };
    const result = validateResolvedTreatmentFile(tree);
    expect(result.success).toBe(false);
    const issue = result.issues.find(
      (i) => i.reason === "unresolved-placeholder",
    );
    expect(issue).toBeDefined();
    expect(issue?.message).toContain("unresolved");
  });

  test("rejects a surviving `${field}` in submitButton buttonText", () => {
    const tree = clone();
    (
      tree.treatments[0].gameStages[0].elements[1] as Record<string, unknown>
    ).buttonText = "${leak}";
    const result = validateResolvedTreatmentFile(tree);
    expect(result.success).toBe(false);
    expect(
      result.issues.some((i) => i.reason === "unresolved-placeholder"),
    ).toBe(true);
  });

  test("rejects an embedded/partial placeholder in a string slot", () => {
    const tree = clone();
    (
      tree.treatments[0].gameStages[0].elements[1] as Record<string, unknown>
    ).buttonText = "Click ${leak} to continue";
    const result = validateResolvedTreatmentFile(tree);
    expect(result.success).toBe(false);
    expect(
      result.issues.some((i) => i.reason === "unresolved-placeholder"),
    ).toBe(true);
  });

  test("skipUnresolved filters a leaked buttonText (authoring context)", () => {
    const tree = clone();
    (
      tree.treatments[0].gameStages[0].elements[1] as Record<string, unknown>
    ).buttonText = "${leak}";
    const result = validateResolvedTreatmentFile(tree, {
      skipUnresolved: true,
    });
    expect(result.success).toBe(true);
    expect(result.issues).toEqual([]);
  });

  test("does NOT flag a literal `$` that isn't a `${...}` placeholder", () => {
    const tree = clone();
    (
      tree.treatments[0].gameStages[0].elements[1] as Record<string, unknown>
    ).buttonText = "Pay $5 to continue";
    const result = validateResolvedTreatmentFile(tree);
    expect(result.success).toBe(true);
    expect(result.issues).toEqual([]);
  });

  test("deduped against per-field guards: a prompt.file leak reports once", () => {
    // The prompt.file guard (resolvedElementSchema) and the global sweep both
    // see the same leaked string at the same path — it must be reported once,
    // preferring the guard's specific message.
    const tree = clone();
    (
      tree.treatments[0].gameStages[0].elements[0] as Record<string, unknown>
    ).file = "${unbound}";
    const result = validateResolvedTreatmentFile(tree);
    expect(result.success).toBe(false);
    const leakIssues = result.issues.filter(
      (i) =>
        i.reason === "unresolved-placeholder" &&
        JSON.stringify(i.path) ===
          JSON.stringify([
            "treatments",
            0,
            "gameStages",
            0,
            "elements",
            0,
            "file",
          ]),
    );
    expect(leakIssues).toHaveLength(1);
    // The guard's specific message wins, not the generic sweep message.
    expect(leakIssues[0]?.message).toContain("prompt.file");
  });

  test("dedup vs a numeric-slot schema error: reported once, and NOT tagged unresolved-placeholder", () => {
    // A numeric slot (`displayTime`) with a leaked `${x}` fails the resolved
    // schema as "Expected number, received string" (reason undefined). The
    // sweep sees the same string at the same path but must NOT add a second
    // issue. Corollary: because the surviving issue isn't tagged, a numeric
    // leak is NOT filtered by skipUnresolved (it hard-errors even in authoring
    // — the pre-existing numeric-placeholder behavior, unchanged here).
    const tree = clone();
    (
      tree.treatments[0].gameStages[0].elements[1] as Record<string, unknown>
    ).displayTime = "${x}";
    const path = JSON.stringify([
      "treatments",
      0,
      "gameStages",
      0,
      "elements",
      1,
      "displayTime",
    ]);
    const result = validateResolvedTreatmentFile(tree);
    expect(result.success).toBe(false);
    const atPath = result.issues.filter((i) => JSON.stringify(i.path) === path);
    expect(atPath).toHaveLength(1);
    expect(atPath[0]?.reason).toBeUndefined();

    // skipUnresolved does NOT filter it (untagged), so it still errors.
    const skipped = validateResolvedTreatmentFile(tree, {
      skipUnresolved: true,
    });
    expect(skipped.success).toBe(false);
  });

  test("catches a leak nested in urlParams[].value (recursive walk into array-of-objects)", () => {
    const tree = clone();
    (tree.treatments[0].gameStages[0].elements[1] as Record<string, unknown>) =
      {
        type: "qualtrics",
        url: "https://survey.example.com/s",
        urlParams: [
          { key: "ok", value: "literal" },
          { key: "pid", value: "${leak}" },
        ],
      };
    const result = validateResolvedTreatmentFile(tree);
    expect(result.success).toBe(false);
    const issue = result.issues.find(
      (i) =>
        i.reason === "unresolved-placeholder" &&
        JSON.stringify(i.path) ===
          JSON.stringify([
            "treatments",
            0,
            "gameStages",
            0,
            "elements",
            1,
            "urlParams",
            1,
            "value",
          ]),
    );
    expect(issue).toBeDefined();
  });

  test("catches a leak nested in a condition operator tree (all: [...])", () => {
    const tree = clone();
    (
      tree.treatments[0].gameStages[0].elements[1] as Record<string, unknown>
    ).conditions = {
      all: [
        {
          reference: "0.prompt.welcome.value",
          comparator: "equals",
          value: "${leak}",
        },
      ],
    };
    const result = validateResolvedTreatmentFile(tree);
    expect(result.success).toBe(false);
    const issue = result.issues.find(
      (i) =>
        i.reason === "unresolved-placeholder" &&
        JSON.stringify(i.path) ===
          JSON.stringify([
            "treatments",
            0,
            "gameStages",
            0,
            "elements",
            1,
            "conditions",
            "all",
            0,
            "value",
          ]),
    );
    expect(issue).toBeDefined();
  });

  test("does NOT flag a non-identifier `${...}` body (matches fillTemplates grammar)", () => {
    // `${form.id}` (dot body) is never substituted by fillTemplates (narrow
    // identifier grammar), so it's a literal string, not a leak. Using the
    // loose `${...}` regex here would falsely reject a previously-valid study
    // (#568 review).
    const tree = clone();
    (
      tree.treatments[0].gameStages[0].elements[1] as Record<string, unknown>
    ).buttonText = "Submit ${form.id}";
    const result = validateResolvedTreatmentFile(tree);
    expect(result.success).toBe(true);
    expect(result.issues).toEqual([]);
  });

  test("does NOT scan the file-level templates: block (definitions keep placeholders)", () => {
    // A not-yet-stripped `templates:` block legitimately contains `${field}`
    // placeholders; the resolved schema tolerates it (`z.unknown()`), so the
    // sweep must skip it rather than false-positive on every definition
    // (#568 review).
    const tree = clone() as Record<string, unknown>;
    tree.templates = [
      { name: "greeting", content: { buttonText: "${unbound}" } },
    ];
    const result = validateResolvedTreatmentFile(tree);
    expect(result.success).toBe(true);
    expect(result.issues).toEqual([]);
  });
});

describe("resolvedTreatmentFileSchema schema is exported", () => {
  // Quick sanity check that the new schema is wired through the
  // module's exports (matches the test in promptFile.test for
  // splitOnTopLevelHrules).
  test("rejects a non-object root", () => {
    expect(resolvedTreatmentFileSchema.safeParse(null).success).toBe(false);
  });

  test("accepts the minimal empty shape", () => {
    expect(resolvedTreatmentFileSchema.safeParse({}).success).toBe(true);
  });
});

describe("resolved groupComposition enforces the self-only rule (#526)", () => {
  // The pre-fill `playerSchema` skips a `${field}` groupComposition, so a
  // host-supplied composition is first validated here post-fill. The
  // self-only rule must fire on this surface too, or a cross-participant
  // selector slips through on the resolved/preview path (#526 review).
  const treatmentWith = (reference: string) => ({
    name: "t",
    playerCount: 2,
    compatibleIntroSequences: [],
    groupComposition: [
      {
        position: 0,
        conditions: [{ reference, comparator: "equals", value: "buyer" }],
      },
      { position: 1 },
    ],
    gameStages: [
      { name: "s", duration: 60, elements: [{ type: "submitButton" }] },
    ],
  });

  test("rejects a non-self position in a resolved groupComposition condition", () => {
    const result = resolvedTreatmentSchema.safeParse(
      treatmentWith("0.prompt.role"),
    );
    expect(result.success).toBe(false);
    if (!result.success) {
      const issue = result.error.issues.find(
        (i) => i.path.join(".") === "groupComposition.0.conditions.0.reference",
      );
      expect(issue?.message).toMatch(/must use the `self` position selector/);
    }
  });

  test("accepts a `self` position in a resolved groupComposition condition", () => {
    const result = resolvedTreatmentSchema.safeParse(
      treatmentWith("self.prompt.role"),
    );
    if (!result.success) console.error(result.error.issues);
    expect(result.success).toBe(true);
  });
});

// ----------- Resolved stage duration floor (#588) -----------
//
// `resolvedStageSchema.duration` reuses `durationSchema` without the
// `${field}` escape hatch, so the 5-second floor applies post-fill too — a
// template field that substitutes in `3` is caught here.

describe("resolvedStageSchema enforces the 5-second duration floor (#588)", () => {
  const stage = (duration: number) => ({
    name: "stage1",
    duration,
    elements: [{ type: "submitButton" }],
  });

  test("rejects a 4-second resolved stage with the author-facing message", () => {
    const result = resolvedStageSchema.safeParse(stage(4));
    expect(result.success).toBe(false);
    if (!result.success) {
      const issue = result.error.issues.find(
        (i) => i.path.join(".") === "duration",
      );
      expect(issue).toBeDefined();
      expect(issue?.message).toContain(
        "Stage duration must be at least 5 seconds",
      );
    }
  });

  test("accepts a 5-second resolved stage", () => {
    expect(resolvedStageSchema.safeParse(stage(5)).success).toBe(true);
  });

  test("rejects a 5.5-second resolved stage (whole seconds only)", () => {
    expect(resolvedStageSchema.safeParse(stage(5.5)).success).toBe(false);
  });
});

describe("resolved schema rejects the removed survey element (#669)", () => {
  // The resolved element `type` is deliberately an open string, so the
  // removed element has to be rejected by name — otherwise a
  // `type: ${kind}` template filled with `survey` would pass the post-fill
  // pass that the editor pipeline surfaces.
  test("a concrete `type: survey` element fails with the migration guidance", () => {
    const filled = {
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
          name: "t",
          playerCount: 1,
          compatibleIntroSequences: ["i"],
          gameStages: [
            {
              name: "g",
              duration: 10,
              elements: [
                { type: "survey", surveyName: "TIPI" },
                { type: "submitButton" },
              ],
            },
          ],
        },
      ],
    };
    const result = validateResolvedTreatmentFile(filled);
    expect(result.success).toBe(false);
    const hit = result.issues.find(
      (i) => i.message === SURVEY_ELEMENT_REMOVED_MESSAGE,
    );
    expect(hit).toBeDefined();
    expect(hit!.path).toEqual([
      "treatments",
      0,
      "gameStages",
      0,
      "elements",
      0,
      "type",
    ]);
  });
});

describe("resolved time fields are finite (#681)", () => {
  // Every time field rejects non-finite values. Only the mediaPlayer fields
  // also mirror the authoring sign checks: they accept a `${field}`
  // placeholder, which skips the authoring sign check, so a host that runs
  // only the resolved schema still catches a filled negative or zero value
  // (validateTreatmentDiff's hydrated authoring pass catches it too). The
  // timer fields take no placeholder, so they get finiteness only. A filled
  // `.inf` never arrives as Infinity on the fill path — fillTemplates
  // substitutes through JSON, which turns it into `null` (a type error) — so
  // the finiteness check guards resolved objects hosts build directly.
  const mediaCases = [
    { type: "mediaPlayer", field: "startAt" },
    { type: "mediaPlayer", field: "stopAt" },
    { type: "mediaPlayer", field: "stepDuration" },
  ];
  const timerCases = [
    { type: "timer", field: "startTime" },
    { type: "timer", field: "endTime" },
    { type: "timer", field: "warnTimeRemaining" },
  ];
  const cases = [...mediaCases, ...timerCases];
  const parse = (type: string, field: string, value: number) =>
    resolvedElementSchema.safeParse({ type, [field]: value });

  test.each(cases)("$type $field: Infinity is rejected", ({ type, field }) => {
    const result = parse(type, field, Infinity);
    expect(result.success).toBe(false);
    if (!result.success) {
      const issue = result.error.issues.find((i) => i.path.includes(field));
      expect(issue?.message).toBe(NON_FINITE_SECONDS_MESSAGE);
    }
  });

  test.each(cases)("$type $field: -Infinity is rejected", ({ type, field }) => {
    expect(parse(type, field, -Infinity).success).toBe(false);
  });

  test.each(cases)(
    "$type $field: a finite positive value is accepted",
    ({ type, field }) => {
      expect(parse(type, field, 2.5).success).toBe(true);
    },
  );

  test.each(mediaCases)(
    "$type $field: a negative value is rejected",
    ({ type, field }) => {
      expect(parse(type, field, -1).success).toBe(false);
    },
  );

  test.each(mediaCases.filter((c) => c.field !== "startAt"))(
    "$type $field: zero is rejected (must be positive)",
    ({ type, field }) => {
      expect(parse(type, field, 0).success).toBe(false);
    },
  );

  test("mediaPlayer startAt: zero is accepted (nonnegative)", () => {
    expect(parse("mediaPlayer", "startAt", 0).success).toBe(true);
  });

  // The resolved schema adds no sign check to the timer fields, so a
  // host-built timer with the documented default `startTime: 0` (#726)
  // still parses.
  test.each(timerCases)(
    "$type $field: zero is accepted (finiteness only)",
    ({ type, field }) => {
      expect(parse(type, field, 0).success).toBe(true);
    },
  );

  // Only the mediaPlayer fields accept a `${field}` placeholder.
  test.each(mediaCases)(
    "$type $field: a negative value filled into a placeholder is rejected",
    ({ type, field }) => {
      const element = { type, file: "a.mp4", [field]: "${t}" };
      // The placeholder passes the authoring schema...
      expect(elementSchema.safeParse(element).success).toBe(true);
      const { result } = fillTemplates({
        obj: { elements: [{ template: "el", fields: { t: -1 } }] },
        templates: [{ name: "el", contentType: "element", content: element }],
      }) as { result: { elements: Record<string, unknown>[] } };
      expect(result.elements[0][field]).toBe(-1);
      // ...and the resolved schema rejects the filled value, on that field.
      const parsed = resolvedElementSchema.safeParse(result.elements[0]);
      expect(parsed.success).toBe(false);
      if (!parsed.success) {
        expect(parsed.error.issues.some((i) => i.path.includes(field))).toBe(
          true,
        );
      }
      // Positive control: the same element filled with a valid value parses,
      // so the rejection above comes from the sign check, not the shape.
      const { result: ok } = fillTemplates({
        obj: { elements: [{ template: "el", fields: { t: 2.5 } }] },
        templates: [{ name: "el", contentType: "element", content: element }],
      }) as { result: { elements: Record<string, unknown>[] } };
      expect(resolvedElementSchema.safeParse(ok.elements[0]).success).toBe(
        true,
      );
    },
  );
});
