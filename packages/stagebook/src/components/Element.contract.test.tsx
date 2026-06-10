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
