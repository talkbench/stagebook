import { describe, it, expect } from "vitest";
import {
  flattenSteps,
  localeForPhase,
  buildUnits,
  initialUnitKey,
} from "./steps";

describe("flattenSteps", () => {
  const introSequence = {
    name: "intro1",
    introSteps: [
      {
        name: "consent",
        elements: [{ type: "submitButton" as const, buttonText: "I agree" }],
      },
      {
        name: "demographics",
        elements: [
          {
            type: "prompt" as const,
            name: "age",
            file: "prompts/age.prompt.md",
          },
          { type: "submitButton" as const, buttonText: "Continue" },
        ],
      },
    ],
  };

  const treatment = {
    name: "treatment1",
    playerCount: 2,
    gameStages: [
      {
        name: "round1",
        duration: 60,
        elements: [
          {
            type: "prompt" as const,
            name: "vote",
            file: "prompts/vote.prompt.md",
          },
        ],
      },
      {
        name: "round2",
        duration: 120,
        elements: [
          {
            type: "prompt" as const,
            name: "vote2",
            file: "prompts/vote2.prompt.md",
          },
        ],
      },
    ],
    exitSequence: [
      {
        name: "debrief",
        elements: [
          {
            type: "prompt" as const,
            name: "feedback",
            file: "prompts/feedback.prompt.md",
          },
          { type: "submitButton" as const, buttonText: "Finish" },
        ],
      },
    ],
  };

  it("produces a flat list of steps in order: intro, game, exit", () => {
    const steps = flattenSteps(introSequence, treatment);
    expect(steps.map((s) => s.name)).toEqual([
      "consent",
      "demographics",
      "round1",
      "round2",
      "debrief",
    ]);
  });

  it("tags each step with its phase", () => {
    const steps = flattenSteps(introSequence, treatment);
    expect(steps.map((s) => s.phase)).toEqual([
      "intro",
      "intro",
      "game",
      "game",
      "exit",
    ]);
  });

  it("preserves stage properties like duration", () => {
    const steps = flattenSteps(introSequence, treatment);
    const round1 = steps.find((s) => s.name === "round1")!;
    expect(round1.duration).toBe(60);
  });

  it("works without an exit sequence", () => {
    const noExit = { ...treatment, exitSequence: undefined };
    const steps = flattenSteps(introSequence, noExit);
    expect(steps.map((s) => s.name)).toEqual([
      "consent",
      "demographics",
      "round1",
      "round2",
    ]);
  });

  it("assigns sequential indices", () => {
    const steps = flattenSteps(introSequence, treatment);
    expect(steps.map((s) => s.index)).toEqual([0, 1, 2, 3, 4]);
  });

  it("carries notes through on intro steps, game stages, and exit steps", () => {
    const introWithNotes = {
      ...introSequence,
      introSteps: [
        { ...introSequence.introSteps[0], notes: "Intro step rationale" },
        introSequence.introSteps[1],
      ],
    };
    const treatmentWithNotes = {
      ...treatment,
      gameStages: [
        { ...treatment.gameStages[0], notes: "Stage rationale" },
        treatment.gameStages[1],
      ],
      exitSequence: [
        { ...treatment.exitSequence[0], notes: "Debrief rationale" },
      ],
    };
    const steps = flattenSteps(introWithNotes, treatmentWithNotes);
    expect(steps.find((s) => s.name === "consent")?.notes).toBe(
      "Intro step rationale",
    );
    expect(steps.find((s) => s.name === "round1")?.notes).toBe(
      "Stage rationale",
    );
    expect(steps.find((s) => s.name === "debrief")?.notes).toBe(
      "Debrief rationale",
    );
    // Unannotated steps have no notes.
    expect(steps.find((s) => s.name === "round2")?.notes).toBeUndefined();
  });

  it("carries discussion through on game stages", () => {
    const discussion = {
      chatType: "video" as const,
      showNickname: true,
      showTitle: true,
      showSelfView: true,
      showReportMissing: true,
      showAudioMute: true,
      showVideoMute: true,
    };
    const withDiscussion = {
      ...treatment,
      gameStages: [
        { ...treatment.gameStages[0], discussion },
        treatment.gameStages[1],
      ],
    };
    const steps = flattenSteps(introSequence, withDiscussion);
    const round1 = steps.find((s) => s.name === "round1")!;
    const round2 = steps.find((s) => s.name === "round2")!;
    expect(round1.discussion).toEqual(discussion);
    expect(round2.discussion).toBeUndefined();
  });

  it("works with no intro sequence (treatments-only file)", () => {
    // A file may declare only `treatments:` (no `introSequences:`); the
    // walkthrough then starts at the first game stage.
    const steps = flattenSteps(undefined, treatment);
    expect(steps.length).toBeGreaterThan(0);
    expect(steps[0]?.phase).toBe("game");
    expect(steps.some((s) => s.phase === "intro")).toBe(false);
  });
});

describe("localeForPhase", () => {
  const introHe = { locale: "he" };
  const treatmentEn = { locale: "en" };

  it("intro phase uses the intro sequence's locale", () => {
    expect(localeForPhase("intro", introHe, treatmentEn)).toBe("he");
  });

  it("game and exit phases use the treatment's locale", () => {
    expect(localeForPhase("game", introHe, treatmentEn)).toBe("en");
    expect(localeForPhase("exit", introHe, treatmentEn)).toBe("en");
  });

  it("an intro sequence does not inherit the treatment's locale", () => {
    // he treatment, en (or absent) intro → intro stays en, not he.
    expect(localeForPhase("intro", { locale: "en" }, { locale: "he" })).toBe(
      "en",
    );
    expect(localeForPhase("intro", undefined, { locale: "he" })).toBe("en");
  });

  it("defaults to en when a phase declares no locale", () => {
    expect(localeForPhase("intro", {}, {})).toBe("en");
    expect(localeForPhase("game", undefined, {})).toBe("en");
    expect(localeForPhase(undefined, undefined, {})).toBe("en");
  });
});

describe("buildUnits", () => {
  const treatment = {
    name: "treatment1",
    playerCount: 2,
    gameStages: [
      { name: "round1", duration: 60, elements: [] },
      { name: "round2", duration: 120, elements: [] },
    ],
    exitSequence: [{ name: "debrief", elements: [] }],
  };

  it("yields one unit per intro sequence and treatment, in picker order", () => {
    const file = {
      introSequences: [
        {
          name: "consent",
          locale: "he",
          introSteps: [{ name: "c1", elements: [] }],
        },
      ],
      treatments: [treatment, { ...treatment, name: "treatment2" }],
    };
    const units = buildUnits(file);
    expect(units.map((u) => u.key)).toEqual([
      "intro:0",
      "treatment:0",
      "treatment:1",
    ]);
    expect(units.map((u) => u.kind)).toEqual([
      "intro",
      "treatment",
      "treatment",
    ]);
  });

  it("each unit carries its own locale + playerCount", () => {
    const units = buildUnits({
      introSequences: [
        { name: "i", locale: "he", introSteps: [{ name: "s", elements: [] }] },
      ],
      treatments: [{ ...treatment, locale: "en", playerCount: 3 }],
    });
    expect(units[0]).toMatchObject({
      kind: "intro",
      locale: "he",
      playerCount: 1,
    });
    expect(units[1]).toMatchObject({
      kind: "treatment",
      locale: "en",
      playerCount: 3,
    });
  });

  it("appends a transition step to each unit", () => {
    const units = buildUnits({ treatments: [treatment] });
    const last = units[0].steps[units[0].steps.length - 1];
    expect(last.isTransition).toBe(true);
    expect(last.transitionCopy).toContain(treatment.name);
    // The real stages still precede it.
    expect(
      units[0].steps.filter((s) => !s.isTransition).map((s) => s.name),
    ).toEqual(["round1", "round2", "debrief"]);
  });

  it("handles a treatments-only file (no introSequences)", () => {
    const units = buildUnits({ treatments: [treatment] });
    expect(units.every((u) => u.kind === "treatment")).toBe(true);
  });

  it("handles an intro-only file (no treatments)", () => {
    const units = buildUnits({
      introSequences: [
        { name: "i", introSteps: [{ name: "s", elements: [] }] },
      ],
    });
    expect(units).toHaveLength(1);
    expect(units[0].kind).toBe("intro");
  });

  it("transition copy only points at the picker when 2+ units exist", () => {
    // Single treatment → no picker, so no 'picker above' instruction.
    const solo = buildUnits({ treatments: [treatment] });
    const soloCopy = solo[0].steps.at(-1)!.transitionCopy!;
    expect(soloCopy).toContain(treatment.name);
    expect(soloCopy).not.toMatch(/picker above/i);

    // Two treatments → picker exists, so the treatment transition points to it.
    const multi = buildUnits({
      treatments: [treatment, { ...treatment, name: "treatment2" }],
    });
    expect(multi[0].steps.at(-1)!.transitionCopy).toMatch(
      /picker above to preview another part/i,
    );
  });

  it("intro transition mentions previewing a treatment only when one exists", () => {
    // Intro + treatment → intro transition invites previewing the treatment.
    const withT = buildUnits({
      introSequences: [
        { name: "i", introSteps: [{ name: "s", elements: [] }] },
      ],
      treatments: [treatment],
    });
    expect(withT[0].steps.at(-1)!.transitionCopy).toMatch(
      /picker above to preview a treatment/i,
    );

    // Intro-only (single) → no picker, no treatment to point at.
    const introOnly = buildUnits({
      introSequences: [
        { name: "i", introSteps: [{ name: "s", elements: [] }] },
      ],
    });
    const copy = introOnly[0].steps.at(-1)!.transitionCopy!;
    expect(copy).not.toMatch(/picker above/i);
    expect(copy).not.toMatch(/preview a treatment/i);
  });
});

describe("initialUnitKey", () => {
  const treatment = {
    name: "treatment1",
    playerCount: 2,
    gameStages: [{ name: "round1", duration: 60, elements: [] }],
  };
  const file = {
    introSequences: [
      { name: "i0", introSteps: [{ name: "s", elements: [] }] },
      { name: "i1", introSteps: [{ name: "s", elements: [] }] },
    ],
    treatments: [treatment, { ...treatment, name: "t1" }],
  };

  it("prefers the selected treatment when it exists", () => {
    const units = buildUnits(file);
    expect(initialUnitKey(units, 1, 1)).toBe("treatment:1");
  });

  it("falls back to the selected intro when no treatment matches (intro-only)", () => {
    const units = buildUnits({ introSequences: file.introSequences });
    // No treatment unit, so the chosen intro (#1) is honored rather than
    // silently opening the first intro.
    expect(initialUnitKey(units, 1, 0)).toBe("intro:1");
  });

  it("falls back to the first unit when neither index matches", () => {
    const units = buildUnits({ treatments: [treatment] });
    expect(initialUnitKey(units, 5, 9)).toBe("treatment:0");
  });

  it("returns a treatment key as last resort when there are no units", () => {
    expect(initialUnitKey([], 0, 3)).toBe("treatment:3");
  });
});
