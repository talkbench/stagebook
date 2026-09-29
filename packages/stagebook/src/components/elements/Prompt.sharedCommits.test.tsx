// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { Prompt, type PromptProps } from "./Prompt.js";
import { Element } from "../Element.js";
import {
  StagebookProvider,
  type StagebookContext,
} from "../StagebookProvider.js";
import { buildPromptRecord } from "../../utils/buildPromptRecord.js";
import { promptFileSchema } from "../../schemas/promptFile.js";
import { openResponse } from "./fixtures/prompts.js";

type Slot = Parameters<NonNullable<PromptProps["renderSharedNotepad"]>>[0] & {
  onLocalEdit: (text: string) => void;
  onRemoteChange: (text: string) => void;
  onBlur: (text: string) => void;
};
let root: Root;
let dom: HTMLDivElement;
let slot: Slot;
const save = vi.fn<(key: string, value: unknown, scope?: string) => void>();
const renderer = (
  config: Parameters<NonNullable<PromptProps["renderSharedNotepad"]>>[0],
) => {
  slot = config as Slot;
  return <div>Host editor</div>;
};
function render(props: Partial<PromptProps> = {}) {
  act(() =>
    root.render(
      <Prompt
        {...openResponse}
        name="answer"
        shared
        value={undefined}
        save={save}
        renderSharedNotepad={renderer}
        {...props}
      />,
    ),
  );
  expect(slot.onLocalEdit).toBeTypeOf("function");
  expect(slot.onRemoteChange).toBeTypeOf("function");
  expect(slot.onBlur).toBeTypeOf("function");
}
const advance = (ms: number) => {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
};
const local = (text: string) => {
  act(() => slot.onLocalEdit(text));
};
const remote = (text: string) => {
  act(() => slot.onRemoteChange(text));
};
const blur = (text: string) => {
  act(() => slot.onBlur(text));
};
const values = () =>
  save.mock.calls.map(([, record]) => (record as { value: string }).value);

beforeEach(() => {
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  vi.useFakeTimers();
  dom = document.createElement("div");
  document.body.appendChild(dom);
  root = createRoot(dom);
  save.mockClear();
});
afterEach(() => {
  act(() => root.unmount());
  dom.remove();
  vi.useRealTimers();
});

test("local burst commits once after 2s quiet, including remote merges without resetting quiet", () => {
  render();
  local("a");
  advance(1000);
  local("ab");
  advance(1500);
  remote("ab + peer");
  advance(499);
  expect(save).not.toHaveBeenCalled();
  advance(1);
  expect(values()).toEqual(["ab + peer"]);
  expect(save.mock.calls[0][2]).toBe("shared");
  advance(10000);
  expect(save).toHaveBeenCalledTimes(1);
});

test("continuous local edits checkpoint at 5s and start a fresh window", () => {
  render();
  for (let batch = 0; batch < 2; batch++) {
    for (let i = 0; i < 5; i++) {
      local(`${batch}:${i}`);
      advance(999);
      expect(save).toHaveBeenCalledTimes(batch);
      advance(1);
    }
  }
  expect(values()).toEqual(["0:4", "1:4"]);
});

test("blur flushes latest text only with pending local edits; idle and remote-only blur are silent", () => {
  render();
  blur("initial");
  remote("peer");
  blur("peer");
  advance(10000);
  expect(save).not.toHaveBeenCalled();
  local("mine");
  advance(100);
  blur("mine + peer");
  expect(values()).toEqual(["mine + peer"]);
  blur("mine + peer");
  advance(10000);
  expect(save).toHaveBeenCalledTimes(1);
});

test("an equal local value still commits in every new batch", () => {
  render();
  local("same");
  advance(2000);
  local("same");
  advance(2000);
  expect(values()).toEqual(["same", "same"]);
});

test("a throttled timer reads the latest remote text long after another writer saved", () => {
  render();
  local("lagging A");
  // Advance wall time without timers: a background tab wakes up after B's
  // newer save and after its document update has reached this editor.
  vi.setSystemTime(Date.now() + 60000);
  remote("merged A + B");
  advance(2000);
  expect(values()).toEqual(["merged A + B"]);
});

test("a merge after this writer's stale commit corrects the record without more typing", () => {
  render();
  local("A before B arrived");
  advance(2000);
  expect(values()).toEqual(["A before B arrived"]);
  remote("merged A + B");
  advance(1999);
  expect(save).toHaveBeenCalledTimes(1);
  advance(1);
  expect(values()).toEqual(["A before B arrived", "merged A + B"]);
  remote("merged A + B");
  advance(20000);
  expect(save).toHaveBeenCalledTimes(2);
});

test("multiple late merges remain eligible for correction while never-editing observers stay silent", () => {
  render();
  remote("initial peer");
  advance(10000);
  expect(save).not.toHaveBeenCalled();
  local("A");
  advance(2000);
  remote("A + B");
  advance(2000);
  remote("A + B + C");
  advance(2000);
  expect(values()).toEqual(["A", "A + B", "A + B + C"]);
});

test("continuous remote corrections reset quiet but retain a 5s maximum", () => {
  render();
  local("A");
  advance(2000);
  for (let i = 0; i < 5; i++) {
    remote(`merged:${i}`);
    advance(999);
    expect(save).toHaveBeenCalledTimes(1);
    advance(1);
  }
  expect(values()).toEqual(["A", "merged:4"]);
  advance(10000);
  expect(save).toHaveBeenCalledTimes(2);
});

test("a duplicate correction callback does not postpone its quiet deadline", () => {
  render();
  local("A");
  advance(2000);
  remote("A+B");
  advance(1500);
  remote("A+B");
  advance(500);
  expect(values()).toEqual(["A", "A+B"]);
});

test("blur cannot flush a correction-only batch", () => {
  render();
  local("A");
  advance(2000);
  remote("A+B");
  advance(500);
  blur("A+B");
  expect(save).toHaveBeenCalledTimes(1);
  advance(1500);
  expect(values()).toEqual(["A", "A+B"]);
});

test("local editing promotes correction to local while retaining the original max deadline", () => {
  render();
  local("A");
  advance(2000);
  remote("A+B");
  advance(1500);
  remote("A+B+C");
  advance(1500);
  local("A+B+C+D");
  advance(1500);
  local("final merged");
  advance(499);
  expect(save).toHaveBeenCalledTimes(1);
  advance(1);
  expect(values()).toEqual(["A", "final merged"]);
  remote("later");
  local("local after correction");
  blur("latest on blur");
  expect(values()).toEqual(["A", "final merged", "latest on blur"]);
});

test("unmount cancels pending work and retained host callbacks cannot restart it", () => {
  render();
  local("unfinished");
  const old = slot;
  act(() => root.render(<div>Next stage</div>));
  act(() => {
    old.onLocalEdit("late local");
    old.onRemoteChange("late merge");
    old.onBlur("late blur");
  });
  advance(20000);
  expect(save).not.toHaveBeenCalled();
});

for (const changed of [
  { name: "other" },
  { file: "other.prompt.md" },
  { step: "other_stage" },
  { stageId: "other_stage_id" },
]) {
  test(`prompt identity change ${JSON.stringify(changed)} cancels old callbacks and pending text`, () => {
    render();
    local("old prompt");
    const old = slot;
    render(changed);
    act(() => old.onLocalEdit("stale callback"));
    advance(10000);
    expect(save).not.toHaveBeenCalled();
    local("new prompt");
    advance(2000);
    expect(values()).toEqual(["new prompt"]);
    expect(save.mock.calls[0][0]).toBe(`prompt_${changed.name ?? "answer"}`);
  });
}

test("two writers converge when B saves, stale A saves later, then A finally receives B's merge", () => {
  let a: Slot;
  let b: Slot;
  let stored: unknown;
  const store = (key: string, record: unknown, scope?: "player" | "shared") => {
    stored = record;
    save(key, record, scope);
  };
  act(() =>
    root.render(
      <>
        <Prompt
          {...openResponse}
          name="answer"
          shared
          value={undefined}
          save={store}
          renderSharedNotepad={(config) => {
            a = config as Slot;
            return null;
          }}
        />
        <Prompt
          {...openResponse}
          name="answer"
          shared
          value={undefined}
          save={store}
          renderSharedNotepad={(config) => {
            b = config as Slot;
            return null;
          }}
        />
      </>,
    ),
  );
  act(() => b.onLocalEdit("B"));
  advance(500);
  act(() => a.onLocalEdit("A"));
  advance(500);
  act(() => b.onRemoteChange("AB"));
  advance(1000);
  expect(stored).toMatchObject({ value: "AB" });
  advance(500);
  expect(stored).toMatchObject({ value: "A" });
  act(() => a.onRemoteChange("AB"));
  advance(1999);
  expect(stored).toMatchObject({ value: "A" });
  advance(1);
  expect(stored).toMatchObject({ value: "AB" });
  expect(values()).toEqual(["AB", "A", "AB"]);
});

for (const shared of [false, true]) {
  test(`actual Element ${shared ? "shared" : "solo"} record equals buildPromptRecord with commit-time context`, async () => {
    const markdown =
      "---\ntype: openResponse\nname: source_name\nrequired: true\nminLength: 3\n---\nQuestion\n---\n> Hint";
    const parsed = promptFileSchema.parse(markdown);
    let elapsed = 40;
    const getElapsedTime = vi.fn(() => ++elapsed);
    const ctx: StagebookContext = {
      get: () => [],
      save,
      getElapsedTime,
      submit: () => {},
      getAssetURL: (path) => path,
      getTextContent: () => Promise.resolve(markdown),
      progressLabel: "game_1_answer",
      playerId: "p1",
      position: 0,
      playerCount: 2,
      isSubmitted: false,
      renderSharedNotepad: renderer,
    };
    await act(async () => {
      root.render(
        <StagebookProvider value={ctx}>
          <Element
            element={{
              type: "prompt",
              name: "answer",
              file: "answer.prompt.md",
              shared,
            }}
            onSubmit={() => {}}
          />
        </StagebookProvider>,
      );
      await Promise.resolve();
    });
    if (shared) local("committed answer");
    else
      act(() => {
        const input = dom.querySelector("textarea")!;
        Object.getOwnPropertyDescriptor(
          HTMLTextAreaElement.prototype,
          "value",
        )!.set!.call(input, "committed answer");
        input.dispatchEvent(new Event("input", { bubbles: true }));
      });
    elapsed = 57;
    advance(2000);
    expect(getElapsedTime).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenLastCalledWith(
      "prompt_answer",
      buildPromptRecord({
        metadata: parsed.metadata,
        name: "answer",
        file: "answer.prompt.md",
        shared,
        body: parsed.body,
        responses: parsed.responseItems,
        value: "committed answer",
        debugMessages: [],
        step: "game_1_answer",
        stageTimeElapsed: 58,
      }),
      shared ? "shared" : "player",
    );
    if (shared) expect(save.mock.calls[0][1]).not.toHaveProperty("isValid");
  });
}

test("empty local deletion remains pending and commits an empty value", () => {
  render({ value: "previous" });
  local("");
  advance(1999);
  expect(save).not.toHaveBeenCalled();
  advance(1);
  expect(values()).toEqual([""]);
});

test("harmless rerender preserves the deadline and commits through latest save with latest metadata", () => {
  render();
  local("answer");
  advance(1000);
  const latestSave = vi.fn();
  const metadata = {
    type: "openResponse" as const,
    name: "updated source",
    rows: 8,
  };
  render({ save: latestSave, metadata, body: "Updated question" });
  advance(999);
  expect(latestSave).not.toHaveBeenCalled();
  advance(1);
  expect(save).not.toHaveBeenCalled();
  expect(latestSave).toHaveBeenCalledTimes(1);
  expect(latestSave).toHaveBeenLastCalledWith(
    "prompt_answer",
    buildPromptRecord({
      metadata,
      name: "answer",
      shared: true,
      body: "Updated question",
      responses: openResponse.responseItems,
      value: "answer",
    }),
    "shared",
  );
});

test("correction blur refreshes pending merged text without flushing or extending its deadlines", () => {
  render();
  local("A");
  advance(2000);
  remote("A+B");
  advance(1500);
  blur("A+B+C");
  expect(save).toHaveBeenCalledTimes(1);
  advance(499);
  expect(save).toHaveBeenCalledTimes(1);
  advance(1);
  expect(values()).toEqual(["A", "A+B+C"]);
});
