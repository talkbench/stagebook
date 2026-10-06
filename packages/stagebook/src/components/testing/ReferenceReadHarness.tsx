import React, { useState } from "react";
import {
  StagebookProvider,
  type StagebookContext,
} from "../StagebookProvider.js";
import { Stage } from "../Stage.js";

/** Real provider + stage fixture: reverse insertion order and a missing seat. */
export function ReferenceReadHarness() {
  const [middle, setMiddle] = useState(false);
  const records = new Map<string, unknown>([
    ["2", { value: "Third" }],
    ["0", { value: "First" }],
  ]);
  if (middle) records.set("1", { value: "Second" });
  const context: StagebookContext = {
    get: (_key, scope) =>
      records.has(scope ?? "") ? [records.get(scope ?? "")] : [],
    save: () => {},
    getElapsedTime: () => 0,
    submit: () => {},
    getAssetURL: (path) => path,
    getTextContent: () => Promise.resolve(""),
    progressLabel: "read-fixture",
    playerId: "p0",
    position: 0,
    playerCount: 3,
    isSubmitted: false,
  };
  return (
    <StagebookProvider value={context}>
      <button onClick={() => setMiddle(true)}>Answer middle seat</button>
      <Stage
        onSubmit={() => {}}
        stage={{
          name: "references",
          duration: 60,
          elements: [
            {
              type: "display",
              name: "answers",
              reference: "everyone.prompt.answer",
            },
            {
              type: "submitButton",
              buttonText: "Everyone answered",
              conditions: {
                all: {
                  reference: "everyone.prompt.answer",
                  comparator: "exists",
                },
              },
            },
          ],
        }}
      />
    </StagebookProvider>
  );
}
