// @vitest-environment jsdom
import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  type StagebookContext,
  StagebookProvider,
} from "./StagebookProvider.js";
import { Stage } from "./Stage.js";

// Stage rendering in CT is built in production mode where React
// silences dev warnings. To catch React's "two children with the
// same key" warning we render under jsdom (vitest) with a
// console.error spy. The warning is dev-mode-only, but vitest +
// react-dom both run in dev mode by default.

function createMockContext(): StagebookContext {
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
    playerCount: 1,
    isSubmitted: false,
  };
}

describe("Stage — React key uniqueness", () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  test("two elements with the same `name` but different `type` do not emit a duplicate-key warning", () => {
    // Real-world repro: pilot_3's topicPrompt template pairs a
    // `prompt` and a `submitButton` under the same `name:
    // presurvey_${topicName}`. Server-side these get distinct
    // storage keys (`prompt_<name>` vs `submitButton_<name>`).
    // The React `key=` in `ElementsColumn`'s map must scope by
    // type or these collide on the client.
    const container = document.createElement("div");
    let root: Root;
    act(() => {
      root = createRoot(container);
      root.render(
        <StagebookProvider value={createMockContext()}>
          <Stage
            stage={{
              name: "SameNameDifferentType",
              duration: 60,
              elements: [
                {
                  type: "prompt",
                  name: "presurvey_vaccination",
                  file: "x.md",
                },
                { type: "submitButton", name: "presurvey_vaccination" },
              ],
            }}
            onSubmit={() => {}}
          />
        </StagebookProvider>,
      );
    });

    const duplicateKeyCalls = consoleErrorSpy.mock.calls.filter((args) =>
      String(args[0]).includes("Encountered two children with the same key"),
    );
    expect(duplicateKeyCalls).toEqual([]);

    act(() => root.unmount());
  });
});
