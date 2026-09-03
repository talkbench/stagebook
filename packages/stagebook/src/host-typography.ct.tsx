import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test, expect } from "@playwright/experimental-ct-react";
import { HeadingSurfaces } from "./components/testing/HeadingSurfaces";

/*
 * Stagebook renders headings on two surfaces: researcher markdown, styled
 * inline by `Markdown`/`Prompt`, and the host's own bare tags, styled by
 * `stagebook/host-typography`. A host writing `<h2>` beside a rendered `## `
 * expects one heading style, not two that resemble each other (#607).
 *
 * This runs in a real browser against the real shipped stylesheet, because
 * the claim is about what a participant SEES. An earlier version of this
 * guard compared the two files as text and was worthless: the literals it
 * read (`var(--stagebook-prompt-h1-weight, 700)`) are dead fallbacks — the
 * values that actually render are declared at :root in styles.css — and no
 * amount of source-matching can see source order, specificity, or whether
 * the stylesheet even parses. Retuning the live token, swapping the two CSS
 * rules so h1 silently lost its weight, and dropping a closing brace all
 * left it green. Everything here is measured post-cascade instead.
 *
 * The harness already loads styles.css (playwright/index.tsx), so the
 * markdown side renders under its real tokens; host-typography is injected
 * from disk rather than duplicated, so the file under test is the file that
 * ships. A malformed stylesheet therefore fails here too — the browser is
 * the parser.
 */

const HOST_TYPOGRAPHY_CSS = join(
  dirname(fileURLToPath(import.meta.url)),
  "host-typography.css",
);

const LEVELS = [1, 2, 3, 4, 5, 6] as const;

/*
 * Every computed property that decides how a heading's glyphs look. Compared
 * wholesale rather than one-by-one so a property added to one surface later
 * (letter-spacing, a font-feature setting) fails here instead of shipping as
 * a fresh mismatch — which is the exact shape of the defect this fixes.
 */
const TYPE_PROPERTIES = [
  "fontSize",
  "fontWeight",
  "fontFamily",
  "fontStyle",
  "fontStretch",
  "fontVariationSettings",
  "fontFeatureSettings",
  "letterSpacing",
  "wordSpacing",
  "lineHeight",
  "textTransform",
] as const;

for (const level of LEVELS) {
  test(`bare h${level} renders like a markdown h${level}`, async ({
    mount,
    page,
  }) => {
    const component = await mount(<HeadingSurfaces />);
    await page.addStyleTag({ path: HOST_TYPOGRAPHY_CSS });

    const typographyOf = (surface: string) =>
      component.locator(`[data-surface="${surface}"] h${level}`).evaluate(
        (el, properties) => {
          const computed = getComputedStyle(el) as unknown as Record<
            string,
            string
          >;
          return Object.fromEntries(properties.map((p) => [p, computed[p]]));
        },
        TYPE_PROPERTIES as unknown as string[],
      );

    expect(await typographyOf("bare")).toEqual(await typographyOf("markdown"));
  });
}

test("bare headings carry no margin, while markdown headings carry their own", async ({
  mount,
  page,
}) => {
  // The one deliberate divergence, pinned at every level so a later "make
  // them match" pass can't quietly take the spacing too. Markdown headings
  // space themselves because researcher prose is a self-contained block;
  // host headings don't, because the host's layout owns vertical rhythm
  // (hosts stack content with `space-y-*`-style utilities that would then
  // double up).
  const component = await mount(<HeadingSurfaces />);
  await page.addStyleTag({ path: HOST_TYPOGRAPHY_CSS });

  const marginsOf = (surface: string, level: number) =>
    component
      .locator(`[data-surface="${surface}"] h${level}`)
      .evaluate((el) => {
        const computed = getComputedStyle(el);
        return {
          top: parseFloat(computed.marginTop),
          bottom: parseFloat(computed.marginBottom),
        };
      });

  for (const level of LEVELS) {
    expect(await marginsOf("bare", level)).toEqual({ top: 0, bottom: 0 });

    const markdown = await marginsOf("markdown", level);
    expect(markdown.top).toBeGreaterThan(0);
    expect(markdown.bottom).toBeGreaterThan(0);
  }
});
