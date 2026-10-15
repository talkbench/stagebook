import { test, expect } from "@playwright/experimental-ct-react";
import { MockTimeline } from "../testing/MockTimeline.js";
import { LocaleProvider } from "../testing/LocaleProvider.js";

const locked = { play: false, pause: false, seek: false };
const props = {
  source: "player",
  playerName: "player",
  name: "annotations",
  multiSelect: true,
  mockCurrentTime: 10,
  mockTransportCapabilities: locked,
};

test("locked transport suppresses keyboard, ruler, and playhead actions while points remain editable", async ({
  mount,
  page,
}) => {
  await mount(<MockTimeline {...props} selectionType="point" />);
  const timeline = page.getByTestId("timeline");
  const ruler = page.getByTestId("time-ruler");
  const playhead = page.getByTestId("playhead").locator(":scope > div").first();
  await expect(ruler).toHaveCSS("cursor", "default");
  await expect(playhead).toHaveCSS("cursor", "default");
  await timeline.focus();
  for (const key of ["Space", "ArrowRight", "ArrowLeft", ",", "."]) {
    await page.keyboard.press(key);
  }
  await ruler.click({ position: { x: 400, y: 10 } });
  const box = (await playhead.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + 100, box.y + box.height / 2);
  await page.mouse.up();
  await timeline.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("save-log")).toContainText('"time":10');
  await page.keyboard.press("]");
  await page.keyboard.press("ArrowRight");
  await expect(page.getByTestId("save-log")).toContainText('"time":11');
  await page.getByTestId("timeline-zoom-in").click();
  await expect(timeline).toHaveAttribute("data-zoom-level", "2");
  await expect(page.getByTestId("transport-calls")).toHaveText("[]");
});

test("locked transport preserves held ranges and boundary edits without frame-sync seeks", async ({
  mount,
  page,
}) => {
  const component = await mount(
    <MockTimeline {...props} selectionType="range" mockPaused={false} />,
  );
  const timeline = page.getByTestId("timeline");
  await timeline.focus();
  await page.keyboard.down("Enter");
  await component.update(
    <MockTimeline
      {...props}
      selectionType="range"
      mockPaused={false}
      mockCurrentTime={15}
    />,
  );
  await page.keyboard.up("Enter");
  await expect(page.getByTestId("save-log")).toContainText(
    '"start":10,"end":15',
  );
  await page.keyboard.press("]");
  await page.keyboard.press("Tab");
  await page.keyboard.press("ArrowRight");
  await expect(page.getByTestId("save-log")).toContainText(
    '"start":10,"end":16',
  );
  await page.keyboard.press("Space");
  await expect(page.getByTestId("transport-calls")).toHaveText("[]");
});

for (const locale of ["en", "he"]) {
  for (const selectionType of ["point", "range"] as const) {
    test(`${locale} ${selectionType} help omits locked transport but retains annotation shortcuts`, async ({
      mount,
      page,
    }) => {
      await mount(
        <LocaleProvider locale={locale}>
          <MockTimeline {...props} selectionType={selectionType} />
        </LocaleProvider>,
      );
      await page.getByTestId("timeline-help-button").click();
      const dialog = page.getByRole("dialog");
      await expect(dialog.getByText("Space", { exact: true })).toHaveCount(0);
      await expect(dialog).not.toContainText(
        locale === "en" ? "(no selection)" : "(ללא בחירה)",
      );
      await expect(dialog).not.toContainText(
        locale === "en"
          ? "Click / drag the ruler"
          : "לחיצה / גרירה על סרגל הזמן",
      );
      await expect(dialog).toContainText("Enter");
      await expect(dialog).toContainText("[ / ]");
      await expect(dialog).toContainText("Delete");
    });
  }
}

test("selective capabilities allow only the applicable play or pause action", async ({
  mount,
  page,
}) => {
  const partial = { play: false, pause: true, seek: false };
  const component = await mount(
    <MockTimeline
      {...props}
      selectionType="point"
      mockTransportCapabilities={partial}
    />,
  );
  const timeline = page.getByTestId("timeline");
  await timeline.focus();
  await page.keyboard.press("Space");
  await component.update(
    <MockTimeline
      {...props}
      selectionType="point"
      mockPaused={false}
      mockTransportCapabilities={partial}
    />,
  );
  await page.keyboard.press("Space");
  await page.keyboard.press("ArrowRight");
  await expect(page.getByTestId("transport-calls")).toHaveText('["pause"]');
  await page.getByTestId("timeline-help-button").click();
  await expect(
    page.getByRole("row").filter({
      has: page.getByRole("cell", { name: "Space", exact: true }),
    }),
  ).toHaveText("SpacePause");
});

test("seek-only capabilities retain ruler and keyboard seeking", async ({
  mount,
  page,
}) => {
  await mount(
    <MockTimeline
      {...props}
      selectionType="point"
      mockTransportCapabilities={{ play: false, pause: false, seek: true }}
    />,
  );
  await page.getByTestId("timeline").focus();
  await page.keyboard.press("Space");
  await page.keyboard.press("ArrowRight");
  await expect(page.getByTestId("transport-calls")).toHaveText('["seek:11"]');
  const ruler = page.getByTestId("time-ruler");
  await expect(ruler).toHaveCSS("cursor", "pointer");
  await ruler.click({ position: { x: 400, y: 10 } });
  await expect(page.getByTestId("transport-calls")).toContainText(
    '["seek:11","seek:',
  );
});

test("capability changes refresh affordances and preserve legacy handle transport", async ({
  mount,
  page,
}) => {
  const component = await mount(
    <MockTimeline
      {...props}
      selectionType="point"
      mockTransportCapabilities={undefined}
    />,
  );
  const timeline = page.getByTestId("timeline");
  const ruler = page.getByTestId("time-ruler");
  await expect(ruler).toHaveCSS("cursor", "pointer");
  await timeline.focus();
  await page.keyboard.press("Space");
  await expect(page.getByTestId("transport-calls")).toHaveText('["play"]');

  await component.update(<MockTimeline {...props} selectionType="point" />);
  await expect(ruler).toHaveCSS("cursor", "default");
  await page.keyboard.press("Space");
  await page.keyboard.press("ArrowRight");
  await expect(page.getByTestId("transport-calls")).toHaveText('["play"]');
  await page.getByTestId("timeline-help-button").click();
  await expect(
    page.getByRole("cell", { name: "Space", exact: true }),
  ).toHaveCount(0);

  await component.update(
    <MockTimeline
      {...props}
      selectionType="point"
      mockTransportCapabilities={undefined}
    />,
  );
  await expect(ruler).toHaveCSS("cursor", "pointer");
  await expect(
    page.getByRole("cell", { name: "Space", exact: true }),
  ).toBeVisible();
  await page.getByTestId("timeline-help-close").click();
  await timeline.focus();
  await page.keyboard.press("Space");
  await page.keyboard.press("ArrowRight");
  await expect(page.getByTestId("transport-calls")).toHaveText(
    '["play","pause","seek:11"]',
  );
});
