import { test, expect } from "@playwright/experimental-ct-react";
import { MockViewer } from "./testing/MockViewer.js";

// End-to-end coverage for the researcher hotkeys (issue #534) in a real
// browser: unit tests in ../lib/hotkeys.test.tsx cover the pure dispatcher with
// synthetic events; here we drive REAL key presses through the mounted Viewer
// and assert the chrome actually navigates. Key chords are code-form
// ("Alt+ArrowLeft", "Alt+Digit1", "Alt+KeyK", "Alt+Slash") because the
// dispatcher matches event.code — Playwright synthesizes the physical key, so
// this holds across chromium/webkit/firefox even though macOS Option would
// otherwise compose a character.
//
// The listener is scoped to the Viewer's root node (not window), so every
// press must land with focus inside it — locator.press() focuses first.

test("⌥→ / ⌥← advance and rewind the step", async ({ mount }) => {
  const component = await mount(<MockViewer />);
  const counter = component.getByText(/^\d+ \/ 3$/);
  await expect(counter).toHaveText("1 / 3");

  await component.press("Alt+ArrowRight");
  await expect(counter).toHaveText("2 / 3");

  await component.press("Alt+ArrowLeft");
  await expect(counter).toHaveText("1 / 3");
});

test("⌥↓ / ⌥↑ switch the previewed treatment", async ({ mount }) => {
  const component = await mount(<MockViewer />);
  const picker = component.getByRole("combobox", { name: "Part to preview" });
  await expect(picker).toHaveValue("treatment:0");

  await component.press("Alt+ArrowDown");
  await expect(picker).toHaveValue("treatment:1");

  await component.press("Alt+ArrowUp");
  await expect(picker).toHaveValue("treatment:0");
});

test("⌥<digit> selects a player position and ignores out-of-range digits", async ({
  mount,
}) => {
  const component = await mount(<MockViewer />);
  const position = component.locator("#position-select");
  await expect(position).toHaveValue("0");

  await component.press("Alt+Digit1");
  await expect(position).toHaveValue("1");

  // playerCount is 2, so ⌥5 is out of range and must be a no-op.
  await component.press("Alt+Digit5");
  await expect(position).toHaveValue("1");

  await component.press("Alt+Digit0");
  await expect(position).toHaveValue("0");
});

test("⌥K plays and pauses the timeline scrubber", async ({ mount }) => {
  const component = await mount(<MockViewer />);
  // Stage 1 (A1) has a duration, so the scrubber's play button is present.
  await expect(component.getByRole("button", { name: "Play" })).toBeVisible();

  await component.press("Alt+KeyK");
  await expect(component.getByRole("button", { name: "Pause" })).toBeVisible();

  await component.press("Alt+KeyK");
  await expect(component.getByRole("button", { name: "Play" })).toBeVisible();
});

test("⌥/ toggles the shortcut cheatsheet", async ({ mount }) => {
  const component = await mount(<MockViewer />);
  const help = component.locator('[data-testid="hotkey-help"]');
  await expect(help).toHaveCount(0);

  await component.press("Alt+Slash");
  await expect(help).toBeVisible();

  await component.press("Alt+Slash");
  await expect(help).toHaveCount(0);
});

test("Escape closes the cheatsheet", async ({ mount }) => {
  const component = await mount(<MockViewer />);
  const help = component.locator('[data-testid="hotkey-help"]');

  await component.press("Alt+Slash");
  await expect(help).toBeVisible();

  await component.press("Escape");
  await expect(help).toHaveCount(0);
});

test("⌥P focuses the part picker so the whole list is reachable", async ({
  mount,
}) => {
  const component = await mount(<MockViewer />);
  const picker = component.getByRole("combobox", { name: "Part to preview" });
  await expect(picker).not.toBeFocused();

  await component.press("Alt+KeyP");
  await expect(picker).toBeFocused();
});

test("step and treatment nav clamp at the bounds (no wrap-around)", async ({
  mount,
}) => {
  const component = await mount(<MockViewer />);
  const counter = component.getByText(/^\d+ \/ 3$/);
  const picker = component.getByRole("combobox", { name: "Part to preview" });
  // MockViewer starts on the first step of the first treatment.
  await expect(counter).toHaveText("1 / 3");
  await expect(picker).toHaveValue("treatment:0");

  // Prev at the first step / first treatment is a no-op — must not wrap to the
  // last one.
  await component.press("Alt+ArrowLeft");
  await expect(counter).toHaveText("1 / 3");
  await component.press("Alt+ArrowUp");
  await expect(picker).toHaveValue("treatment:0");
});

test("bare keys pass through — no modifier means no chrome navigation", async ({
  mount,
}) => {
  const component = await mount(<MockViewer />);
  const counter = component.getByText(/^\d+ \/ 3$/);
  await expect(counter).toHaveText("1 / 3");

  // Bare ArrowRight belongs to the study content, not the researcher chrome.
  await component.press("ArrowRight");
  await expect(counter).toHaveText("1 / 3");
});
