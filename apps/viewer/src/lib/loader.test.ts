import { describe, it, expect, vi } from "vitest";
import { loadTreatmentFromUrl } from "./loader";
import { TreatmentValidationError } from "./treatment";

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

describe("loadTreatmentFromUrl", () => {
  it("fetches, parses, and expands a treatment file", async () => {
    const fetch = mockFetch(MINIMAL_YAML);
    const result = await loadTreatmentFromUrl(
      "https://github.com/org/repo/blob/main/treatment.yaml",
      fetch,
    );
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining(
        "https://raw.githubusercontent.com/org/repo/main/treatment.yaml",
      ),
    );
    expect(result.treatmentFile.treatments).toHaveLength(1);
    expect(result.treatmentFile.treatments[0].name).toBe("treatment1");
    expect(result.unresolvedFields).toEqual([]);
    expect(result.rawBaseUrl).toBe(
      "https://raw.githubusercontent.com/org/repo/main/",
    );
  });

  it("throws on fetch failure", async () => {
    const fetch = mockFetch("Not Found", false);
    await expect(
      loadTreatmentFromUrl(
        "https://github.com/org/repo/blob/main/treatment.yaml",
        fetch,
      ),
    ).rejects.toThrow("Failed to fetch");
  });

  it("throws on invalid YAML", async () => {
    const fetch = mockFetch("{{bad yaml");
    await expect(
      loadTreatmentFromUrl(
        "https://github.com/org/repo/blob/main/treatment.yaml",
        fetch,
      ),
    ).rejects.toThrow();
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

    const result = await loadTreatmentFromUrl(
      "https://github.com/org/repo/blob/main/treatment.yaml",
      fetch,
    );

    // Imports should have been fetched from the same repo + branch
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining(
        "https://raw.githubusercontent.com/org/repo/main/modules/consent.stagebook.yaml",
      ),
    );

    // The template invocation resolved during expansion
    expect(result.treatmentFile.introSequences?.[0].introSteps[0].name).toBe(
      "consent",
    );
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

    await expect(
      loadTreatmentFromUrl(
        "https://github.com/org/repo/blob/main/treatment.yaml",
        fetch,
      ),
    ).rejects.toThrow(
      /Failed to fetch imported file 'modules\/missing\.stagebook\.yaml'.*HTTP 404.*same repo/s,
    );
  });

  // -- #483: prompt locale-consistency on load --

  it("rejects when a he treatment references an untagged (en) prompt (#483)", async () => {
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

    await expect(
      loadTreatmentFromUrl(
        "https://github.com/org/repo/blob/main/treatment.yaml",
        fetch,
      ),
    ).rejects.toThrow(/authored in locale "en".*declares locale "he"/s);
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

    const result = await loadTreatmentFromUrl(
      "https://github.com/org/repo/blob/main/treatment.yaml",
      fetch,
    );
    expect(result.treatmentFile.treatments[0].name).toBe("t");
  });

  it("does not reject on locale grounds when the prompt can't be fetched (#483)", async () => {
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

    const result = await loadTreatmentFromUrl(
      "https://github.com/org/repo/blob/main/treatment.yaml",
      fetch,
    );
    expect(result.treatmentFile.treatments[0].name).toBe("t");
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

    const err = await loadTreatmentFromUrl(
      "https://github.com/org/repo/blob/main/treatment.yaml",
      fetch,
    ).catch((e: unknown) => e);

    // Rejected on schema grounds (relative-path rule), not locale grounds.
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toMatch(/relative path/);
    expect((err as Error).message).not.toMatch(/authored in locale/);
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

    await expect(
      loadTreatmentFromUrl(
        "https://github.com/org/repo/blob/main/treatment.yaml",
        fetch,
      ),
    ).rejects.toThrow(/intro sequence "i".*declares locale "he"/s);
  });

  it("surfaces every mismatching prompt, not just the first (#483)", async () => {
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

    const err = await loadTreatmentFromUrl(
      "https://github.com/org/repo/blob/main/treatment.yaml",
      fetch,
    ).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(TreatmentValidationError);
    expect((err as TreatmentValidationError).issues).toHaveLength(2);
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

    const result = await loadTreatmentFromUrl(
      "https://github.com/org/repo/blob/main/treatment.yaml",
      fetch,
    );

    // Transitive import (shared.stagebook.yaml) was fetched relative to
    // its parent file (surveys/tipi.stagebook.yaml), not relative to the
    // entry-point root. So the URL is `surveys/shared.stagebook.yaml`.
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining(
        "https://raw.githubusercontent.com/org/repo/main/surveys/shared.stagebook.yaml",
      ),
    );

    // The nested template was resolved through both layers
    const introStep = result.treatmentFile.introSequences?.[0].introSteps[0];
    expect(introStep?.elements?.[0]).toMatchObject({
      type: "submitButton",
      buttonText: "Continue",
    });
  });
});
