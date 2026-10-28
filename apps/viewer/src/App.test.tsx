// @vitest-environment jsdom
//
// Routing coverage for the #440 load outcomes: the split between a file that
// loaded-but-can't-render (→ diagnostics placeholder) and a hard failure like a
// network/import error (→ plain error screen). Uses the same jsdom +
// react-dom/client + act harness as the other viewer .test.tsx files, and mocks
// the loader so the routing is exercised without any network.
import {
  describe,
  it,
  expect,
  afterEach,
  beforeAll,
  beforeEach,
  vi,
} from "vitest";
import React, { type ReactNode } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { LoadResult } from "./lib/loader";

const { mockLoad } = vi.hoisted(() => ({ mockLoad: vi.fn() }));
vi.mock("./lib/loader", () => ({
  loadTreatmentFromUrl: (url: string) => mockLoad(url) as Promise<LoadResult>,
}));

import { App } from "./App";

async function render(node: ReactNode): Promise<{
  container: HTMLElement;
  unmount: () => void;
}> {
  const container = document.createElement("div");
  document.body.appendChild(container);
  let root: Root;
  await act(async () => {
    root = createRoot(container);
    root.render(node);
  });
  // Flush the async auto-load (loading → resolved outcome).
  await act(async () => {});
  await act(async () => {});
  return {
    container,
    unmount: () =>
      act(() => {
        root.unmount();
        container.remove();
      }),
  };
}

beforeEach(() => {
  mockLoad.mockReset();
  // The App auto-loads whatever is in ?url= on mount.
  window.history.replaceState(
    {},
    "",
    "/?url=https://github.com/org/repo/blob/main/study.stagebook.yaml",
  );
});

describe("App load routing (#440)", () => {
  it("routes a null treatmentFile to the diagnostics placeholder", async () => {
    mockLoad.mockResolvedValue({
      treatmentFile: null,
      diagnostics: [
        {
          message: "playerCount must be a number",
          severity: "error",
          range: { startLine: 4, startCol: 2, endLine: 4, endCol: 6 },
          file: "study.stagebook.yaml",
        },
        {
          message: "duplicate key",
          severity: "warning",
          range: null,
          file: "study.stagebook.yaml",
        },
      ],
      unresolvedFields: [],
      rawBaseUrl: "",
    } satisfies LoadResult);

    const { container, unmount } = await render(<App />);
    const text = container.textContent ?? "";
    expect(text).toContain("can’t be previewed");
    expect(text).toContain("2 problems found");
    expect(text).toContain("playerCount must be a number");
    expect(text).toContain("duplicate key");
    unmount();
  });

  it("uses singular 'problem' for a single diagnostic", async () => {
    mockLoad.mockResolvedValue({
      treatmentFile: null,
      diagnostics: [
        {
          message: "only one problem",
          severity: "error",
          range: null,
          file: "study.stagebook.yaml",
        },
      ],
      unresolvedFields: [],
      rawBaseUrl: "",
    } satisfies LoadResult);

    const { container, unmount } = await render(<App />);
    expect(container.textContent ?? "").toContain("1 problem found");
    unmount();
  });

  it("routes a thrown error (network/import failure) to the error screen", async () => {
    mockLoad.mockRejectedValue(new Error("Failed to fetch imported file"));

    const { container, unmount } = await render(<App />);
    const text = container.textContent ?? "";
    expect(text).toContain("Failed to load");
    expect(text).toContain("Failed to fetch imported file");
    // The diagnostics placeholder must NOT be used for hard failures.
    expect(text).not.toContain("can’t be previewed");
    unmount();
  });
});

describe("App task parameters (#815)", () => {
  // The preview mounts the Viewer, which needs browser APIs jsdom lacks.
  beforeAll(() => {
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
    if (!Element.prototype.scrollTo) Element.prototype.scrollTo = () => {};
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("loads a local task file and previews the chosen task", async () => {
    mockLoad.mockResolvedValue({
      treatmentFile: {
        treatments: [
          {
            name: "rate",
            playerCount: 1,
            compatibleIntroSequences: [],
            gameStages: [
              {
                name: "only",
                duration: "${seconds}",
                elements: [{ type: "submitButton", buttonText: "Done" }],
              },
            ],
          },
        ],
      } as unknown as NonNullable<LoadResult["treatmentFile"]>,
      diagnostics: [],
      unresolvedFields: ["seconds"],
      rawBaseUrl: "https://raw.example/",
    } satisfies LoadResult);
    // No README: the viewer goes straight to the preview.
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(new Response("", { status: 404 }))),
    );

    const { container, unmount } = await render(<App />);
    const bar = () =>
      container.querySelector('[data-testid="task-parameter-bar"]');
    expect(bar()?.textContent).toContain("Load parameters");

    const chooseFile = async (name: string, tasks: unknown) => {
      const input = container.querySelector<HTMLInputElement>(
        '[data-testid="task-parameter-file-input"]',
      )!;
      const file = new File([JSON.stringify(tasks)], name, {
        type: "application/json",
      });
      await act(async () => {
        Object.defineProperty(input, "files", {
          value: [file],
          configurable: true,
        });
        input.dispatchEvent(new Event("change", { bubbles: true }));
      });
      await act(async () => {});
    };
    const task = (seconds: number) => [
      { callerTaskId: "clip-01", treatment: "rate", fields: { seconds } },
    ];
    const selectedTask = () =>
      bar()?.querySelector<HTMLSelectElement>("select")?.value;

    await chooseFile("tasks.json", task(30));
    expect(bar()?.textContent).toContain("tasks.json");

    const choose = Array.from(container.querySelectorAll("button")).find((b) =>
      b.textContent?.includes("clip-01"),
    )!;
    await act(async () => choose.click());
    await act(async () => {});
    expect(container.querySelector("main")).not.toBeNull();
    expect(container.querySelector("#field-seconds")).toBeNull();

    // A browser can't re-read the file, so choosing it again is the
    // refresh: the task stays selected.
    await chooseFile("tasks.json", task(40));
    expect(selectedTask()).toBe("id:clip-01");
    expect(container.querySelector("main")).not.toBeNull();

    // A different file starts over.
    await chooseFile("other.json", task(40));
    expect(container.textContent).toContain("Choose a task to preview");
    expect(container.querySelector("main")).toBeNull();
    unmount();
  });

  it("preloads the task file a bundled example ships", async () => {
    window.history.replaceState({}, "", "/");
    const { container, unmount } = await render(<App />);
    const example = Array.from(container.querySelectorAll("button")).find((b) =>
      b.textContent?.includes("clip_review"),
    );
    expect(example).toBeDefined();
    await act(async () => example!.click());
    await act(async () => {});
    // The example has a README, so it opens on its overview first.
    await act(async () =>
      container
        .querySelector<HTMLButtonElement>(
          '[data-testid="overview-view-button"]',
        )!
        .click(),
    );
    const bar = container.querySelector('[data-testid="task-parameter-bar"]');
    expect(bar?.textContent).toContain("tasks.json");
    expect(container.textContent).toContain("Choose a task to preview");
    unmount();
  });
});
