import { describe, it, expect } from "vitest";
import { extractTimeBreakpoints } from "./timeBreakpoints.js";

describe("extractTimeBreakpoints", () => {
  it("extracts displayTime and hideTime from elements", () => {
    const elements = [
      { type: "prompt", name: "q1", file: "q1.prompt.md", displayTime: 15 },
      {
        type: "prompt",
        name: "q2",
        file: "q2.prompt.md",
        displayTime: 30,
        hideTime: 90,
      },
      { type: "submitButton", buttonText: "Next" },
    ];
    const breakpoints = extractTimeBreakpoints(elements);
    expect(breakpoints).toEqual([15, 30, 90]);
  });

  it("deduplicates and sorts", () => {
    const elements = [
      { type: "prompt", name: "q1", file: "q1.prompt.md", displayTime: 30 },
      {
        type: "prompt",
        name: "q2",
        file: "q2.prompt.md",
        displayTime: 30,
        hideTime: 10,
      },
    ];
    const breakpoints = extractTimeBreakpoints(elements);
    expect(breakpoints).toEqual([10, 30]);
  });

  it("returns empty array when no time values", () => {
    const elements = [
      { type: "prompt", name: "q1", file: "q1.prompt.md" },
      { type: "submitButton", buttonText: "Next" },
    ];
    const breakpoints = extractTimeBreakpoints(elements);
    expect(breakpoints).toEqual([]);
  });

  it("ignores zero values", () => {
    const elements = [
      {
        type: "prompt",
        name: "q1",
        file: "q1.prompt.md",
        displayTime: 0,
        hideTime: 60,
      },
    ];
    const breakpoints = extractTimeBreakpoints(elements);
    expect(breakpoints).toEqual([60]);
  });
});
