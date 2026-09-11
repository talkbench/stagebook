import { test, expect } from "@playwright/experimental-ct-react";
import { MockTimeline } from "./MockTimeline.js";

test("unrelated mock rerenders preserve seeks; changed time props still drive playback", async ({
  mount,
  page,
}) => {
  const props = {
    source: "player",
    playerName: "player",
    name: "fixture",
    selectionType: "point" as const,
    mockCurrentTime: 0,
  };
  const component = await mount(<MockTimeline {...props} />);
  const playhead = page.getByTestId("playhead");
  const position = () =>
    playhead.evaluate((el) => parseFloat((el as HTMLElement).style.left));
  await page.getByTestId("timeline").focus();
  await page.keyboard.press("ArrowRight");
  await expect.poll(position).toBeGreaterThan(0);
  // A parent rerender (e.g. a save/mute/capture-count update) must not undo
  // the handle's seek when its time prop did not change.
  await component.update(<MockTimeline {...props} />);
  await expect.poll(position).toBeGreaterThan(0);
  await component.update(<MockTimeline {...props} mockCurrentTime={30} />);
  await expect.poll(position).toBeGreaterThan(300);
});
