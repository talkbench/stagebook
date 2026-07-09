// @vitest-environment jsdom
//
// #492: the on-load locale-consistency check (loader.ts) runs on the
// template-expanded tree, BEFORE host `additionalFields` / FieldForm values
// bind `${...}` slots. When `locale` (or a prompt `file:` path) is a field
// resolved only post-load, that check is a no-op. PreviewHost must re-run the
// (async) check on the field-resolved tree once computePreviewState reaches
// `ready`, and surface any mismatch — otherwise a `he` treatment can render an
// `en` prompt with no diagnostic.
import { describe, it, expect, beforeAll, vi } from "vitest";
import React, { type ReactNode } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { TreatmentFileType } from "../../schemas/index.js";
import { PreviewHost } from "./PreviewHost.js";

beforeAll(() => {
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
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

/** Drain the async locale check and its state update. A single macrotask
 *  boundary flushes ALL pending microtasks (the getTextContent → check →
 *  setState chain) regardless of how deep it is, so this stays reliable even
 *  if the check gains internal awaits. Wrapped in act so React commits. */
async function flush(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

const getAsset = (p: string) => p;

/** A treatment whose `locale` is a `${lang}` field left for the host to bind
 *  post-load, referencing a static prompt file. The ADR single-source pattern
 *  would resolve `lang` via template `fields:` (covered on load); here it's
 *  supplied through PreviewHost's `additionalFields`, the gap #492 closes. */
function fieldBoundLocaleTreatment(): TreatmentFileType {
  return {
    treatments: [
      {
        name: "study1",
        locale: "${lang}",
        playerCount: 1,
        compatibleIntroSequences: [],
        gameStages: [
          {
            name: "s1",
            duration: 60,
            elements: [{ type: "prompt", file: "q.prompt.md" }],
          },
        ],
      },
    ],
  } as unknown as TreatmentFileType;
}

/** A treatment with a STATIC locale but a prompt `file:` path whose directory
 *  is a `${dir}` field bound post-load — the other #492 trigger (the on-load
 *  check fetches the literal `prompts/${dir}/…` path, 404s, and skips). */
function fieldBoundFilePathTreatment(): TreatmentFileType {
  return {
    treatments: [
      {
        name: "study1",
        locale: "he",
        playerCount: 1,
        compatibleIntroSequences: [],
        gameStages: [
          {
            name: "s1",
            duration: 60,
            elements: [{ type: "prompt", file: "prompts/${dir}/q.prompt.md" }],
          },
        ],
      },
    ],
  } as unknown as TreatmentFileType;
}

const banner = (c: HTMLElement) =>
  c.querySelector('[data-testid="locale-mismatch-banner"]');

const UNTAGGED_PROMPT = "---\ntype: noResponse\n---\n\n# Question"; // → "en"
const HE_PROMPT = "---\ntype: noResponse\nlocale: he\n---\n\n# שאלה";

describe("PreviewHost post-fill locale-consistency (#492)", () => {
  it("surfaces a mismatch once the locale field binds to a value the prompt doesn't match", async () => {
    // Prompt declares no locale → counts as "en"; treatment binds to "he".
    const getText = vi.fn(() => Promise.resolve(UNTAGGED_PROMPT));
    const { container, unmount } = render(
      <PreviewHost
        treatmentFile={fieldBoundLocaleTreatment()}
        additionalFields={{ lang: "he" }}
        selectedIntroIndex={0}
        selectedTreatmentIndex={0}
        getTextContent={getText}
        getAssetURL={getAsset}
      />,
    );
    await flush();

    const b = banner(container);
    expect(b).not.toBeNull();
    expect(b?.getAttribute("role")).toBe("alert");
    expect(b?.textContent).toContain("q.prompt.md");
    // Names both the prompt's effective locale and the treatment's.
    expect(b?.textContent).toContain('"en"');
    expect(b?.textContent).toContain('"he"');
    unmount();
  });

  it("re-runs the check but shows no banner when the field-resolved locales agree", async () => {
    // Prompt is tagged `he`, matching the bound treatment locale.
    const getText = vi.fn(() => Promise.resolve(HE_PROMPT));
    const { container, unmount } = render(
      <PreviewHost
        treatmentFile={fieldBoundLocaleTreatment()}
        additionalFields={{ lang: "he" }}
        selectedIntroIndex={0}
        selectedTreatmentIndex={0}
        getTextContent={getText}
        getAssetURL={getAsset}
      />,
    );
    await flush();

    // The spy proves the check actually RAN (fetched the prompt) — a null
    // banner here means "locales agree", not "check silently skipped".
    expect(getText).toHaveBeenCalledWith("q.prompt.md");
    expect(banner(container)).toBeNull();
    unmount();
  });

  it("checks the resolved prompt `file:` path, not the `${field}` literal", async () => {
    // #492's other trigger: the prompt path's directory is bound post-load.
    // The check must fetch the EXPANDED path (prompts/en/…), read its locale,
    // and flag it against the treatment's static `he`.
    const getText = vi.fn((path: string) =>
      path === "prompts/en/q.prompt.md"
        ? Promise.resolve(UNTAGGED_PROMPT)
        : Promise.reject(new Error(`unexpected path: ${path}`)),
    );
    const { container, unmount } = render(
      <PreviewHost
        treatmentFile={fieldBoundFilePathTreatment()}
        additionalFields={{ dir: "en" }}
        selectedIntroIndex={0}
        selectedTreatmentIndex={0}
        getTextContent={getText}
        getAssetURL={getAsset}
      />,
    );
    await flush();

    expect(getText).toHaveBeenCalledWith("prompts/en/q.prompt.md");
    const b = banner(container);
    expect(b).not.toBeNull();
    expect(b?.textContent).toContain("prompts/en/q.prompt.md");
    unmount();
  });

  it("clears the banner once the binding is changed to a matching locale", async () => {
    // Prompt is untagged → "en". First bind lang=he (mismatch), then rebind
    // lang=en (match) — the re-run must retract the banner, not leave it stale.
    const getText = vi.fn(() => Promise.resolve(UNTAGGED_PROMPT));
    const tree = fieldBoundLocaleTreatment();
    const { container, rerender, unmount } = render(
      <PreviewHost
        treatmentFile={tree}
        additionalFields={{ lang: "he" }}
        selectedIntroIndex={0}
        selectedTreatmentIndex={0}
        getTextContent={getText}
        getAssetURL={getAsset}
      />,
    );
    await flush();
    expect(banner(container)).not.toBeNull();

    rerender(
      <PreviewHost
        treatmentFile={tree}
        additionalFields={{ lang: "en" }}
        selectedIntroIndex={0}
        selectedTreatmentIndex={0}
        getTextContent={getText}
        getAssetURL={getAsset}
      />,
    );
    await flush();
    expect(banner(container)).toBeNull();
    unmount();
  });

  it("shows no banner (and doesn't crash) when a referenced prompt can't be read", async () => {
    // A throwing getTextContent is an unreadable prompt — a different error
    // class with its own reporting. The check must skip it, not surface a
    // bogus mismatch or throw an unhandled rejection out of the effect.
    const getText = vi.fn(() => Promise.reject(new Error("not found")));
    const { container, unmount } = render(
      <PreviewHost
        treatmentFile={fieldBoundLocaleTreatment()}
        additionalFields={{ lang: "he" }}
        selectedIntroIndex={0}
        selectedTreatmentIndex={0}
        getTextContent={getText}
        getAssetURL={getAsset}
      />,
    );
    await flush();

    expect(getText).toHaveBeenCalledWith("q.prompt.md");
    expect(banner(container)).toBeNull();
    unmount();
  });
});
