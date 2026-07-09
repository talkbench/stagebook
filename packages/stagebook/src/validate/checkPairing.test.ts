import { describe, expect, test } from "vitest";
import { checkPairing } from "./checkPairing.js";

/**
 * Runtime pairing guard (#499). `checkPairing` is what a host calls at
 * batch launch, with the already-expanded treatment file, to verify
 * that the selected intro sequence may legally precede every selected
 * treatment and provides everything they reference.
 */

function promptEl(name: string): Record<string, unknown> {
  return { type: "prompt", file: `${name}.prompt.md`, name };
}

const FILE = {
  introSequences: [
    {
      name: "prolific",
      introSteps: [
        {
          name: "survey",
          elements: [promptEl("color"), { type: "submitButton" }],
        },
      ],
    },
    {
      name: "pilot",
      introSteps: [
        {
          name: "welcome",
          elements: [promptEl("shape"), { type: "submitButton" }],
        },
      ],
    },
  ],
  treatments: [
    {
      name: "uses_color",
      playerCount: 1,
      compatibleIntroSequences: ["prolific"],
      gameStages: [
        {
          name: "s1",
          duration: 60,
          elements: [
            {
              type: "submitButton",
              name: "done",
              conditions: [
                { reference: "self.prompt.color", comparator: "exists" },
              ],
            },
          ],
        },
      ],
    },
    {
      name: "standalone",
      playerCount: 1,
      compatibleIntroSequences: [],
      gameStages: [
        {
          name: "s1",
          duration: 60,
          elements: [{ type: "submitButton", name: "done" }],
        },
      ],
    },
  ],
};

describe("checkPairing", () => {
  test("valid pairing → no diagnostics", () => {
    const diags = checkPairing(FILE, { introSequenceName: "prolific" }, [
      "uses_color",
    ]);
    expect(diags).toHaveLength(0);
  });

  test("unknown intro sequence → error listing defined names", () => {
    const diags = checkPairing(FILE, { introSequenceName: "ghost" }, [
      "uses_color",
    ]);
    expect(diags.length).toBeGreaterThan(0);
    expect(diags[0].severity).toBe("error");
    expect(diags[0].message).toContain("ghost");
    expect(diags[0].message).toContain("prolific");
    expect(diags[0].message).toContain("pilot");
  });

  test("unknown treatment name → error", () => {
    const diags = checkPairing(FILE, { introSequenceName: "prolific" }, [
      "nope",
    ]);
    expect(diags.some((d) => d.message.includes('"nope"'))).toBe(true);
  });

  test("treatment does not list the selected sequence → error", () => {
    const diags = checkPairing(FILE, { introSequenceName: "pilot" }, [
      "uses_color",
    ]);
    expect(
      diags.some(
        (d) =>
          d.message.includes('"uses_color"') && d.message.includes('"pilot"'),
      ),
    ).toBe(true);
  });

  test("launching without an intro sequence: only compatibleIntroSequences:[] treatments pass", () => {
    const ok = checkPairing(FILE, { introSequenceName: null }, ["standalone"]);
    expect(ok).toHaveLength(0);

    const bad = checkPairing(FILE, { introSequenceName: null }, ["uses_color"]);
    expect(bad.length).toBeGreaterThan(0);
  });

  test("listed sequence that fails to provide a referenced key → error", () => {
    // Force the constraint through: pretend uses_color listed pilot too.
    const file = structuredClone(FILE) as typeof FILE;
    (file.treatments[0].compatibleIntroSequences as string[]).push("pilot");
    const diags = checkPairing(file, { introSequenceName: "pilot" }, [
      "uses_color",
    ]);
    expect(diags.length).toBeGreaterThan(0);
    expect(diags.some((d) => /color/.test(d.message))).toBe(true);
  });

  test("mixed selection: constraint failure and data failure name the right treatments", () => {
    const file = structuredClone(FILE) as typeof FILE;
    // third treatment: lists pilot but references color (which pilot lacks)
    (file.treatments as Record<string, unknown>[]).push({
      ...structuredClone(FILE.treatments[0]),
      name: "wants_color_from_pilot",
      compatibleIntroSequences: ["pilot"],
    });
    const diags = checkPairing(file, { introSequenceName: "pilot" }, [
      "uses_color", // constraint fail: doesn't list pilot
      "wants_color_from_pilot", // data fail: pilot doesn't provide color
      "standalone", // constraint fail: declares []
    ]);
    // The data-check error must name wants_color_from_pilot — NOT
    // uses_color (filtered out of the walker run by the constraint
    // check, so synthetic indices shift).
    const dataDiag = diags.find(
      (d) => /color/.test(d.message) && /In treatment/.test(d.message),
    );
    expect(dataDiag?.message).toContain('"wants_color_from_pilot"');
    expect(dataDiag?.message).not.toContain('"uses_color"');
    expect(diags.some((d) => d.message.includes('"uses_color"'))).toBe(true);
    expect(diags.some((d) => d.message.includes('"standalone"'))).toBe(true);
  });

  test("empty treatmentNames → vacuous pass (contract: nothing selected, nothing to check)", () => {
    expect(checkPairing(FILE, { introSequenceName: "prolific" }, [])).toEqual(
      [],
    );
  });

  test("duplicate names in treatmentNames → one diagnostic per occurrence", () => {
    const diags = checkPairing(FILE, { introSequenceName: "pilot" }, [
      "uses_color",
      "uses_color",
    ]);
    expect(
      diags.filter((d) => d.message.includes('"uses_color"')),
    ).toHaveLength(2);
  });

  test("selected sequence but file has no introSequences collection → single clear error", () => {
    const diags = checkPairing(
      { treatments: FILE.treatments },
      { introSequenceName: "prolific" },
      ["uses_color"],
    );
    expect(diags).toHaveLength(1);
    expect(diags[0].message).toContain(
      "The file defines no named intro sequences.",
    );
  });

  test("diagnostics carry null ranges (runtime check, no source positions)", () => {
    const diags = checkPairing(FILE, { introSequenceName: "ghost" }, [
      "uses_color",
    ]);
    expect(diags.every((d) => d.range === null)).toBe(true);
  });

  test("unexpanded placeholder in a selected treatment → error telling host to expand first", () => {
    const file = structuredClone(FILE) as Record<string, unknown>;
    (file.treatments as Record<string, unknown>[])[0].compatibleIntroSequences =
      "${intros}";
    const diags = checkPairing(file, { introSequenceName: "prolific" }, [
      "uses_color",
    ]);
    expect(diags.some((d) => /placeholder|expand/i.test(d.message))).toBe(true);
  });
});

describe("checkPairing input hygiene (Copilot review)", () => {
  test("array with non-string entries → uninterpretable-declaration error, not a confusing constraint error", () => {
    const file = structuredClone(FILE) as Record<string, unknown>;
    (file.treatments as Record<string, unknown>[])[0].compatibleIntroSequences =
      [5, "prolific"];
    const diags = checkPairing(file, { introSequenceName: "prolific" }, [
      "uses_color",
    ]);
    expect(diags).toHaveLength(1);
    expect(diags[0].message).toMatch(/uninterpretable/);
  });
});

describe("exit-step references under checkPairing (#481)", () => {
  test("exit-step references are verified under the selected sequence", () => {
    const seq = (name: string, key: string) => ({
      name,
      introSteps: [
        {
          name: "s",
          elements: [
            { type: "prompt", file: `${key}.prompt.md`, name: key },
            { type: "submitButton" },
          ],
        },
      ],
    });
    const file = {
      introSequences: [seq("a", "color"), seq("b", "shape")],
      treatments: [
        {
          name: "t",
          playerCount: 1,
          compatibleIntroSequences: ["a", "b"],
          gameStages: [
            {
              name: "s1",
              duration: 60,
              elements: [{ type: "submitButton", name: "done" }],
            },
          ],
          exitSequence: [
            {
              name: "d",
              elements: [
                {
                  type: "submitButton",
                  conditions: [
                    { reference: "self.prompt.color", comparator: "exists" },
                  ],
                },
              ],
            },
          ],
        },
      ],
    };
    expect(checkPairing(file, { introSequenceName: "a" }, ["t"])).toHaveLength(
      0,
    );
    const diags = checkPairing(file, { introSequenceName: "b" }, ["t"]);
    expect(diags).toHaveLength(1);
    expect(diags[0].message).toMatch(/self\.prompt\.color/);
  });
});
