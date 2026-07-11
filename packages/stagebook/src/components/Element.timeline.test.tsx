// @vitest-environment jsdom
import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import {
  StagebookProvider,
  type StagebookContext,
} from "./StagebookProvider.js";
import { Element } from "./Element.js";

// Regression for the timeline read-back path (#298 migration miss): the
// `timeline` element resolves previously-saved selections so a participant
// who reloads the stage sees their existing marks. After #298 every
// reference must carry a position prefix, but the read was left as the bare
// `timeline.<name>` — so `resolve()` rejected it, logged "Invalid reference",
// returned [], and the marks silently vanished on reload. This test renders a
// timeline element through the real provider `resolve` and asserts the saved
// selections reach the Timeline's `initialSelections`.
//
// Timeline itself is heavy (canvas waveform, ResizeObserver, rAF) and is
// covered by Timeline.ct.tsx; here we stub it to capture just the prop the
// resolve path feeds it, keeping the test in jsdom.
vi.mock("./elements/Timeline.js", () => ({
  Timeline: (props: { initialSelections?: unknown }) => (
    <div
      data-testid="timeline-stub"
      data-initial={JSON.stringify(props.initialSelections ?? null)}
    />
  ),
}));

const SAVED_SELECTIONS = [{ id: "s1", start: 1.5, end: 3.2 }];

function makeContext(overrides?: Partial<StagebookContext>): StagebookContext {
  return {
    get: vi.fn(() => []),
    save: vi.fn(),
    getElapsedTime: vi.fn(() => 0),
    submit: vi.fn(),
    getAssetURL: vi.fn((p: string) => `https://cdn.test/${p}`),
    getTextContent: vi.fn(() => Promise.resolve("mock")),
    progressLabel: "game_0_stage",
    playerId: "internal-player-1",
    position: 0,
    playerCount: 1,
    isSubmitted: false,
    ...overrides,
  };
}

function renderTimelineElement(ctx: StagebookContext): HTMLElement {
  const container = document.createElement("div");
  act(() => {
    createRoot(container).render(
      <StagebookProvider value={ctx}>
        <Element
          element={{
            type: "timeline",
            source: "gallery_clip",
            name: "gallery_clip_ranges",
            selectionType: "range",
            multiSelect: true,
          }}
          onSubmit={() => {}}
        />
      </StagebookProvider>,
    );
  });
  return container;
}

describe("Element → Timeline saved-selection read-back (#298 prefix)", () => {
  let consoleError: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    consoleError.mockRestore();
  });

  test("reads previously-saved selections back into initialSelections", () => {
    // Store holds the timeline's saved selections under its storage key
    // (`timeline_<name>`, self scope → host scope "player").
    const get = vi.fn((key: string) =>
      key === "timeline_gallery_clip_ranges" ? [SAVED_SELECTIONS] : [],
    );
    const ctx = makeContext({ get });
    const container = renderTimelineElement(ctx);

    // The read must go through the resolver to the right storage key.
    expect(get).toHaveBeenCalledWith("timeline_gallery_clip_ranges", "player");

    // The saved marks must reach the Timeline, not get dropped.
    const stub = container.querySelector('[data-testid="timeline-stub"]');
    expect(stub?.getAttribute("data-initial")).toBe(
      JSON.stringify(SAVED_SELECTIONS),
    );
  });

  test("first load (no saved value) passes no marks and logs no error", () => {
    // Default context: get() → [], so resolve() → [] and savedSelections is
    // undefined. The read must stay silent (no invalid-reference error) and
    // hand the Timeline nothing rather than garbage.
    const container = renderTimelineElement(makeContext());

    const loggedInvalidRef = consoleError.mock.calls.some((args) =>
      String(args[0]).includes("Invalid reference"),
    );
    expect(loggedInvalidRef).toBe(false);

    const stub = container.querySelector('[data-testid="timeline-stub"]');
    expect(stub?.getAttribute("data-initial")).toBe("null");
  });
});
