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
    unmount: () =>
      act(() => {
        root.unmount();
        container.remove();
      }),
  };
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

describe("viewer per-phase locale", () => {
  it("badge follows the phase: intro sequence's locale, then the treatment's", () => {
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
    // stageIndex 0 = the intro step → intro sequence locale (he).
    expect(badge()).toBe("he");

    // Navigate to the game stage via the StageNav <select>; the catalog must
    // re-resolve (the `locale` useMemo dep) so the badge flips to en.
    const select = container.querySelector(
      "select",
    ) as HTMLSelectElement | null;
    expect(select).not.toBeNull();
    act(() => {
      select!.value = "1";
      select!.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(badge()).toBe("en");
    unmount();
  });
});
