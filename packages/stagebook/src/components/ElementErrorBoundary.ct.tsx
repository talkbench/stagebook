import { test, expect } from "@playwright/experimental-ct-react";
import {
  BoundaryTestHarness,
  SiblingLayout,
} from "./testing/BoundaryTestHarness";

const FALLBACK_TEXT = "Part of this page couldn't load";

test("renders happy-path children with no visible wrapper", async ({
  mount,
  page,
}) => {
  await mount(
    <BoundaryTestHarness
      elementType="prompt"
      elementName="ok"
      happyText="HAPPY-PATH-CONTENT"
    />,
  );
  await expect(page.locator('[data-testid="happy-child"]')).toBeVisible();
  await expect(page.locator("#root")).toContainText("HAPPY-PATH-CONTENT");
  await expect(page.locator("#root")).not.toContainText(FALLBACK_TEXT);
  // No fallback element in the DOM in the happy path.
  await expect(
    page.locator('[data-testid="element-error-fallback"]'),
  ).toHaveCount(0);
});

test("renders a participant-friendly fallback when a child throws", async ({
  mount,
  page,
}) => {
  // Swallow the async-rethrown error so the test doesn't fail on page error
  page.on("pageerror", () => {});

  await mount(
    <BoundaryTestHarness
      elementType="prompt"
      elementName="secretPromptName"
      crashMessage="secret-internal-reason"
    />,
  );

  const fallback = page.locator('[data-testid="element-error-fallback"]');
  await expect(fallback).toBeVisible();
  await expect(fallback).toHaveClass(/stagebook-error-callout/);
  await expect(fallback).toContainText(FALLBACK_TEXT);
});

test("fallback UI leaks no technical detail to the participant", async ({
  mount,
  page,
}) => {
  page.on("pageerror", () => {});

  await mount(
    <BoundaryTestHarness
      elementType="prompt"
      elementName="secretPromptName"
      crashMessage="secret-internal-reason"
    />,
  );

  await expect(
    page.locator('[data-testid="element-error-fallback"]'),
  ).toBeVisible();

  const root = page.locator("#root");
  // None of these may appear in the DOM presented to the participant
  await expect(root).not.toContainText("secret-internal-reason");
  await expect(root).not.toContainText("secretPromptName");
  // The raw element type string shouldn't leak either — the fallback copy
  // intentionally does not reference the element's kind.
  await expect(root).not.toContainText("prompt:");
});

test("sibling elements still render when the middle one crashes", async ({
  mount,
  page,
}) => {
  page.on("pageerror", () => {});

  await mount(
    <SiblingLayout
      leftText="LEFT-OK"
      rightText="RIGHT-OK"
      crashMessage="middle-boom"
      elementNames={["left", "middle", "right"]}
    />,
  );

  await expect(page.locator('[data-testid="sibling-left"]')).toBeVisible();
  await expect(page.locator('[data-testid="sibling-right"]')).toBeVisible();
  await expect(
    page.locator('[data-testid="element-error-fallback"]'),
  ).toHaveCount(1);
  const root = page.locator("#root");
  await expect(root).toContainText("LEFT-OK");
  await expect(root).toContainText("RIGHT-OK");
  await expect(root).toContainText(FALLBACK_TEXT);
});

test("emits a [Stagebook] console.error with the full technical payload", async ({
  mount,
  page,
}) => {
  page.on("pageerror", () => {});

  const stagebookErrors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error" && msg.text().includes("[Stagebook]")) {
      stagebookErrors.push(msg.text());
    }
  });

  await mount(
    <BoundaryTestHarness
      elementType="prompt"
      elementName="promptForDebug"
      crashMessage="debug-visible-to-researcher"
    />,
  );

  await expect
    .poll(() => stagebookErrors.length, { timeout: 2000 })
    .toBeGreaterThanOrEqual(1);

  const logged = stagebookErrors[0];
  expect(logged).toContain("prompt");
  expect(logged).toContain("promptForDebug");
});

test("async re-throws original error to window.onerror", async ({
  mount,
  page,
}) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (err) => {
    pageErrors.push(err.message);
  });

  await mount(
    <BoundaryTestHarness
      elementType="display"
      elementName="xyz"
      crashMessage="rethrown-to-window-onerror"
    />,
  );

  await expect
    .poll(() => pageErrors.length, { timeout: 2000 })
    .toBeGreaterThanOrEqual(1);

  expect(pageErrors).toContain("rethrown-to-window-onerror");
});

test("calls onElementError with structured payload when provided", async ({
  mount,
  page,
}) => {
  page.on("pageerror", () => {});

  await page.evaluate(() => {
    delete window.__stagebookElementErrors;
  });

  await mount(
    <BoundaryTestHarness
      elementType="timer"
      elementName="countdownA"
      callbackMode="record"
      crashMessage="callback-error"
    />,
  );

  await expect
    .poll(
      () => page.evaluate(() => window.__stagebookElementErrors?.length ?? 0),
      { timeout: 2000 },
    )
    .toBeGreaterThanOrEqual(1);

  const recorded = await page.evaluate(
    () => window.__stagebookElementErrors?.[0],
  );
  expect(recorded).toMatchObject({
    elementType: "timer",
    elementName: "countdownA",
    errorMessage: "callback-error",
    errorName: "Error",
    hasErrorInfo: true,
  });
});

test("throwing onElementError does not break containment or async re-throw", async ({
  mount,
  page,
}) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (err) => pageErrors.push(err.message));

  await mount(
    <BoundaryTestHarness
      elementType="prompt"
      elementName="buggyHost"
      callbackMode="throw"
      crashMessage="original-crash-message"
    />,
  );

  // Fallback still renders — a buggy host callback must not compromise
  // the boundary's participant-facing UI.
  await expect(
    page.locator('[data-testid="element-error-fallback"]'),
  ).toBeVisible();

  // The original error still reaches window.onerror — not the callback's
  // error — so crash reporters see the real crash.
  await expect
    .poll(() => pageErrors.length, { timeout: 2000 })
    .toBeGreaterThanOrEqual(1);
  expect(pageErrors).toContain("original-crash-message");
});

test("without onElementError, console.error and window.onerror still fire", async ({
  mount,
  page,
}) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (err) => pageErrors.push(err.message));
  const stagebookErrors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error" && msg.text().includes("[Stagebook]")) {
      stagebookErrors.push(msg.text());
    }
  });

  await mount(
    <BoundaryTestHarness
      elementType="display"
      elementName="noCallback"
      crashMessage="no-callback-provided"
    />,
  );

  await expect
    .poll(() => pageErrors.length, { timeout: 2000 })
    .toBeGreaterThanOrEqual(1);
  expect(pageErrors).toContain("no-callback-provided");
  expect(stagebookErrors.length).toBeGreaterThanOrEqual(1);
});
