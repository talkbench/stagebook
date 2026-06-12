import { test, expect } from "@playwright/experimental-ct-react";
import { SubmissionConditionalRender } from "./SubmissionConditionalRender";

test("renders children when not submitted", async ({ mount }) => {
  const component = await mount(
    <SubmissionConditionalRender isSubmitted={false} playerCount={3}>
      <p>Form content</p>
    </SubmissionConditionalRender>,
  );
  await expect(component).toContainText("Form content");
});

test("shows waiting message when submitted in multiplayer", async ({
  mount,
}) => {
  const component = await mount(
    <SubmissionConditionalRender isSubmitted={true} playerCount={3}>
      <p>Form content</p>
    </SubmissionConditionalRender>,
  );
  await expect(component).not.toContainText("Form content");
  await expect(component).toContainText("Waiting for other participants");
});

test("shows loading when submitted in single player", async ({ mount }) => {
  const component = await mount(
    <SubmissionConditionalRender isSubmitted={true} playerCount={1}>
      <p>Form content</p>
    </SubmissionConditionalRender>,
  );
  await expect(component).not.toContainText("Form content");
  await expect(component.locator('[aria-label="Loading"]')).toBeVisible();
});
