// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, test } from "vitest";
import { StateInspector } from "./StateInspector.js";
import { ViewerStateStore } from "../lib/store.js";

test("inspector uses the canonical per-seat read and preserves missing slots", () => {
  const store = new ViewerStateStore();
  store.save("prompt_answer", { value: "Third" }, "player", 2, 0);
  store.save("prompt_answer", { value: "First" }, "player", 0, 0);
  const container = document.createElement("div");
  const root = createRoot(container);
  act(() =>
    root.render(
      <StateInspector
        store={store}
        position={0}
        playerCount={3}
        stageIndex={0}
        currentStep={{
          index: 0,
          phase: "game",
          name: "test",
          elements: [{ type: "display", reference: "everyone.prompt.answer" }],
        }}
      />,
    ),
  );
  try {
    expect(container.querySelector("textarea")?.value).toBe(
      '[\n  "First",\n  null,\n  "Third"\n]',
    );
  } finally {
    act(() => root.unmount());
  }
});
