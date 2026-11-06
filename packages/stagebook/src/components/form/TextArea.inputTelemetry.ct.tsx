import { test, expect } from "@playwright/experimental-ct-react";
import { TextArea, type TypingStats } from "./TextArea";

test("native typing and bulk insertion share the existing blur commit", async ({
  mount,
  page,
  browserName,
}) => {
  await page.clock.install({ time: new Date("2026-11-05T12:00:00Z") });
  const snapshots: TypingStats[] = [];
  const values: string[] = [];
  const component = await mount(
    <TextArea
      debounceDelay={100000}
      maxWait={100000}
      onTypingSnapshot={(snapshot) => snapshots.push(snapshot)}
      onChange={(value) => values.push(value)}
    />,
  );
  const field = component.locator("textarea");
  await field.focus();
  await field.pressSequentially("ab");
  await page.clock.fastForward(100);
  await page.keyboard.insertText("x".repeat(40));
  await expect(field).toHaveValue("ab" + "x".repeat(40));
  expect(values).toEqual([]);
  await field.blur();
  await expect.poll(() => values).toEqual(["ab" + "x".repeat(40)]);
  expect(snapshots).toHaveLength(1);
  expect(snapshots[0]).toMatchObject({
    totalKeystrokes: 2,
    inputEventCount: 3,
    charsInsertedTotal: 42,
    charsDeletedTotal: 0,
    untrustedInputEventCount: 0,
    inputWithoutKeydownCount: 1,
    largeInsertionCount: 1,
    largeInsertions: [
      {
        chars: 40,
        // Playwright's Firefox insertion uses composition events. Preserve
        // that observed provenance instead of normalizing it to insertText.
        inputType:
          browserName === "firefox" ? "insertCompositionText" : "insertText",
        isTrusted: true,
        precededByKeydown: false,
      },
    ],
  });
});

test("equal-text replacement is observed even when React has no changed value", async ({
  mount,
  page,
}) => {
  const snapshots: TypingStats[] = [];
  const component = await mount(
    <TextArea
      value="abc"
      onTypingSnapshot={(snapshot) => snapshots.push(snapshot)}
    />,
  );
  const field = component.locator("textarea");
  await field.selectText();
  await page.keyboard.insertText("abc");
  await field.blur();
  await expect.poll(() => snapshots.length).toBe(1);
  expect(snapshots[0]).toMatchObject({
    inputEventCount: 1,
    charsInsertedTotal: 3,
    charsDeletedTotal: 3,
    totalKeystrokes: 0,
  });
});

test("a script-dispatched input is marked untrusted and carries no extra commit", async ({
  mount,
}) => {
  const snapshots: TypingStats[] = [];
  const values: string[] = [];
  const component = await mount(
    <TextArea
      debounceDelay={100000}
      maxWait={100000}
      onTypingSnapshot={(snapshot) => snapshots.push(snapshot)}
      onChange={(value) => values.push(value)}
    />,
  );
  const field = component.locator("textarea");
  await field.focus();
  await field.evaluate((element) => {
    Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype,
      "value",
    )!.set!.call(element, "script input");
    element.dispatchEvent(
      new InputEvent("input", {
        bubbles: true,
        inputType: "insertText",
        data: "script input",
      }),
    );
  });
  expect(values).toEqual([]);
  await field.blur();
  await expect.poll(() => values).toEqual(["script input"]);
  expect(snapshots[0]).toMatchObject({
    inputEventCount: 1,
    untrustedInputEventCount: 1,
    inputWithoutKeydownCount: 1,
    charsInsertedTotal: 12,
  });
});
