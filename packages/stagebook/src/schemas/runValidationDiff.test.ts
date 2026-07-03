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
    introSequences: []
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

  describe("intro/exit advancement-element source-only suppression (#347)", () => {
    // A `template:` invocation in an intro/exit step whose definition
    // lexically resolves to an advancement element should NOT surface the
    // "needs advancement element" warning: the author did the right thing
    // and the source-pass refinement simply can't see through the
    // invocation. The warning still fires in `sourceIssues` (the raw
    // record), but is dropped from the surfaced `sourceOnly` bucket.

    const hasAdvancementMessage = (i: { message: string }) =>
      i.message.toLowerCase().includes("advancement element");

    it("suppresses the intro-step warning when a `template:` (contentType elements) resolves to an advancement element", () => {
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
      // The raw source pass still records the artifact ...
      expect(result.sourceIssues.some(hasAdvancementMessage)).toBe(true);
      // ... but it is neither a real bug (matched) nor surfaced (sourceOnly).
      expect(result.matched.some(hasAdvancementMessage)).toBe(false);
      expect(result.sourceOnly.some(hasAdvancementMessage)).toBe(false);
    });

    it("suppresses the exit-step warning when the template is contentType `element` (singular)", () => {
      const source = `templates:
  - name: submit
    contentType: element
    content:
      type: submitButton
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
    exitSequence:
      - name: thanks
        elements:
          - template: submit
`;
      const result = runValidationDiff({ source });
      expect(result.hydrationError).toBeNull();
      expect(result.sourceOnly.some(hasAdvancementMessage)).toBe(false);
      expect(result.matched.some(hasAdvancementMessage)).toBe(false);
    });

    it("suppresses when the template resolves via mediaPlayer with submitOnComplete: true", () => {
      const source = `templates:
  - name: video
    contentType: elements
    content:
      - type: mediaPlayer
        url: https://example.com/v.mp4
        submitOnComplete: true
introSequences:
  - name: i
    introSteps:
      - name: s
        elements:
          - template: video
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
      expect(result.sourceOnly.some(hasAdvancementMessage)).toBe(false);
    });

    it("does NOT suppress a genuine no-advancement step (real bug stays surfaced as `matched`)", () => {
      // Safety: suppression keys off the step's actual contents, not
      // bucket membership. A concrete step with no way to advance fires
      // the rule in BOTH passes, so it lands in `matched` (a real error)
      // and must never be dropped.
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
    exitSequence:
      - name: broken
        elements:
          - type: display
            reference: self.prompt.x
`;
      const result = runValidationDiff({ source });
      expect(result.hydrationError).toBeNull();
      expect(result.matched.some(hasAdvancementMessage)).toBe(true);
      expect(result.sourceOnly.some(hasAdvancementMessage)).toBe(false);
    });

    it("never fully hides a real no-advancement bug, even mixed with a suppressible artifact", () => {
      // Both a suppressible artifact (intro step → resolving template)
      // and a real bug (concrete exit step, no advancement) share the
      // identical message. The v1 multiset diff matches by
      // `(code, normalized_message)`, so the two collapse and get routed
      // by order — the real bug can land in either `matched` or
      // `sourceOnly` (an acknowledged option-1 limitation, see #321). The
      // invariant that must hold regardless: the advancement problem is
      // still surfaced somewhere, and suppression — which only checks
      // step contents — cannot drop the concrete-no-advancement step.
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
    exitSequence:
      - name: broken
        elements:
          - type: display
            reference: self.prompt.x
`;
      const result = runValidationDiff({ source });
      expect(result.hydrationError).toBeNull();
      const stillSurfaced =
        result.matched.some(hasAdvancementMessage) ||
        result.sourceOnly.some(hasAdvancementMessage);
      expect(stillSurfaced).toBe(true);
    });

    it("KEEPS the warning when the invoked template is defined but resolves through a further (unresolved-at-one-level) template", () => {
      // The step invokes `wrap`, whose content is itself only another
      // `template:` invocation — no lexical advancement element one level
      // deep. Hydration still succeeds (wrap → inner → submitButton) so
      // this lands in sourceOnly, but the static one-level check can't
      // prove it, so we conservatively keep the warning.
      const source = `templates:
  - name: wrap
    contentType: elements
    content:
      - template: inner
  - name: inner
    contentType: elements
    content:
      - type: submitButton
introSequences:
  - name: i
    introSteps:
      - name: s
        elements:
          - template: wrap
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
      // Kept as a source-only warning (not provable one level deep).
      expect(result.sourceOnly.some(hasAdvancementMessage)).toBe(true);
    });

    it("suppresses when the resolving template comes from importedTemplates (module reuse — the #347 motivation)", () => {
      // The template lives in an imported module, not the root file. The
      // orchestrator merges importedTemplates into the set used for both
      // passes AND for suppression, so a shared `surveyAndSubmit`-style
      // module template must be resolvable here too.
      const source = `introSequences:
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
      const result = runValidationDiff({
        source,
        importedTemplates: [
          {
            name: "advanceBtn",
            contentType: "elements",
            content: [{ type: "submitButton" }],
          },
        ],
      });
      expect(result.hydrationError).toBeNull();
      expect(result.sourceOnly.some(hasAdvancementMessage)).toBe(false);
    });

    it("suppresses when the template resolves to a survey (auto-submitting) element", () => {
      const source = `templates:
  - name: poll
    contentType: elements
    content:
      - type: survey
        surveyName: TIPI
introSequences:
  - name: i
    introSteps:
      - name: s
        elements:
          - template: poll
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
      expect(result.sourceOnly.some(hasAdvancementMessage)).toBe(false);
    });

    it("suppresses when a singular `element` template resolves to a qualtrics survey", () => {
      const source = `templates:
  - name: q
    contentType: element
    content:
      type: qualtrics
      url: https://example.qualtrics.com/survey
introSequences:
  - name: i
    introSteps:
      - name: s
        elements:
          - template: q
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
      expect(result.sourceOnly.some(hasAdvancementMessage)).toBe(false);
    });

    it("suppresses a mixed step where one element is a non-advancement display and another is a resolving template", () => {
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
          - type: display
            reference: self.prompt.x
          - template: advanceBtn
treatments:
  - name: t
    playerCount: 1
    gameStages:
      - name: g
        duration: 10
        elements:
          - type: display
            reference: self.prompt.x
          - type: submitButton
`;
      const result = runValidationDiff({ source });
      expect(result.hydrationError).toBeNull();
      expect(result.sourceOnly.some(hasAdvancementMessage)).toBe(false);
    });

    it("does NOT silently suppress a parameterized template name — it surfaces as a hydration error", () => {
      // A `template: ${x}` name can't be resolved pre-fill; fillTemplates
      // can't expand it either, so hydration fails and the raw source
      // issue (including the advancement warning) is all callers get. The
      // point: the author still sees an error, nothing is hidden.
      const source = `templates:
  - name: real
    contentType: elements
    content:
      - type: submitButton
introSequences:
  - name: i
    introSteps:
      - name: s
        elements:
          - template: \${which}
            fields:
              which: real
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
      expect(result.hydrationError).not.toBeNull();
      // Buckets are empty on hydration failure; the warning survives in
      // the raw source record so the caller can still surface something.
      expect(result.sourceOnly).toEqual([]);
      expect(result.sourceIssues.some(hasAdvancementMessage)).toBe(true);
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

  describe("cross-treatment leak detection (schema is strict by default)", () => {
    it("flags a cross-treatment leak in `matched` (both passes fire, diff matches them)", () => {
      // Treatment A references a key only Treatment B produces. Per
      // #321's strict-by-default change, the schema's reference check
      // no longer falls through to `globalProducedKeys`. Both source
      // and hydrated passes see the unreachable-reference error;
      // identical `(code, message)` → diff matches → `matched` bucket.
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
      // The schema fires on the leak in BOTH passes.
      const leakInSource = result.sourceIssues.find((i) =>
        i.message.includes("prompt.bOnly"),
      );
      const leakInHydrated = result.hydratedIssues.find((i) =>
        i.message.includes("prompt.bOnly"),
      );
      expect(leakInSource).toBeDefined();
      expect(leakInHydrated).toBeDefined();
      // Diff matches them → routes to `matched` (real bug at source).
      const matchedLeak = result.matched.find((i) =>
        i.message.includes("prompt.bOnly"),
      );
      expect(matchedLeak).toBeDefined();
      expect(matchedLeak!.path[0]).toBe("treatments");
      expect(matchedLeak!.path[1]).toBe(0); // Treatment A
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
            introSequences: [],
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

describe("introSequences pairing artifacts (#499)", () => {
  it("routes pairing artifacts from a template-driven introSequences collection to sourceOnly", () => {
    const source = `templates:
  - name: introTpl
    contentType: introSequence
    content:
      name: \${seqName}
      introSteps:
        - name: step
          elements:
            - { type: prompt, file: color.prompt.md, name: color }
            - type: submitButton
introSequences:
  - template: introTpl
    fields:
      seqName: expanded
treatments:
  - name: t
    playerCount: 1
    introSequences: [expanded]
    gameStages:
      - name: s1
        duration: 60
        elements:
          - type: submitButton
            name: done
            conditions:
              - { reference: self.prompt.color, comparator: exists }`;
    const result = runValidationDiff({ source, importedTemplates: [] });
    expect(result.hydrationError).toBeNull();
    // Both source-pass artifacts (dangling name + unknown ref) are
    // templating noise: post-hydration the sequence exists and provides
    // the key — they must land in sourceOnly (warnings), not matched.
    expect(result.matched).toHaveLength(0);
    expect(
      result.sourceOnly.some((i) =>
        /lists intro sequence "expanded"/.test(i.message),
      ),
    ).toBe(true);
    expect(result.hydratedOnly).toHaveLength(0);
  });
});

describe("advisory suffixes must not break cross-pass matching (#499 review)", () => {
  // The dangling-name and unknown-ref messages carry advisory tails that
  // enumerate the file's sequences — template expansion changes those
  // enumerations, so the same real error renders differently across the
  // two passes. normalizeIssueKey strips the tails; without that, these
  // real errors demote from matched/error to sourceOnly/warning.
  it("dangling name stays a matched error when another sequence is template-generated", () => {
    const source = `templates:
  - name: makeSeq
    contentType: introSequence
    content:
      name: generated_seq
      introSteps:
        - name: step
          elements:
            - type: submitButton
introSequences:
  - name: onboarding
    introSteps:
      - name: welcome
        elements:
          - type: submitButton
  - template: makeSeq
treatments:
  - name: t
    playerCount: 1
    introSequences: [onboarding, gohst]
    gameStages:
      - name: s1
        duration: 60
        elements:
          - type: submitButton
            name: done`;
    const result = runValidationDiff({ source, importedTemplates: [] });
    expect(result.hydrationError).toBeNull();
    expect(
      result.matched.some((i) =>
        /lists intro sequence "gohst"/.test(i.message),
      ),
    ).toBe(true);
    expect(
      result.sourceOnly.some((i) =>
        /lists intro sequence "gohst"/.test(i.message),
      ),
    ).toBe(false);
  });

  it("unknown-ref stays a matched error when the hint's producer is template-generated", () => {
    const source = `templates:
  - name: makeSeq
    contentType: introSequence
    content:
      name: alt_pathway
      introSteps:
        - name: step
          elements:
            - { type: prompt, file: color.prompt.md, name: color }
            - type: submitButton
introSequences:
  - name: onboarding
    introSteps:
      - name: welcome
        elements:
          - type: submitButton
  - template: makeSeq
treatments:
  - name: t
    playerCount: 1
    introSequences: [onboarding]
    gameStages:
      - name: s1
        duration: 60
        elements:
          - type: submitButton
            name: done
            conditions:
              - { reference: self.prompt.color, comparator: exists }`;
    const result = runValidationDiff({ source, importedTemplates: [] });
    expect(result.hydrationError).toBeNull();
    // The reference is genuinely unresolvable under the declared pairing
    // in BOTH passes — only the hydrated pass can name alt_pathway in its
    // hint. Must still match as a real error.
    expect(
      result.matched.some((i) =>
        /doesn't match any prompt element/.test(i.message),
      ),
    ).toBe(true);
  });
});
