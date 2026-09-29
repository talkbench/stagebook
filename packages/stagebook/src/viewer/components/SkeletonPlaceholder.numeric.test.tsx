// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { SharedNumericResponseConfig } from "../../components/StagebookProvider.js";
import { createSkeletonRenderers } from "./SkeletonPlaceholder.js";
import { createViewerContext } from "../lib/context.js";
import { ViewerStateStore } from "../lib/store.js";

beforeAll(() => {
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
});
const roots: Root[] = [];
afterEach(() => {
  act(() => roots.splice(0).forEach((root) => root.unmount()));
  document.body.replaceChildren();
});

function renderNumeric(overrides: Partial<SharedNumericResponseConfig> = {}) {
  const config: SharedNumericResponseConfig = {
    name: "estimate",
    constraints: { min: 18, max: 99, integer: true },
    required: true,
    numberFormat: { decimal: ".", grouping: "," },
    inputmode: "numeric",
    ariaLabelledBy: "numeric-question",
    prefix: "$",
    suffix: "per person",
    filterInsertion: vi.fn(),
    getFeedback: vi.fn(() => ({
      state: "neutral",
      text: "Whole number from 18 to 99",
    })),
    onLocalEdit: vi.fn(),
    onRemoteChange: vi.fn(),
    onBlur: vi.fn(),
    ...overrides,
  };
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  const renderers = createSkeletonRenderers();
  const context = createViewerContext({
    store: new ViewerStateStore(),
    position: 0,
    stageIndex: 0,
    playerCount: 2,
    onSubmit: vi.fn(),
    getTextContent: () => Promise.resolve(""),
    getAssetURL: (path) => path,
    renderers: {
      renderSharedNumericResponse: renderers.renderSharedNumericResponse,
    },
  });
  act(() =>
    root.render(
      <>
        <p id="numeric-question">Estimate a number</p>
        {context.renderSharedNumericResponse!(config)}
      </>,
    ),
  );
  return { container, config };
}

describe("shared numeric viewer stand-in", () => {
  it("exposes the real mock slot as a blank single-line field with the host contract attributes", () => {
    const { container, config } = renderNumeric();
    const input = container.querySelector("input")!;
    expect(input.type).toBe("text");
    expect(input.value).toBe("");
    expect(input.readOnly).toBe(true);
    expect(input.dir).toBe("ltr");
    expect(input.inputMode).toBe("numeric");
    expect(input.getAttribute("aria-labelledby")).toBe("numeric-question");
    expect(input.getAttribute("aria-required")).toBe("true");
    expect(input.hasAttribute("placeholder")).toBe(false);
    expect(container.querySelector("textarea")).toBeNull();
    expect(config.getFeedback).toHaveBeenCalledWith("", false);
    expect(config.onLocalEdit).not.toHaveBeenCalled();
    expect(config.onRemoteChange).not.toHaveBeenCalled();
    expect(config.onBlur).not.toHaveBeenCalled();
  });

  it("renders plain isolated affixes and associates them and feedback with the field", () => {
    const { container } = renderNumeric({
      prefix: "<strong>$</strong>",
      suffix: "°C",
    });
    const affixes = [...container.querySelectorAll("bdi")];
    expect(affixes.map((node) => node.textContent)).toEqual([
      "<strong>$</strong>",
      "°C",
    ]);
    expect(container.querySelector("strong")).toBeNull();
    const input = container.querySelector("input")!;
    const described = input
      .getAttribute("aria-describedby")!
      .split(" ")
      .map((id) => document.getElementById(id)?.textContent);
    expect(described).toEqual([
      "<strong>$</strong>",
      "°C",
      "Whole number from 18 to 99",
    ]);
  });

  it("keeps input width while affixes can wrap, and puts opaque feedback before the existing Shared chip", () => {
    const { container } = renderNumeric({
      prefix: "p".repeat(32),
      suffix: "s".repeat(32),
    });
    const field = container.querySelector<HTMLElement>(
      '[data-testid="numeric-placeholder-box"]',
    )!;
    const input = container.querySelector("input")!;
    expect(field.style.flexWrap).toBe("wrap");
    expect(input.style.minWidth).toBe("6rem");
    for (const affix of container.querySelectorAll("bdi")) {
      expect(affix.style.overflowWrap).toBe("anywhere");
      expect(affix.style.whiteSpace).toBe("normal");
    }
    const feedback = container.querySelector<HTMLElement>(
      '[data-testid="numeric-placeholder-feedback"]',
    )!;
    const chip = container.querySelector(
      '[data-testid="notepad-shared-chip"]',
    )!;
    expect(feedback.textContent).toBe("Whole number from 18 to 99");
    expect(feedback.style.backgroundColor).not.toBe("");
    expect(feedback.parentElement).toBe(chip.parentElement);
    expect(feedback.parentElement!.lastElementChild).toBe(chip);
    expect(chip.textContent).toContain("Shared");
  });

  it("omits optional affixes and default keyboard without inventing a hint", () => {
    const { container } = renderNumeric({
      prefix: undefined,
      suffix: undefined,
      inputmode: undefined,
      required: false,
    });
    expect(container.querySelectorAll("bdi")).toHaveLength(0);
    const input = container.querySelector("input")!;
    expect(input.hasAttribute("inputmode")).toBe(false);
    expect(input.getAttribute("aria-required")).toBe("false");
    expect(container.textContent).not.toContain("Start typing");
    expect(input.getAttribute("aria-describedby")!.split(" ")).toHaveLength(1);
  });
});
