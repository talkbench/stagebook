import { describe, it, expect, vi } from "vitest";
import { loadTreatmentFromUrl } from "./loader";

const MINIMAL_YAML = `
introSequences:
  - name: intro1
    introSteps:
      - name: consent
        elements:
          - type: submitButton
            buttonText: Continue

treatments:
  - name: treatment1
    playerCount: 2
    gameStages:
      - name: stage1
        duration: 10
        elements:
          - type: prompt
            name: q1
            file: prompts/q1.prompt.md
`;

function mockFetch(body: string, ok = true) {
  return vi.fn().mockResolvedValue({
    ok,
    status: ok ? 200 : 404,
    text: () => Promise.resolve(body),
  });
}

/**
 * Build a fetch mock that routes by URL substring. Each entry is
 * `[match, body, ok?]`; the first match wins. `ok` defaults to true.
 * URLs not matched return 404.
 */
function routedFetch(
  routes: ReadonlyArray<readonly [string, string, boolean?]>,
) {
  return vi.fn().mockImplementation((url: string) => {
    for (const [match, body, ok = true] of routes) {
      if (url.includes(match)) {
        return Promise.resolve({
          ok,
          status: ok ? 200 : 404,
          text: () => Promise.resolve(body),
        });
      }
    }
    return Promise.resolve({
      ok: false,
      status: 404,
      text: () => Promise.resolve("Not Found"),
    });
  });
}

const BLOB_URL = "https://github.com/org/repo/blob/main/treatment.yaml";

describe("loadTreatmentFromUrl", () => {
  it("fetches, parses, and expands a treatment file with no diagnostics", async () => {
    const fetch = mockFetch(MINIMAL_YAML);
    const result = await loadTreatmentFromUrl(BLOB_URL, fetch);
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining(
        "https://raw.githubusercontent.com/org/repo/main/treatment.yaml",
      ),
    );
    expect(result.treatmentFile).not.toBeNull();
    expect(result.treatmentFile!.treatments).toHaveLength(1);
    expect(result.treatmentFile!.treatments[0].name).toBe("treatment1");
    expect(result.diagnostics).toEqual([]);
    expect(result.unresolvedFields).toEqual([]);
    expect(result.rawBaseUrl).toBe(
      "https://raw.githubusercontent.com/org/repo/main/",
    );
  });

  it("throws on fetch failure", async () => {
    const fetch = mockFetch("Not Found", false);
    await expect(loadTreatmentFromUrl(BLOB_URL, fetch)).rejects.toThrow(
      "Failed to fetch",
    );
  });

  // -- #440: validation diagnostics on load --

  it("returns positioned diagnostics and a null file for a schema error (#440)", async () => {
    const badYaml = `
introSequences:
  - name: i
    introSteps:
      - name: s
        elements:
          - type: submitButton
treatments:
  - name: t
    playerCount: two
    gameStages:
      - name: g
        duration: 10
        elements:
          - type: submitButton
`;
    const fetch = mockFetch(badYaml);
    const result = await loadTreatmentFromUrl(BLOB_URL, fetch);

    expect(result.treatmentFile).toBeNull();
    expect(result.diagnostics.length).toBeGreaterThan(0);
    const diag = result.diagnostics[0];
    expect(diag.severity).toBe("error");
    expect(diag.message).toMatch(/playerCount/);
    // Positioned against the entry file the author is editing.
    expect(diag.range).not.toBeNull();
    expect(diag.file).toBe("treatment.yaml");
  });

  it("renders with a warning for a schema slip in an unused imported template (#440)", async () => {
    // The bad template is defined in an import but never invoked. The diff
    // validator downgrades such source-only artifacts to warnings (they don't
    // survive hydration into a real bug), and expansion strips the unused
    // template — so the preview still opens, with the warning in the drawer.
    // This matches the VS Code extension's Problems panel.
    const rootYaml = `
imports:
  - ./mod.stagebook.yaml
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
    const moduleYaml = `
templates:
  - name: bad_step
    contentType: element
    content:
      type: notARealElementType
`;
    const fetch = routedFetch([
      ["treatment.yaml", rootYaml],
      ["mod.stagebook.yaml", moduleYaml],
    ]);

    const result = await loadTreatmentFromUrl(BLOB_URL, fetch);

    expect(result.treatmentFile).not.toBeNull();
    const diag = result.diagnostics.find((d) => /content/.test(d.message));
    expect(diag).toBeDefined();
    expect(diag!.severity).toBe("warning");
    expect(diag!.file).toBe("treatment.yaml");
  });

  it("surfaces a duplicate-key warning with a position and a null file (#440)", async () => {
    // A duplicate key is a warning in the validator, but js-yaml refuses to
    // build an object from it — so nothing renders, yet the positioned
    // warning still explains why.
    const dupYaml = `
introSequences:
  - name: i
    introSteps:
      - name: s
        elements:
          - type: submitButton
treatments:
  - name: t
    playerCount: 2
    playerCount: 3
    gameStages:
      - name: g
        duration: 10
        elements:
          - type: submitButton
`;
    const fetch = mockFetch(dupYaml);
    const result = await loadTreatmentFromUrl(BLOB_URL, fetch);

    expect(result.treatmentFile).toBeNull();
    expect(result.diagnostics.some((d) => d.severity === "warning")).toBe(true);
    expect(result.diagnostics[0].range).not.toBeNull();
  });

  it("returns a diagnostic (not a throw) for invalid YAML (#440)", async () => {
    const fetch = mockFetch("{{bad yaml");
    const result = await loadTreatmentFromUrl(BLOB_URL, fetch);
    expect(result.treatmentFile).toBeNull();
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  // -- #312: cross-file imports via URL --

  it("resolves `imports:` from the same repo and merges templates (#312)", async () => {
    const rootYaml = `
imports:
  - ./modules/consent.stagebook.yaml

introSequences:
  - name: intro1
    introSteps:
      - template: shared_consent_step

treatments:
  - name: treatment1
    playerCount: 2
    gameStages:
      - name: stage1
        duration: 10
        elements:
          - type: submitButton
            buttonText: Continue
`;
    const moduleYaml = `
templates:
  - name: shared_consent_step
    contentType: introExitStep
    content:
      name: consent
      elements:
        - type: submitButton
          buttonText: I agree
`;

    const fetch = routedFetch([
      ["treatment.yaml", rootYaml],
      ["modules/consent.stagebook.yaml", moduleYaml],
    ]);

    const result = await loadTreatmentFromUrl(BLOB_URL, fetch);

    // Imports should have been fetched from the same repo + branch
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining(
        "https://raw.githubusercontent.com/org/repo/main/modules/consent.stagebook.yaml",
      ),
    );

    // The template invocation resolved during expansion
    expect(result.treatmentFile).not.toBeNull();
    expect(result.treatmentFile!.introSequences?.[0].introSteps[0].name).toBe(
      "consent",
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("throws a clear error when an imported file 404s (#312)", async () => {
    const rootYaml = `
imports:
  - ./modules/missing.stagebook.yaml

treatments:
  - name: t
    playerCount: 1
    gameStages:
      - name: s
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
    const fetch = routedFetch([
      ["treatment.yaml", rootYaml],
      // modules/missing.stagebook.yaml not routed → 404
    ]);

    await expect(loadTreatmentFromUrl(BLOB_URL, fetch)).rejects.toThrow(
      /Failed to fetch imported file 'modules\/missing\.stagebook\.yaml'.*HTTP 404.*same repo/s,
    );
  });

  // -- #483: prompt locale-consistency on load --

  it("flags a he treatment referencing an untagged (en) prompt as a diagnostic (#483)", async () => {
    const rootYaml = `
treatments:
  - name: t
    playerCount: 1
    locale: he
    gameStages:
      - name: g
        duration: 10
        elements:
          - type: prompt
            name: q
            file: prompts/q.prompt.md
introSequences:
  - name: i
    introSteps:
      - name: s
        elements:
          - type: submitButton
`;
    const fetch = routedFetch([
      ["treatment.yaml", rootYaml],
      ["prompts/q.prompt.md", "---\ntype: noResponse\n---\nhello\n"],
    ]);

    const result = await loadTreatmentFromUrl(BLOB_URL, fetch);

    // Locale mismatch doesn't block rendering — preview still available.
    expect(result.treatmentFile).not.toBeNull();
    const localeDiag = result.diagnostics.find((d) =>
      /authored in locale "en".*declares locale "he"/s.test(d.message),
    );
    expect(localeDiag).toBeDefined();
    expect(localeDiag!.severity).toBe("error");
    // The message names the offending prompt; the diagnostic is filed against
    // the entry treatment file (no source token, same as the extension).
    expect(localeDiag!.message).toContain("prompts/q.prompt.md");
    expect(localeDiag!.file).toBe("treatment.yaml");
  });

  it("loads cleanly when the prompt is tagged with the treatment's locale (#483)", async () => {
    const rootYaml = `
treatments:
  - name: t
    playerCount: 1
    locale: he
    gameStages:
      - name: g
        duration: 10
        elements:
          - type: prompt
            name: q
            file: prompts/q.prompt.md
introSequences:
  - name: i
    introSteps:
      - name: s
        elements:
          - type: submitButton
`;
    const fetch = routedFetch([
      ["treatment.yaml", rootYaml],
      [
        "prompts/q.prompt.md",
        "---\ntype: noResponse\nlocale: he\n---\nhello\n",
      ],
    ]);

    const result = await loadTreatmentFromUrl(BLOB_URL, fetch);
    expect(result.treatmentFile).not.toBeNull();
    expect(result.treatmentFile!.treatments[0].name).toBe("t");
    expect(result.diagnostics).toEqual([]);
  });

  it("does not flag a locale mismatch when the prompt can't be fetched (#483)", async () => {
    // A missing prompt 404s; the locale rule skips it rather than emitting a
    // spurious mismatch. (Runtime rendering surfaces the missing file.)
    const rootYaml = `
treatments:
  - name: t
    playerCount: 1
    locale: he
    gameStages:
      - name: g
        duration: 10
        elements:
          - type: prompt
            name: q
            file: prompts/q.prompt.md
introSequences:
  - name: i
    introSteps:
      - name: s
        elements:
          - type: submitButton
`;
    const fetch = routedFetch([
      ["treatment.yaml", rootYaml],
      // prompts/q.prompt.md not routed → 404
    ]);

    const result = await loadTreatmentFromUrl(BLOB_URL, fetch);
    expect(result.treatmentFile).not.toBeNull();
    expect(result.treatmentFile!.treatments[0].name).toBe("t");
    expect(result.diagnostics).toEqual([]);
  });

  it("never fetches a schema-rejected prompt path for the locale check (#483)", async () => {
    // The live-fetch surface must never turn a gated path (absolute,
    // traversal) into a network request. An absolute prompt path is rejected
    // by the treatment schema; the locale rule must not fetch it or emit a
    // second (locale) diagnostic for it.
    const rootYaml = `
treatments:
  - name: t
    playerCount: 1
    locale: he
    gameStages:
      - name: g
        duration: 10
        elements:
          - type: prompt
            name: q
            file: /etc/hosts.prompt.md
introSequences:
  - name: i
    introSteps:
      - name: s
        elements:
          - type: submitButton
`;
    const fetch = routedFetch([["treatment.yaml", rootYaml]]);

    const result = await loadTreatmentFromUrl(BLOB_URL, fetch);

    // Rejected on schema grounds (relative-path rule), not locale grounds.
    expect(result.treatmentFile).toBeNull();
    expect(
      result.diagnostics.some((d) => /relative path/.test(d.message)),
    ).toBe(true);
    expect(
      result.diagnostics.some((d) => /authored in locale/.test(d.message)),
    ).toBe(false);
    // And the gated path was never fetched.
    const fetchedUrls = (fetch.mock.calls as unknown[][]).map(
      (args) => args[0] as string,
    );
    expect(fetchedUrls.some((u) => u.includes("hosts.prompt.md"))).toBe(false);
  });

  it("checks intro-step prompts against the intro sequence's own locale (#483)", async () => {
    const rootYaml = `
introSequences:
  - name: i
    locale: he
    introSteps:
      - name: consent
        elements:
          - type: prompt
            name: c
            file: prompts/consent.prompt.md
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
    const fetch = routedFetch([
      ["treatment.yaml", rootYaml],
      ["prompts/consent.prompt.md", "---\ntype: noResponse\n---\nhello\n"],
    ]);

    const result = await loadTreatmentFromUrl(BLOB_URL, fetch);
    expect(result.treatmentFile).not.toBeNull();
    expect(
      result.diagnostics.some((d) =>
        /intro sequence "i".*declares locale "he"/s.test(d.message),
      ),
    ).toBe(true);
  });

  it("surfaces every mismatching prompt as its own diagnostic (#483)", async () => {
    const rootYaml = `
treatments:
  - name: t
    playerCount: 1
    locale: he
    gameStages:
      - name: g
        duration: 10
        elements:
          - type: prompt
            name: a
            file: prompts/a.prompt.md
          - type: prompt
            name: b
            file: prompts/b.prompt.md
introSequences:
  - name: i
    introSteps:
      - name: s
        elements:
          - type: submitButton
`;
    const fetch = routedFetch([
      ["treatment.yaml", rootYaml],
      ["prompts/a.prompt.md", "---\ntype: noResponse\n---\na\n"],
      ["prompts/b.prompt.md", "---\ntype: noResponse\n---\nb\n"],
    ]);

    const result = await loadTreatmentFromUrl(BLOB_URL, fetch);
    const localeDiags = result.diagnostics.filter((d) =>
      /authored in locale/.test(d.message),
    );
    expect(localeDiags).toHaveLength(2);
    // Each mismatch is its own diagnostic, naming its prompt in the message.
    const named = localeDiags
      .map((d) => (d.message.match(/prompts\/[ab]\.prompt\.md/) ?? [])[0])
      .sort();
    expect(named).toEqual(["prompts/a.prompt.md", "prompts/b.prompt.md"]);
  });

  it("supports transitive imports (A imports B imports C) (#312)", async () => {
    const rootYaml = `
imports:
  - ./surveys/tipi.stagebook.yaml

introSequences:
  - name: i
    introSteps:
      - template: tipi_step

treatments:
  - name: t
    playerCount: 1
    gameStages:
      - name: g
        duration: 10
        elements:
          - type: submitButton
`;
    const tipiYaml = `
imports:
  - ./shared.stagebook.yaml

templates:
  - name: tipi_step
    contentType: introExitStep
    content:
      name: tipi
      elements:
        - template: shared_button
`;
    const sharedYaml = `
templates:
  - name: shared_button
    contentType: element
    content:
      type: submitButton
      buttonText: Continue
`;

    const fetch = routedFetch([
      ["treatment.yaml", rootYaml],
      ["surveys/tipi.stagebook.yaml", tipiYaml],
      ["surveys/shared.stagebook.yaml", sharedYaml],
    ]);

    const result = await loadTreatmentFromUrl(BLOB_URL, fetch);

    // Transitive import (shared.stagebook.yaml) was fetched relative to
    // its parent file (surveys/tipi.stagebook.yaml), not relative to the
    // entry-point root. So the URL is `surveys/shared.stagebook.yaml`.
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining(
        "https://raw.githubusercontent.com/org/repo/main/surveys/shared.stagebook.yaml",
      ),
    );

    // The nested template was resolved through both layers
    expect(result.treatmentFile).not.toBeNull();
    const introStep = result.treatmentFile!.introSequences?.[0].introSteps[0];
    expect(introStep?.elements?.[0]).toMatchObject({
      type: "submitButton",
      buttonText: "Continue",
    });
  });
});
