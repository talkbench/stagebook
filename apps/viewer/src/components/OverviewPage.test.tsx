// @vitest-environment jsdom
//
// App-shell half of the #479 regression guard: a treatments-only file (no
// `introSequences:`) — and, symmetrically, an intro-only file (no
// `treatments:`, #476) — must render in OverviewPage without crashing.
// The viewer-harness half (Viewer + TreatmentPicker) lives in the library at
// packages/stagebook/src/viewer/components/introSequencesOptional.test.tsx.
import { describe, it, expect, beforeAll } from "vitest";
import React, { type ReactNode } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { TreatmentFileType } from "stagebook";
import { OverviewPage } from "./OverviewPage";

beforeAll(() => {
  // jsdom lacks these; keep parity with the harness half's polyfills.
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

/** A valid treatments-only file: no `introSequences:` key at all. */
function treatmentsOnlyFile(): TreatmentFileType {
  return {
    treatments: [
      {
        name: "study1",
        playerCount: 1,
        gameStages: [
          { name: "s1", duration: 60, elements: [{ type: "submitButton" }] },
        ],
      },
    ],
  } as unknown as TreatmentFileType;
}

/** A valid intro-only file: no `treatments:` key at all. */
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

describe("OverviewPage renders with an optional part missing", () => {
  it("does not crash on a treatments-only file (no introSequences)", () => {
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

  it("does not crash on an intro-only file (no treatments)", () => {
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
});
