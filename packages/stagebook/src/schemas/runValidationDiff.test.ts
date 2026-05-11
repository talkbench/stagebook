import { describe, it, expect } from "vitest";
import { runValidationDiff } from "./runValidationDiff.js";

/**
 * Tests for the diff orchestrator: run the schema twice (once on the
 * unfilled source, once on the hydrated form) and partition issues by
 * which run(s) they appeared in. The routing decides whether each
 * issue is a real bug, a templating artifact, or a hydration-only
 * surprise.
 *
 * v1 matching key is `(code, normalized_message)`. Coincidentally
 * identical messages at different paths collapse — acceptable for
 * the typical authoring failure modes; see #321 for follow-up
 * options 2 (path-aware match) and 3 (full provenance).
 */

describe("runValidationDiff", () => {
  describe("happy path", () => {
    it("returns empty buckets when the file has no issues at all", () => {
      const source = `introSequences:
  - name: i
    introSteps:
      - name: s
        elements:
          - type: submitButton
treatments:
  - name: t
    playerCount: 1
    gameStages:
      - name: g
        duration: 10
        elements:
          - type: submitButton
`;
      const result = runValidationDiff({ source });
      expect(result.hydrationError).toBeNull();
      expect(result.sourceIssues).toEqual([]);
      expect(result.hydratedIssues).toEqual([]);
      expect(result.matched).toEqual([]);
      expect(result.sourceOnly).toEqual([]);
      expect(result.hydratedOnly).toEqual([]);
    });
  });

  describe("matched issues — real bugs present in both runs", () => {
    it("classifies a shape error in a template body as matched", () => {
      // The element type is wrong both pre-fill (in the template's
      // content) and post-fill (in the expanded treatment). Schema
      // surfaces it in both runs; diff matches them.
      const source = `templates:
  - name: bad
    contentType: stage
    content:
      name: s
      duration: 10
      elements:
        - type: notAValidElementType
introSequences:
  - name: i
    introSteps:
      - name: s
        elements:
          - type: submitButton
treatments:
  - name: t
    playerCount: 1
    gameStages:
      - template: bad
`;
      const result = runValidationDiff({ source });
      expect(result.hydrationError).toBeNull();
      // The discriminator error fires at the template's definition site
      // in both passes (hydrated re-attaches `templates:` so the
      // definition stays visible), so the diff matches that instance.
      // Real bug, not a templating artifact.
      expect(
        result.matched.some((i) => i.code === "invalid_union_discriminator"),
      ).toBe(true);
      // It must not land in sourceOnly — that bucket means "templating
      // artifact, suppress," which would be wrong for a real
      // template-definition bug.
      expect(
        result.sourceOnly.some((i) => i.code === "invalid_union_discriminator"),
      ).toBe(false);
      // The hydrated pass also surfaces the error at the expansion
      // site (`treatments[0].gameStages[0].elements[0].type`) — same
      // underlying bug, one extra hydrated instance per invocation.
      // That's mathematically `hydratedOnly`, but semantically it's
      // the same bug as the matched one. Callers typically display
      // matched at the source position and treat duplicate
      // hydrated-only entries with the same (code, message) as
      // already-reported. Out of scope for v1 (#321 follow-up).
    });
  });

  describe("source-only issues — templating artifacts", () => {
    it("classifies intro-step-needs-advancement as source-only when a template provides it", () => {
      // The intro step's only direct child is a `template:` invocation.
      // The source-pass schema's refinement counts this as missing an
      // advancement element (template invocations aren't submit buttons
      // / surveys / qualtrics / submit-on-complete mediaPlayer). After
      // hydration the template expands to include a submitButton, so
      // the hydrated-pass passes. Diff classifies as source-only and
      // recommends suppressing it.
      const source = `templates:
  - name: advanceBtn
    contentType: elements
    content:
      - type: submitButton
introSequences:
  - name: i
    introSteps:
      - name: s
        elements:
          - template: advanceBtn
treatments:
  - name: t
    playerCount: 1
    gameStages:
      - name: g
        duration: 10
        elements:
          - type: submitButton
`;
      const result = runValidationDiff({ source });
      expect(result.hydrationError).toBeNull();
      // The advancement-element rule fires in source but not in hydrated.
      const advancementIssue = result.sourceIssues.find((i) =>
        i.message.toLowerCase().includes("advancement element"),
      );
      expect(advancementIssue).toBeDefined();
      // It's classified as source-only (not matched).
      expect(
        result.sourceOnly.some((i) =>
          i.message.toLowerCase().includes("advancement element"),
        ),
      ).toBe(true);
      expect(
        result.matched.some((i) =>
          i.message.toLowerCase().includes("advancement element"),
        ),
      ).toBe(false);
    });
  });

  describe("hydrated-only issues — revealed by expansion", () => {
    it("classifies a duration-too-short error that only manifests after field substitution as hydrated-only", () => {
      // The template's content has `duration: ${dur}` — pre-fill the
      // schema accepts the placeholder (template fields can be any
      // string). After substitution with -5, the schema rejects it.
      const source = `templates:
  - name: stageT
    contentType: stage
    content:
      name: s
      duration: \${dur}
      elements:
        - type: submitButton
introSequences:
  - name: i
    introSteps:
      - name: s
        elements:
          - type: submitButton
treatments:
  - name: t
    playerCount: 1
    gameStages:
      - template: stageT
        fields:
          dur: -5
`;
      const result = runValidationDiff({ source });
      expect(result.hydrationError).toBeNull();
      // Something about the bad duration shows up post-fill but not
      // pre-fill. Verify there's a hydrated-only issue and no matched
      // duration issue.
      expect(result.hydratedOnly.length).toBeGreaterThan(0);
    });
  });

  describe("hydration failure", () => {
    it("sets hydrationError and returns sourceIssues with no diff buckets", () => {
      const source = `treatments:
  - template: doesNotExist
`;
      const result = runValidationDiff({ source });
      expect(result.hydrationError).not.toBeNull();
      expect(result.hydratedIssues).toEqual([]);
      // Diff machinery shouldn't try to route when hydration didn't
      // produce a hydrated set — callers fall back to source issues
      // with a "may include artifacts" caveat.
      expect(result.matched).toEqual([]);
      expect(result.sourceOnly).toEqual([]);
      expect(result.hydratedOnly).toEqual([]);
    });
  });

  describe("malformed input", () => {
    it("surfaces YAML parse failures as hydrationError", () => {
      const result = runValidationDiff({ source: "[[[invalid" });
      expect(result.hydrationError).not.toBeNull();
      expect(result.hydrationError).toMatch(/yaml|parse/i);
    });

    it("preserves a non-array `templates:` so the schema flags the type error", () => {
      // If the user wrote `templates: notAnArray`, silently coercing
      // to `[]` would suppress the real type error. The source pass
      // must surface it. (The hydrated pass doesn't see `templates:`
      // — fillTemplates strips it — so this lands in `sourceOnly`,
      // but the `templates`-prefixed path identifies it as a real
      // bug per the routing contract in the function header.)
      const source = `templates: notAnArray
treatments:
  - name: t
    playerCount: 1
    gameStages:
      - name: g
        duration: 10
        elements:
          - type: submitButton
introSequences:
  - name: i
    introSteps:
      - name: s
        elements:
          - type: submitButton
`;
      const result = runValidationDiff({ source });
      const templatesTypeIssue = (bucket: typeof result.matched) =>
        bucket.some(
          (i) =>
            Array.isArray(i.path) &&
            i.path[0] === "templates" &&
            (i.code === "invalid_type" || i.code === "invalid_union"),
        );
      // Present somewhere — must not be silently dropped.
      expect(
        templatesTypeIssue(result.matched) ||
          templatesTypeIssue(result.sourceOnly),
      ).toBe(true);
    });
  });

  describe("template-definition errors", () => {
    it("classifies an error in a USED template's definition as matched (def site)", () => {
      // The template is invoked from a treatment. The source pass
      // surfaces the bug at the def site; the hydrated pass surfaces
      // it at the expansion site. After normalization both share the
      // same (code, message), so the diff puts one instance in
      // `matched` (with the def-site path — the canonical fix
      // location) and any further expansion sites in `hydratedOnly`.
      const source = `templates:
  - name: usedAndBroken
    contentType: element
    content:
      type: prompt
      file: 12345
introSequences:
  - name: i
    introSteps:
      - name: s
        elements:
          - type: submitButton
treatments:
  - name: t
    playerCount: 1
    gameStages:
      - name: g
        duration: 10
        elements:
          - template: usedAndBroken
          - type: submitButton
`;
      const result = runValidationDiff({ source });
      expect(result.hydrationError).toBeNull();
      // The matched entry points at the def site (path starts with
      // "templates").
      const matchedAtDef = result.matched.filter(
        (i) => Array.isArray(i.path) && i.path[0] === "templates",
      );
      expect(matchedAtDef.length).toBeGreaterThan(0);
    });

    it("an UNUSED template's def error lands in sourceOnly (no hydrated counterpart)", () => {
      // Defined but never invoked → source sees the bug, hydrated has
      // no expansion site for it. Lands in `sourceOnly`. Honest about
      // the bucket: v1 can't tell this case (real bug) apart from a
      // genuine artifact at a `templates[...]` path, so callers
      // present sourceOnly at lower visual priority than the
      // confidently-real buckets.
      const source = `templates:
  - name: brokenButUnused
    contentType: element
    content:
      type: prompt
      file: 12345
introSequences:
  - name: i
    introSteps:
      - name: s
        elements:
          - type: submitButton
treatments:
  - name: t
    playerCount: 1
    gameStages:
      - name: g
        duration: 10
        elements:
          - type: submitButton
`;
      const result = runValidationDiff({ source });
      expect(result.hydrationError).toBeNull();
      const sourceOnlyAtDef = result.sourceOnly.filter(
        (i) => Array.isArray(i.path) && i.path[0] === "templates",
      );
      expect(sourceOnlyAtDef.length).toBeGreaterThan(0);
      const matchedAtDef = result.matched.filter(
        (i) => Array.isArray(i.path) && i.path[0] === "templates",
      );
      expect(matchedAtDef).toEqual([]);
    });

    it("an artifact INSIDE a template body also lands in sourceOnly (path is not a reliable signal)", () => {
      // The template's content is an introExitStep whose only direct
      // element is a `template:` invocation of another template that
      // does provide a submitButton. The schema's advancement-element
      // refinement fires inside the source-pass validation of this
      // template's content. After hydration the inner template expands
      // to include the submitButton, so the same refinement passes —
      // this is a genuine artifact. Crucially: the path is
      // `templates[...]`, identical to the unused-broken-template
      // case above. Path can't distinguish the two; callers handle
      // sourceOnly with lower confidence than matched/hydratedOnly.
      const source = `templates:
  - name: wrapAdvance
    contentType: introSteps
    content:
      - name: s
        elements:
          - template: innerAdvance
  - name: innerAdvance
    contentType: elements
    content:
      - type: submitButton
introSequences:
  - name: i
    introSteps:
      - template: wrapAdvance
treatments:
  - name: t
    playerCount: 1
    gameStages:
      - name: g
        duration: 10
        elements:
          - type: submitButton
`;
      const result = runValidationDiff({ source });
      expect(result.hydrationError).toBeNull();
      const advancementInSourceOnly = result.sourceOnly.find(
        (i) =>
          Array.isArray(i.path) &&
          i.path[0] === "templates" &&
          i.message.toLowerCase().includes("advancement element"),
      );
      expect(advancementInSourceOnly).toBeDefined();
    });
  });

  describe("unreachableReferences bucket", () => {
    it("populates unreachableReferences for cross-treatment leaks the schema silently passes", () => {
      // Treatment A references a key only Treatment B produces. The
      // schema's existing reference check falls through to
      // globalProducedKeys (silent pass), so neither sourceIssues nor
      // hydratedIssues catches it. The orchestrator's strict per-
      // treatment check (rung-3-strict, no fallthrough) does.
      const source = `introSequences:
  - name: i
    introSteps:
      - name: s
        elements:
          - type: submitButton
treatments:
  - name: A
    playerCount: 1
    gameStages:
      - name: g
        duration: 10
        elements:
          - type: display
            reference: self.prompt.bOnly
          - type: submitButton
  - name: B
    playerCount: 1
    gameStages:
      - name: g
        duration: 10
        elements:
          - type: prompt
            name: bOnly
            file: b.prompt.md
          - type: submitButton
`;
      const result = runValidationDiff({ source });
      expect(result.hydrationError).toBeNull();
      // Schema's pass through with fallthrough — no source/hydrated
      // unknown-reference issues for the leak.
      const leakInSourceIssues = result.sourceIssues.some((i) =>
        i.message.includes("prompt.bOnly"),
      );
      const leakInHydratedIssues = result.hydratedIssues.some((i) =>
        i.message.includes("prompt.bOnly"),
      );
      expect(leakInSourceIssues).toBe(false);
      expect(leakInHydratedIssues).toBe(false);
      // But the strict check catches it.
      expect(result.unreachableReferences).toHaveLength(1);
      expect(result.unreachableReferences[0].message).toContain("prompt.bOnly");
      expect(result.unreachableReferences[0].path[0]).toBe("treatments");
      expect(result.unreachableReferences[0].path[1]).toBe(0);
    });

    it("returns an empty unreachableReferences on hydration failure", () => {
      const result = runValidationDiff({
        source: `treatments:
  - template: doesNotExist
`,
      });
      expect(result.hydrationError).not.toBeNull();
      expect(result.unreachableReferences).toEqual([]);
    });
  });

  describe("imports field validation", () => {
    it("flags a non-string entry in `imports:` (matched in both passes)", () => {
      // The schema models `imports:` as `z.array(z.string().min(1))`.
      // If we stripped imports from the validated objects, this type
      // error would go silently — exactly the kind of obvious mistake
      // a validator should catch.
      const source = `imports:
  - 12345
introSequences:
  - name: i
    introSteps:
      - name: s
        elements:
          - type: submitButton
treatments:
  - name: t
    playerCount: 1
    gameStages:
      - name: g
        duration: 10
        elements:
          - type: submitButton
`;
      const result = runValidationDiff({ source });
      expect(result.hydrationError).toBeNull();
      expect(
        result.matched.some(
          (i) => Array.isArray(i.path) && i.path[0] === "imports",
        ),
      ).toBe(true);
    });
  });

  describe("imported templates", () => {
    it("uses the merged template set for both passes", () => {
      const source = `imports:
  - ./module.stagebook.yaml
introSequences:
  - name: i
    introSteps:
      - name: s
        elements:
          - type: submitButton
treatments:
  - template: makeTreatment
`;
      const importedTemplates = [
        {
          name: "makeTreatment",
          contentType: "treatment",
          content: {
            name: "t",
            playerCount: 1,
            gameStages: [
              {
                name: "g",
                duration: 10,
                elements: [{ type: "submitButton" }],
              },
            ],
          },
        },
      ];
      const result = runValidationDiff({ source, importedTemplates });
      expect(result.hydrationError).toBeNull();
      expect(result.matched).toEqual([]);
      expect(result.hydratedOnly).toEqual([]);
    });
  });

  describe("matching semantics", () => {
    it("matches by (code, normalized message) — same exact issue text in both passes", () => {
      // Use a shape error that's identical pre- and post-fill: a
      // template invocation passes the template's content through
      // unchanged, so an invalid element type stays invalid at the
      // same JSON shape.
      const source = `templates:
  - name: pass
    contentType: element
    content:
      type: notAValidElementType
introSequences:
  - name: i
    introSteps:
      - name: s
        elements:
          - type: submitButton
treatments:
  - name: t
    playerCount: 1
    gameStages:
      - name: g
        duration: 10
        elements:
          - template: pass
          - type: submitButton
`;
      const result = runValidationDiff({ source });
      expect(result.hydrationError).toBeNull();
      // The discriminator-value error from the invalid element type
      // appears in both runs (once in the template definition, once
      // in the expanded treatment) and the diff matches them.
      expect(
        result.matched.some((i) => i.code === "invalid_union_discriminator"),
      ).toBe(true);
    });
  });
});
