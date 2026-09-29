import { test, expect } from "@playwright/experimental-ct-react";
import React from "react";
import { SkeletonPlaceholder } from "./SkeletonPlaceholder.js";
import { NumericSkeletonFixture } from "./SkeletonPlaceholder.numeric.fixture.js";

// Browser-level counterpart to the jsdom tests: those assert the declaration
// is present, this proves the var() actually resolves end-to-end. Mirrors
// TextArea.ct.tsx's "font respects --stagebook-font override".
test("stand-in resolves a host's scoped --stagebook-font override", async ({
  mount,
}) => {
  // Scoped to a container, not :root — the case in the Codex review on #592,
  // where an embedding host themes only its viewer pane.
  const component = await mount(
    <div style={{ ["--stagebook-font" as never]: "Helvetica, sans-serif" }}>
      <SkeletonPlaceholder
        type="sharedNotepad"
        config={{ padName: "n", rows: 2, defaultText: "hint" }}
      />
    </div>,
  );
  const box = component.locator("[data-testid='notepad-box']");
  const fontFamily = await box.evaluate(
    (el) => window.getComputedStyle(el).fontFamily,
  );
  expect(fontFamily).toMatch(/Helvetica/);
});

test("stand-in falls back to the Inter stack with no override", async ({
  mount,
}) => {
  const component = await mount(
    <SkeletonPlaceholder
      type="sharedNotepad"
      config={{ padName: "n", rows: 2, defaultText: "hint" }}
    />,
  );
  const box = component.locator("[data-testid='notepad-box']");
  const fontFamily = await box.evaluate(
    (el) => window.getComputedStyle(el).fontFamily,
  );
  expect(fontFamily.toLowerCase()).not.toMatch(/mono|courier/);
  expect(fontFamily).toMatch(/Inter|sans-serif/);
});

for (const locale of ["en", "he"]) {
  test(`numeric stand-in wraps 32-character affixes at 320px (${locale})`, async ({
    mount,
    page,
  }) => {
    await page.setViewportSize({ width: 320, height: 500 });
    const component = await mount(
      <NumericSkeletonFixture
        locale={locale}
        prefix={"P".repeat(32)}
        suffix={"S".repeat(32)}
      />,
    );
    const input = component.locator("input");
    await expect(input).toHaveAccessibleName("Temperature");
    await expect(input).toHaveAttribute("dir", "ltr");
    const geometry = await component.evaluate((element) => {
      const input = element.querySelector("input")!;
      const affixes = [...element.querySelectorAll("bdi")];
      const feedback = element.querySelector<HTMLElement>(
        '[data-testid="numeric-placeholder-feedback"]',
      )!;
      const chip = element.querySelector<HTMLElement>(
        '[data-testid="notepad-shared-chip"]',
      )!;
      return {
        inputWidth: input.getBoundingClientRect().width,
        rootRem: parseFloat(
          getComputedStyle(document.documentElement).fontSize,
        ),
        overflow: document.documentElement.scrollWidth > window.innerWidth,
        clippedAffixes: affixes.some(
          (affix) =>
            affix.scrollWidth > affix.clientWidth ||
            affix.scrollHeight > affix.clientHeight,
        ),
        feedback: feedback.getBoundingClientRect().toJSON(),
        chip: chip.getBoundingClientRect().toJSON(),
        background: getComputedStyle(feedback).backgroundColor,
        textAlign: getComputedStyle(input).textAlign,
      };
    });
    expect(geometry.inputWidth).toBeGreaterThanOrEqual(6 * geometry.rootRem);
    expect(geometry.overflow).toBe(false);
    expect(geometry.clippedAffixes).toBe(false);
    expect(geometry.background).not.toBe("rgba(0, 0, 0, 0)");
    if (locale === "he") {
      expect(geometry.chip.right).toBeLessThanOrEqual(geometry.feedback.left);
      expect(geometry.textAlign).toBe("right");
    } else {
      expect(geometry.feedback.right).toBeLessThanOrEqual(geometry.chip.left);
      expect(geometry.textAlign).toBe("left");
    }
  });
}
