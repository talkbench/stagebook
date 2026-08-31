import { test, expect } from "@playwright/experimental-ct-react";
import React from "react";
import { SkeletonPlaceholder } from "./SkeletonPlaceholder.js";

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
