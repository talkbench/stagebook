import { test, expect } from "@playwright/experimental-ct-react";
import { LocaleProvider } from "../testing/LocaleProvider.js";
import { MockTimeline } from "../testing/MockTimeline.js";

for (const selectionType of ["point", "range"] as const) {
  test(`${selectionType}: browse restored annotations in time order without saving or seeking`, async ({
    mount,
    page,
  }) => {
    await mount(
      <MockTimeline
        source="player"
        playerName="player"
        name="annotations"
        selectionType={selectionType}
        multiSelect
        mockCurrentTime={25}
        initialSelections={
          selectionType === "point"
            ? [{ time: 50 }, { time: 10 }, { time: 30 }]
            : [
                { start: 50, end: 55 },
                { start: 10, end: 15 },
                { start: 30, end: 35 },
              ]
        }
      />,
    );
    const timeline = page.getByTestId("timeline");
    await page.getByTestId("timeline-zoom-in").click();
    await timeline.focus();
    await expect(timeline).toBeFocused();
    await page.keyboard.press("]");
    await expect(page.getByTestId(`${selectionType}-1`)).toHaveAttribute(
      "data-active",
      "true",
    );
    await expect(page.getByRole("status")).toContainText(
      `${selectionType === "point" ? "Point" : "Range"} 1 of 3`,
    );
    await page.keyboard.press("]");
    await expect(page.getByTestId(`${selectionType}-2`)).toHaveAttribute(
      "data-active",
      "true",
    );
    await page.keyboard.press("]");
    await expect(page.getByTestId(`${selectionType}-0`)).toHaveAttribute(
      "data-active",
      "true",
    );
    await expect
      .poll(async () =>
        Number(await timeline.getAttribute("data-viewport-start")),
      )
      .toBeGreaterThan(20);
    await expect
      .poll(async () =>
        Number(await timeline.getAttribute("data-viewport-start")),
      )
      .toBeLessThanOrEqual(50);
    await page.keyboard.press("]");
    await expect(page.getByTestId(`${selectionType}-0`)).toHaveAttribute(
      "data-active",
      "true",
    );
    await page.keyboard.press("[");
    await expect(page.getByTestId(`${selectionType}-2`)).toHaveAttribute(
      "data-active",
      "true",
    );
    await page.keyboard.press("Escape");
    await page.keyboard.press("[");
    await expect(page.getByTestId(`${selectionType}-0`)).toHaveAttribute(
      "data-active",
      "true",
    );
    await expect(timeline).toBeFocused();
    await expect(page.getByTestId("save-log")).toHaveText("[]");
    // Enter uses the original playhead time, even after browsing off-screen marks.
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("save-log")).toContainText(
      selectionType === "point" ? '"time":25' : '"start":25',
    );
  });
}

test("announces selection, boundary changes, edits, deletion and undo", async ({
  mount,
  page,
}) => {
  await mount(
    <MockTimeline
      source="player"
      playerName="player"
      name="annotations"
      selectionType="range"
      initialSelections={[{ start: 10, end: 15 }]}
    />,
  );
  const timeline = page.getByTestId("timeline");
  const status = page.getByRole("status");
  await timeline.focus();
  await page.keyboard.press("]");
  await expect(status).toHaveText("Range 1 of 1, 10 to 15 seconds.");
  await page.keyboard.press("Tab");
  await expect(status).toHaveText(
    "Range 1 of 1, 10 to 15 seconds. End boundary selected.",
  );
  await page.keyboard.press("ArrowRight");
  await expect(status).toHaveText(
    "Range 1 of 1, 10 to 16 seconds. End boundary selected.",
  );
  await page.keyboard.press("Delete");
  await expect(status).toHaveText("No annotation selected. 0 annotations.");
  await page.keyboard.press("ControlOrMeta+z");
  await expect(status).toHaveText("No annotation selected. 1 annotation.");
  await page.keyboard.press("[");
  await expect(status).toHaveText("Range 1 of 1, 10 to 16 seconds.");
});

test("brackets ignore buttons and modifiers; empty timelines remain usable", async ({
  mount,
  page,
}) => {
  await mount(
    <MockTimeline
      source="player"
      playerName="player"
      name="annotations"
      selectionType="point"
      initialSelections={[{ time: 10 }]}
    />,
  );
  await page.getByTestId("timeline-zoom-in").focus();
  await page.keyboard.press("]");
  await expect(page.getByTestId("point-0")).toHaveAttribute(
    "data-active",
    "false",
  );
  await page.getByTestId("timeline").focus();
  await page.keyboard.press("Alt+]");
  await expect(page.getByTestId("point-0")).toHaveAttribute(
    "data-active",
    "false",
  );
  await page.keyboard.press("]");
  await expect(page.getByTestId("point-0")).toHaveAttribute(
    "data-active",
    "true",
  );
  await page.keyboard.press("Delete");
  await expect(page.getByTestId("point-0")).toHaveCount(0);
  await page.keyboard.press("]");
  await page.keyboard.press("[");
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("point-0")).toHaveAttribute(
    "data-active",
    "true",
  );
});

test("status stays quiet during playback and dragging, then reports the completed pointer edit", async ({
  mount,
  page,
}) => {
  const props = {
    source: "player",
    playerName: "player",
    name: "annotations",
    selectionType: "point" as const,
    initialSelections: [{ time: 10 }],
  };
  const component = await mount(
    <MockTimeline {...props} mockCurrentTime={0} />,
  );
  const status = page.getByRole("status");
  await expect(status).toHaveAttribute("aria-live", "polite");
  await expect(status).toHaveAttribute("aria-atomic", "true");
  await page.getByTestId("timeline").focus();
  await page.keyboard.press("]");
  await expect(status).toHaveText("Point 1 of 1, 10 seconds.");
  await component.update(
    <MockTimeline {...props} mockCurrentTime={20} mockPaused={false} />,
  );
  // Observe beyond the announcement delay: playback must not change the status.
  await page.waitForTimeout(500);
  await expect(status).toHaveText("Point 1 of 1, 10 seconds.");
  const point = await page.getByTestId("point-0").boundingBox();
  if (!point) throw new Error("Missing point");
  await page.mouse.move(point.x + point.width / 2, point.y + point.height / 2);
  await page.mouse.down();
  await page.mouse.move(
    point.x + point.width / 2 + 80,
    point.y + point.height / 2,
    { steps: 5 },
  );
  await page.waitForTimeout(500);
  await expect(status).toHaveText("Point 1 of 1, 10 seconds.");
  await page.mouse.up();
  await expect(status).not.toHaveText("Point 1 of 1, 10 seconds.");
  await expect(status).toContainText("Point 1 of 1,");
  await expect(page.getByTestId("save-log")).not.toHaveText("[]");
});

for (const selectionType of ["point", "range"] as const) {
  for (const release of ["deselection", "edit", "seek"] as const) {
    test(`${selectionType}: browsing holds the viewport during playback until ${release}`, async ({
      mount,
      page,
    }) => {
      const props = {
        source: "player",
        playerName: "player",
        name: "browsing",
        selectionType,
        multiSelect: true,
        mockPaused: false,
        initialSelections:
          selectionType === "point"
            ? [{ time: 5 }, { time: 10 }]
            : [
                { start: 5, end: 7 },
                { start: 10, end: 12 },
              ],
      };
      const component = await mount(
        <MockTimeline {...props} mockCurrentTime={40} />,
      );
      const timeline = page.getByTestId("timeline");
      await page.getByTestId("timeline-zoom-in").click();
      await page.getByTestId("timeline-zoom-in").click();
      await expect(timeline).toHaveAttribute("data-zoom-level", "4");
      await timeline.focus();
      await page.keyboard.press("[");
      await expect(page.getByTestId(`${selectionType}-1`)).toHaveAttribute(
        "data-active",
        "true",
      );
      await expect
        .poll(async () =>
          Number(await timeline.getAttribute("data-viewport-start")),
        )
        .toBeLessThanOrEqual(10);
      const viewport = await timeline.getAttribute("data-viewport-start");
      if (selectionType === "range") {
        await page.keyboard.press("Tab");
        await expect(page.getByRole("status")).toContainText(
          "End boundary selected.",
        );
      }
      // Advance in small steps, as ordinary playback does, and let RAF plus
      // the viewport effect settle after each update (not just the prop render).
      for (const time of [40.1, 40.2, 40.3]) {
        await component.update(
          <MockTimeline {...props} mockCurrentTime={time} />,
        );
        await page.evaluate(
          () =>
            new Promise((resolve) =>
              requestAnimationFrame(() =>
                requestAnimationFrame(() => resolve(null)),
              ),
            ),
        );
        await expect(timeline).toHaveAttribute(
          "data-viewport-start",
          viewport!,
        );
      }
      await expect(page.getByTestId("save-log")).toHaveText("[]");
      if (release === "deselection") {
        await page.keyboard.press("Escape");
      } else if (release === "edit") {
        await page.keyboard.press("ArrowRight");
        await expect(page.getByTestId("save-log")).not.toHaveText("[]");
      } else {
        const ruler = page.getByTestId("time-ruler");
        const box = await ruler.boundingBox();
        if (!box) throw new Error("Missing ruler");
        await ruler.click({
          position: { x: box.width / 2, y: box.height / 2 },
        });
      }
      await component.update(
        <MockTimeline {...props} mockCurrentTime={40.4} />,
      );
      await expect
        .poll(async () =>
          Number(await timeline.getAttribute("data-viewport-start")),
        )
        .toBeGreaterThan(20);
    });
  }
}

for (const selectionType of ["point", "range"] as const) {
  for (const restored of [false, true]) {
    test(`${selectionType}: initial status reports ${restored ? "restored" : "empty"} annotation count before interaction`, async ({
      mount,
      page,
    }) => {
      await mount(
        <MockTimeline
          source="player"
          playerName="player"
          name="initial_status"
          selectionType={selectionType}
          initialSelections={
            restored
              ? selectionType === "point"
                ? [{ time: 5 }, { time: 10 }]
                : [
                    { start: 5, end: 7 },
                    { start: 10, end: 12 },
                  ]
              : []
          }
        />,
      );
      await expect(page.getByRole("status")).toHaveText(
        `No annotation selected. ${restored ? 2 : 0} annotations.`,
      );
      await expect(page.locator('[data-active="true"]')).toHaveCount(0);
      await expect(page.getByTestId("save-log")).toHaveText("[]");
    });
  }
}

for (const selectionType of ["point", "range"] as const) {
  for (const paused of [true, false]) {
    test(`${selectionType}: Enter reveals new annotation after browsing while ${paused ? "paused" : "playing"}`, async ({
      mount,
      page,
    }) => {
      const props = {
        source: "player",
        playerName: "player",
        name: "resume_annotation",
        selectionType,
        multiSelect: true,
        mockPaused: paused,
        initialSelections:
          selectionType === "point" ? [{ time: 5 }] : [{ start: 5, end: 7 }],
      };
      const component = await mount(
        <MockTimeline {...props} mockCurrentTime={40} />,
      );
      const timeline = page.getByTestId("timeline");
      const viewport = async () =>
        Number(await timeline.getAttribute("data-viewport-start"));
      await page.getByTestId("timeline-zoom-in").click();
      await page.getByTestId("timeline-zoom-in").click();
      await expect(timeline).toHaveAttribute("data-zoom-level", "4");
      await timeline.focus();
      await page.keyboard.press("[");
      await expect.poll(viewport).toBeLessThanOrEqual(5);
      await page.keyboard.down("Enter");
      // Must reveal immediately, even without a new playhead tick or keyup.
      await expect.poll(viewport).toBeGreaterThan(25);
      if (selectionType === "range") {
        await expect(page.getByTestId("range-keyboard-preview")).toBeAttached();
        await component.update(
          <MockTimeline {...props} mockCurrentTime={41} />,
        );
      }
      await page.keyboard.up("Enter");
      await expect(page.getByTestId(`${selectionType}-1`)).toHaveAttribute(
        "data-active",
        "true",
      );
      await expect(page.getByTestId(`${selectionType}-1`)).toBeInViewport();
      await expect(page.getByTestId("save-log")).toContainText(
        selectionType === "point" ? '"time":40' : '"start":40,"end":41',
      );
    });
  }
}

for (const selected of [false, true]) {
  test(`status follows locale changes with ${selected ? "selected boundary" : "no selection"}`, async ({
    mount,
    page,
  }) => {
    const props = {
      source: "player",
      playerName: "player",
      name: "locale",
      selectionType: "range" as const,
      initialSelections: [{ start: 10, end: 15 }],
    };
    const component = await mount(
      <LocaleProvider locale="en">
        <MockTimeline {...props} />
      </LocaleProvider>,
    );
    const status = page.getByRole("status");
    await expect(status).toHaveText("No annotation selected. 1 annotation.");
    if (selected) {
      await page.getByTestId("timeline").focus();
      await page.keyboard.press("]");
      await page.keyboard.press("Tab");
      await expect(status).toHaveText(
        "Range 1 of 1, 10 to 15 seconds. End boundary selected.",
      );
    }
    await component.update(
      <LocaleProvider locale="he">
        <MockTimeline {...props} />
      </LocaleProvider>,
    );
    await expect(status).toHaveText(
      selected
        ? "טווח 1 מתוך 1, 10 עד 15 שניות. גבול הסיום נבחר."
        : "לא נבחר סימון. מספר הסימונים: 1.",
    );
    if (selected) {
      await component.update(
        <LocaleProvider
          locale="he"
          messages={{ timelineEndBoundarySelected: "End boundary override." }}
        >
          <MockTimeline {...props} />
        </LocaleProvider>,
      );
      await expect(status).toHaveText(
        "טווח 1 מתוך 1, 10 עד 15 שניות. End boundary override.",
      );
    }
    await expect(page.getByTestId("save-log")).toHaveText("[]");
  });
}
