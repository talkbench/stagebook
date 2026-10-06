// @vitest-environment jsdom
import { Missing } from "../expressions/missing.js";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Element, type ElementConfig } from "./Element.js";
import {
  StagebookProvider,
  useStagebookContext,
  type StagebookContext,
} from "./StagebookProvider.js";

const roots: Root[] = [];
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
});
afterEach(() => {
  act(() => roots.splice(0).forEach((root) => root.unmount()));
  vi.unstubAllGlobals();
});

function renderElement(element: ElementConfig) {
  const state = new Map<string, unknown>([
    ["attributes", { stableParticipantId: "stable-1" }],
  ]);
  let elapsedTime = 0;
  let readReference: ReturnType<
    typeof useStagebookContext
  >["readReference"] = () => Missing;
  const save = vi.fn((key: string, value: unknown) => state.set(key, value));
  const onSubmit = vi.fn();
  const context: StagebookContext = {
    get: (key) => [state.get(key)],
    save,
    getElapsedTime: () => elapsedTime,
    submit: onSubmit,
    getAssetURL: (path) => path,
    getTextContent: () => Promise.resolve(""),
    progressLabel: "game_0_survey",
    playerId: "player-1",
    position: 0,
    playerCount: 1,
    isSubmitted: false,
  };
  function ReadReferences() {
    const context = useStagebookContext();
    readReference = (reference) => context.readReference(reference);
    return null;
  }
  const container = document.createElement("div");
  const root = createRoot(container);
  roots.push(root);
  act(() => {
    root.render(
      <StagebookProvider value={context}>
        <Element element={element} onSubmit={onSubmit} />
        <ReadReferences />
      </StagebookProvider>,
    );
  });
  return {
    container,
    state,
    save,
    onSubmit,
    readReference: (reference: string) => readReference(reference),
    setElapsedTime: (time: number) => {
      elapsedTime = time;
    },
  };
}

describe("Element referenceable completion records (#690)", () => {
  test.each(["confirm", undefined])(
    "submitButton %s records its click time before submitting",
    (name) => {
      const view = renderElement({ type: "submitButton", name });
      const recordName = name ?? "game_0_survey";
      const reference = `self.submitButton.${recordName}.time`;
      expect(view.readReference(reference)).toBe(Missing);

      // The clock is read at the click, not when the element mounts.
      view.setElapsedTime(25.5);
      let valueAtSubmit: unknown = [];
      view.onSubmit.mockImplementation(() => {
        valueAtSubmit = view.readReference(reference);
      });
      act(() => view.container.querySelector("button")!.click());

      expect(valueAtSubmit).toBe(25.5);
      expect(view.state.get(`submitButton_${recordName}`)).toEqual({
        time: 25.5,
        step: "game_0_survey",
        stageTimeElapsed: 25.5,
      });
      expect(view.onSubmit).toHaveBeenCalledTimes(1);
    },
  );

  test.each(["exit", undefined])(
    "qualtrics %s records completion metadata and preserves the host trigger",
    (name) => {
      const url = "https://upenn.qualtrics.com/jfe/form/SV_x";
      const view = renderElement({ type: "qualtrics", name, url });
      const recordName = name ?? "game_0_survey";
      const reference = `self.qualtrics.${recordName}.sessionId`;
      expect(view.readReference(reference)).toBe(Missing);
      view.setElapsedTime(42);
      let valueAtSubmit: unknown = [];
      let triggerAtSubmit: unknown;
      view.onSubmit.mockImplementation(() => {
        valueAtSubmit = view.readReference(reference);
        triggerAtSubmit = view.state.get("qualtricsDataReady");
      });

      act(() => {
        window.dispatchEvent(
          new MessageEvent("message", {
            data: "QualtricsEOS|SV_x|sess-1",
            origin: "https://upenn.qualtrics.com",
          }),
        );
      });

      const expected = {
        surveyURL: url,
        surveyId: "SV_x",
        sessionId: "sess-1",
        step: "game_0_survey",
        stageTimeElapsed: 42,
      };
      expect(valueAtSubmit).toBe("sess-1");
      expect(triggerAtSubmit).toEqual(expected);
      expect(view.state.get(`qualtrics_${recordName}`)).toEqual(expected);
      expect(view.state.get("qualtricsDataReady")).toEqual(expected);
      expect(view.save.mock.calls.map(([key]) => key)).toEqual([
        `qualtrics_${recordName}`,
        "qualtricsDataReady",
      ]);
      expect(view.onSubmit).toHaveBeenCalledTimes(1);
    },
  );

  test.each([
    ["https://evilqualtrics.com", "QualtricsEOS|SV_x|sess-1"],
    ["https://qualtrics.com.evil.example", "QualtricsEOS|SV_x|sess-1"],
    ["https://upenn.qualtrics.com", "QualtricsEOSspoof|SV_x|sess-1"],
    ["https://upenn.qualtrics.com", "unrelated message"],
  ])("ignores non-Qualtrics completion signals: %s %s", (origin, data) => {
    const view = renderElement({
      type: "qualtrics",
      name: "exit",
      url: "https://upenn.qualtrics.com/jfe/form/SV_x",
    });
    act(() => {
      window.dispatchEvent(new MessageEvent("message", { origin, data }));
    });

    expect(view.save).not.toHaveBeenCalled();
    expect(view.readReference("self.qualtrics.exit.sessionId")).toBe(Missing);
    expect(view.onSubmit).not.toHaveBeenCalled();
  });

  test("accepts completion from the Qualtrics root domain", () => {
    const view = renderElement({
      type: "qualtrics",
      name: "exit",
      url: "https://qualtrics.com/jfe/form/SV_x",
    });
    act(() => {
      window.dispatchEvent(
        new MessageEvent("message", {
          origin: "https://qualtrics.com",
          data: "QualtricsEOS|SV_x|sess-1",
        }),
      );
    });

    expect(view.readReference("self.qualtrics.exit.sessionId")).toBe("sess-1");
    expect(view.onSubmit).toHaveBeenCalledTimes(1);
  });
});
