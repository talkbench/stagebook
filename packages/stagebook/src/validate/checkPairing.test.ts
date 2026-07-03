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
      introSequences: ["prolific"],
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
      introSequences: [],
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

  test("launching without an intro sequence: only introSequences:[] treatments pass", () => {
    const ok = checkPairing(FILE, { introSequenceName: null }, ["standalone"]);
    expect(ok).toHaveLength(0);

    const bad = checkPairing(FILE, { introSequenceName: null }, ["uses_color"]);
    expect(bad.length).toBeGreaterThan(0);
  });

  test("listed sequence that fails to provide a referenced key → error", () => {
    // Force the constraint through: pretend uses_color listed pilot too.
    const file = structuredClone(FILE) as typeof FILE;
    (file.treatments[0].introSequences as string[]).push("pilot");
    const diags = checkPairing(file, { introSequenceName: "pilot" }, [
      "uses_color",
    ]);
    expect(diags.length).toBeGreaterThan(0);
    expect(diags.some((d) => /color/.test(d.message))).toBe(true);
  });

  test("diagnostics carry null ranges (runtime check, no source positions)", () => {
    const diags = checkPairing(FILE, { introSequenceName: "ghost" }, [
      "uses_color",
    ]);
    expect(diags.every((d) => d.range === null)).toBe(true);
  });

  test("unexpanded placeholder in a selected treatment → error telling host to expand first", () => {
    const file = structuredClone(FILE) as Record<string, unknown>;
    (file.treatments as Record<string, unknown>[])[0].introSequences =
      "${intros}";
    const diags = checkPairing(file, { introSequenceName: "prolific" }, [
      "uses_color",
    ]);
    expect(diags.some((d) => /placeholder|expand/i.test(d.message))).toBe(true);
  });
});
