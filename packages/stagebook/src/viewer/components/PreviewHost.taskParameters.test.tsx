// @vitest-environment jsdom
//
// #815: PreviewHost previews a parameterized workflow against an Annotator
// task file — choose an entry, bind its fields with their JSON types, and
// start each entry from a clean slate.
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import React, { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { TreatmentFileType } from "../../schemas/index.js";
import { PreviewHost, type TaskParameterSource } from "./PreviewHost.js";

beforeAll(() => {
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  if (!("ResizeObserver" in globalThis)) {
    (globalThis as { ResizeObserver?: unknown }).ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
  }
  if (!window.matchMedia) {
    window.matchMedia = (() => ({
      matches: false,
      addEventListener() {},
      removeEventListener() {},
    })) as unknown as typeof window.matchMedia;
  }
});

const cleanups: (() => void)[] = [];
afterEach(async () => {
  // Let the async post-fill prompt checks settle inside act before
  // unmounting, so their state updates don't land between tests.
  await flush();
  for (const cleanup of cleanups.splice(0)) cleanup();
});

const PROMPT =
  "---\ntype: multipleChoice\nname: answer\n---\nChoose one.\n\n---\n\n- Alpha\n- Beta";

/** One treatment whose prompt file and stage duration come from task fields. */
function workflow(): TreatmentFileType {
  return {
    treatments: [
      {
        name: "rate",
        playerCount: 1,
        compatibleIntroSequences: [],
        gameStages: [
          {
            name: "first",
            duration: "${seconds}",
            elements: [
              { type: "prompt", name: "answer", file: "${promptFile}" },
            ],
          },
          {
            name: "second",
            duration: 10,
            elements: [{ type: "submitButton", buttonText: "Done" }],
          },
        ],
      },
      {
        name: "other",
        playerCount: 1,
        compatibleIntroSequences: [],
        gameStages: [
          {
            name: "only",
            duration: 10,
            elements: [{ type: "display", reference: "${otherRef}" }],
          },
        ],
      },
    ],
  } as unknown as TreatmentFileType;
}

const TASKS = [
  {
    callerTaskId: "clip-01",
    treatment: "rate",
    fields: { promptFile: "a.prompt.md", seconds: 60 },
    targetReplications: 1,
    metadata: {},
  },
  {
    callerTaskId: "clip-02",
    treatment: "rate",
    fields: { promptFile: "b.prompt.md", seconds: 30 },
  },
  {
    callerTaskId: "bad-path",
    treatment: "rate",
    fields: { promptFile: "c.md", seconds: 30 },
  },
  {
    callerTaskId: "bad-seconds",
    treatment: "rate",
    fields: { promptFile: "a.prompt.md", seconds: "60" },
  },
  { callerTaskId: "typo", treatment: "rte", fields: {} },
];

interface HarnessHandle {
  setSource: (source: TaskParameterSource | null) => void;
  setTreatmentFile: (file: TreatmentFileType) => void;
}

function renderHarness({
  source = { name: "tasks.json", text: JSON.stringify(TASKS) },
  selectedKey = null,
  treatmentFile = workflow(),
  selectedTreatmentIndex = 0,
}: {
  source?: TaskParameterSource | null;
  selectedKey?: string | null;
  treatmentFile?: TreatmentFileType;
  selectedTreatmentIndex?: number;
} = {}) {
  const getTextContent = vi.fn(() => Promise.resolve(PROMPT));
  const onLoad = vi.fn();
  const onSelect = vi.fn();
  const onFieldsResolved = vi.fn();
  const onRefresh = vi.fn();
  const handle = {} as HarnessHandle;

  function Harness() {
    const [currentSource, setSource] = useState(source);
    const [key, setKey] = useState(selectedKey);
    const [file, setTreatmentFile] = useState(treatmentFile);
    handle.setSource = setSource;
    handle.setTreatmentFile = setTreatmentFile;
    return (
      <PreviewHost
        treatmentFile={file}
        selectedIntroIndex={0}
        selectedTreatmentIndex={selectedTreatmentIndex}
        getTextContent={getTextContent}
        getAssetURL={(p) => p}
        onFieldsResolved={onFieldsResolved}
        onRefresh={onRefresh}
        taskParameters={{
          source: currentSource,
          selectedKey: key,
          onSelect: (next) => {
            onSelect(next);
            setKey(next);
          },
          onLoad,
          onClear: () => {
            setSource(null);
            setKey(null);
          },
        }}
      />
    );
  }

  const container = document.createElement("div");
  document.body.appendChild(container);
  let root: Root;
  act(() => {
    root = createRoot(container);
    root.render(<Harness />);
  });
  cleanups.push(() =>
    act(() => {
      root.unmount();
      container.remove();
    }),
  );
  return {
    container,
    getTextContent,
    onLoad,
    onSelect,
    onFieldsResolved,
    onRefresh,
    handle,
  };
}

async function flush(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

function taskSelect(container: HTMLElement): HTMLSelectElement {
  const select = bar(container).querySelector("select");
  if (!select) throw new Error("Missing task select");
  return select;
}

function chooseTask(container: HTMLElement, key: string): void {
  act(() => {
    const select = taskSelect(container);
    select.value = key;
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

function bar(container: HTMLElement): HTMLElement {
  const element = container.querySelector<HTMLElement>(
    '[data-testid="task-parameter-bar"]',
  );
  if (!element) throw new Error("Missing task parameter bar");
  return element;
}

function problem(container: HTMLElement): HTMLElement | null {
  return container.querySelector('[data-testid="task-parameter-problem"]');
}

function button(container: HTMLElement, text: string): HTMLButtonElement {
  const found = Array.from(container.querySelectorAll("button")).find((b) =>
    b.textContent?.includes(text),
  );
  if (!found) throw new Error(`Missing button: ${text}`);
  return found;
}

function typeInto(input: HTMLInputElement | null, value: string): void {
  if (!input) throw new Error("Missing input");
  act(() => {
    // React tracks the value property; set it natively so onChange fires.
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

/** The workflow with a copy of `rate` under another name. */
function workflowWithCopy(): TreatmentFileType {
  const file = workflow();
  const treatments = file.treatments as { name: string }[];
  return {
    ...file,
    treatments: [...treatments, { ...treatments[0], name: "rate_again" }],
  } as TreatmentFileType;
}

const answer = (container: HTMLElement) =>
  container.querySelector<HTMLInputElement>(
    'main input[type="radio"][value="Alpha"]',
  );

describe("PreviewHost task parameters (#815)", () => {
  it("offers to load parameters when the workflow has fields to fill", () => {
    const { container, onLoad } = renderHarness({ source: null });
    // Manual entry is still there…
    expect(container.querySelector("#field-promptFile")).not.toBeNull();
    // …next to the way to load a task file instead.
    act(() => button(bar(container), "Load parameters").click());
    expect(onLoad).toHaveBeenCalledOnce();
  });

  it("shows no parameter bar for a workflow without fields", async () => {
    const { container } = renderHarness({
      source: null,
      treatmentFile: {
        treatments: [
          {
            name: "plain",
            playerCount: 1,
            compatibleIntroSequences: [],
            gameStages: [
              {
                name: "s",
                duration: 10,
                elements: [{ type: "submitButton", buttonText: "Go" }],
              },
            ],
          },
        ],
      } as unknown as TreatmentFileType,
    });
    await flush();
    expect(
      container.querySelector('[data-testid="task-parameter-bar"]'),
    ).toBeNull();
    expect(container.querySelector("main")).not.toBeNull();
  });

  it("asks which task to preview, then binds that task's fields", async () => {
    const { container, getTextContent, onSelect } = renderHarness();
    expect(bar(container).textContent).toContain("tasks.json");
    // Nothing previews until a task is chosen.
    expect(container.querySelector("main")).toBeNull();

    act(() => button(container, "clip-02").click());
    expect(onSelect).toHaveBeenCalledWith("id:clip-02");
    await flush();

    expect(getTextContent).toHaveBeenCalledWith("b.prompt.md");
    expect(taskSelect(container).value).toBe("id:clip-02");
    // The other treatment's fields (otherRef) aren't asked for.
    expect(container.querySelector("#field-otherRef")).toBeNull();
    expect(answer(container)).not.toBeNull();
  });

  it("starts each task from a clean slate", async () => {
    const { container, getTextContent } = renderHarness({
      selectedKey: "id:clip-01",
    });
    await flush();
    expect(getTextContent).toHaveBeenCalledWith("a.prompt.md");
    act(() => answer(container)!.click());
    expect(answer(container)!.checked).toBe(true);

    chooseTask(container, "id:clip-02");
    await flush();
    expect(getTextContent).toHaveBeenCalledWith("b.prompt.md");
    expect(answer(container)!.checked).toBe(false);

    // Coming back doesn't restore the earlier response either.
    chooseTask(container, "id:clip-01");
    await flush();
    expect(answer(container)!.checked).toBe(false);
  });

  it("doesn't carry a manual override over to another task", async () => {
    const { container } = renderHarness({ selectedKey: "id:bad-path" });
    // The bad value routes to the form, naming the field behind the issue.
    const input =
      container.querySelector<HTMLInputElement>("#field-promptFile");
    expect(input?.value).toBe("c.md");
    expect(container.textContent).toContain("${promptFile}");

    // Override it by hand…
    typeInto(input, "a.prompt.md");
    act(() => button(container, "Continue").click());
    await flush();
    expect(container.querySelector("#field-promptFile")).toBeNull();

    // …then switch away and back: the task's own value is in force again.
    chooseTask(container, "id:clip-01");
    await flush();
    chooseTask(container, "id:bad-path");
    await flush();
    expect(
      container.querySelector<HTMLInputElement>("#field-promptFile")?.value,
    ).toBe("c.md");
  });

  it("reports a numeric field given as a string, naming the field", () => {
    const { container } = renderHarness({ selectedKey: "id:bad-seconds" });
    // The string "60" isn't coerced: the issue is reported, attributed to
    // the field in the task file.
    const issues = container.querySelector('[role="alert"]');
    expect(issues?.textContent).toContain("Post-fill validation failed");
    expect(issues?.textContent).toContain("duration (from ${seconds})");
    // The bar stays, so another task can be chosen.
    expect(taskSelect(container).value).toBe("id:bad-seconds");
  });

  it("keeps the bar on the error screen a form can't fix", async () => {
    // Every field is a number, so there's nothing to edit by hand.
    const { container } = renderHarness({
      source: {
        name: "tasks.json",
        text: JSON.stringify([
          {
            callerTaskId: "negative",
            treatment: "timed",
            fields: { seconds: -5 },
          },
          { callerTaskId: "fine", treatment: "timed", fields: { seconds: 5 } },
        ]),
      },
      selectedKey: "id:negative",
      treatmentFile: {
        treatments: [
          {
            name: "timed",
            playerCount: 1,
            compatibleIntroSequences: [],
            gameStages: [
              {
                name: "only",
                duration: "${seconds}",
                elements: [{ type: "submitButton", buttonText: "Go" }],
              },
            ],
          },
        ],
      } as unknown as TreatmentFileType,
    });
    expect(container.querySelector("form")).toBeNull();
    expect(container.querySelector("h2")?.textContent).toBe(
      "Post-fill validation failed",
    );
    expect(container.querySelector("li")?.textContent).toContain(
      "(from ${seconds})",
    );
    chooseTask(container, "id:fine");
    await flush();
    expect(container.querySelector("main")).not.toBeNull();
  });

  it("reports an unknown treatment instead of previewing another one", () => {
    const { container } = renderHarness({ selectedKey: "id:typo" });
    expect(problem(container)?.textContent).toContain('Task "typo"');
    expect(problem(container)?.textContent).toContain(
      'Treatment "rte" isn\'t defined in this workflow. Treatments: rate, other.',
    );
    expect(container.querySelector("main")).toBeNull();
  });

  it("offers refresh where the viewer's own refresh isn't shown", async () => {
    const { container, onRefresh } = renderHarness({ selectedKey: "id:typo" });
    // After fixing the workflow or the file, refresh from the problem screen.
    act(() => button(bar(container), "Refresh").click());
    expect(onRefresh).toHaveBeenCalledOnce();

    // In the preview the viewer header has refresh, so the bar doesn't.
    chooseTask(container, "id:clip-01");
    await flush();
    expect(
      Array.from(bar(container).querySelectorAll("button")).map(
        (b) => b.textContent,
      ),
    ).toEqual(["Load parameters…", "Clear"]);
    expect(
      container.querySelector('button[aria-label="Refresh preview"]'),
    ).not.toBeNull();
  });

  it("reports missing fields by entry and field", () => {
    const { container } = renderHarness({
      source: {
        name: "tasks.json",
        text: JSON.stringify([
          { callerTaskId: "short", treatment: "rate", fields: { seconds: 5 } },
        ]),
      },
      selectedKey: "id:short",
    });
    expect(problem(container)?.textContent).toContain('Task "short"');
    expect(problem(container)?.textContent).toContain(
      'Missing field "promptFile", used by treatment "rate".',
    );
  });

  it("warns about fields the treatment doesn't use", async () => {
    const { container } = renderHarness({
      source: {
        name: "tasks.json",
        text: JSON.stringify([
          {
            callerTaskId: "extra",
            treatment: "rate",
            fields: { promptFile: "a.prompt.md", seconds: 5, clipURL: "x" },
          },
        ]),
      },
      selectedKey: "id:extra",
    });
    await flush();
    expect(bar(container).textContent).toContain('Field "clipURL"');
    expect(answer(container)).not.toBeNull();
  });

  it("reports malformed JSON and an unreadable file", () => {
    const { container, handle } = renderHarness({
      source: { name: "tasks.json", text: "[{" },
    });
    expect(problem(container)?.textContent).toMatch(/Invalid JSON/);

    act(() =>
      handle.setSource({ name: "tasks.json", readError: "ENOENT: gone" }),
    );
    expect(problem(container)?.textContent).toContain("ENOENT: gone");
    // Load stays available to pick a different file.
    expect(button(bar(container), "Load parameters")).not.toBeNull();
  });

  it("keeps the selection across a refresh and re-reads the task's fields", async () => {
    const { container, getTextContent, handle } = renderHarness({
      selectedKey: "id:clip-01",
    });
    await flush();
    act(() => answer(container)!.click());

    // A refresh re-reads the file: same task, edited value.
    const edited = TASKS.map((task) =>
      task.callerTaskId === "clip-01"
        ? { ...task, fields: { promptFile: "a2.prompt.md", seconds: 60 } }
        : task,
    );
    act(() =>
      handle.setSource({ name: "tasks.json", text: JSON.stringify(edited) }),
    );
    await flush();
    expect(getTextContent).toHaveBeenCalledWith("a2.prompt.md");
    expect(taskSelect(container).value).toBe("id:clip-01");
    // New values are a new case: the preview starts over.
    expect(answer(container)!.checked).toBe(false);
  });

  it("lets an edited task file win over an earlier manual override", async () => {
    const { container, getTextContent, handle } = renderHarness({
      selectedKey: "id:bad-path",
    });
    typeInto(
      container.querySelector<HTMLInputElement>("#field-promptFile"),
      "a.prompt.md",
    );
    act(() => button(container, "Continue").click());
    await flush();

    // Fix the value in the file and refresh: the file's value is used.
    const fixed = TASKS.map((task) =>
      task.callerTaskId === "bad-path"
        ? { ...task, fields: { promptFile: "b.prompt.md", seconds: 30 } }
        : task,
    );
    getTextContent.mockClear();
    act(() =>
      handle.setSource({ name: "tasks.json", text: JSON.stringify(fixed) }),
    );
    await flush();
    expect(getTextContent).toHaveBeenCalledWith("b.prompt.md");
    expect(getTextContent).not.toHaveBeenCalledWith("a.prompt.md");
  });

  it("starts over when an earlier entry's removal shifts a position key", async () => {
    // Without callerTaskIds, entries are known by position.
    const untitled = [
      { treatment: "rate", fields: { promptFile: "a.prompt.md", seconds: 5 } },
      { treatment: "rate", fields: { promptFile: "b.prompt.md", seconds: 5 } },
      { treatment: "rate", fields: { promptFile: "c.prompt.md", seconds: 5 } },
    ];
    const { container, handle } = renderHarness({
      source: { name: "tasks.json", text: JSON.stringify(untitled) },
      selectedKey: "entry:2",
    });
    await flush();
    act(() => answer(container)!.click());

    act(() =>
      handle.setSource({
        name: "tasks.json",
        text: JSON.stringify(untitled.slice(1)),
      }),
    );
    await flush();
    // "Entry 2" is now the former entry 3: its answers start empty.
    expect(answer(container)!.checked).toBe(false);
  });

  it("keeps the task's state when the workflow itself is refreshed", async () => {
    const { container, handle } = renderHarness({ selectedKey: "id:clip-01" });
    await flush();
    act(() => answer(container)!.click());

    // VS Code's refresh re-reads the workflow and the task file together.
    const edited = workflow();
    const [rate] = edited.treatments as {
      gameStages: { elements: Record<string, unknown>[] }[];
    }[];
    rate.gameStages[0].elements.push({ type: "display", text: "Edited" });
    act(() => {
      handle.setTreatmentFile(edited);
      handle.setSource({ name: "tasks.json", text: JSON.stringify(TASKS) });
    });
    await flush();
    expect(container.querySelector("main")?.textContent).toContain("Edited");
    expect(taskSelect(container).value).toBe("id:clip-01");
    expect(answer(container)!.checked).toBe(true);
  });

  it("starts over when a refresh points the task at another treatment", async () => {
    const { container, handle } = renderHarness({
      selectedKey: "id:clip-01",
      treatmentFile: workflowWithCopy(),
    });
    await flush();
    act(() => answer(container)!.click());

    // Same task, same prompt, but now it runs a different treatment.
    const moved = TASKS.map((task) =>
      task.callerTaskId === "clip-01"
        ? { ...task, treatment: "rate_again" }
        : task,
    );
    act(() =>
      handle.setSource({ name: "tasks.json", text: JSON.stringify(moved) }),
    );
    await flush();
    expect(taskSelect(container).value).toBe("id:clip-01");
    expect(answer(container)!.checked).toBe(false);
  });

  it("previews the task's treatment whatever the host's treatment selection", async () => {
    // With an intro in the file, a host index past the narrowed workflow's
    // single treatment would fall back to the intro.
    const { container, onFieldsResolved } = renderHarness({
      selectedKey: "id:bad-path",
      selectedTreatmentIndex: 1,
      treatmentFile: {
        ...workflow(),
        introSequences: [
          {
            name: "intro",
            introSteps: [
              {
                name: "welcome",
                elements: [{ type: "submitButton", buttonText: "Start" }],
              },
            ],
          },
        ],
      } as TreatmentFileType,
    });
    typeInto(
      container.querySelector<HTMLInputElement>("#field-promptFile"),
      "a.prompt.md",
    );
    act(() => button(container, "Continue").click());
    await flush();
    expect(
      container.querySelector<HTMLSelectElement>(
        'select[aria-label="Part to preview"]',
      )?.value,
    ).toBe("treatment:0");
    // A task's values aren't the host's to persist as user-entered ones.
    expect(onFieldsResolved).not.toHaveBeenCalled();
  });

  it("explains why a malformed entry can't be previewed", () => {
    const { container } = renderHarness({
      source: {
        name: "tasks.json",
        text: JSON.stringify([{ callerTaskId: "x", fields: {} }]),
      },
      selectedKey: "id:x",
    });
    expect(problem(container)?.textContent).toContain(
      'Task "x" can\'t be previewed',
    );
    expect(problem(container)?.textContent).toContain('Missing "treatment"');
  });

  it("says so when the selected task disappears on refresh", () => {
    const { container, handle } = renderHarness({ selectedKey: "id:clip-01" });
    act(() =>
      handle.setSource({
        name: "tasks.json",
        text: JSON.stringify(TASKS.slice(1)),
      }),
    );
    expect(problem(container)?.textContent).toContain(
      'The selected task "clip-01" is no longer in tasks.json.',
    );
    expect(container.querySelector("main")).toBeNull();
    // Another task can still be chosen from the list.
    expect(button(container, "clip-02")).not.toBeNull();
  });

  it("returns to manual entry when the file is cleared", () => {
    const { container } = renderHarness({ selectedKey: "id:clip-01" });
    act(() => button(bar(container), "Clear").click());
    expect(container.querySelector("#field-promptFile")).not.toBeNull();
    expect(container.querySelector("main")).toBeNull();
  });
});
