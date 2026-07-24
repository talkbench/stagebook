// @vitest-environment jsdom
import { describe, test, expect, vi, afterEach, beforeAll } from "vitest";
import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Prompt } from "./Prompt.js";
import { openResponse } from "./fixtures/prompts.js";

beforeAll(() => {
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
});

let root: Root | undefined;
let container: HTMLDivElement | undefined;

afterEach(() => {
  if (root) act(() => root!.unmount());
  root = undefined;
  container = undefined;
});

function render(node: React.ReactElement): HTMLDivElement {
  container = document.createElement("div");
  root = createRoot(container);
  act(() => root!.render(node));
  return container;
}

// The renderSharedNotepad pass-through is pinned here in jsdom rather than
// in Prompt.ct.tsx: Playwright CT proxies function props across the mount
// boundary as async message channels, so a render prop can't hand JSX back
// to the browser-side component and the slot would never render.
describe("Prompt shared mode (renderSharedNotepad slot)", () => {
  test("passes { padName, defaultText, rows } to the slot (#580)", () => {
    const renderSharedNotepad = vi.fn(() => <div data-testid="notepad-slot" />);
    const dom = render(
      <Prompt
        {...openResponse}
        name="testShared"
        shared={true}
        value=""
        save={() => {}}
        renderSharedNotepad={renderSharedNotepad}
      />,
    );

    // Last call, not first: Prompt initializes its display order via a
    // set-state-during-render pass, so an early call may precede the
    // response items being threaded through.
    expect(renderSharedNotepad).toHaveBeenLastCalledWith({
      padName: "testShared",
      defaultText: "Please enter your response here.",
      rows: 3,
    });
    expect(dom.querySelector('[data-testid="notepad-slot"]')).not.toBeNull();
    // Shared mode renders the slot INSTEAD of stagebook's own textarea.
    expect(dom.querySelector("textarea")).toBeNull();
  });

  // The docs promise defaultText is the prompt file's `> ` lines
  // newline-joined; the single-item fixture can't distinguish join("\n")
  // from responses[0], so pin the join explicitly.
  test("newline-joins multiple placeholder lines into defaultText", () => {
    const renderSharedNotepad = vi.fn(() => <div data-testid="notepad-slot" />);
    render(
      <Prompt
        {...openResponse}
        responseItems={["First line.", "Second line."]}
        name="testShared"
        shared={true}
        value=""
        save={() => {}}
        renderSharedNotepad={renderSharedNotepad}
      />,
    );

    expect(renderSharedNotepad).toHaveBeenLastCalledWith({
      padName: "testShared",
      defaultText: "First line.\nSecond line.",
      rows: 3,
    });
  });

  test("does not call the slot when shared is false", () => {
    const renderSharedNotepad = vi.fn(() => <div data-testid="notepad-slot" />);
    const dom = render(
      <Prompt
        {...openResponse}
        name="testSolo"
        value=""
        save={() => {}}
        renderSharedNotepad={renderSharedNotepad}
      />,
    );

    expect(renderSharedNotepad).not.toHaveBeenCalled();
    expect(dom.querySelector("textarea")).not.toBeNull();
  });
});
