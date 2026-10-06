import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  STAGEBOOK_VERSION,
  compareStagebookVersions,
  declaredStagebookVersion,
} from "./stagebookVersion.js";
import { validateTreatmentSource } from "./validateTreatment.js";
import { validatePromptSource } from "./validatePrompt.js";
import { validateTreatmentWithDiff } from "./validateTreatmentDiff.js";

// Some fixtures are unversioned or on an old release, so every real upgrade
// rule would apply to them. Keep the table out of these tests.
vi.mock("./upgradeRules.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./upgradeRules.js")>()),
  upgradeRules: [],
}));

const [major] = STAGEBOOK_VERSION.split(".").map(Number);
/** A version this validator can't know about, whatever release it is. */
const NEWER = `${major + 1}.0`;

const treatment = (version: string | null) =>
  `${version === null ? "" : `stagebook: ${version}\n`}treatments:
  - name: t
    playerCount: 1
    compatibleIntroSequences: []
    gameStages:
      - name: g
        duration: 10
        elements:
          - type: submitButton
`;

const prompt = (version: string, type = "noResponse") =>
  `---\ntype: ${type}\nstagebook: ${version}\n---\n# Welcome\n`;

const isNewerWarning = (message: string) => message.includes("newer than");

describe("STAGEBOOK_VERSION", () => {
  it("is a major.minor version no older than the package release", () => {
    // The constant is the version whose rules this validator implements. A
    // release bumps package.json; this test then fails until the constant
    // catches up. Between releases the constant may run ahead, when a change
    // for the next release lands with its upgrade rules.
    const pkgPath = join(
      dirname(fileURLToPath(import.meta.url)),
      "..",
      "..",
      "package.json",
    );
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as {
      version: string;
    };
    const released = pkg.version.split(".").slice(0, 2).join(".");
    expect(STAGEBOOK_VERSION).toMatch(/^\d+\.\d+$/);
    expect(
      compareStagebookVersions(STAGEBOOK_VERSION, released),
    ).toBeGreaterThanOrEqual(0);
  });
});

describe("compareStagebookVersions", () => {
  it("compares numerically, not as text", () => {
    expect(compareStagebookVersions("0.9", "0.10")).toBeLessThan(0);
    expect(compareStagebookVersions("0.10", "0.9")).toBeGreaterThan(0);
  });

  it("orders by major before minor", () => {
    expect(compareStagebookVersions("1.0", "0.99")).toBeGreaterThan(0);
  });

  it("treats equal versions as equal", () => {
    expect(compareStagebookVersions("0.34", "0.34")).toBe(0);
  });
});

describe("declaredStagebookVersion", () => {
  it("reads a well-formed version", () => {
    expect(declaredStagebookVersion({ stagebook: "0.34" })).toBe("0.34");
  });

  it.each([
    ["absent", {}],
    ["an unquoted number", { stagebook: 0.34 }],
    ["malformed", { stagebook: "0.34.1" }],
    ["not an object", "stagebook"],
  ])("is undefined when the field is %s", (_label, file) => {
    expect(declaredStagebookVersion(file)).toBeUndefined();
  });
});

describe("newer-than-validator warning — treatment file", () => {
  it("warns once at the stagebook: value, naming both versions", () => {
    const source = treatment(`"${NEWER}"`);
    const { diagnostics } = validateTreatmentSource(source);
    const warnings = diagnostics.filter((d) => isNewerWarning(d.message));
    expect(warnings).toHaveLength(1);
    expect(warnings[0].severity).toBe("warning");
    expect(warnings[0].message).toContain(`"${NEWER}"`);
    expect(warnings[0].message).toContain(STAGEBOOK_VERSION);
    expect(warnings[0].range?.startLine).toBe(0);
  });

  it.each([STAGEBOOK_VERSION, "0.1"])(
    "is silent for a version the validator knows (%s)",
    (version) => {
      const { diagnostics } = validateTreatmentSource(
        treatment(`"${version}"`),
      );
      expect(diagnostics).toEqual([]);
    },
  );

  it("is an error, not this warning, for a malformed value", () => {
    const { diagnostics } = validateTreatmentSource(treatment("9.0.0"));
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].severity).toBe("error");
    expect(diagnostics[0].message).toMatch(/"major\.minor"/);
    expect(diagnostics[0].range?.startLine).toBe(0);
  });

  it("warns once on the editor path too", async () => {
    const { diagnostics } = await validateTreatmentWithDiff({
      source: treatment(`"${NEWER}"`),
      loadImport: () => Promise.reject(new Error("no imports")),
    });
    const warnings = diagnostics.filter((d) => isNewerWarning(d.message));
    expect(warnings).toHaveLength(1);
    expect(warnings[0].severity).toBe("warning");
    expect(warnings[0].range?.startLine).toBe(0);
  });

  it("reports a malformed value once, as an error, on the editor path", async () => {
    const { diagnostics } = await validateTreatmentWithDiff({
      source: treatment('"0.x"'),
      loadImport: () => Promise.reject(new Error("no imports")),
    });
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].severity).toBe("error");
    expect(diagnostics[0].message).toMatch(/"major\.minor"/);
  });
});

describe("newer-than-validator warning — prompt file", () => {
  it("warns at the stagebook: line, naming both versions", () => {
    const { diagnostics } = validatePromptSource(prompt(`"${NEWER}"`));
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].severity).toBe("warning");
    expect(diagnostics[0].message).toContain(`"${NEWER}"`);
    expect(diagnostics[0].message).toContain(STAGEBOOK_VERSION);
    expect(diagnostics[0].range?.startLine).toBe(2);
  });

  it("still warns when the prompt fails validation, since the newer release may explain why", () => {
    const { diagnostics } = validatePromptSource(
      prompt(`"${NEWER}"`, "futureType"),
    );
    expect(diagnostics.some((d) => d.severity === "error")).toBe(true);
    expect(
      diagnostics.filter(
        (d) => d.severity === "warning" && isNewerWarning(d.message),
      ),
    ).toHaveLength(1);
  });

  it("is silent for the current version", () => {
    const { diagnostics } = validatePromptSource(
      prompt(`"${STAGEBOOK_VERSION}"`),
    );
    expect(diagnostics).toEqual([]);
  });

  it("is an error, not this warning, for a malformed value", () => {
    const { diagnostics } = validatePromptSource(prompt("0.30"));
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].severity).toBe("error");
    expect(diagnostics[0].message).toMatch(/quoted/);
    expect(diagnostics[0].range?.startLine).toBe(2);
  });
});
