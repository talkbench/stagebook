// @vitest-environment jsdom
//
// The shared-notepad stand-in reproduces the HOST editor's geometry from the
// `rows` + placeholder the treatment already supplies (#591), so a researcher
// previewing a study sees a box the right size with their own placeholder in
// it. These tests pin what makes it a faithful stand-in rather than a
// decorative box: the height follows the runner's CoeditField (not stagebook's
// solo textarea, which is ~22-31px shorter), the placeholder clips rather than
// growing the box, the chip/sentence match the runner verbatim, and the "not
// the final rendering" signalling survives even at rows: 1.
import { describe, it, expect, beforeAll } from "vitest";
import React, { type ReactNode } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import {
  createSkeletonRenderers,
  sharedNotepadBoxHeight,
} from "./SkeletonPlaceholder.js";
import {
  TEXTAREA_METRICS,
  TEXTAREA_FONT_FAMILY,
} from "../../components/form/TextArea.js";

beforeAll(() => {
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
});

function render(node: ReactNode): HTMLElement {
  const container = document.createElement("div");
  document.body.appendChild(container);
  act(() => {
    createRoot(container).render(node);
  });
  return container;
}

// jsdom's CSSOM re-serializes `calc()` (reordering operands), so comparing
// raw strings against sharedNotepadBoxHeight() is brittle. Round-trip the
// expected value through the same CSSOM so both sides normalize identically
// — the assertion is "same declaration", not "same source string".
function asCssHeight(value: string): string {
  const probe = document.createElement("div");
  probe.style.height = value;
  return probe.style.height;
}

// Transcribed verbatim from the runner, client/src/components/coedit/
// CoeditField.jsx — deliberately NOT derived from REFERENCE_HOST_GEOMETRY, so
// an arithmetic slip in one copy fails to match the other:
//
//   const FIELD_PAD_Y = "0.5rem";
//   const fieldMinHeight = `calc(${rows ? `${(rows + 1) * 1.5}em` : "8em"} + ${FIELD_PAD_Y} * 2)`;
//
// Stagebook adds the 1px border the runner puts on the wrapping box.
function runnerHeight(rows: number): string {
  return `calc(${rows ? (rows + 1) * 1.5 : 8}em + 1rem + 2px)`;
}

function renderNotepad(config: {
  padName: string;
  defaultText?: string;
  rows?: number;
}): HTMLElement {
  return render(<>{createSkeletonRenderers().renderSharedNotepad(config)}</>);
}

describe("shared-notepad skeleton (#591)", () => {
  it("shows the author's placeholder text", () => {
    const el = renderNotepad({
      padName: "group_notes",
      defaultText: "Start typing your group's notes here",
      rows: 5,
    });
    expect(el.textContent).toContain("Start typing your group's notes here");
  });

  it("sizes the box from `rows` using the host editor's geometry", () => {
    const el = renderNotepad({ padName: "n", defaultText: "x", rows: 5 });
    const box = el.querySelector<HTMLElement>("[data-testid='notepad-box']");
    expect(box).not.toBeNull();
    expect(box!.style.height).toBe(asCssHeight(runnerHeight(5)));
  });

  it("reproduces the runner's height at every rows value", () => {
    // The whole point of the guard: compare against `runnerHeight`, which is
    // transcribed from the runner independently of REFERENCE_HOST_GEOMETRY.
    // Asserting against sharedNotepadBoxHeight() on both sides would only
    // prove the box calls it, never that it computes the right number.
    for (const rows of [1, 2, 3, 5, 8, 20]) {
      expect(asCssHeight(sharedNotepadBoxHeight(rows))).toBe(
        asCssHeight(runnerHeight(rows)),
      );
    }
    // Literal spot checks, so a drift failure names the actual value.
    expect(sharedNotepadBoxHeight(1)).toBe("calc(3em + 1rem + 2px)");
    expect(sharedNotepadBoxHeight(5)).toBe("calc(9em + 1rem + 2px)");
  });

  it("falls back to the runner's 8em branch when `rows` is unusable", () => {
    // The runner's own `rows ? ... : "8em"`. `rows` reaches this component
    // through a Record<string, unknown> cast, so a non-number must not
    // string-concatenate into a ~1070px box.
    expect(asCssHeight(sharedNotepadBoxHeight(undefined))).toBe(
      asCssHeight(runnerHeight(0)),
    );
    for (const bad of ["5", 0, -1, NaN, Infinity, null, {}]) {
      expect(sharedNotepadBoxHeight(bad as unknown as number)).toBe(
        "calc(8em + 1rem + 2px)",
      );
    }
    const el = renderNotepad({ padName: "n" });
    const box = el.querySelector<HTMLElement>("[data-testid='notepad-box']");
    expect(box!.style.height).toBe(asCssHeight(runnerHeight(0)));
  });

  it("clips an overflowing placeholder rather than growing the box", () => {
    const el = renderNotepad({
      padName: "n",
      defaultText: "a very long placeholder ".repeat(20),
      rows: 1,
    });
    const box = el.querySelector<HTMLElement>("[data-testid='notepad-box']");
    // Fixed height + hidden overflow: the preview must show the same
    // mid-glyph truncation a participant on Firefox sees (#590), never a
    // taller box that hides the authoring problem.
    expect(box!.style.height).toBe(asCssHeight(runnerHeight(1)));
    expect(box!.style.overflow).toBe("hidden");
  });

  it("signals that the host owns the real rendering, even at rows: 1", () => {
    const el = renderNotepad({ padName: "n", defaultText: "x", rows: 1 });
    // The signalling lives in the chrome *around* the box, so a 1-row
    // notepad has the same disclosure as a 20-row one.
    expect(el.textContent).toContain("host renders the live editor");
  });

  it("captions the field with the runner's 'Shared' chip and sentence", () => {
    // Copied from the runner so the preview and the live study agree. The
    // sentence is the chip's tooltip, not a visible caption — runner#421
    // removed the visible one because it repeated per field.
    const el = renderNotepad({ padName: "n", defaultText: "x", rows: 2 });
    const chip = el.querySelector<HTMLElement>(
      "[data-testid='notepad-shared-chip']",
    );
    expect(chip).not.toBeNull();
    expect(chip!.textContent).toContain("Shared");
    expect(chip!.title).toBe(
      "This notepad is shared between you and the other members of your group.",
    );
    // The long sentence must not also be visible body text.
    expect(el.textContent).not.toContain("shared between you and the other");
  });

  it("falls back to the runner's hint when no placeholder was authored", () => {
    // CoeditField renders `placeholder(defaultText || "Start typing…")`, so an
    // empty preview box would misreport what the participant actually sees.
    const el = renderNotepad({ padName: "n", rows: 3 });
    const box = el.querySelector<HTMLElement>("[data-testid='notepad-box']");
    expect(box!.style.height).toBe(asCssHeight(runnerHeight(3)));
    expect(el.textContent).toContain("Start typing");
  });

  it("does not render the placeholder as if it were saved content", () => {
    // #581: `defaultText` is placeholder-only — it is never seeded into the
    // shared document. The preview must not imply otherwise, so assert the
    // hint STYLING, not merely that the text appears: rendering it in the
    // body-text color is precisely the failure this test is named for.
    const el = renderNotepad({ padName: "n", defaultText: "hint", rows: 2 });
    const ph = el.querySelector<HTMLElement>(
      "[data-testid='notepad-placeholder']",
    );
    expect(ph).not.toBeNull();
    expect(ph!.textContent).toBe("hint");
    expect(ph!.style.color).not.toBe("");
    // Muted, and distinctly not --stagebook-text (#1f2937).
    expect(ph!.style.color).toBe("rgb(75, 85, 99)");
  });

  it("preserves newlines in a multi-line placeholder", () => {
    // Prompt joins several `> ` lines with "\n". The solo <textarea> renders
    // those as real breaks and the runner restores them with
    // `.cm-placeholder { white-space: pre-wrap }`; without the same here the
    // preview collapses them and under-reports the lines used.
    const el = renderNotepad({
      padName: "n",
      defaultText: "line one\nline two\nline three",
      rows: 3,
    });
    const ph = el.querySelector<HTMLElement>(
      "[data-testid='notepad-placeholder']",
    );
    expect(ph!.textContent).toBe("line one\nline two\nline three");
    expect(ph!.style.whiteSpace).toBe("pre-wrap");
  });

  it("uses the runner's hint for an EMPTY-STRING defaultText", () => {
    // The shape production actually emits: Prompt passes
    // `responses.join("\n")`, which is "" (never undefined) when a prompt
    // file authors no `> ` line. A `??` here instead of `||` would blank every
    // un-authored shared notepad in every preview.
    const el = renderNotepad({ padName: "n", defaultText: "", rows: 2 });
    expect(el.textContent).toContain("Start typing");
  });

  it("keeps the chip row below the box, not above it", () => {
    // Position is load-bearing: runner#421 shipped the chip inside the box's
    // top-right corner, where it cost the field its first line, and runner#572
    // moved it below. Previewing the abandoned position would misreport the
    // layout.
    const el = renderNotepad({ padName: "n", defaultText: "x", rows: 2 });
    const root = el.querySelector<HTMLElement>(
      "[data-testid='notepad-placeholder-root']",
    );
    const order = Array.from(root!.children).map((c) =>
      c.getAttribute("data-testid"),
    );
    expect(order[0]).toBe("notepad-box");
    expect(
      root!.children[1].contains(
        el.querySelector("[data-testid='notepad-shared-chip']"),
      ),
    ).toBe(true);
  });

  it("resolves the --stagebook-font token instead of inheriting", () => {
    // Codex review on #592. Both things this box stands in for pin the font
    // explicitly (TextArea #399, and the runner's CodeMirror theme). Without
    // the declaration the preview inherits the ambient font, so a host that
    // scopes --stagebook-font to its container wraps the placeholder
    // differently here than in the live editor — and the wrapping is what the
    // height preview rests on.
    const el = renderNotepad({ padName: "n", defaultText: "x", rows: 2 });
    const box = el.querySelector<HTMLElement>("[data-testid='notepad-box']");
    expect(box!.style.fontFamily).toBe(TEXTAREA_FONT_FAMILY);
    expect(box!.style.fontFamily).toContain("--stagebook-font");
  });

  it("takes its typography from TEXTAREA_METRICS, not a second copy", () => {
    // The reason TEXTAREA_METRICS is exported at all. Without this, the box
    // could drift to its own font-size/padding and nothing would notice.
    const el = renderNotepad({ padName: "n", defaultText: "x", rows: 2 });
    const box = el.querySelector<HTMLElement>("[data-testid='notepad-box']");
    expect(box!.style.fontSize).toBe(`${TEXTAREA_METRICS.fontSizeRem}rem`);
    expect(box!.style.lineHeight).toBe(`${TEXTAREA_METRICS.lineHeightRem}rem`);
    expect(box!.style.padding).toBe(
      `${TEXTAREA_METRICS.paddingBlockRem}rem ${TEXTAREA_METRICS.paddingInlineRem}rem`,
    );
  });

  it("exposes the shared chip to assistive tech", () => {
    // The runner may set aria-hidden on its chip because it re-exposes the
    // sentence via the editor's aria-describedby. This stand-in has no editor,
    // so hiding the chip would drop "shared" from the a11y tree entirely.
    const el = renderNotepad({ padName: "n", defaultText: "x", rows: 2 });
    const chip = el.querySelector<HTMLElement>(
      "[data-testid='notepad-shared-chip']",
    );
    expect(chip!.getAttribute("aria-hidden")).toBeNull();
    expect(chip!.querySelector("svg")!.getAttribute("aria-hidden")).toBe(
      "true",
    );
  });

  it("names the pad so multi-notepad stages stay distinguishable", () => {
    const el = renderNotepad({
      padName: "group_notes",
      defaultText: "x",
      rows: 2,
    });
    expect(el.textContent).toContain("group_notes");
  });
});
