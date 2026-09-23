// @vitest-environment jsdom
import { describe, test, expect, vi } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import {
  StagebookProvider,
  type StagebookContext,
} from "./StagebookProvider.js";
import { Element } from "./Element.js";

// End-to-end wiring (#473): a `qualtrics` element rendered through `Element`
// must source its identifiers from `self.attributes.*` and thread the
// `onContractViolation` hook from context to the leaf Qualtrics component.
// The leaf behavior is unit-tested in Qualtrics.contract.test.tsx; this guards
// the resolve → Element → Qualtrics path the leaf tests bypass.

function makeContext(overrides?: Partial<StagebookContext>): StagebookContext {
  return {
    get: vi.fn(() => []),
    save: vi.fn(),
    getElapsedTime: vi.fn(() => 0),
    submit: vi.fn(),
    getAssetURL: vi.fn((p: string) => `https://cdn.test/${p}`),
    getTextContent: vi.fn(() => Promise.resolve("mock")),
    progressLabel: "game_0_survey",
    playerId: "internal-player-1",
    position: 0,
    playerCount: 2,
    isSubmitted: false,
    ...overrides,
  };
}

function renderQualtricsElement(ctx: StagebookContext): HTMLElement {
  const container = document.createElement("div");
  act(() => {
    createRoot(container).render(
      <StagebookProvider value={ctx}>
        <Element
          element={{
            type: "qualtrics",
            url: "https://upenn.qualtrics.com/jfe/form/SV_x",
          }}
          onSubmit={() => {}}
        />
      </StagebookProvider>,
    );
  });
  return container;
}

describe("Element → Qualtrics attributes wiring (#473)", () => {
  test("resolves stableParticipantId + sampleId from attributes into the survey URL (not playerId)", () => {
    const ctx = makeContext({
      get: vi.fn((key: string) =>
        key === "attributes"
          ? [{ stableParticipantId: "stable-1", sampleId: "row-9" }]
          : [],
      ),
    });
    const container = renderQualtricsElement(ctx);
    const src = container.querySelector("iframe")?.getAttribute("src") ?? "";
    expect(src).toContain("stableParticipantId=stable-1");
    expect(src).toContain("sampleId=row-9");
    // The internal playerId must never reach the URL.
    expect(src).not.toContain("internal-player-1");
  });

  test("threads onContractViolation through Element when stableParticipantId is empty", () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    const onContractViolation = vi.fn();
    // Host provides no attributes → resolve yields "" for the id.
    const ctx = makeContext({ get: vi.fn(() => []), onContractViolation });

    const container = renderQualtricsElement(ctx);

    expect(onContractViolation).toHaveBeenCalledTimes(1);
    expect(onContractViolation).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "missingStableParticipantId" }),
    );
    // ...and the empty id is omitted from the URL rather than sent blank.
    const src = container.querySelector("iframe")?.getAttribute("src") ?? "";
    expect(src).not.toContain("stableParticipantId=");
    consoleError.mockRestore();
  });
});

// #584: `discussion` is a stage-level key rendered by Stage.tsx, NOT an
// element type — `elementSchema`'s discriminated union has no `discussion`
// member. Downstream hosts rely on at most one discussion rendering per
// stage, so an element config that claims `type: "discussion"` must take the
// unknown-type path rather than reach the host's `renderDiscussion` slot.
describe("Element → no element-level discussion (#584)", () => {
  test('`type: "discussion"` does not invoke renderDiscussion and falls through to the unknown-type path', () => {
    const consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const renderDiscussion = vi.fn(() => <div data-testid="discussion" />);
      const ctx = makeContext({ renderDiscussion });

      const container = document.createElement("div");
      act(() => {
        createRoot(container).render(
          <StagebookProvider value={ctx}>
            <Element
              element={{ type: "discussion", chatType: "video" }}
              onSubmit={() => {}}
            />
          </StagebookProvider>,
        );
      });

      expect(renderDiscussion).not.toHaveBeenCalled();
      expect(container.innerHTML).toBe("");
      expect(consoleWarn).toHaveBeenCalledWith(
        "Unknown element type: discussion",
      );
    } finally {
      consoleWarn.mockRestore();
    }
  });
});

// #669: the host-rendered `survey` element is gone. A pre-parsed tree that
// still carries `type: "survey"` must take the unknown-type path — no
// `survey_*` save, no stage submit — rather than reach any host slot.
describe("Element → no survey element (#669)", () => {
  test('`type: "survey"` falls through to the unknown-type path without saving or submitting', () => {
    const consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const onSubmit = vi.fn();
      const save = vi.fn();
      const ctx = makeContext({ save });

      const container = document.createElement("div");
      act(() => {
        createRoot(container).render(
          <StagebookProvider value={ctx}>
            <Element
              element={{ type: "survey", surveyName: "TIPI", name: "preTIPI" }}
              onSubmit={onSubmit}
            />
          </StagebookProvider>,
        );
      });

      expect(container.innerHTML).toBe("");
      expect(save).not.toHaveBeenCalled();
      expect(onSubmit).not.toHaveBeenCalled();
      expect(consoleWarn).toHaveBeenCalledWith("Unknown element type: survey");
    } finally {
      consoleWarn.mockRestore();
    }
  });
});

// The stage auto-submit on instrument completion — previously pinned at the
// Element level by the deleted Survey.ct.tsx — is now covered for the
// supported external instrument: a Qualtrics end-of-survey message saves the
// completion record and submits the stage through Element's `onSubmit`.
describe("Element → Qualtrics completion auto-submits the stage", () => {
  test("QualtricsEOS from a qualtrics.com origin saves qualtricsDataReady and calls onSubmit once", () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    try {
      const onSubmit = vi.fn();
      const save = vi.fn();
      const ctx = makeContext({
        save,
        get: vi.fn((key: string) =>
          key === "attributes" ? [{ stableParticipantId: "stable-1" }] : [],
        ),
      });
      const container = document.createElement("div");
      act(() => {
        createRoot(container).render(
          <StagebookProvider value={ctx}>
            <Element
              element={{
                type: "qualtrics",
                url: "https://upenn.qualtrics.com/jfe/form/SV_x",
              }}
              onSubmit={onSubmit}
            />
          </StagebookProvider>,
        );
      });

      act(() => {
        window.dispatchEvent(
          new MessageEvent("message", {
            data: "QualtricsEOS|SV_x|sess-1",
            origin: "https://upenn.qualtrics.com",
          }),
        );
      });

      expect(onSubmit).toHaveBeenCalledTimes(1);
      expect(save).toHaveBeenCalledWith(
        "qualtricsDataReady",
        expect.objectContaining({ surveyId: "SV_x", sessionId: "sess-1" }),
        undefined,
      );
    } finally {
      consoleError.mockRestore();
    }
  });
});
