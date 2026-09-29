// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, test, vi } from "vitest";
import { Prompt, type PromptProps } from "./Prompt.js";
import {
  StagebookProvider,
  useStagebookContext,
  type StagebookContext,
} from "../StagebookProvider.js";
import { Element } from "../Element.js";
import { evaluateConditions } from "../../utils/evaluateConditions.js";
import { checkResponse } from "../../utils/checkResponse.js";
import { buildPromptRecord } from "../../utils/buildPromptRecord.js";
import { resolveCatalog } from "../../messages/index.js";

type Config = Parameters<
  NonNullable<StagebookContext["renderSharedNumericResponse"]>
>[0];
let dom: HTMLDivElement;
let root: Root;
let slot: Config;
const save = vi.fn();
const format = { decimal: ".", grouping: "," };
const comma = { decimal: ",", grouping: "." };
const renderer = (config: Config) => {
  slot = config;
  return <div>Numeric host</div>;
};
const base: PromptProps = {
  metadata: { type: "numericResponse", min: 18, max: 99, required: true },
  body: "How old are you?",
  responseItems: [],
  name: "age",
  value: undefined,
  save,
};
const context = (
  overrides: Partial<StagebookContext> = {},
): StagebookContext => ({
  get: () => [],
  save,
  getElapsedTime: () => 12,
  submit: vi.fn(),
  getAssetURL: (p) => p,
  getTextContent: () =>
    Promise.resolve(
      "---\ntype: numericResponse\nmin: 18\nmax: 99\n---\nHow old are you?",
    ),
  progressLabel: "study_age",
  position: 0,
  playerCount: 2,
  isSubmitted: false,
  ...overrides,
});
const render = (props: Partial<PromptProps> = {}, ctx = context()) => {
  act(() =>
    root.render(
      <StagebookProvider value={ctx}>
        <Prompt {...base} {...props} />
      </StagebookProvider>,
    ),
  );
};
const advance = (ms = 2000) => {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
};
const edit = (text: string) => {
  const input = dom.querySelector("input")!;
  act(() => {
    input.focus();
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!.call(input, text);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
};
const record = () => save.mock.calls.at(-1)?.[1] as Record<string, unknown>;
beforeEach(() => {
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  vi.useFakeTimers();
  vi.stubGlobal("matchMedia", () => ({
    matches: false,
    addEventListener() {},
    removeEventListener() {},
  }));
  dom = document.createElement("div");
  document.body.appendChild(dom);
  root = createRoot(dom);
  save.mockClear();
});
afterEach(() => {
  act(() => root.unmount());
  dom.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

test("solo saves numeric validity, raw text and format; malformed edit removes stale value", () => {
  render({ metadata: { type: "numericResponse", max: 20 } });
  edit("25");
  advance(1999);
  expect(save).not.toHaveBeenCalled();
  advance(1);
  expect(record()).toMatchObject({
    value: 25,
    entry: "25",
    isValid: false,
    numberFormat: format,
  });
  edit("3-4");
  advance();
  expect(record()).not.toHaveProperty("value");
  expect(record().entry).toBe("3-4");
  edit("-0");
  advance();
  expect(Object.is(record().value, 0)).toBe(true);
  edit("");
  act(() => dom.querySelector("input")!.blur());
  expect(record()).not.toHaveProperty("value");
  expect(record().isValid).toBe(true);
});
test("required blank blur saves invalid entry; control is named and marked required", () => {
  render();
  const input = dom.querySelector("input")!;
  expect(
    document
      .getElementById(input.getAttribute("aria-labelledby")!)
      ?.querySelector("p")?.textContent,
  ).toBe("How old are you?");
  expect(input.getAttribute("aria-required")).toBe("true");
  act(() => {
    input.focus();
    input.blur();
  });
  expect(record()).toMatchObject({ entry: "", isValid: false });
  expect(record()).not.toHaveProperty("value");
});
test.each(["007", "5."])(
  "restores raw %s rather than stringifying value",
  (entry) => {
    render({ entry, numberFormat: format, value: 7 });
    expect(dom.querySelector("input")!.value).toBe(entry);
  },
);
test("saved comma format survives no-edit blur then own edit adopts the provider override", () => {
  render(
    { entry: "1,5", numberFormat: comma, value: 1.5 },
    context({ messages: { numberFormat: format } }),
  );
  const input = dom.querySelector("input")!;
  act(() => {
    input.focus();
    input.blur();
  });
  expect(record()).toMatchObject({
    value: 1.5,
    entry: "1,5",
    numberFormat: comma,
  });
  edit("2.5");
  advance();
  expect(record()).toMatchObject({
    value: 2.5,
    entry: "2.5",
    numberFormat: format,
  });
});
test("provider override drives parsing through Prompt", () => {
  render({}, context({ messages: { numberFormat: comma } }));
  edit("18,5");
  advance();
  expect(record()).toMatchObject({
    value: 18.5,
    numberFormat: comma,
    isValid: true,
  });
});
test("same Prompt switches kinds, constraints, and affixes without hook errors", () => {
  const error = vi.spyOn(console, "error").mockImplementation(() => {});
  render();
  render({
    metadata: {
      type: "numericResponse",
      integer: true,
      prefix: "$",
      suffix: "USD",
    },
  });
  render({ metadata: { type: "openResponse" } });
  editTextArea();
  advance();
  expect(record().value).toBe("00123");
  render();
  expect(error).not.toHaveBeenCalled();
  error.mockRestore();
});
function editTextArea() {
  const input = dom.querySelector("textarea")!;
  act(() => {
    Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype,
      "value",
    )!.set!.call(input, "00123");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
test("shared numeric config carries semantics and uses separate slot", () => {
  const notepad = vi.fn();
  render({
    shared: true,
    renderSharedNumericResponse: renderer,
    renderSharedNotepad: notepad,
    metadata: {
      type: "numericResponse",
      required: true,
      min: 0,
      max: 99,
      integer: true,
      prefix: "$",
      suffix: "USD",
    },
  });
  expect(slot).toMatchObject({
    name: "age",
    required: true,
    constraints: { required: true, min: 0, max: 99, integer: true },
    prefix: "$",
    suffix: "USD",
    numberFormat: format,
    inputmode: "numeric",
  });
  expect(
    document.getElementById(slot.ariaLabelledBy)?.querySelector("p")
      ?.textContent,
  ).toBe("How old are you?");
  expect(
    dom.querySelector('[data-testid="required-marker"]')?.textContent,
  ).toBe("Required");
  expect(notepad).not.toHaveBeenCalled();
});
test("missing numeric slot renders callout and reports a contract violation once", () => {
  const violation = vi.fn();
  const notepad = vi.fn();
  const error = vi.spyOn(console, "error").mockImplementation(() => {});
  render({
    shared: true,
    renderSharedNotepad: notepad,
    onContractViolation: violation,
  });
  render({ shared: true, onContractViolation: violation });
  expect(dom.querySelector('[role="alert"]')?.textContent).toContain(
    "This question can't be shown here",
  );
  expect(violation).toHaveBeenCalledTimes(1);
  expect(violation).toHaveBeenCalledWith(
    expect.objectContaining({ kind: "missingSharedNumericResponse" }),
  );
  expect(notepad).not.toHaveBeenCalled();
  error.mockRestore();
});
test.each(["en", "he", "override"])(
  "shared helpers use %s catalog and keep participant reveal across remotes",
  (locale) => {
    const ctx = context({
      locale: locale === "override" ? "en" : locale,
      messages: locale === "override" ? { numberFormat: comma } : undefined,
    });
    render({ shared: true, renderSharedNumericResponse: renderer }, ctx);
    const catalog = resolveCatalog(ctx.locale, ctx.messages);
    for (const inserted of ["a", " ", "+", catalog.numberFormat.grouping]) {
      expect(
        slot.filterInsertion({ entry: "35", start: 0, end: 2, inserted }),
      ).toMatchObject({
        entry: "35",
        accepted: false,
        refused: true,
        selectionStart: 0,
        selectionEnd: 2,
      });
    }
    for (const inserted of ["-", catalog.numberFormat.decimal]) {
      expect(
        slot.filterInsertion({ entry: "", start: 0, end: 0, inserted }),
      ).toMatchObject({ entry: inserted, accepted: true });
    }
    const oversized = "1".repeat(101);
    expect(
      slot.filterInsertion({
        entry: oversized,
        start: 0,
        end: 1,
        inserted: "",
      }),
    ).toMatchObject({ entry: "1".repeat(100), accepted: true });
    expect(
      slot.filterInsertion({
        entry: oversized,
        start: 0,
        end: 1,
        inserted: "2",
      }),
    ).toMatchObject({ entry: oversized, accepted: false });
    expect(slot.getFeedback(oversized, false)).toEqual({
      state: "problem",
      text: `ⓘ ${catalog.numericTooLong}`,
    });
    expect(slot.getFeedback("", true).state).toBe("neutral");
    expect(slot.getFeedback(`5${catalog.numberFormat.decimal}`, true)).toEqual({
      state: "problem",
      text: `ⓘ ${catalog.numericUnfinished}`,
    });
    expect(slot.getFeedback("-", false).state).toBe("problem");
    expect(slot.getFeedback("3", false).state).toBe("neutral");
    expect(slot.getFeedback("3", true).state).toBe("problem");
    act(() => slot.onRemoteChange("4"));
    expect(slot.getFeedback("4", true).state).toBe("problem");
    expect(slot.getFeedback("35", false).text).toBe(
      `✓ ${catalog.numericGuidance(false, "18", "99")}`,
    );
    expect(
      slot.filterInsertion({ entry: "35", start: 0, end: 2, inserted: "a" }),
    ).toMatchObject({
      entry: "35",
      accepted: false,
      selectionStart: 0,
      selectionEnd: 2,
    });
    expect(
      slot.filterInsertion({ entry: "35", start: 1, end: 1, inserted: "x" }),
    ).toMatchObject({
      entry: "35",
      accepted: false,
      selectionStart: 1,
      selectionEnd: 1,
    });
    expect(
      slot.filterInsertion({
        entry: "",
        start: 0,
        end: 0,
        inserted: `1${catalog.numberFormat.decimal}5`,
      }).entry,
    ).toBe(`1${catalog.numberFormat.decimal}5`);
    render(
      {
        shared: true,
        renderSharedNumericResponse: renderer,
        metadata: { type: "numericResponse", max: 20, integer: true },
      },
      ctx,
    );
    expect(slot.getFeedback("00025", false)).toEqual({
      state: "problem",
      text: `ⓘ ${catalog.numericMoreThan("25", "20")}`,
    });
    expect(slot.getFeedback("2", false).state).toBe("valid");
    expect(
      slot.getFeedback(`1${catalog.numberFormat.decimal}5`, false),
    ).toEqual({ state: "problem", text: `ⓘ ${catalog.numericWholeNumber}` });
  },
);
test("shared merged text commits through builder, saved format stays pinned across own edits", () => {
  render({
    shared: true,
    renderSharedNumericResponse: renderer,
    entry: "1,5",
    numberFormat: comma,
    step: "s",
    getElapsedTime: () => 9,
  });
  expect(slot.numberFormat).toEqual(comma);
  act(() => slot.onRemoteChange("19,5"));
  advance(10000);
  expect(save).not.toHaveBeenCalled();
  act(() => slot.onLocalEdit("18,5"));
  advance(1500);
  act(() => slot.onRemoteChange("25,5"));
  advance(500);
  expect(record()).toEqual(
    buildPromptRecord({
      metadata: base.metadata,
      body: base.body,
      name: "age",
      responses: [],
      shared: true,
      entry: "25,5",
      numberFormat: comma,
      step: "s",
      stageTimeElapsed: 9,
    }),
  );
  expect(save.mock.calls.at(-1)?.[2]).toBe("shared");
  expect(record().isValid).toBe(
    checkResponse(record().entry, {
      ...base.metadata,
      type: "numericResponse",
      numberFormat: comma,
    }).isValid,
  );
  act(() => slot.onLocalEdit("3-4"));
  act(() => slot.onBlur("3-4"));
  expect(record()).not.toHaveProperty("value");
});
test("shared field unmount cancels pending commits and retained callbacks", () => {
  render({ shared: true, renderSharedNumericResponse: renderer });
  const stale = slot;
  act(() => slot.onLocalEdit("25"));
  render({ name: "new", shared: true, renderSharedNumericResponse: renderer });
  act(() => {
    stale.onBlur("30");
    stale.onLocalEdit("40");
  });
  advance(10000);
  expect(save).not.toHaveBeenCalled();
});
test("Element restores raw records and real save/store/reference resolves a numeric value", async () => {
  const store = new Map<string, unknown>([
    ["prompt_age", { entry: "007", value: 7, numberFormat: format }],
  ]);
  const ctx = context({
    get: (key) => (store.has(key) ? [store.get(key)] : []),
    save: (key, value) => {
      store.set(key, value);
      save(key, value);
    },
  });
  await act(async () => {
    root.render(
      <StagebookProvider value={ctx}>
        <Element
          element={{ type: "prompt", file: "age.prompt", name: "age" }}
          onSubmit={() => {}}
        />
        <GateProbe />
      </StagebookProvider>,
    );
    await Promise.resolve();
  });
  expect(dom.querySelector("input")!.value).toBe("007");
  expect(dom.querySelector("output")?.textContent).toBe("false");
  edit("25");
  advance();
  await act(async () => {
    root.render(
      <StagebookProvider value={{ ...ctx }}>
        <Element
          element={{ type: "prompt", file: "age.prompt", name: "age" }}
          onSubmit={() => {}}
        />
        <GateProbe />
      </StagebookProvider>,
    );
    await Promise.resolve();
  });
  expect(store.get("prompt_age")).toMatchObject({
    value: 25,
    entry: "25",
    isValid: true,
  });
  expect(dom.querySelector("output")?.textContent).toBe("true");
});

function GateProbe() {
  const ctx = useStagebookContext();
  return (
    <output>
      {String(
        evaluateConditions(
          { reference: "self.prompt.age", comparator: "isAtLeast", value: 18 },
          (reference) => ctx.resolve(reference),
        ),
      )}
    </output>
  );
}
