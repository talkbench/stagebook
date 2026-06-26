// @vitest-environment jsdom
import { describe, test, expect, vi } from "vitest";
import React, { type ReactNode } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  type StagebookContext,
  StagebookProvider,
  useResolve,
  useMessages,
  useIsRTL,
  useTextContent,
  type TextContentResult,
} from "./StagebookProvider.js";
import { defaultMessages, type StagebookMessages } from "../messages/index.js";
import { SubmitButton } from "./elements/SubmitButton.js";
import { Loading } from "./form/Loading.js";
import { HelpPopover } from "./elements/timeline/HelpPopover.js";
import { TextArea } from "./form/TextArea.js";
import { RadioGroup } from "./form/RadioGroup.js";
import { CheckboxGroup } from "./form/CheckboxGroup.js";
import { Markdown } from "./form/Markdown.js";
import { Display } from "./elements/Display.js";
import { SubmissionConditionalRender } from "./conditions/SubmissionConditionalRender.js";

// We test the provider/hooks via a simple test component pattern
// that captures hook return values into a ref we can assert on.

function createMockContext(
  overrides?: Partial<StagebookContext>,
): StagebookContext {
  // No attributes shim needed: the provider does not check
  // `stableParticipantId` at mount (#473) — that's a use-site check in the
  // Qualtrics element — so a missing attributes bag here is harmless.
  return {
    get: vi.fn(() => []),
    save: vi.fn(),
    getElapsedTime: vi.fn(() => 0),
    submit: vi.fn(),
    getAssetURL: vi.fn((path: string) => `https://cdn.test/${path}`),
    getTextContent: vi.fn(() => Promise.resolve("mock content")),
    progressLabel: "game_0_stage1",
    playerId: "player1",
    position: 0,
    playerCount: 3,
    isSubmitted: false,
    ...overrides,
  };
}

describe("StagebookContext interface", () => {
  test("mock context satisfies the interface", () => {
    const ctx = createMockContext();

    expect(ctx.playerId).toBe("player1");
    expect(ctx.playerCount).toBe(3);
    expect(ctx.position).toBe(0);
    expect(ctx.progressLabel).toBe("game_0_stage1");
    expect(ctx.isSubmitted).toBe(false);
  });

  test("get returns array", () => {
    const get = vi.fn(() => ["value1", "value2"]);
    const ctx = createMockContext({ get });

    const result = ctx.get("prompt_myPrompt", "all");
    expect(get).toHaveBeenCalledWith("prompt_myPrompt", "all");
    expect(result).toEqual(["value1", "value2"]);
  });

  test("save calls through with scope", () => {
    const save = vi.fn();
    const ctx = createMockContext({ save });

    ctx.save("prompt_q1", { value: "answer" }, "player");
    expect(save).toHaveBeenCalledWith(
      "prompt_q1",
      { value: "answer" },
      "player",
    );
  });

  test("getElapsedTime returns seconds", () => {
    const ctx = createMockContext({
      getElapsedTime: () => 42.5,
    });
    expect(ctx.getElapsedTime()).toBe(42.5);
  });

  test("getAssetURL resolves path", () => {
    const ctx = createMockContext();
    expect(ctx.getAssetURL("images/photo.png")).toBe(
      "https://cdn.test/images/photo.png",
    );
  });

  test("getTextContent returns promise", async () => {
    const ctx = createMockContext({
      getTextContent: vi.fn(() => Promise.resolve("# Hello")),
    });
    const text = await ctx.getTextContent("prompts/hello.md");
    expect(text).toBe("# Hello");
  });

  test("render slots are optional", () => {
    const ctx = createMockContext();
    expect(ctx.renderDiscussion).toBeUndefined();
    expect(ctx.renderSharedNotepad).toBeUndefined();
  });

  test("render slots can be provided", () => {
    const ctx = createMockContext({
      renderDiscussion: () => React.createElement("div", null, "discussion"),
      renderSharedNotepad: () => React.createElement("div", null, "notepad"),
    });
    expect(ctx.renderDiscussion).toBeDefined();
    expect(ctx.renderSharedNotepad).toBeDefined();
  });
});

describe("StagebookProvider + useStagebookContext", () => {
  test("useStagebookContext throws without provider", async () => {
    // Dynamic import to test the throw behavior
    const { useStagebookContext } = await import("./StagebookProvider.js");

    // useStagebookContext is a hook — calling it outside React should throw
    // We test this by verifying the error message pattern
    expect(() => {
      // This will throw because there's no React render context
      // In a real component tree without StagebookProvider, it throws our custom error
      // Outside React entirely, it throws a different React error
      useStagebookContext();
    }).toThrow();
  });
});

// Helper to render useResolve inside a StagebookProvider
function renderUseResolve(
  reference: string,
  ctx: StagebookContext,
): {
  result: { current: unknown[] };
  unmount: () => void;
} {
  const result = { current: [] as unknown[] };
  const container = document.createElement("div");
  let root: Root;

  function Harness(): ReactNode {
    result.current = useResolve(reference);
    return null;
  }

  act(() => {
    root = createRoot(container);
    root.render(
      <StagebookProvider value={ctx}>
        <Harness />
      </StagebookProvider>,
    );
  });

  return {
    result,
    unmount: () => act(() => root.unmount()),
  };
}

describe("Provider-level resolve (get → resolve pipeline)", () => {
  test("extracts .value path for prompt references", () => {
    const get = vi.fn(() => [
      { type: "multipleChoice", value: "yes", step: "s0" },
    ]);
    const ctx = createMockContext({ get });

    // Per #298 the position is part of the reference itself. `self.X`
    // maps to the host's "player" scope at the get() boundary.
    const { result, unmount } = renderUseResolve("self.prompt.q1", ctx);

    expect(get).toHaveBeenCalledWith("prompt_q1", "player");
    expect(result.current).toEqual(["yes"]);
    unmount();
  });

  test("navigates nested paths for survey references", () => {
    const get = vi.fn(() => [{ result: { score: 4.5 } }]);
    const ctx = createMockContext({ get });

    const { result, unmount } = renderUseResolve(
      "self.survey.TIPI.result.score",
      ctx,
    );

    expect(get).toHaveBeenCalledWith("survey_TIPI", "player");
    expect(result.current).toEqual([4.5]);
    unmount();
  });

  test("passes 'shared' position prefix through to get verbatim", () => {
    const get = vi.fn(() => []);
    const ctx = createMockContext({ get });

    const { unmount } = renderUseResolve("shared.prompt.q1", ctx);

    expect(get).toHaveBeenCalledWith("prompt_q1", "shared");
    unmount();
  });

  test("passes a numeric slot-index prefix through to get verbatim", () => {
    // Numeric slot index is rendered to a string at the get()
    // boundary so the host receives a uniform string scope arg.
    const get = vi.fn(() => []);
    const ctx = createMockContext({ get });

    const { unmount } = renderUseResolve("0.prompt.q1", ctx);

    expect(get).toHaveBeenCalledWith("prompt_q1", "0");
    unmount();
  });

  test("forwards `all` prefix to get (multi-participant list)", () => {
    // `all.X` returns one value per participant; the runtime forwards
    // `"all"` verbatim to the host's get().
    const get = vi.fn(() => []);
    const ctx = createMockContext({ get });

    const { unmount } = renderUseResolve("all.prompt.q1", ctx);

    expect(get).toHaveBeenCalledWith("prompt_q1", "all");
    unmount();
  });

  test("filters out undefined path results", () => {
    // Record exists but doesn't have the nested .value path
    const get = vi.fn(() => [{ name: "q1" }]);
    const ctx = createMockContext({ get });

    const { result, unmount } = renderUseResolve("self.prompt.q1", ctx);

    expect(result.current).toEqual([]);
    unmount();
  });

  test("resolves across multiple raw values", () => {
    // Hosts can return multiple values for any scope (e.g. an
    // append-only store); the resolve hook unwraps each via the
    // declared path. Using a numeric slot index here as a
    // representative read selector.
    const get = vi.fn(() => [
      { value: "a", step: "s0" },
      { value: "b", step: "s1" },
    ]);
    const ctx = createMockContext({ get });

    const { result, unmount } = renderUseResolve("0.prompt.q1", ctx);

    expect(result.current).toEqual(["a", "b"]);
    unmount();
  });
});

// Helper to render a hook inside a StagebookProvider
function renderUseTextContent(
  initialPath: string,
  ctx: StagebookContext,
): {
  result: { current: TextContentResult };
  rerender: (path: string) => void;
  unmount: () => void;
} {
  const result = { current: undefined as unknown as TextContentResult };
  const container = document.createElement("div");
  let root: Root;
  let currentPath = initialPath;

  function Harness(): ReactNode {
    result.current = useTextContent(currentPath);
    return null;
  }

  act(() => {
    root = createRoot(container);
    root.render(
      <StagebookProvider value={ctx}>
        <Harness />
      </StagebookProvider>,
    );
  });

  return {
    result,
    rerender: (path: string) => {
      currentPath = path;
      act(() => {
        root.render(
          <StagebookProvider value={ctx}>
            <Harness />
          </StagebookProvider>,
        );
      });
    },
    unmount: () => act(() => root.unmount()),
  };
}

describe("useTextContent", () => {
  test("does not call getTextContent when path is empty", async () => {
    const getTextContent = vi.fn(() => Promise.resolve("content"));
    const ctx = createMockContext({ getTextContent });

    const { unmount } = renderUseTextContent("", ctx);

    // Let any pending microtasks flush
    await act(() => Promise.resolve());

    expect(getTextContent).not.toHaveBeenCalled();
    unmount();
  });

  test("calls getTextContent when path is non-empty", async () => {
    const getTextContent = vi.fn(() => Promise.resolve("# Hello"));
    const ctx = createMockContext({ getTextContent });

    const { result, unmount } = renderUseTextContent("prompts/hello.md", ctx);

    await act(() => Promise.resolve());

    expect(getTextContent).toHaveBeenCalledWith("prompts/hello.md");
    expect(result.current.data).toBe("# Hello");
    expect(result.current.isLoading).toBe(false);
    unmount();
  });

  test("resets data when path changes from non-empty to empty", async () => {
    const getTextContent = vi.fn(() => Promise.resolve("# Hello"));
    const ctx = createMockContext({ getTextContent });

    const { result, rerender, unmount } = renderUseTextContent(
      "prompts/hello.md",
      ctx,
    );

    await act(() => Promise.resolve());

    expect(result.current.data).toBe("# Hello");
    expect(result.current.isLoading).toBe(false);

    rerender("");
    await act(() => Promise.resolve());

    expect(getTextContent).toHaveBeenCalledTimes(1);
    expect(result.current.isLoading).toBe(false);
    expect(result.current.data).toBeUndefined();
    expect(result.current.error).toBeUndefined();
    unmount();
  });

  test("returns not-loading with no data for empty path", async () => {
    const ctx = createMockContext();

    const { result, unmount } = renderUseTextContent("", ctx);

    await act(() => Promise.resolve());

    expect(result.current.isLoading).toBe(false);
    expect(result.current.data).toBeUndefined();
    expect(result.current.error).toBeUndefined();
    unmount();
  });

  // Regression for #105: useTextContent previously listed `getTextContent`
  // in its effect deps. If the platform rebuilds its StagebookContext each
  // render (very common) and does not wrap `getTextContent` in `useCallback`,
  // the effect re-fires every render — refetching content on every parent
  // state change. The ref pattern fixes this.
  test("does not refetch when getTextContent identity changes but path is stable", async () => {
    const container = document.createElement("div");
    let root: Root;
    const result = { current: undefined as unknown as TextContentResult };
    const getTextContent = vi.fn(() => Promise.resolve("# Hello"));
    // Rebuild the context object each render — same underlying function,
    // different outer identity. Because `get` is wrapped but `getTextContent`
    // is not, the resolved context returns a new getTextContent ref each render.
    function makeCtx(): StagebookContext {
      return createMockContext({
        // fresh identity per invocation
        getTextContent: (p: string) => getTextContent(p),
      });
    }

    function Harness(): ReactNode {
      result.current = useTextContent("prompts/hello.md");
      return null;
    }

    act(() => {
      root = createRoot(container);
      root.render(
        <StagebookProvider value={makeCtx()}>
          <Harness />
        </StagebookProvider>,
      );
    });
    await act(() => Promise.resolve());

    expect(getTextContent).toHaveBeenCalledTimes(1);

    // Force re-renders with fresh getTextContent identities
    for (let i = 0; i < 5; i++) {
      act(() => {
        root.render(
          <StagebookProvider value={makeCtx()}>
            <Harness />
          </StagebookProvider>,
        );
      });
      await act(() => Promise.resolve());
    }

    // Path never changed — effect must not refetch just because
    // getTextContent changed identity
    expect(getTextContent).toHaveBeenCalledTimes(1);

    act(() => root.unmount());
  });

  test("contentVersion bump triggers re-fetch even when path and getTextContent are stable", async () => {
    const container = document.createElement("div");
    let root: Root;
    const result = { current: undefined as unknown as TextContentResult };
    const getTextContent = vi.fn(() => Promise.resolve("# Original"));

    function makeCtx(version: number): StagebookContext {
      return {
        ...createMockContext({ getTextContent }),
        contentVersion: version,
      };
    }

    function Harness(): ReactNode {
      result.current = useTextContent("prompts/hello.md");
      return null;
    }

    // Initial render with contentVersion 0
    act(() => {
      root = createRoot(container);
      root.render(
        <StagebookProvider value={makeCtx(0)}>
          <Harness />
        </StagebookProvider>,
      );
    });
    await act(() => Promise.resolve());

    expect(getTextContent).toHaveBeenCalledTimes(1);
    expect(result.current.data).toBe("# Original");

    // Bump contentVersion — same path, same getTextContent identity
    getTextContent.mockResolvedValue("# Updated");
    act(() => {
      root.render(
        <StagebookProvider value={makeCtx(1)}>
          <Harness />
        </StagebookProvider>,
      );
    });
    await act(() => Promise.resolve());

    // Must have re-fetched because contentVersion changed
    expect(getTextContent).toHaveBeenCalledTimes(2);
    expect(result.current.data).toBe("# Updated");

    act(() => root.unmount());
  });
});

// --------------- Localization (i18n) ---------------

// Capture useMessages()/useIsRTL() return values. When `ctx` is omitted the
// harness renders WITHOUT a provider, exercising the graceful-fallback path.
function renderMessages(ctx?: StagebookContext): {
  messages: { current: StagebookMessages };
  isRTL: { current: boolean };
  unmount: () => void;
} {
  const messages = { current: defaultMessages.en };
  const isRTL = { current: false };
  const container = document.createElement("div");
  let root: Root;

  function Harness(): ReactNode {
    messages.current = useMessages();
    isRTL.current = useIsRTL();
    return null;
  }

  act(() => {
    root = createRoot(container);
    root.render(
      ctx ? (
        <StagebookProvider value={ctx}>
          <Harness />
        </StagebookProvider>
      ) : (
        <Harness />
      ),
    );
  });

  return { messages, isRTL, unmount: () => act(() => root.unmount()) };
}

// Render a component subtree, optionally inside a provider, and return the
// container for DOM assertions.
function renderNode(
  node: ReactNode,
  ctx?: StagebookContext,
): { container: HTMLElement; unmount: () => void } {
  const container = document.createElement("div");
  let root: Root;
  act(() => {
    root = createRoot(container);
    root.render(
      ctx ? <StagebookProvider value={ctx}>{node}</StagebookProvider> : node,
    );
  });
  return { container, unmount: () => act(() => root.unmount()) };
}

describe("useMessages / useIsRTL", () => {
  test("localizes the catalog inside a provider with a non-en locale", () => {
    const { messages, isRTL, unmount } = renderMessages(
      createMockContext({ locale: "he" }),
    );
    expect(messages.current.submitButtonDefault).toBe("הבא");
    expect(messages.current.loadingLabel).toBe("טוען");
    expect(isRTL.current).toBe(true);
    unmount();
  });

  test("applies host messages overrides on top of the locale catalog", () => {
    const { messages, unmount } = renderMessages(
      createMockContext({ locale: "he", messages: { loadingLabel: "…" } }),
    );
    expect(messages.current.loadingLabel).toBe("…"); // override wins
    expect(messages.current.submitButtonDefault).toBe("הבא"); // he base intact
    unmount();
  });

  test("defaults to the en catalog (LTR) inside a provider with no locale", () => {
    const { messages, isRTL, unmount } = renderMessages(createMockContext());
    expect(messages.current.submitButtonDefault).toBe("Next");
    expect(isRTL.current).toBe(false);
    unmount();
  });

  test("falls back to en / LTR when rendered WITHOUT a provider", () => {
    // Standalone-component contract: the hooks must not throw outside a
    // provider (unlike useStagebookContext), so form components stay usable.
    const { messages, isRTL, unmount } = renderMessages();
    expect(messages.current.submitButtonDefault).toBe("Next");
    expect(isRTL.current).toBe(false);
    unmount();
  });
});

describe("component localization wiring", () => {
  test("SubmitButton uses the active locale's default when no buttonText", () => {
    const { container, unmount } = renderNode(
      <SubmitButton onSubmit={() => {}} name="s" save={() => {}} />,
      createMockContext({ locale: "he" }),
    );
    const btn = container.querySelector('[data-testid="submitButton"]');
    expect(btn?.textContent).toBe("הבא"); // not "Next"
    unmount();
  });

  test("SubmitButton: researcher buttonText still wins under a non-en locale", () => {
    const { container, unmount } = renderNode(
      <SubmitButton
        onSubmit={() => {}}
        name="s"
        save={() => {}}
        buttonText="Continue"
      />,
      createMockContext({ locale: "he" }),
    );
    const btn = container.querySelector('[data-testid="submitButton"]');
    expect(btn?.textContent).toBe("Continue");
    unmount();
  });

  test("Loading aria-label localizes from the catalog", () => {
    const { container, unmount } = renderNode(
      <Loading />,
      createMockContext({ locale: "he" }),
    );
    expect(container.querySelector("svg")?.getAttribute("aria-label")).toBe(
      "טוען",
    );
    unmount();
  });

  test("standalone components fall back to en with no provider", () => {
    const { container, unmount } = renderNode(<Loading />);
    expect(container.querySelector("svg")?.getAttribute("aria-label")).toBe(
      "Loading",
    );
    unmount();
  });

  test("mirrored components pin dir from the locale (rtl under he, ltr under en)", () => {
    // The RTL CT suite pins the Slider/KitchenTimer geometry; this sweep
    // protects the remaining mirrored components from a silent dir revert.
    const cases: [string, React.ReactNode][] = [
      ["textarea-wrap", <TextArea key="t" />],
      ["radio", <RadioGroup key="r" options={[{ key: "a", value: "A" }]} />],
      [
        "checkbox",
        <CheckboxGroup
          key="c"
          options={[{ key: "a", value: "A" }]}
          value={[]}
        />,
      ],
      ["markdown", <Markdown key="m" text="hello" />],
      ["display", <Display key="d" reference="self.prompt.x" values={["v"]} />],
      [
        "submission",
        <SubmissionConditionalRender key="s" isSubmitted={true} playerCount={3}>
          <p>x</p>
        </SubmissionConditionalRender>,
      ],
    ];
    for (const [label, node] of cases) {
      for (const [locale, expected] of [
        ["he", "rtl"],
        ["en", "ltr"],
      ] as const) {
        const { container, unmount } = renderNode(
          node,
          createMockContext({ locale }),
        );
        const el = container.querySelector("[dir]");
        expect(el?.getAttribute("dir"), `${label} under ${locale}`).toBe(
          expected,
        );
        unmount();
      }
    }
  });

  test("Timeline chrome (HelpPopover) reads the catalog under a he provider", () => {
    // HelpPopover portals into document.body; assert there. This is the one
    // test proving Timeline-family chrome actually flows through the catalog
    // (the Timeline CT suite mounts provider-less, exercising only the en
    // fallback).
    const buttonRef = { current: null };
    const { unmount } = renderNode(
      <HelpPopover
        selectionType="range"
        onClose={() => {}}
        buttonRef={buttonRef}
      />,
      createMockContext({ locale: "he" }),
    );
    const popover = document.body.querySelector(
      '[data-testid="timeline-help-popover"]',
    );
    expect(popover?.getAttribute("aria-label")).toBe(
      defaultMessages.he.timelineShortcutsLabel,
    );
    expect(popover?.textContent).toContain(
      defaultMessages.he.timelineShortcutsTitle,
    );
    expect(popover?.querySelectorAll("tr")).toHaveLength(
      defaultMessages.he.timelineShortcutRowsRange().length,
    );
    unmount();
  });

  test("HelpPopover degrades to an empty table on a malformed shortcut override", () => {
    // `resolveCatalog`'s typeof-guard accepts any FUNCTION for this key, so a
    // host override returning a non-array slips through to HelpPopover's
    // `.map()`. HelpPopover's `Array.isArray` guard must keep it from
    // crashing the render (it's the second defense layer; see #479).
    const buttonRef = { current: null };
    const { unmount } = renderNode(
      <HelpPopover
        selectionType="range"
        onClose={() => {}}
        buttonRef={buttonRef}
      />,
      createMockContext({
        messages: {
          timelineShortcutRowsRange: () =>
            "oops" as unknown as { keys: string; description: string }[],
        },
      }),
    );
    const popover = document.body.querySelector(
      '[data-testid="timeline-help-popover"]',
    );
    // Rendered (didn't throw), with no shortcut rows.
    expect(popover).not.toBeNull();
    expect(popover?.querySelectorAll("tr")).toHaveLength(0);
    unmount();
  });
});
