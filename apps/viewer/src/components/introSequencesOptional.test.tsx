// @vitest-environment jsdom
//
// Regression guard for the crash that shipped twice (#479): a treatments-only
// treatment file (no `introSequences:`) must render in every host component
// that reads `introSequences`. `altTemplateContext` types that field as `any`
// in the built .d.ts, so tsc can't catch a `.length`/`.map`/`[idx]`-on-
// undefined regression — these render tests are the guard. Also pins the
// viewer's per-phase locale (intro sequence vs treatment).
import { describe, it, expect, beforeAll } from "vitest";
import React, { type ReactNode } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { TreatmentFileType } from "stagebook";
import { OverviewPage } from "./OverviewPage";
import { TreatmentPicker } from "./TreatmentPicker";
import { Viewer } from "./Viewer";

beforeAll(() => {
  // jsdom lacks these; Viewer's scroll-awareness + Stage touch them.
  if (!("ResizeObserver" in globalThis)) {
    (globalThis as { ResizeObserver?: unknown }).ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
  }
  if (!window.matchMedia) {
    window.matchMedia = (() => ({
      matches: false,
      addEventListener() {},
      removeEventListener() {},
    })) as unknown as typeof window.matchMedia;
  }
});

function render(node: ReactNode): {
  container: HTMLElement;
  rerender: (next: ReactNode) => void;
  unmount: () => void;
} {
  const container = document.createElement("div");
  document.body.appendChild(container);
  let root: Root;
  act(() => {
    root = createRoot(container);
    root.render(node);
  });
  return {
    container,
    rerender: (next: ReactNode) =>
      act(() => {
        root.render(next);
      }),
    unmount: () =>
      act(() => {
        root.unmount();
        container.remove();
      }),
  };
}

/** Switch the "part to preview" picker to the given unit key. */
function selectUnit(container: HTMLElement, key: string): void {
  const picker = container.querySelector(
    'select[aria-label="Part to preview"]',
  ) as HTMLSelectElement | null;
  if (!picker) throw new Error("part picker not found");
  act(() => {
    picker.value = key;
    picker.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

const noop = () => {};
const getText = () => Promise.resolve("# x");
const getAsset = (p: string) => p;

/** A valid treatments-only file: no `introSequences:` key at all. */
function treatmentsOnlyFile(locale?: string): TreatmentFileType {
  return {
    treatments: [
      {
        name: "study1",
        ...(locale ? { locale } : {}),
        playerCount: 1,
        gameStages: [
          { name: "s1", duration: 60, elements: [{ type: "submitButton" }] },
        ],
      },
    ],
  } as unknown as TreatmentFileType;
}

/** A valid intro-only file: no `treatments:` key at all. The structure you
 *  preview while still building the intro, before any treatment exists. */
function introOnlyFile(): TreatmentFileType {
  return {
    introSequences: [
      {
        name: "intro1",
        locale: "en",
        introSteps: [{ name: "welcome", elements: [{ type: "submitButton" }] }],
      },
    ],
  } as unknown as TreatmentFileType;
}

/** An empty file: neither intro sequences nor treatments. */
function emptyFile(): TreatmentFileType {
  return {} as unknown as TreatmentFileType;
}

/** An intro (with a submit button) plus a treatment of `playerCount` players,
 *  to exercise unit-switch state hygiene (submitted flags, position). */
function introPlusTreatmentFile(playerCount = 3): TreatmentFileType {
  return {
    introSequences: [
      {
        name: "intro1",
        locale: "en",
        introSteps: [{ name: "consent", elements: [{ type: "submitButton" }] }],
      },
    ],
    treatments: [
      {
        name: "study1",
        locale: "en",
        playerCount,
        gameStages: [
          { name: "s1", duration: 60, elements: [{ type: "submitButton" }] },
        ],
      },
    ],
  } as unknown as TreatmentFileType;
}

/** he intro sequence + en treatment, to exercise per-phase locale. */
function introHeTreatmentEnFile(): TreatmentFileType {
  return {
    introSequences: [
      {
        name: "intro1",
        locale: "he",
        introSteps: [{ name: "consent", elements: [{ type: "submitButton" }] }],
      },
    ],
    treatments: [
      {
        name: "study1",
        locale: "en",
        playerCount: 1,
        gameStages: [
          { name: "s1", duration: 60, elements: [{ type: "submitButton" }] },
        ],
      },
    ],
  } as unknown as TreatmentFileType;
}

describe("treatments-only file renders (no introSequences)", () => {
  it("OverviewPage does not crash", () => {
    const { container, unmount } = render(
      <OverviewPage
        treatmentFile={treatmentsOnlyFile()}
        readmeContent={null}
        onSelect={noop}
      />,
    );
    expect(container.textContent).toBeTruthy();
    unmount();
  });

  it("TreatmentPicker does not crash", () => {
    const { container, unmount } = render(
      <TreatmentPicker treatmentFile={treatmentsOnlyFile()} onSelect={noop} />,
    );
    expect(container.textContent).toBeTruthy();
    unmount();
  });

  it("Viewer does not crash and starts at the first game stage", () => {
    const { container, unmount } = render(
      <Viewer
        treatmentFile={treatmentsOnlyFile("he")}
        getTextContent={getText}
        getAssetURL={getAsset}
        selectedIntroIndex={0}
        selectedTreatmentIndex={0}
      />,
    );
    // Renders, and the locale badge shows the treatment's declared locale
    // (no intro phase to override it).
    const badge = container.querySelector(
      '[data-testid="viewer-locale-badge"]',
    );
    expect(badge?.textContent).toBe("he");
    unmount();
  });
});

describe("intro-only file renders (no treatments)", () => {
  // Symmetric to the treatments-only case: `treatments` is also optional in
  // the schema, so previewing while you've only built the intro must not
  // crash. See #476 (the secondary note).
  it("OverviewPage does not crash", () => {
    const { container, unmount } = render(
      <OverviewPage
        treatmentFile={introOnlyFile()}
        readmeContent={null}
        onSelect={noop}
      />,
    );
    expect(container.textContent).toBeTruthy();
    unmount();
  });

  it("TreatmentPicker does not crash", () => {
    const { container, unmount } = render(
      <TreatmentPicker treatmentFile={introOnlyFile()} onSelect={noop} />,
    );
    expect(container.textContent).toBeTruthy();
    unmount();
  });

  it("Viewer starts at the intro unit", () => {
    const { container, unmount } = render(
      <Viewer
        treatmentFile={introOnlyFile()}
        getTextContent={getText}
        getAssetURL={getAsset}
        selectedIntroIndex={0}
        selectedTreatmentIndex={0}
      />,
    );
    // No treatment unit exists, so the viewer falls back to the only unit
    // (the intro) rather than blanking. Locale badge shows its locale.
    const badge = container.querySelector(
      '[data-testid="viewer-locale-badge"]',
    );
    expect(badge?.textContent).toBe("en");
    unmount();
  });
});

describe("empty file renders a placeholder (no intro, no treatment)", () => {
  it("Viewer shows the empty-state, not a blank screen or crash", () => {
    const { container, unmount } = render(
      <Viewer
        treatmentFile={emptyFile()}
        getTextContent={getText}
        getAssetURL={getAsset}
        selectedIntroIndex={0}
        selectedTreatmentIndex={0}
      />,
    );
    expect(
      container.querySelector('[data-testid="viewer-empty"]'),
    ).not.toBeNull();
    unmount();
  });

  it("keeps the back + refresh controls so the user isn't stranded", () => {
    // In VS Code you refresh the empty preview after adding the first part;
    // in the standalone app you need a way back to the landing page.
    const { container, unmount } = render(
      <Viewer
        treatmentFile={emptyFile()}
        getTextContent={getText}
        getAssetURL={getAsset}
        selectedIntroIndex={0}
        selectedTreatmentIndex={0}
        onBack={noop}
        onRefresh={noop}
      />,
    );
    expect(container.querySelector('[aria-label="Back"]')).not.toBeNull();
    expect(
      container.querySelector('[aria-label="Refresh preview"]'),
    ).not.toBeNull();
    unmount();
  });
});

describe("unit-switch state hygiene", () => {
  it("does not carry a submitted intro step into the treatment's first stage", () => {
    const { container, unmount } = render(
      <Viewer
        treatmentFile={introPlusTreatmentFile()}
        getTextContent={getText}
        getAssetURL={getAsset}
        selectedIntroIndex={0}
        selectedTreatmentIndex={0}
      />,
    );
    const main = () => container.querySelector("main")!;

    // Switch to the intro unit and submit its only step → waiting overlay.
    selectUnit(container, "intro:0");
    const submit = main().querySelector(
      '[data-testid="submitButton"]',
    ) as HTMLButtonElement | null;
    expect(submit).not.toBeNull();
    act(() => {
      submit!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(main().textContent).toContain("Waiting for other participants");

    // Switch to the treatment: its first stage must render fresh, NOT inherit
    // the intro's submitted[0] (which would show the waiting overlay).
    selectUnit(container, "treatment:0");
    expect(main().textContent).not.toContain("Waiting for other participants");
    expect(main().querySelector('[data-testid="submitButton"]')).not.toBeNull();
    unmount();
  });

  it("clamps the participant position when switching to a 1-player unit", () => {
    const { container, unmount } = render(
      <Viewer
        treatmentFile={introPlusTreatmentFile(3)}
        getTextContent={getText}
        getAssetURL={getAsset}
        selectedIntroIndex={0}
        selectedTreatmentIndex={0}
      />,
    );
    const positionSelect = () =>
      container.querySelector("#position-select") as HTMLSelectElement;

    // On the 3-player treatment, pick participant 2.
    expect(positionSelect().options).toHaveLength(3);
    act(() => {
      positionSelect().value = "2";
      positionSelect().dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(positionSelect().value).toBe("2");

    // Switch to the intro (always 1 player): the select must collapse to a
    // single in-range option, not keep an impossible index.
    selectUnit(container, "intro:0");
    expect(positionSelect().options).toHaveLength(1);
    expect(positionSelect().value).toBe("0");
    unmount();
  });
});

describe("selection survives an in-place refresh", () => {
  it("stays on the chosen intro when the file is re-supplied (VS Code save)", () => {
    const { container, rerender, unmount } = render(
      <Viewer
        treatmentFile={introHeTreatmentEnFile()}
        getTextContent={getText}
        getAssetURL={getAsset}
        selectedIntroIndex={0}
        selectedTreatmentIndex={0}
      />,
    );
    const badge = () =>
      container.querySelector('[data-testid="viewer-locale-badge"]')
        ?.textContent;

    // Choose the intro unit (he).
    selectUnit(container, "intro:0");
    expect(badge()).toBe("he");

    // A refresh hands us a fresh-but-equal treatmentFile object. The viewer
    // must keep the intro the user was on, not snap back to the treatment.
    rerender(
      <Viewer
        treatmentFile={introHeTreatmentEnFile()}
        getTextContent={getText}
        getAssetURL={getAsset}
        selectedIntroIndex={0}
        selectedTreatmentIndex={0}
      />,
    );
    expect(badge()).toBe("he");
    unmount();
  });
});

describe("viewer unit selection (one unit at a time)", () => {
  it("the locale badge follows the SELECTED unit (intro vs treatment)", () => {
    const { container, unmount } = render(
      <Viewer
        treatmentFile={introHeTreatmentEnFile()}
        getTextContent={getText}
        getAssetURL={getAsset}
        selectedIntroIndex={0}
        selectedTreatmentIndex={0}
      />,
    );
    const badge = () =>
      container.querySelector('[data-testid="viewer-locale-badge"]')
        ?.textContent;
    // Starts on the treatment unit (en).
    expect(badge()).toBe("en");

    // Switch to the intro-sequence unit via the part picker → badge flips to he
    // (each unit declares its own locale; the catalog re-resolves).
    const picker = container.querySelector(
      'select[aria-label="Part to preview"]',
    ) as HTMLSelectElement | null;
    expect(picker).not.toBeNull();
    act(() => {
      picker!.value = "intro:0";
      picker!.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(badge()).toBe("he");
    unmount();
  });

  it("ends a unit with a transition screen, not a stage", () => {
    const { container, unmount } = render(
      <Viewer
        treatmentFile={introHeTreatmentEnFile()}
        getTextContent={getText}
        getAssetURL={getAsset}
        selectedIntroIndex={0}
        selectedTreatmentIndex={0}
      />,
    );
    // The treatment unit here is one stage + a transition. Navigate to the
    // last step (the transition) via StageNav's stage <select>.
    const stageSelect = container.querySelector(
      'select[aria-label="Stage"], select[title="Stage"]',
    ) as HTMLSelectElement | null;
    // Fallback: the stage selector is the one whose options are stage indices.
    const selects = Array.from(container.querySelectorAll("select"));
    const nav =
      stageSelect ??
      (selects.find((sel) =>
        Array.from(sel.options).some((o) => o.value === "1"),
      ) as HTMLSelectElement | undefined);
    expect(nav).toBeTruthy();
    act(() => {
      nav!.value = "1";
      nav!.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(
      container.querySelector('[data-testid="viewer-transition"]'),
    ).not.toBeNull();
    unmount();
  });
});
