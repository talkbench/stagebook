import { test, expect } from "@playwright/experimental-ct-react";
import type { Page } from "@playwright/test";
import { Select } from "./form/Select";
import { TextArea } from "./form/TextArea";
import { Slider } from "./form/Slider";

// Chromium headless hides scrollbars by default; let this probe paint them.
test.use({ launchOptions: { ignoreDefaultArgs: ["--hide-scrollbars"] } });

// Compare decoded paint, not PNG compression bytes. Two channel levels allow
// the rounding seen at antialiased native-control corners between captures.
async function paintDelta(page: Page, a: Buffer, b: Buffer): Promise<number> {
  return page.evaluate(
    async (images) => {
      const decoded = await Promise.all(
        images.map(async (base64) => {
          const image = new Image();
          image.src = `data:image/png;base64,${base64}`;
          await image.decode();
          const canvas = document.createElement("canvas");
          canvas.width = image.width;
          canvas.height = image.height;
          const context = canvas.getContext("2d");
          if (!context) throw new Error("No canvas context");
          context.drawImage(image, 0, 0);
          return {
            width: image.width,
            height: image.height,
            data: context.getImageData(0, 0, image.width, image.height).data,
          };
        }),
      );
      if (
        decoded[0].width !== decoded[1].width ||
        decoded[0].height !== decoded[1].height
      )
        return 255;
      let delta = 0;
      for (let i = 0; i < decoded[0].data.length; i++)
        delta = Math.max(
          delta,
          Math.abs(decoded[0].data[i] - decoded[1].data[i]),
        );
      return delta;
    },
    [a.toString("base64"), b.toString("base64")],
  );
}

const options = Array.from({ length: 40 }, (_, i) => ({
  key: String(i),
  value: `Option ${String(i)}`,
}));
const response = Array.from(
  { length: 20 },
  (_, i) => `Response line ${String(i)}`,
).join("\n");

for (const stylesheet of [true, false]) {
  test(`native controls and their scrollbars keep the same paint in OS light and dark modes (stylesheet=${String(stylesheet)}, #550)`, async ({
    mount,
    page,
  }) => {
    if (!stylesheet) {
      await page.evaluate(() =>
        document
          .querySelectorAll('style, link[rel="stylesheet"]')
          .forEach((el) => el.remove()),
      );
    }
    const component = await mount(
      <div
        style={{
          width: 340,
          padding: 12,
          color: "#1f2937",
          background: "white",
          colorScheme: "light dark",
        }}
      >
        <Select
          options={options}
          value="0"
          label="Choose"
          onChange={() => {}}
        />
        <TextArea rows={2} value={response} label="Response" />
        <Slider min={0} max={100} value={50} />
      </div>,
    );
    const textarea = component.getByRole("textbox");
    await textarea.evaluate((el) => {
      el.scrollTop = 40;
    });
    expect(
      await textarea.evaluate((el) => el.scrollHeight > el.clientHeight),
    ).toBe(true);
    const paints: Buffer[] = [];
    for (const colorScheme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme });
      expect(
        await page.evaluate(
          (scheme) => matchMedia(`(prefers-color-scheme: ${scheme})`).matches,
          colorScheme,
        ),
      ).toBe(true);
      for (const role of ["combobox", "textbox", "slider"] as const) {
        await expect(component.getByRole(role)).toHaveCSS(
          "color-scheme",
          "light",
        );
      }
      paints.push(
        await component.screenshot({ animations: "disabled", caret: "hide" }),
      );
    }
    expect(
      await paintDelta(page, paints[0], paints[1]),
      "the same scrolled controls should paint identically in both OS themes",
    ).toBeLessThanOrEqual(2);

    // Customizable pickers are in-page and can be painted; a native OS popup
    // is outside Playwright's screenshots. Its scheme is checked above.
    if (await page.evaluate(() => CSS.supports("appearance", "base-select"))) {
      const select = component.getByRole("combobox");
      const pickerPaints: Buffer[] = [];
      for (const colorScheme of ["light", "dark"] as const) {
        await page.emulateMedia({ colorScheme });
        // Open by keyboard on both passes. Escape leaves keyboard modality
        // active, so mixing an initial mouse-open with a later one changes
        // the focused row's ring independently of the OS theme.
        await select.focus();
        await page.keyboard.press("Space");
        await expect
          .poll(() => select.evaluate((el) => el.matches(":open")))
          .toBe(true);
        expect(
          await select.evaluate(
            (el) => getComputedStyle(el, "::picker(select)").colorScheme,
          ),
        ).toBe("light");
        pickerPaints.push(
          await page.screenshot({
            animations: "disabled",
            caret: "hide",
          }),
        );
        await page.keyboard.press("Escape");
      }
      const delta = await paintDelta(page, pickerPaints[0], pickerPaints[1]);
      if (delta > 2) {
        await test.info().attach("picker-light", {
          body: pickerPaints[0],
          contentType: "image/png",
        });
        await test.info().attach("picker-dark", {
          body: pickerPaints[1],
          contentType: "image/png",
        });
      }
      expect(
        delta,
        "the open picker and its scrollbar should paint identically",
      ).toBeLessThanOrEqual(2);
    }
  });
}

test("the stylesheet pins the page scheme in both OS modes (#550)", async ({
  page,
  mount,
}) => {
  await mount(<div>Page scheme probe</div>);
  for (const colorScheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme });
    await expect(page.locator("html")).toHaveCSS("color-scheme", "light");
  }
});

// Positive control: prove the paint comparison can see OS-driven native color
// changes, rather than comparing two inert emulation settings.
test("the OS-theme paint probe detects an unpinned native surface (#550)", async ({
  mount,
  page,
}) => {
  await page.evaluate(() =>
    document
      .querySelectorAll('style, link[rel="stylesheet"]')
      .forEach((el) => el.remove()),
  );
  const component = await mount(
    <textarea
      aria-label="Unpinned probe"
      defaultValue={response}
      rows={2}
      style={{ colorScheme: "light dark" }}
    />,
  );
  await page.emulateMedia({ colorScheme: "light" });
  const light = await component.screenshot({
    animations: "disabled",
    caret: "hide",
  });
  await page.emulateMedia({ colorScheme: "dark" });
  const dark = await component.screenshot({
    animations: "disabled",
    caret: "hide",
  });
  expect(
    await paintDelta(page, light, dark),
    "the unpinned native surface should change with the OS theme",
  ).toBeGreaterThan(2);
});
