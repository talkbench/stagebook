// @vitest-environment jsdom
import { describe, test, expect, vi, afterEach, beforeAll } from "vitest";
import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Prompt } from "./Prompt.js";
import type { StagebookContext } from "../StagebookProvider.js";
import type { MetadataType } from "../../schemas/promptFile.js";
import {
  bodylessCheckboxes,
  bodylessDropdown,
  bodylessNumeric,
  bodylessOpenResponse,
  bodylessRadios,
  multipleChoiceMultiple,
  multipleChoiceSingle,
  openResponse,
} from "./fixtures/prompts.js";

// `body: none` (#718). Accessible names and geometry are checked in a real
// browser in Prompt.ct.tsx; this pins the DOM wiring and the slot contract,
// which Playwright CT can't reach (render props don't cross its boundary).

beforeAll(() => {
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
});

let root: Root | undefined;

afterEach(() => {
  if (root) act(() => root!.unmount());
  root = undefined;
  document.body.innerHTML = "";
});

function render(node: React.ReactElement): HTMLDivElement {
  const container = document.createElement("div");
  // Attached, so getElementById resolves the aria-labelledby targets.
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root!.render(node));
  return container;
}

const common = { name: "q", save: () => {}, value: undefined };

/** The element an aria-labelledby attribute points at. */
function labelOf(element: Element | null) {
  const id = element?.getAttribute("aria-labelledby");
  return id ? document.getElementById(id) : null;
}

describe("body: none", () => {
  test("checkboxes render without a body or a group name", () => {
    const dom = render(<Prompt {...bodylessCheckboxes} {...common} />);
    const group = dom.querySelector('[role="group"]');
    expect(group).not.toBeNull();
    expect(group!.hasAttribute("aria-labelledby")).toBe(false);
    // Nothing above the options: the group's wrapper is the first element.
    expect(dom.firstElementChild).toBe(
      dom.querySelector('[data-testid="checkboxGroup"]'),
    );
    expect(dom.querySelectorAll('input[type="checkbox"]')).toHaveLength(2);
  });

  test("checkboxes drop the spacing that set them under a question", () => {
    const dom = render(<Prompt {...bodylessCheckboxes} {...common} />);
    const wrapper = dom.querySelector<HTMLElement>(
      '[data-testid="checkboxGroup"]',
    )!;
    const group = dom.querySelector<HTMLElement>('[role="group"]')!;
    expect(wrapper.style.marginTop).toBe("");
    expect(group.style.marginInlineStart).toBe("");
  });

  test("an ariaLabel names the radio group from a hidden element", () => {
    const dom = render(<Prompt {...bodylessRadios} {...common} />);
    const label = labelOf(dom.querySelector('[role="radiogroup"]'));
    expect(label?.textContent).toBe("Briefing materials");
    expect(label?.hidden).toBe(true);
    // Inline, so a host stylesheet that sets `display` on spans can't
    // reveal it (#213).
    expect(label?.style.display).toBe("none");
    const wrapper = dom.querySelector<HTMLElement>(
      '[data-testid="radioGroup"]',
    )!;
    expect(wrapper.style.marginTop).toBe("");
  });

  test("numeric-mode radios are named and flush too", () => {
    const dom = render(
      <Prompt
        {...bodylessRadios}
        responseItems={["Disagree", "Agree"]}
        responsePoints={[1, 2]}
        {...common}
      />,
    );
    const group = dom.querySelector<HTMLElement>('[role="radiogroup"]')!;
    expect(
      dom.querySelector('input[type="radio"]')?.getAttribute("value"),
    ).toBe("1");
    expect(labelOf(group)?.textContent).toBe("Briefing materials");
    expect(group.style.marginInlineStart).toBe("");
    expect(
      dom.querySelector<HTMLElement>('[data-testid="radioGroup"]')!.style
        .marginTop,
    ).toBe("");
  });

  test("an ariaLabel names a checkbox group when given", () => {
    const dom = render(
      <Prompt
        {...bodylessCheckboxes}
        metadata={
          {
            ...bodylessCheckboxes.metadata,
            ariaLabel: "Materials",
          } as MetadataType
        }
        {...common}
      />,
    );
    const label = labelOf(dom.querySelector('[role="group"]'));
    expect(label?.textContent).toBe("Materials");
    expect(label?.hidden).toBe(true);
  });

  test("an ariaLabel names the textarea", () => {
    const dom = render(<Prompt {...bodylessOpenResponse} {...common} />);
    const label = labelOf(dom.querySelector("textarea"));
    expect(label?.textContent).toBe("Notes on this recording");
    expect(label?.hidden).toBe(true);
  });

  test("an ariaLabel names the dropdown, with no gap above it", () => {
    const dom = render(<Prompt {...bodylessDropdown} {...common} />);
    const select = dom.querySelector("select");
    expect(labelOf(select)?.textContent).toBe("Hogwarts house");
    // The dropdown's study-prompt gap (#605) separates it from a body.
    for (const element of dom.querySelectorAll<HTMLElement>("div")) {
      expect(element.style.marginTop).not.toBe("1rem");
    }
  });

  test("an ariaLabel names the numeric field", () => {
    const dom = render(<Prompt {...bodylessNumeric} {...common} />);
    const label = labelOf(dom.querySelector("input"));
    expect(label?.textContent).toBe("Age in years");
    expect(label?.hidden).toBe(true);
  });

  test("the record has empty prompt text and echoes the flag", () => {
    // Records spread the frontmatter, so exports show the omission was
    // deliberate; the body text itself is the record's `prompt`.
    const save = vi.fn();
    const dom = render(
      <Prompt {...bodylessCheckboxes} {...common} save={save} />,
    );
    act(() => dom.querySelector<HTMLInputElement>("input")!.click());
    expect(save).toHaveBeenLastCalledWith(
      "prompt_q",
      expect.objectContaining({
        body: "none",
        prompt: "",
        value: ["Show briefing materials"],
      }),
      "player",
    );
  });
});

describe("prompts with a body are unchanged", () => {
  test("checkboxes keep their body name and spacing", () => {
    const dom = render(<Prompt {...multipleChoiceMultiple} {...common} />);
    const group = dom.querySelector<HTMLElement>('[role="group"]')!;
    const label = labelOf(group);
    expect(label?.hidden).toBe(false);
    expect(label?.textContent).toContain("Which colors");
    expect(
      dom.querySelector<HTMLElement>('[data-testid="checkboxGroup"]')!.style
        .marginTop,
    ).toBe("1rem");
    expect(group.style.marginInlineStart).toBe("1.25rem");
  });

  test("radios keep their body name and spacing", () => {
    const dom = render(<Prompt {...multipleChoiceSingle} {...common} />);
    const group = dom.querySelector<HTMLElement>('[role="radiogroup"]')!;
    expect(labelOf(group)?.textContent).toContain("Markdown or HTML?");
    expect(
      dom.querySelector<HTMLElement>('[data-testid="radioGroup"]')!.style
        .marginTop,
    ).toBe("1rem");
    expect(group.style.marginInlineStart).toBe("1.25rem");
  });
});

describe("shared slots carry the name (#718)", () => {
  type NotepadConfig = Parameters<
    NonNullable<StagebookContext["renderSharedNotepad"]>
  >[0];
  type NumericConfig = Parameters<
    NonNullable<StagebookContext["renderSharedNumericResponse"]>
  >[0];

  test("the notepad slot is named by the prompt body", () => {
    let config: NotepadConfig | undefined;
    render(
      <Prompt
        {...openResponse}
        {...common}
        shared
        renderSharedNotepad={(c) => {
          config = c;
          return null;
        }}
      />,
    );
    const label = document.getElementById(config!.ariaLabelledBy);
    expect(label?.textContent).toContain("Markdown or HTML?");
  });

  test("a bodyless notepad slot is named by its ariaLabel", () => {
    let config: NotepadConfig | undefined;
    render(
      <Prompt
        {...bodylessOpenResponse}
        {...common}
        shared
        renderSharedNotepad={(c) => {
          config = c;
          return null;
        }}
      />,
    );
    const label = document.getElementById(config!.ariaLabelledBy);
    expect(label?.textContent).toBe("Notes on this recording");
    expect(label?.hidden).toBe(true);
  });

  test("a bodyless numeric slot is named by its ariaLabel", () => {
    let config: NumericConfig | undefined;
    render(
      <Prompt
        {...bodylessNumeric}
        {...common}
        shared
        renderSharedNumericResponse={(c) => {
          config = c;
          return null;
        }}
      />,
    );
    const label = document.getElementById(config!.ariaLabelledBy);
    expect(label?.textContent).toBe("Age in years");
    expect(label?.hidden).toBe(true);
  });
});
