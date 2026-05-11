import { describe, it, expect } from "vitest";
import { collectPreHydrationIssues } from "./preHydrationSemantic.js";

/**
 * Pre-hydration semantic checks run on the merged source (root + imports)
 * without expanding any templates. They catch a class of authoring errors
 * that would otherwise throw a generic mid-hydration error far from the
 * actual fix site, or silently pass and surprise the user at runtime.
 *
 * Scoped to two checks in this PR:
 *   1. Unknown template name — every `template: X` invocation references
 *      a template defined in this file or its imports
 *   2. Circular template invocations — no template-A-invokes-B-invokes-A
 *      cycles
 *
 * Parameterized invocation names (e.g. `template: ${arm}_pre`) are skipped
 * — their concrete identity depends on call-site bindings that aren't
 * resolved until hydration. Falsely flagging them as unknown would be
 * worse than missing genuinely unresolvable ones, which hydration will
 * surface in a clear way anyway.
 *
 * See #321 for the broader validation pipeline this is part of.
 */

describe("collectPreHydrationIssues", () => {
  describe("unknown template invocations", () => {
    it("returns no issues when every invocation resolves", () => {
      const root = {
        templates: [
          {
            name: "foo",
            contentType: "treatment",
            content: { name: "t", playerCount: 1, gameStages: [] },
          },
        ],
        treatments: [{ template: "foo" }],
      };
      expect(collectPreHydrationIssues({ root })).toEqual([]);
    });

    it("flags an invocation whose name isn't defined anywhere", () => {
      const root = {
        templates: [
          {
            name: "foo",
            contentType: "treatment",
            content: { name: "t" },
          },
        ],
        treatments: [{ template: "doesNotExist" }],
      };
      const issues = collectPreHydrationIssues({ root });
      expect(issues).toHaveLength(1);
      expect(issues[0].code).toBe("unknown-template");
      expect(issues[0].message).toContain("doesNotExist");
      expect(issues[0].path).toEqual(["treatments", 0, "template"]);
    });

    it("resolves a template defined in an imported file", () => {
      const root = {
        treatments: [{ template: "fromImport" }],
      };
      const importedTemplates = [
        {
          name: "fromImport",
          contentType: "treatment",
          content: { name: "t" },
        },
      ];
      expect(collectPreHydrationIssues({ root, importedTemplates })).toEqual(
        [],
      );
    });

    it("flags an invocation when neither root nor imports define the name", () => {
      const root = {
        treatments: [{ template: "missing" }],
      };
      const importedTemplates = [
        { name: "other", contentType: "treatment", content: { name: "t" } },
      ];
      const issues = collectPreHydrationIssues({ root, importedTemplates });
      expect(issues).toHaveLength(1);
      expect(issues[0].code).toBe("unknown-template");
      expect(issues[0].message).toContain("missing");
    });

    it("skips parameterized invocations (name contains ${...})", () => {
      // `template: ${arm}_pre` resolves at hydration time when `arm` is
      // bound by broadcast or fields. The literal text doesn't match any
      // defined template name, but it's not an error — it's a runtime
      // dispatch. Flagging it here would false-positive on every
      // broadcast-driven file.
      const root = {
        templates: [
          {
            name: "control_pre",
            contentType: "elements",
            content: [{ type: "submitButton" }],
          },
        ],
        treatments: [
          { template: "${arm}_pre", broadcast: { d0: [{ arm: "control" }] } },
        ],
      };
      expect(collectPreHydrationIssues({ root })).toEqual([]);
    });

    it("finds invocations nested deep inside the source", () => {
      const root = {
        templates: [
          {
            name: "stageT",
            contentType: "stage",
            content: {
              name: "s",
              duration: 10,
              elements: [{ template: "nestedMissing" }],
            },
          },
        ],
        treatments: [
          {
            name: "t",
            playerCount: 1,
            gameStages: [{ template: "stageT" }],
          },
        ],
      };
      const issues = collectPreHydrationIssues({ root });
      expect(issues).toHaveLength(1);
      expect(issues[0].code).toBe("unknown-template");
      expect(issues[0].message).toContain("nestedMissing");
    });

    it("reports multiple unknown invocations separately", () => {
      const root = {
        treatments: [{ template: "missing1" }, { template: "missing2" }],
      };
      const issues = collectPreHydrationIssues({ root });
      expect(issues).toHaveLength(2);
      const names = issues.map((i) => i.message);
      expect(names.some((m) => m.includes("missing1"))).toBe(true);
      expect(names.some((m) => m.includes("missing2"))).toBe(true);
    });
  });

  describe("circular template invocations", () => {
    it("returns no issues for a non-cyclic call graph", () => {
      const root = {
        templates: [
          {
            name: "a",
            contentType: "elements",
            content: [{ template: "b" }],
          },
          {
            name: "b",
            contentType: "elements",
            content: [{ type: "submitButton" }],
          },
        ],
        treatments: [{ name: "t", playerCount: 1, gameStages: [] }],
      };
      expect(collectPreHydrationIssues({ root })).toEqual([]);
    });

    it("flags a direct self-invocation (A → A)", () => {
      const root = {
        templates: [
          {
            name: "a",
            contentType: "elements",
            content: [{ template: "a" }],
          },
        ],
        treatments: [{ name: "t", playerCount: 1, gameStages: [] }],
      };
      const issues = collectPreHydrationIssues({ root });
      expect(issues).toHaveLength(1);
      expect(issues[0].code).toBe("circular-template");
      expect(issues[0].message).toContain("a");
    });

    it("flags a two-step cycle (A → B → A)", () => {
      const root = {
        templates: [
          {
            name: "a",
            contentType: "elements",
            content: [{ template: "b" }],
          },
          {
            name: "b",
            contentType: "elements",
            content: [{ template: "a" }],
          },
        ],
        treatments: [{ name: "t", playerCount: 1, gameStages: [] }],
      };
      const issues = collectPreHydrationIssues({ root });
      expect(issues.some((i) => i.code === "circular-template")).toBe(true);
    });

    it("flags a longer cycle (A → B → C → A)", () => {
      const root = {
        templates: [
          {
            name: "a",
            contentType: "elements",
            content: [{ template: "b" }],
          },
          {
            name: "b",
            contentType: "elements",
            content: [{ template: "c" }],
          },
          {
            name: "c",
            contentType: "elements",
            content: [{ template: "a" }],
          },
        ],
        treatments: [{ name: "t", playerCount: 1, gameStages: [] }],
      };
      const issues = collectPreHydrationIssues({ root });
      expect(issues.some((i) => i.code === "circular-template")).toBe(true);
    });

    it("does not flag diamond shapes (A → B, A → C, B → D, C → D)", () => {
      // Same template invoked from multiple call sites isn't a cycle.
      const root = {
        templates: [
          {
            name: "a",
            contentType: "elements",
            content: [{ template: "b" }, { template: "c" }],
          },
          {
            name: "b",
            contentType: "elements",
            content: [{ template: "d" }],
          },
          {
            name: "c",
            contentType: "elements",
            content: [{ template: "d" }],
          },
          {
            name: "d",
            contentType: "elements",
            content: [{ type: "submitButton" }],
          },
        ],
        treatments: [{ name: "t", playerCount: 1, gameStages: [] }],
      };
      const cycles = collectPreHydrationIssues({ root }).filter(
        (i) => i.code === "circular-template",
      );
      expect(cycles).toEqual([]);
    });

    it("anchors a cycle that exists entirely in imports to a position the editor can resolve", () => {
      // When A → B → A is defined entirely inside imported templates and
      // the root file doesn't invoke either, the diagnostic still needs
      // a path that the editor's YAML AST mapper can convert to a
      // position. Falling through to `["templates"]` would fail when
      // the root has no `templates:` key; fall back to `["imports"]`
      // (always present when imports are in play) instead.
      const root = {
        imports: ["./module.stagebook.yaml"],
        treatments: [{ name: "t", playerCount: 1, gameStages: [] }],
      };
      const importedTemplates = [
        {
          name: "a",
          contentType: "elements",
          content: [{ template: "b" }],
        },
        {
          name: "b",
          contentType: "elements",
          content: [{ template: "a" }],
        },
      ];
      const cycles = collectPreHydrationIssues({
        root,
        importedTemplates,
      }).filter((i) => i.code === "circular-template");
      expect(cycles).toHaveLength(1);
      // Anchor to a path that's actually present in the root.
      expect(cycles[0].path[0]).toBe("imports");
    });

    it("skips cycles that go through parameterized invocations", () => {
      // If A → ${x} is parameterized, we can't statically determine which
      // template it resolves to. Treat as not part of the call graph for
      // cycle detection — runtime errors will surface real cycles.
      const root = {
        templates: [
          {
            name: "a",
            contentType: "elements",
            content: [{ template: "${x}" }],
          },
        ],
        treatments: [{ name: "t", playerCount: 1, gameStages: [] }],
      };
      const cycles = collectPreHydrationIssues({ root }).filter(
        (i) => i.code === "circular-template",
      );
      expect(cycles).toEqual([]);
    });
  });

  describe("imported template bodies", () => {
    it("flags an imported template whose body invokes an undefined name", () => {
      // An imported template `outer` whose body invokes a missing
      // template would today fail at hydration with a generic error.
      // The diagnostic anchors to the root's `imports:` line since
      // that's the editable surface the user has when working in the
      // root file.
      const root = {
        imports: ["./module.stagebook.yaml"],
        treatments: [{ template: "outer" }],
      };
      const importedTemplates = [
        {
          name: "outer",
          contentType: "elements",
          content: [{ template: "missingFromImport" }],
        },
      ];
      const issues = collectPreHydrationIssues({ root, importedTemplates });
      const unknown = issues.filter((i) => i.code === "unknown-template");
      expect(unknown).toHaveLength(1);
      expect(unknown[0].message).toContain("missingFromImport");
      // Anchor in the root file, not just `["templates"]` which doesn't
      // exist when the root only declares `imports:`.
      expect(unknown[0].path[0]).toBe("imports");
    });
  });

  describe("malformed input", () => {
    it("returns no issues for an empty object", () => {
      expect(collectPreHydrationIssues({ root: {} })).toEqual([]);
    });

    it("ignores templates without a name (those are caught by the schema)", () => {
      const root = {
        templates: [{ contentType: "elements", content: [] }],
        treatments: [{ template: "foo" }],
      };
      // The nameless template definition is malformed; the schema will
      // flag that. We just shouldn't crash, and should still flag the
      // unknown invocation.
      const issues = collectPreHydrationIssues({ root });
      expect(issues.some((i) => i.code === "unknown-template")).toBe(true);
    });
  });
});
