/**
 * Clicking an attached MediaPlayer's controls leaves focus where it was
 * (#695).
 *
 * A Timeline handles Enter only while it holds focus. If a pointer click on
 * the player's speed button or scrub bar took focus, the annotator's next
 * Enter would go to the player, which swallows it (#268), and the mark would
 * be lost. The control bar cancels the focus a mouse press would give it;
 * keyboard users still Tab to them, and clicking the video surface still
 * focuses the player so its own shortcuts work without a timeline.
 *
 * Real browser focus is the subject here, so these are CT tests in all three
 * engines (jsdom doesn't focus on mousedown).
 */
import { test, expect, type Locator } from "@playwright/experimental-ct-react";
import { MockWindowedTimeline } from "../testing/MockWindowedTimeline.js";
import { MockMediaPlayer } from "../testing/MockMediaPlayer.js";

const URL = "/sample-video.mp4";

const ALL_CONTROLS = {
  playPause: true,
  seek: true,
  step: true,
  speed: true,
};

function attached({
  playVideo = true,
  selectionType = "point",
}: { playVideo?: boolean; selectionType?: "point" | "range" } = {}) {
  return (
    <MockWindowedTimeline
      url={URL}
      selectionType={selectionType}
      controls={ALL_CONTROLS}
      playVideo={playVideo}
    />
  );
}

async function whenReady(component: Locator) {
  const video = component.locator('[data-testid="mediaPlayer-video"]');
  await expect
    .poll(() => video.evaluate((el: HTMLVideoElement) => el.readyState))
    .toBeGreaterThanOrEqual(1);
  const overlay = component.locator('[data-testid="selection-overlay"]');
  await expect
    .poll(async () => (await overlay.boundingBox())?.width ?? 0)
    .toBeGreaterThan(0);
  return {
    video,
    timeline: component.locator('[data-testid="timeline"]'),
    player: component.locator('[data-testid="mediaPlayer"]'),
  };
}

/** The Timeline's last save, or [] before its first. */
async function savedMarks(component: Locator): Promise<unknown[]> {
  const text = await component
    .locator('[data-testid="save-log"]')
    .textContent();
  const log = JSON.parse(text ?? "[]") as Array<{
    key: string;
    value: unknown;
  }>;
  const last = log.filter((s) => s.key === "timeline_marks").pop();
  return (last?.value ?? []) as unknown[];
}

// -- A focused timeline keeps Enter through a click on any control --

for (const control of [
  "playPause",
  "seekBack",
  "stepBack",
  "stepForward",
  "seekForward",
  "speed",
  "scrubBar",
]) {
  test(`clicking the player's ${control} leaves the timeline focused, so Enter still marks`, async ({
    mount,
    page,
  }) => {
    const component = await mount(attached());
    const { timeline } = await whenReady(component);
    await timeline.focus();

    await component.getByTestId(`mediaPlayer-${control}`).click();
    await expect(timeline).toBeFocused();

    await page.keyboard.press("Enter");
    await expect.poll(async () => (await savedMarks(component)).length).toBe(1);
  });
}

// -- A near miss on the control bar doesn't take focus either --
// The padding, the gaps between buttons and the time readout belong to the
// controls, not to the video surface. In audio-only mode the bar is the whole
// player, so there is no video surface at all.

for (const playVideo of [true, false]) {
  const mode = playVideo ? "video" : "audio-only";

  test(`${mode}: clicking the time readout leaves the timeline focused`, async ({
    mount,
    page,
  }) => {
    const component = await mount(attached({ playVideo }));
    const { timeline } = await whenReady(component);
    await timeline.focus();

    await component.getByTestId("mediaPlayer-time").click();
    await expect(timeline).toBeFocused();

    await page.keyboard.press("Enter");
    await expect.poll(async () => (await savedMarks(component)).length).toBe(1);
  });

  test(`${mode}: clicking the gap beside the speed button leaves the timeline focused`, async ({
    mount,
    page,
  }) => {
    const component = await mount(attached({ playVideo }));
    const { timeline } = await whenReady(component);
    await timeline.focus();

    const box = await component.getByTestId("mediaPlayer-speed").boundingBox();
    if (!box) throw new Error("speed button not found");
    // The 0.25rem gap just before the button, which no control covers.
    await page.mouse.click(box.x - 2, box.y + box.height / 2);
    await expect(timeline).toBeFocused();

    await page.keyboard.press("Enter");
    await expect.poll(async () => (await savedMarks(component)).length).toBe(1);
  });
}

test("the speed click still changes the speed", async ({ mount }) => {
  const component = await mount(attached());
  const { video, timeline } = await whenReady(component);
  await timeline.focus();
  await component.getByTestId("mediaPlayer-speed").click();
  await expect
    .poll(() => video.evaluate((el: HTMLVideoElement) => el.playbackRate))
    .toBe(1.25);
});

test("dragging the scrub bar still seeks, and the timeline keeps focus", async ({
  mount,
  page,
}) => {
  const component = await mount(attached());
  const { video, timeline } = await whenReady(component);
  await timeline.focus();
  const bar = component.getByTestId("mediaPlayer-scrubBar");
  const box = await bar.boundingBox();
  if (!box) throw new Error("scrub bar not found");
  const y = box.y + box.height / 2;
  await page.mouse.move(box.x + box.width * 0.2, y);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.6, y, { steps: 4 });
  // 60% of the 10 s file.
  await expect
    .poll(() => video.evaluate((el: HTMLVideoElement) => el.currentTime))
    .toBeCloseTo(6, 0);
  // Pointer capture keeps the drag going off the bar; past its end it clamps.
  await page.mouse.move(box.x + box.width * 1.2, y - 40, { steps: 4 });
  await page.mouse.up();
  await expect
    .poll(() => video.evaluate((el: HTMLVideoElement) => el.currentTime))
    .toBeCloseTo(10, 0);
  await expect(timeline).toBeFocused();
});

test("a range held open with Enter survives scrubbing with the mouse", async ({
  mount,
  page,
}) => {
  // On main the click blurred the timeline, which dropped the pending start.
  const component = await mount(attached({ selectionType: "range" }));
  const { video, timeline } = await whenReady(component);
  await timeline.focus();
  await page.keyboard.down("Enter");

  const bar = component.getByTestId("mediaPlayer-scrubBar");
  const box = await bar.boundingBox();
  if (!box) throw new Error("scrub bar not found");
  const y = box.y + box.height / 2;
  await page.mouse.move(box.x + box.width * 0.2, y);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.6, y, { steps: 4 });
  await page.mouse.up();
  await expect
    .poll(() => video.evaluate((el: HTMLVideoElement) => el.currentTime))
    .toBeCloseTo(6, 0);

  await page.keyboard.up("Enter");
  await expect.poll(async () => (await savedMarks(component)).length).toBe(1);
  const [range] = (await savedMarks(component)) as Array<{
    start: number;
    end: number;
  }>;
  expect(range.start).toBeCloseTo(0, 0);
  expect(range.end).toBeCloseTo(6, 0);
});

// -- The #300 focus rescue only follows keyboard focus --

test("controls hiding after a click don't pull focus off the timeline", async ({
  mount,
  page,
}) => {
  const component = await mount(attached());
  const { timeline, video } = await whenReady(component);
  await timeline.focus();
  await component.getByTestId("mediaPlayer-speed").click();
  // Played directly: clicking play swaps its icon under the pointer, and
  // WebKit then never reports the mouse leaving the player.
  await video.evaluate((el: HTMLVideoElement) => el.play());

  // Leaving the player while it plays hides the controls.
  await timeline.hover();
  await expect(component.getByTestId("mediaPlayer-controls")).toHaveCount(0);

  await expect(timeline).toBeFocused();
  await page.keyboard.press("Enter");
  await expect.poll(async () => (await savedMarks(component)).length).toBe(1);
});

// -- Keyboard focus is unchanged --

/** Whether focus is on `el` or inside it. */
function holdsFocus(el: Locator): Promise<boolean> {
  return el.evaluate((node) => node.contains(document.activeElement));
}

test("Tab still reaches the speed button, and Enter and Space leave focus on it", async ({
  mount,
  page,
}) => {
  const component = await mount(
    <MockMediaPlayer
      url={URL}
      name="clip"
      playback="manual"
      controls={{ speed: true }}
    />,
  );
  const player = component.getByTestId("mediaPlayer");
  const speed = component.getByTestId("mediaPlayer-speed");
  // Hovered, the controls stay up while Space plays the video.
  await player.hover();
  await expect(speed).toBeVisible();

  // Firefox also stops on the <video> itself, so allow an extra Tab.
  for (let i = 0; i < 3; i++) {
    await page.keyboard.press("Tab");
    if (await speed.evaluate((el) => el === document.activeElement)) break;
  }
  await expect(speed).toBeFocused();

  // The player reserves Enter for the timeline (#268) and keeps Space for
  // play/pause, so neither cycles the speed; neither moves focus either.
  await page.keyboard.press("Enter");
  await expect(speed).toBeFocused();
  await page.keyboard.press(" ");
  await expect(speed).toBeFocused();
});

// -- Without a timeline, clicking the video still turns on the shortcuts --

test("clicking the video surface focuses the player, and Space then plays", async ({
  mount,
  page,
}) => {
  const component = await mount(
    <MockMediaPlayer
      url={URL}
      name="clip"
      playback="manual"
      controls={ALL_CONTROLS}
    />,
  );
  const player = component.getByTestId("mediaPlayer");
  const video = component.getByTestId("mediaPlayer-video");
  await expect
    .poll(() => video.evaluate((el: HTMLVideoElement) => el.readyState))
    .toBeGreaterThanOrEqual(1);

  // The top of the frame, clear of the controls overlay along the bottom.
  // Chromium and WebKit focus the container; Firefox focuses the <video>.
  await video.click({ position: { x: 20, y: 20 } });
  expect(await holdsFocus(player)).toBe(true);

  await page.keyboard.press(" ");
  await expect
    .poll(() => video.evaluate((el: HTMLVideoElement) => el.paused))
    .toBe(false);
});

// -- The play-once button --

for (const playVideo of [true, false]) {
  const mode = playVideo ? "video" : "audio-only";

  test(`${mode}: clicking the play-once button leaves focus where it was`, async ({
    mount,
    page,
  }) => {
    // Blocked autoplay is what shows the play-once button.
    await page.route("**/blocked.mp4", (route) => route.abort());
    const component = await mount(
      <div>
        <input data-testid="other-input" />
        <MockMediaPlayer
          url="/blocked.mp4"
          name="clip"
          playback="once"
          playVideo={playVideo}
        />
      </div>,
    );
    await component.getByTestId("mediaPlayer-video").evaluate((el) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (el as any).play = () =>
        Promise.reject(new DOMException("NotAllowedError"));
      Object.defineProperty(el, "duration", {
        get: () => 60,
        configurable: true,
      });
      el.dispatchEvent(new Event("loadedmetadata"));
    });
    const other = component.getByTestId("other-input");
    const playOnce = component.getByTestId("mediaPlayer-playOnce");
    await expect(playOnce).toBeVisible();
    await other.focus();
    await playOnce.click();
    await expect(other).toBeFocused();
  });
}
