import { test, expect } from "@playwright/experimental-ct-react";
import { MockMediaPlayer } from "../../testing/MockMediaPlayer.js";

for (const source of ["play button", "scrub release"]) {
  test(`pausing pending native play from ${source} handles its rejection (#800)`, async ({
    mount,
    page,
  }) => {
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    // No bytes arrive, so the browser cannot resolve play() before pause().
    await page.route("**/pending-play.mp4", () => {});
    const component = await mount(
      <MockMediaPlayer
        url="/pending-play.mp4"
        name="pending-play"
        controls={{ playPause: true, seek: true }}
        stopAt={60}
      />,
    );
    const video = component.getByTestId("mediaPlayer-video");
    await video.evaluate((element: HTMLVideoElement) => {
      const unhandled: string[] = [];
      const rejected: string[] = [];
      element.dataset.unhandledRejections = JSON.stringify(unhandled);
      window.addEventListener("unhandledrejection", (event) => {
        unhandled.push(String(event.reason));
        element.dataset.unhandledRejections = JSON.stringify(unhandled);
      });
      const nativePlay = element.play.bind(element);
      element.play = () =>
        nativePlay().catch((error: unknown) => {
          rejected.push(
            error instanceof DOMException ? error.name : String(error),
          );
          element.dataset.playRejections = JSON.stringify(rejected);
          // Return the native failure to the component; observing it here must
          // not silently consume the rejection this regression guards against.
          throw error;
        });
    });

    const button = component.getByTestId("mediaPlayer-playPause");
    await button.click();
    await expect(button).toHaveAttribute("aria-label", "Pause");
    expect(
      await video.evaluate((element: HTMLVideoElement) => element.readyState),
    ).toBe(0);

    if (source === "scrub release") {
      // Grabbing cancels the first pending play; releasing starts a second
      // native play through the scrub-resume path, still waiting for bytes.
      const scrub = component.getByTestId("mediaPlayer-scrubBar");
      await scrub.hover();
      await page.mouse.down();
      await expect(button).toHaveAttribute("aria-label", "Play");
      await page.mouse.up();
      await expect(button).toHaveAttribute("aria-label", "Pause");
    }
    await button.click();

    await expect(video).toHaveAttribute(
      "data-play-rejections",
      JSON.stringify(
        source === "scrub release"
          ? ["AbortError", "AbortError"]
          : ["AbortError"],
      ),
    );
    await expect(button).toHaveAttribute("aria-label", "Play");
    expect(
      await video.evaluate((element: HTMLVideoElement) => element.paused),
    ).toBe(true);
    // Allow the browser's unhandled-rejection task to run after the rejection.
    await page.waitForTimeout(50);
    await expect(video).toHaveAttribute("data-unhandled-rejections", "[]");
    expect(pageErrors).toEqual([]);
  });
}
