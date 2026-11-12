import { test, expect } from "@playwright/experimental-ct-react";
import type { Page } from "@playwright/test";
import { TimelineViewer } from "./testing/TimelineViewer.js";

// A media player that refuses its audio channels shows the participant a
// message about the recording. The preview has to tell the researcher the
// actual cause, which for a blocked AudioWorklet module is the page's
// Content-Security-Policy and not the recording (#837).

/** No blob: scripts, as in the VS Code preview's webview. ('unsafe-eval' is
 * for the component-test bundle; it does not admit blob: URLs.) */
const refuseBlobScripts = (page: Page) =>
  page.evaluate(() => {
    const meta = document.createElement("meta");
    meta.httpEquiv = "Content-Security-Policy";
    meta.content = "script-src 'self' 'unsafe-eval'";
    document.head.append(meta);
  });

test("the preview names the cause when a policy blocks the channel-count worklet", async ({
  mount,
  page,
}) => {
  await refuseBlobScripts(page);
  // The waveform's capture starts with the stage, so no click is needed.
  const component = await mount(<TimelineViewer />);

  await expect(component.getByTestId("timeline-error")).toBeVisible();
  const notice = component.getByTestId("viewer-channel-errors");
  await expect(notice.locator("code")).toHaveText("v");
  await expect(notice).toContainText("Content-Security-Policy");
  await expect(notice).toContainText("channel-count.js");
});

test("the notice goes with its stage, and can be dismissed", async ({
  mount,
  page,
}) => {
  await refuseBlobScripts(page);
  const component = await mount(<TimelineViewer />);
  const notice = component.getByTestId("viewer-channel-errors");
  await expect(notice).toBeVisible();

  await notice.getByRole("button", { name: "Dismiss" }).click();
  await expect(notice).toHaveCount(0);

  // Coming back remounts the player, which reports again.
  await component.getByRole("button", { name: "Next stage" }).click();
  await expect(notice).toHaveCount(0);
  await component.getByRole("button", { name: "Previous stage" }).click();
  await expect(notice).toBeVisible();
  await component.getByRole("button", { name: "Next stage" }).click();
  await expect(notice).toHaveCount(0);
});

// The file is put in the test bundle by playwright-ct.config.ts.
test("a preview given the worklet file's URL plays under the same policy", async ({
  mount,
  page,
}) => {
  await refuseBlobScripts(page);
  const component = await mount(
    <TimelineViewer channelCountWorkletUrl="/worklets/channel-count.js" />,
  );
  await component.getByTestId("mediaPlayer-playPause").click();

  await expect(component.getByTestId("timeline")).toBeVisible();
  await expect
    .poll(() =>
      component
        .getByTestId("mediaPlayer-video")
        .evaluate((video: HTMLVideoElement) => video.currentTime),
    )
    .toBeGreaterThan(0.5);
  await expect(component.getByTestId("timeline-error")).toHaveCount(0);
  await expect(component.getByTestId("viewer-channel-errors")).toHaveCount(0);
});
