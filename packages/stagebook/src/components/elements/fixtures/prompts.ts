// Parsed prompt fixtures for testing.
// These mirror the structure returned by promptFileSchema.parse() — every
// fixture includes `sliderPoints` (empty for non-slider types) so consumers
// can spread the fixture into <Prompt {...fixture} /> without special-casing.

import type { MetadataType } from "../../../schemas/promptFile.js";

export const multipleChoiceSingle = {
  metadata: {
    name: "projects/example/multipleChoice.md",
    type: "multipleChoice",
  } as MetadataType,
  body: `# Markdown or HTML?

We need to decide whether to use Markdown or HTML for storing deliberation topics.

- **Markdown** files are a convenient way to include basic formatting.
- **HTML** documents allow for more customization.

_Which format is better for this task?_`,
  responseItems: ["Markdown", "HTML"],
  responsePoints: [],
  sliderPoints: [],
};

export const multipleChoiceMultiple = {
  metadata: {
    name: "projects/example/multipleChoiceColors.md",
    type: "multipleChoice",
    select: "multiple",
  } as MetadataType,
  body: "# Which colors indicate a strong magical field?",
  responseItems: ["Octarine", "Hooloovoo", "Ultrablack", "Ulfire", "Plaid"],
  responsePoints: [],
  sliderPoints: [],
};

export const openResponse = {
  metadata: {
    name: "projects/example/openResponse.md",
    type: "openResponse",
    rows: 3,
  } as MetadataType,
  body: `# Markdown or HTML?

_Are there any other reasons you can think of for choosing one or the other?_`,
  responseItems: ["Please enter your response here."],
  responsePoints: [],
  sliderPoints: [],
};

export const openResponseWithLimits = {
  metadata: {
    name: "projects/example/openResponseLimits.md",
    type: "openResponse",
    rows: 4,
    minLength: 50,
    maxLength: 200,
  } as MetadataType,
  body: "# Please write a response between 50 and 200 characters.",
  responseItems: ["Enter your response here."],
  responsePoints: [],
  sliderPoints: [],
};

export const noResponse = {
  metadata: {
    name: "projects/example/noResponse.md",
    type: "noResponse",
  } as MetadataType,
  body: `# Markdown or HTML?

We need to decide whether to use Markdown or HTML. _Discuss why markdown is the best._`,
  responseItems: [],
  responsePoints: [],
  sliderPoints: [],
};

export const slider = {
  metadata: {
    name: "projects/example/sliderAvocado.md",
    type: "slider",
    min: 0,
    max: 100,
    interval: 1,
  } as MetadataType,
  body: "# How warm is your love for avocados?",
  responseItems: ["Very cold", "Chilly", "Tolerable", "Warm", "Super Hot"],
  // After #243 slider points live in the body alongside their labels.
  // The fixture shape mirrors `promptFileSchema.parse()` output, so
  // points and labels arrive as parallel arrays.
  responsePoints: [0, 20, 50, 80, 100],
  sliderPoints: [0, 20, 50, 80, 100],
};

export const listSorter = {
  metadata: {
    name: "projects/example/listSorter.md",
    type: "listSorter",
  } as MetadataType,
  body: "# Please drag the following list into alphabetical order by first name",
  responseItems: [
    "Harry Potter",
    "Hermione Granger",
    "Ron Weasley",
    "Albus Dumbledore",
    "Severus Snape",
  ],
  responsePoints: [],
  sliderPoints: [],
};
