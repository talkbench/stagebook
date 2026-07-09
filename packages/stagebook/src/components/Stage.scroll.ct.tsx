import { test, expect } from "@playwright/experimental-ct-react";
import type { Locator, Page } from "@playwright/test";
import { MockStageRenderer } from "./testing/MockStageRenderer";
import type { StageConfig } from "./Stage";

// Integration tests for the ScrollIndicator + useScrollAwareness wiring in
// Stage.tsx — the three pieces work as a unit and were previously only
// covered end-to-end via a cypress spec in the downstream runner
// repo. These tests exercise the four behavioral branches of the hook
// (indicator on, dismiss via scroll, auto-peek at bottom, no re-fire after
// dismiss) against the real Stage wrapper.

// Static elements only — prompts load text async via getTextContent, which
// produces its own DOM mutations after mount and would race with the test's
// deliberate appendChild calls. Separators + submitButton render
// synchronously, so the MutationObserver's "first growth is absorbed,
// subsequent growths trigger indicator logic" sequencing is deterministic.
const staticStage: StageConfig = {
  name: "ScrollFixture",
  duration: 600,
  elements: [
    { type: "separator" },
    { type: "separator" },
    { type: "submitButton", buttonText: "OK" },
  ],
};

// Constrains Stage's scroll container so the test's appended pads overflow
// visibly. 200px is small enough that a 1000px fixture pad clearly triggers
// "not at bottom" past the 120px threshold in useScrollAwareness.
const WRAPPER_STYLE = {
  height: "200px",
  display: "flex" as const,
  flexDirection: "column" as const,
};

// Prime the hook's init gate and set the starting scroll state. After this
// call the hook's isInitializedRef is true (so the next growth triggers the
// real indicator path) and wasAtBottomRef reflects `start` via a dispatched
// scroll event.
// Stage's scroll container uses `display: flex; flex-direction: column`.
// Flex items default to `flex-shrink: 1`, which would crush the pads we
// append below. `flex: 0 0 auto` + explicit height keeps them at the
// requested size so scrollHeight actually grows.

// useScrollAwareness schedules its MutationObserver callback via
// requestAnimationFrame. If a test mutates twice before any rAF fires (which
// happens under parallel load), both rAF callbacks run after the DOM has
// already settled — the first one initializes with the final scrollHeight
// and the second sees no growth, so the indicator never fires. Awaiting two
// rAFs between mutations guarantees the hook has processed each one.
async function settleHook(page: Page): Promise<void> {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      }),
  );
}

async function primeScrollState(
  container: Locator,
  start: "top" | "bottom",
): Promise<void> {
  await container.evaluate((el, atBottom) => {
    const pad = document.createElement("div");
    pad.style.height = "1000px";
    pad.style.width = "100%";
    pad.style.flex = "0 0 auto";
    pad.setAttribute("data-fixture-pad", "1");
    el.appendChild(pad);
    el.scrollTop = atBottom ? el.scrollHeight : 0;
    el.dispatchEvent(new Event("scroll", { bubbles: true }));
  }, start === "bottom");
}

async function growContent(container: Locator, height = 200): Promise<void> {
  await container.evaluate((el, h) => {
    const pad = document.createElement("div");
    pad.style.height = `${h}px`;
    pad.style.width = "100%";
    pad.style.flex = "0 0 auto";
    pad.setAttribute("data-growth-pad", "1");
    el.appendChild(pad);
  }, height);
}

// Like primeScrollState("top") but DOES NOT dispatch a scroll event —
// used to set up overflow without registering user engagement, so we can
// test the "user hasn't scrolled yet" branch of the hook.
async function seedOverflowWithoutScroll(
  container: Locator,
  height = 1000,
): Promise<void> {
  await container.evaluate((el, h) => {
    const pad = document.createElement("div");
    pad.style.height = `${h}px`;
    pad.style.width = "100%";
    pad.style.flex = "0 0 auto";
    pad.setAttribute("data-seed-pad", "1");
    el.appendChild(pad);
  }, height);
}

async function scrollToBottom(container: Locator): Promise<void> {
  await container.evaluate((el) => {
    el.scrollTop = el.scrollHeight;
    el.dispatchEvent(new Event("scroll", { bubbles: true }));
  });
}

test("indicator appears when content grows while user is scrolled up", async ({
  mount,
}) => {
  const component = await mount(
    <div style={WRAPPER_STYLE}>
      <MockStageRenderer stage={staticStage} />
    </div>,
  );
  const container = component.locator('[data-testid="stageContent"]');
  await expect(container).toBeVisible();

  await primeScrollState(container, "top");
  await settleHook(component.page());
  await growContent(container);

  await expect(
    component.locator('[data-testid="scroll-indicator"]'),
  ).toBeVisible();
});

test("indicator is dismissed when user scrolls to bottom", async ({
  mount,
}) => {
  const component = await mount(
    <div style={WRAPPER_STYLE}>
      <MockStageRenderer stage={staticStage} />
    </div>,
  );
  const container = component.locator('[data-testid="stageContent"]');

  await primeScrollState(container, "top");
  await settleHook(component.page());
  await growContent(container);
  await expect(
    component.locator('[data-testid="scroll-indicator"]'),
  ).toBeVisible();

  await scrollToBottom(container);

  await expect(
    component.locator('[data-testid="scroll-indicator"]'),
  ).toHaveCount(0);
});

test("no indicator when user is already at bottom — auto-peek path", async ({
  mount,
}) => {
  const component = await mount(
    <div style={WRAPPER_STYLE}>
      <MockStageRenderer stage={staticStage} />
    </div>,
  );
  const container = component.locator('[data-testid="stageContent"]');

  await primeScrollState(container, "bottom");
  await settleHook(component.page());
  await growContent(container);
  await settleHook(component.page());

  await expect(
    component.locator('[data-testid="scroll-indicator"]'),
  ).toHaveCount(0);
});

test("dismissed indicator does not re-fire on subsequent mutations at the same scroll position", async ({
  mount,
}) => {
  const component = await mount(
    <div style={WRAPPER_STYLE}>
      <MockStageRenderer stage={staticStage} />
    </div>,
  );
  const container = component.locator('[data-testid="stageContent"]');

  await primeScrollState(container, "top");
  await settleHook(component.page());
  await growContent(container);
  await expect(
    component.locator('[data-testid="scroll-indicator"]'),
  ).toBeVisible();

  await scrollToBottom(container);
  await expect(
    component.locator('[data-testid="scroll-indicator"]'),
  ).toHaveCount(0);

  // Dismissal removes the ScrollIndicator element from the DOM — that's a
  // mutation the observer sees, and without a settle between it and the
  // next growth the two can batch into a single rAF callback that misses
  // the growth delta. Settle so each mutation is processed on its own.
  await settleHook(component.page());

  // User is still at the bottom — another mutation should take the
  // auto-peek branch, not show the indicator again.
  await growContent(container);
  await settleHook(component.page());
  await expect(
    component.locator('[data-testid="scroll-indicator"]'),
  ).toHaveCount(0);
});

test("no auto-peek on first growth before user has scrolled", async ({
  mount,
}) => {
  // Auto-peek used to fire on a fresh page load whenever async content
  // pushed scrollHeight past the viewport — even though the user hadn't
  // engaged with the content yet. The hook now gates peek on a real
  // scroll event having fired on the container; this is the regression
  // test for that gate.
  const component = await mount(
    <div style={WRAPPER_STYLE}>
      <MockStageRenderer stage={staticStage} />
    </div>,
  );
  const container = component.locator('[data-testid="stageContent"]');
  await expect(container).toBeVisible();

  // Push scrollHeight past clientHeight WITHOUT dispatching a scroll
  // event — the user hasn't engaged at all.
  await seedOverflowWithoutScroll(container);
  await settleHook(component.page());
  // First post-init growth: would have triggered peek under the old
  // logic (wasAtBottomRef defaults to true, isAtBottom returns true on
  // a not-yet-scrolled small container, so wasAtBottomNow=true).
  await growContent(container);
  await settleHook(component.page());

  // The cue is the indicator, not a peek scroll.
  await expect(
    component.locator('[data-testid="scroll-indicator"]'),
  ).toBeVisible();

  // And scrollTop has not been animated — no peek happened.
  // (peekAmount tops out at 150px; allow a tiny tolerance for any future
  // animation fudge but expect it to be effectively 0.)
  const scrollTop = await container.evaluate((el) => el.scrollTop);
  expect(scrollTop).toBeLessThan(2);
});
