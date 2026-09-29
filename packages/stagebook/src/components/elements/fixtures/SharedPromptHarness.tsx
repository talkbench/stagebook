import React, { useState } from "react";
import { Element } from "../../Element.js";
import {
  StagebookProvider,
  type StagebookContext,
} from "../../StagebookProvider.js";

type NotepadConfig = Parameters<
  NonNullable<StagebookContext["renderSharedNotepad"]>
>[0];
const markdown =
  "---\ntype: openResponse\nname: shared_answer\n---\nShared answer\n---\n> A placeholder";
function HostEditor({
  onLocalEdit,
  onRemoteChange,
  onBlur,
  defaultText,
}: NotepadConfig) {
  const [text, setText] = useState("");
  return (
    <>
      <textarea
        aria-label="Host shared editor"
        placeholder={defaultText}
        value={text}
        onChange={(event) => {
          setText(event.target.value);
          onLocalEdit(event.target.value);
        }}
        onBlur={() => onBlur(text)}
      />
      <button
        type="button"
        // Simulate a peer transaction without blurring the local editor first.
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => {
          setText("Merged from peer");
          onRemoteChange("Merged from peer");
        }}
      >
        Receive remote merge
      </button>
      <button type="button">Leave editor</button>
    </>
  );
}
const renderSharedNotepad = (config: NotepadConfig) => (
  <HostEditor {...config} />
);

export function SharedPromptHarness() {
  const [writes, setWrites] = useState<
    Array<{ key: string; record: unknown; scope?: string }>
  >([]);
  const context: StagebookContext = {
    get: () => (writes.length ? [writes.at(-1)!.record] : []),
    save: (key, record, scope) =>
      setWrites((previous) => [...previous, { key, record, scope }]),
    getElapsedTime: () => 42,
    submit: () => {},
    getAssetURL: (path) => path,
    getTextContent: () => Promise.resolve(markdown),
    progressLabel: "game_0_shared",
    stageId: "stage-1",
    playerId: "p1",
    playerCount: 2,
    position: 0,
    isSubmitted: false,
    renderSharedNotepad,
  };
  return (
    <StagebookProvider value={context}>
      <Element
        element={{
          type: "prompt",
          name: "answer",
          file: "answer.prompt.md",
          shared: true,
        }}
        onSubmit={() => {}}
      />
      <output data-testid="write-count">{writes.length}</output>
      <output data-testid="last-write">{JSON.stringify(writes.at(-1))}</output>
    </StagebookProvider>
  );
}
