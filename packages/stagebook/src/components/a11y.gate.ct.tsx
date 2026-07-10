// Accessibility regression gate (issue #20).
//
// Mounts each participant-facing component in its correctly-used form and
// asserts zero axe-core violations at the WCAG 2.2 AA ruleset the project
// committed to (docs/decisions/2026-07-accessibility.md).
//
// This is the permanent successor to the one-off audit harness: it stays
// GREEN, so a future regression — a contrast-token drift, a dropped
// `aria-labelledby`, an unnamed control — turns it red. Co-locating a
// per-component assertion inside each `*.ct.tsx` is a possible future
// refinement; a single gate is the low-friction starting form.
import { test, expect } from "@playwright/experimental-ct-react";
import AxeBuilder from "@axe-core/playwright";
import type { ReactNode } from "react";
import type { MetadataType } from "../schemas/promptFile";

import { RadioGroup } from "./form/RadioGroup";
import { CheckboxGroup } from "./form/CheckboxGroup";
import { Select } from "./form/Select";
import { TextArea } from "./form/TextArea";
import { Slider } from "./form/Slider";
import { Button } from "./form/Button";
import { Markdown } from "./form/Markdown";
import { Separator } from "./form/Separator";
import { MockListSorter } from "./testing/MockListSorter";
import { MockKitchenTimer } from "./testing/MockKitchenTimer";
import { Prompt } from "./elements/Prompt";
import { Display } from "./elements/Display";
import { SubmitButton } from "./elements/SubmitButton";
import { ImageElement } from "./elements/ImageElement";
import { TrackedLink } from "./elements/TrackedLink";
import {
  multipleChoiceSingle,
  multipleChoiceMultiple,
  openResponse,
  slider as sliderPrompt,
  listSorter as listSorterPrompt,
} from "./elements/fixtures/prompts";

// WCAG 2.2 AA = 2.0/2.1/2.2 at levels A and AA.
const WCAG_22_AA = [
  "wcag2a",
  "wcag2aa",
  "wcag21a",
  "wcag21aa",
  "wcag22a",
  "wcag22aa",
];

const options = [
  { key: "a", value: "Option A" },
  { key: "b", value: "Option B" },
  { key: "c", value: "Option C" },
];

// 1×1 transparent PNG.
const testImage =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==";

const promptProps = {
  progressLabel: "game_0_gate",
  save: () => {},
  getElapsedTime: () => 0,
};

const dropdownPrompt = {
  metadata: {
    name: "projects/example/dropdown.md",
    type: "dropdown",
  } as MetadataType,
  body: "# Choose your favorite\n\nPick one from the list.",
  responseItems: ["Alpha", "Bravo", "Charlie"],
  responsePoints: [],
  sliderPoints: [],
};

// Each case is a participant-facing component in its correctly-used (named,
// themed) form. The gate asserts none of them produce WCAG 2.2 AA violations.
const cases: { name: string; node: ReactNode }[] = [
  {
    name: "RadioGroup",
    node: <RadioGroup options={options} onChange={() => {}} label="Pick one" />,
  },
  {
    name: "CheckboxGroup",
    node: (
      <CheckboxGroup
        options={options}
        value={["a"]}
        onChange={() => {}}
        label="Select all"
      />
    ),
  },
  {
    name: "Select",
    node: (
      <Select options={options} onChange={() => {}} label="Choose an option" />
    ),
  },
  {
    name: "TextArea",
    node: <TextArea value="Some typed response" ariaLabel="Your answer" />,
  },
  {
    name: "Slider (anchored)",
    node: <Slider min={0} max={100} interval={1} value={50} />,
  },
  {
    name: "Slider (unanchored)",
    node: <Slider min={0} max={100} interval={1} />,
  },
  { name: "Button", node: <Button>Continue</Button> },
  {
    name: "SubmitButton",
    node: (
      <SubmitButton
        onSubmit={() => {}}
        name="submit"
        save={() => {}}
        getElapsedTime={() => 0}
      />
    ),
  },
  {
    name: "ImageElement",
    node: <ImageElement src={testImage} alt="A small test image" />,
  },
  {
    name: "TrackedLink",
    node: (
      <TrackedLink
        name="link"
        url="https://example.org/form"
        displayText="Open the linked form"
        save={() => {}}
        getElapsedTime={() => 0}
        progressLabel="game_0_gate"
      />
    ),
  },
  {
    name: "KitchenTimer",
    node: <MockKitchenTimer startTime={0} endTime={60} elapsedTime={0} />,
  },
  {
    name: "ListSorter",
    node: <MockListSorter items={["Alpha", "Bravo", "Charlie", "Delta"]} />,
  },
  {
    name: "Markdown",
    node: (
      <Markdown
        text={"Some **bold** text and a [link](https://example.org)."}
      />
    ),
  },
  { name: "Separator", node: <Separator /> },
  {
    name: "Display",
    node: <Display reference="prompt.q1" values={["A displayed answer"]} />,
  },
  {
    name: "Prompt: multiple choice (single)",
    node: (
      <Prompt
        {...multipleChoiceSingle}
        {...promptProps}
        name="mcSingle"
        value={undefined}
      />
    ),
  },
  {
    name: "Prompt: multiple choice (multiple)",
    node: (
      <Prompt
        {...multipleChoiceMultiple}
        {...promptProps}
        name="mcMulti"
        value={[]}
      />
    ),
  },
  {
    name: "Prompt: open response",
    node: <Prompt {...openResponse} {...promptProps} name="open" value="" />,
  },
  {
    name: "Prompt: slider",
    node: (
      <Prompt {...sliderPrompt} {...promptProps} name="slider" value={50} />
    ),
  },
  {
    name: "Prompt: list sorter",
    node: (
      <Prompt
        {...listSorterPrompt}
        {...promptProps}
        name="sorter"
        value={undefined}
      />
    ),
  },
  {
    name: "Prompt: dropdown",
    node: (
      <Prompt
        {...dropdownPrompt}
        {...promptProps}
        name="dropdown"
        value={undefined}
      />
    ),
  },
];

for (const c of cases) {
  test(`a11y: ${c.name}`, async ({ mount, page }) => {
    await mount(c.node);
    const results = await new AxeBuilder({ page })
      .include("#root")
      .withTags(WCAG_22_AA)
      .analyze();

    expect(
      results.violations.map(
        (v) =>
          `${v.id}(${v.impact}) @ ${v.nodes
            .map((n) => n.target.join(" "))
            .join(", ")}`,
      ),
      `${c.name} WCAG 2.2 AA violations`,
    ).toEqual([]);
  });
}
