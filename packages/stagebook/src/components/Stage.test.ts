import { describe, it, expect } from "vitest";
import { maxWidthForElement } from "./Stage.js";
import type { ElementConfig } from "./Element.js";

const el = (type: string, name?: string): ElementConfig => ({ type, name });

describe("maxWidthForElement", () => {
  it("uses the narrow lane (42rem) for prompts and other default elements", () => {
    expect(maxWidthForElement(el("prompt"))).toBe("42rem");
    expect(maxWidthForElement(el("submitButton"))).toBe("42rem");
    expect(maxWidthForElement(el("timer"))).toBe("42rem");
  });

  it("uses 56rem for mediaPlayer and timeline", () => {
    expect(maxWidthForElement(el("mediaPlayer"))).toBe("56rem");
    expect(maxWidthForElement(el("timeline"))).toBe("56rem");
  });

  it("uses 64rem for survey and qualtrics", () => {
    expect(maxWidthForElement(el("survey"))).toBe("64rem");
    expect(maxWidthForElement(el("qualtrics"))).toBe("64rem");
  });

  describe("separator (issue #301)", () => {
    it("falls back to the default width when no siblings are provided", () => {
      expect(maxWidthForElement(el("separator"))).toBe("42rem");
    });

    it("matches the default lane when all siblings are default-width", () => {
      const siblings = [el("prompt"), el("submitButton")];
      expect(maxWidthForElement(el("separator"), siblings)).toBe("42rem");
    });

    it("widens to the mediaPlayer lane when the stage has a player", () => {
      const siblings = [
        el("prompt"),
        el("mediaPlayer"),
        el("timeline"),
        el("separator"),
        el("submitButton"),
      ];
      expect(maxWidthForElement(el("separator"), siblings)).toBe("56rem");
    });

    it("widens to the survey lane when the stage has a survey or qualtrics", () => {
      expect(
        maxWidthForElement(el("separator"), [el("prompt"), el("survey")]),
      ).toBe("64rem");
      expect(
        maxWidthForElement(el("separator"), [
          el("prompt"),
          el("qualtrics"),
          el("mediaPlayer"),
        ]),
      ).toBe("64rem");
    });

    it("ignores other separators when picking the widest sibling", () => {
      const siblings = [el("separator"), el("separator")];
      expect(maxWidthForElement(el("separator"), siblings)).toBe("42rem");
    });
  });
});
