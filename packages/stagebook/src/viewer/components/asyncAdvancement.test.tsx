// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import type { TreatmentFileType } from "../../schemas/index.js";
import { Viewer } from "./Viewer.js";

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

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

type AsyncPhase = "consent" | "intro" | "exit";
const phases: AsyncPhase[] = ["consent", "intro", "exit"];
const submitElement = { type: "submitButton", buttonText: "Continue" };
const getAssetURL = (path: string) => path;
const getTextContent = () =>
  Promise.resolve(
    "---\ntype: multipleChoice\nname: answer\n---\nChoose one.\n\n---\n\n- Alpha\n- Beta",
  );

function study({
  firstElements = [submitElement],
  firstConditions,
}: {
  firstElements?: Record<string, unknown>[];
  firstConditions?: unknown;
} = {}): TreatmentFileType {
  const steps = (phase: AsyncPhase) => [
    {
      name: `${phase}-first`,
      elements: firstElements,
      ...(firstConditions === undefined ? {} : { conditions: firstConditions }),
    },
    { name: `${phase}-last`, elements: [submitElement] },
  ];
  return {
    consent: [{ name: "consent-arm", steps: steps("consent") }],
    introSequences: [{ name: "intro-sequence", introSteps: steps("intro") }],
    treatments: [
      {
        name: "treatment",
        playerCount: 3,
        gameStages: [{ name: "game", duration: 60, elements: [submitElement] }],
        exitSequence: steps("exit"),
      },
    ],
  } as unknown as TreatmentFileType;
}

function select(container: HTMLElement, selector: string, value: string): void {
  const element = container.querySelector<HTMLSelectElement>(selector);
  if (!element) throw new Error(`Missing select: ${selector}`);
  act(() => {
    element.value = value;
    element.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

function stageNav(container: HTMLElement): HTMLSelectElement {
  const element = Array.from(container.querySelectorAll("select")).find(
    (select) =>
      Array.from(select.options).some((option) => option.text.startsWith("[")),
  );
  if (!element) throw new Error("Missing stage navigation");
  return element;
}

function navigate(container: HTMLElement, index: number): void {
  act(() => {
    const nav = stageNav(container);
    nav.value = String(index);
    nav.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

function main(container: HTMLElement): HTMLElement {
  const element = container.querySelector("main");
  if (!element) throw new Error("Missing viewer main content");
  return element;
}

function click(element: HTMLElement | null): void {
  if (!element) throw new Error("Missing clickable element");
  act(() => element.click());
}

function submit(container: HTMLElement): void {
  click(main(container).querySelector('[data-testid="submitButton"]'));
}

function expectNoWaiting(container: HTMLElement): void {
  expect(main(container).textContent).not.toContain(
    "Waiting for other participants",
  );
  // Stage has its own submitted-state gate: hiding just Viewer's overlay
  // would still leave a spinner (consent/intro) or group wait (exit).
  expect(
    main(container).querySelector('[data-testid="submission-state"]'),
  ).toBeNull();
}

async function flush(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

async function renderViewer(
  phase: AsyncPhase | "game",
  treatmentFile = study(),
): Promise<HTMLElement> {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  cleanups.push(() => {
    act(() => root.unmount());
    container.remove();
  });
  act(() => {
    root.render(
      <Viewer
        treatmentFile={treatmentFile}
        getTextContent={getTextContent}
        getAssetURL={getAssetURL}
        selectedIntroIndex={0}
        selectedTreatmentIndex={0}
      />,
    );
  });
  if (phase === "consent" || phase === "intro") {
    select(container, '[aria-label="Part to preview"]', `${phase}:0`);
  } else if (phase === "exit") {
    navigate(container, 1);
  }
  await flush();
  return container;
}

describe("asynchronous preview advancement (#788)", () => {
  it.each(phases)(
    "submits %s steps directly through the final transition",
    async (phase) => {
      const container = await renderViewer(phase);
      const first = phase === "exit" ? 1 : 0;
      submit(container);
      expect(stageNav(container).value).toBe(String(first + 1));
      expectNoWaiting(container);
      expect(
        main(container).querySelector('[data-testid="submitButton"]'),
      ).not.toBeNull();

      submit(container);
      expect(stageNav(container).value).toBe(String(first + 2));
      expectNoWaiting(container);
      expect(
        main(container).querySelector('[data-testid="viewer-transition"]'),
      ).not.toBeNull();
      expect(
        container.querySelector<HTMLSelectElement>(
          '[aria-label="Part to preview"]',
        )?.value,
      ).toBe(phase === "exit" ? "treatment:0" : `${phase}:0`);
      expect(
        container.querySelector<HTMLButtonElement>('[aria-label="Next stage"]')
          ?.disabled,
      ).toBe(true);
    },
  );

  it("keeps game waiting and explicit Next at the game-to-exit boundary", async () => {
    const container = await renderViewer("game");
    submit(container);
    expect(stageNav(container).value).toBe("0");
    expect(main(container).textContent).toContain(
      "Waiting for other participants",
    );
    click(
      Array.from(main(container).querySelectorAll("button")).find(
        (button) => button.textContent === "Show stage again",
      ) ?? null,
    );
    expect(
      main(container).querySelector('[data-testid="submitButton"]'),
    ).not.toBeNull();
    submit(container);
    click(
      Array.from(main(container).querySelectorAll("button")).find((button) =>
        button.textContent?.startsWith("Next"),
      ) ?? null,
    );
    expect(stageNav(container).value).toBe("1");
    expectNoWaiting(container);
    submit(container);
    expect(stageNav(container).value).toBe("2");
    expectNoWaiting(container);
  });

  it.each(["navigation", "hotkey"])(
    "preserves prompt answers and replay after revisiting via %s",
    async (method) => {
      const container = await renderViewer(
        "exit",
        study({
          firstElements: [
            { type: "prompt", file: "answer.prompt.md", name: "answer" },
            submitElement,
          ],
        }),
      );
      const answer = () =>
        main(container).querySelector<HTMLInputElement>(
          'input[type="radio"][value="Alpha"]',
        );
      click(answer());
      expect(answer()?.checked).toBe(true);
      submit(container);
      expect(stageNav(container).value).toBe("2");

      if (method === "navigation") {
        navigate(container, 1);
      } else {
        act(() => {
          main(container).dispatchEvent(
            new KeyboardEvent("keydown", {
              bubbles: true,
              altKey: true,
              code: "ArrowLeft",
            }),
          );
        });
      }
      await flush();
      expect(stageNav(container).value).toBe("1");
      expectNoWaiting(container);
      expect(answer()?.checked).toBe(true);
      submit(container);
      expect(stageNav(container).value).toBe("2");
      expectNoWaiting(container);
    },
  );

  it.each(phases)(
    "does not hide or leave a %s step when the inspector toggles submitted",
    async (phase) => {
      const container = await renderViewer(phase);
      const index = stageNav(container).value;
      const checkbox = container.querySelector<HTMLInputElement>(
        'aside input[type="checkbox"]',
      );
      click(checkbox);
      expect(stageNav(container).value).toBe(index);
      expectNoWaiting(container);
      expect(
        main(container).querySelector('[data-testid="submitButton"]'),
      ).not.toBeNull();
      click(checkbox);
      expect(stageNav(container).value).toBe(index);
      expectNoWaiting(container);
      submit(container);
      expect(stageNav(container).value).toBe(String(Number(index) + 1));
    },
  );

  it("advances a condition-skipped intro through the context advanceStage path", async () => {
    const container = await renderViewer(
      "intro",
      study({ firstConditions: false }),
    );
    expect(stageNav(container).value).toBe("1");
    expectNoWaiting(container);
    expect(
      main(container).querySelector('[data-testid="submitButton"]'),
    ).not.toBeNull();
    submit(container);
    expect(
      main(container).querySelector('[data-testid="viewer-transition"]'),
    ).not.toBeNull();
  });

  it("advances an exit step when media completes", async () => {
    const container = await renderViewer(
      "exit",
      study({
        firstElements: [
          {
            type: "mediaPlayer",
            name: "clip",
            file: "clip.mp4",
            playVideo: true,
            playback: "manual",
            submitOnComplete: true,
          },
        ],
      }),
    );
    const video = main(container).querySelector("video");
    expect(video).not.toBeNull();
    act(() => {
      video!.dispatchEvent(new Event("ended", { bubbles: true }));
    });
    expect(stageNav(container).value).toBe("2");
    expectNoWaiting(container);
    expect(
      main(container).querySelector('[data-testid="submitButton"]'),
    ).not.toBeNull();
  });

  it("advances once for duplicate Qualtrics completion notifications", async () => {
    const container = await renderViewer(
      "intro",
      study({
        firstElements: [
          {
            type: "qualtrics",
            name: "survey",
            url: "https://study.qualtrics.com/jfe/form/test",
          },
        ],
      }),
    );
    expect(main(container).querySelector("iframe")).not.toBeNull();
    act(() => {
      for (let i = 0; i < 2; i++) {
        window.dispatchEvent(
          new MessageEvent("message", {
            origin: "https://study.qualtrics.com",
            data: "QualtricsEOS|survey|session",
          }),
        );
      }
    });
    expect(stageNav(container).value).toBe("1");
    expectNoWaiting(container);
    expect(
      main(container).querySelector('[data-testid="submitButton"]'),
    ).not.toBeNull();
    expect(
      main(container).querySelector('[data-testid="viewer-transition"]'),
    ).toBeNull();
  });
});
