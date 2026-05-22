import type { CSSProperties } from "react";
import { test, expect } from "@playwright/experimental-ct-react";
import { Markdown } from "./Markdown";
import { MockMarkdown } from "../testing/MockMarkdown";

test("renders markdown text", async ({ mount }) => {
  const component = await mount(<Markdown text="**Bold text**" />);
  await expect(component.locator("strong")).toContainText("Bold text");
});

test("renders links", async ({ mount }) => {
  const component = await mount(
    <Markdown text="[Click here](https://example.com)" />,
  );
  await expect(component.locator("a")).toHaveAttribute(
    "href",
    "https://example.com",
  );
});

test("passes through relative image paths without resolveURL", async ({
  mount,
}) => {
  const component = await mount(<Markdown text="![photo](images/test.png)" />);
  // Verify the src attribute is set correctly (image won't load — that's expected)
  await expect(component.locator("img")).toHaveAttribute(
    "src",
    "images/test.png",
  );
});

// -- Image URL encoding (#431) --
//
// Playwright CT can't serialize inline arrow-function props across
// the mount boundary, so these tests use `MockMarkdown` (a tiny
// wrapper that builds the `resolveURL` callback from a serializable
// `baseUrl` string) instead of <Markdown> directly.

test("resolveURL: does NOT double-encode %XX sequences in the host's already-encoded base", async ({
  mount,
}) => {
  // Regression for #431: VS Code's `asWebviewUri` returns URLs like
  // `https://file%2B.vscode-resource.vscode-cdn.net/...` where the
  // `%2B` is the encoded `+` in the synthetic host name. The old
  // `encodeURI(resolved)` re-encoded `%` → `%25` so `%2B` became
  // `%252B` and the image 404'd. The fix encodes the markdown PATH
  // (the part we know is raw) before passing to resolveURL, leaving
  // the host's already-encoded base alone.
  const component = await mount(
    <MockMarkdown
      text="![photo](images/test.png)"
      baseUrl="https://file%2B.example.cdn.net/dir/"
    />,
  );
  const src = await component.locator("img").getAttribute("src");
  // Exactly one `%2B`, never `%252B`.
  expect(src).toContain("%2B");
  expect(src).not.toContain("%252B");
});

test("resolveURL: encodes spaces in researcher-authored filenames", async ({
  mount,
}) => {
  // Markdown source is raw — researchers write paths like
  // `![](my pic.jpg)`. The fix encodes the path segment(s) before
  // resolving, so spaces (and other URI-special chars) become
  // `%20` rather than landing literally in the <img src>.
  const component = await mount(
    <MockMarkdown
      text="![photo](folder/my pic.jpg)"
      baseUrl="https://example.com/"
    />,
  );
  const src = await component.locator("img").getAttribute("src");
  expect(src).toBe("https://example.com/folder/my%20pic.jpg");
});

test("resolveURL: encodes ? and # in path (would otherwise split into query/fragment)", async ({
  mount,
}) => {
  // `encodeURI` (the previous approach) left `?` and `#` alone since
  // both have URI-special meaning. That's wrong here because the
  // markdown path IS a path, not a URI — `confused?.png` is a
  // filename. Per-segment `encodeURIComponent` catches these (#431).
  const component = await mount(
    <MockMarkdown
      text="![photo](confused?.png)"
      baseUrl="https://example.com/"
    />,
  );
  const src = await component.locator("img").getAttribute("src");
  expect(src).toBe("https://example.com/confused%3F.png");
});

test("resolveURL: preserves `/` separators when encoding the path", async ({
  mount,
}) => {
  // Encoding via `encodeURIComponent` on the whole path would mangle
  // the `/` separators. Per-segment encoding preserves them.
  const component = await mount(
    <MockMarkdown
      text="![photo](a/b/c/image.png)"
      baseUrl="https://example.com/"
    />,
  );
  const src = await component.locator("img").getAttribute("src");
  expect(src).toBe("https://example.com/a/b/c/image.png");
});

test("resolveURL: encodes `#` in path (would otherwise split into a fragment)", async ({
  mount,
}) => {
  // Parallel to the `?` case — `#` in a path means "this file is named
  // foo#bar.png", not "navigate to fragment bar". `encodeURI` left this
  // alone; per-segment `encodeURIComponent` catches it.
  const component = await mount(
    <MockMarkdown
      text="![photo](sketch#1.png)"
      baseUrl="https://example.com/"
    />,
  );
  const src = await component.locator("img").getAttribute("src");
  expect(src).toBe("https://example.com/sketch%231.png");
});

test("resolveURL: encodes `+` in path (close to the bug's root)", async ({
  mount,
}) => {
  // `+` is in `encodeURI`'s pass-through set (it's "reserved"), so the
  // previous approach left `+` literal in URLs. Most servers treat `+`
  // as space in query strings, which can cause real-world breakage for
  // a file literally named `version+1.png`. Per-segment
  // `encodeURIComponent` encodes to `%2B`, which is also the same
  // sequence at the root of #431 — exercised here to confirm we
  // produce exactly one `%2B`, never `%252B`.
  const component = await mount(
    <MockMarkdown
      text="![photo](version+1.png)"
      baseUrl="https://example.com/"
    />,
  );
  const src = await component.locator("img").getAttribute("src");
  expect(src).toBe("https://example.com/version%2B1.png");
});

test("resolveURL: encodes non-ASCII characters in path", async ({ mount }) => {
  // Researchers may name files in non-English alphabets (`café.png`,
  // `日本.png`, …). `encodeURIComponent` UTF-8-encodes these to
  // `%XX` sequences correctly.
  const component = await mount(
    <MockMarkdown text="![photo](café.png)" baseUrl="https://example.com/" />,
  );
  const src = await component.locator("img").getAttribute("src");
  expect(src).toBe("https://example.com/caf%C3%A9.png");
});

test("img renders with inline max-width: 100% and height: auto so it can't overflow the prompt (issue #211)", async ({
  mount,
}) => {
  const component = await mount(<Markdown text="![photo](images/test.png)" />);
  const { maxWidth, height } = await component
    .locator("img")
    .evaluate((el) => ({
      maxWidth: (el as HTMLElement).style.maxWidth,
      height: (el as HTMLElement).style.height,
    }));
  expect(maxWidth).toBe("100%");
  expect(height).toBe("auto");
});

test("renders headings", async ({ mount }) => {
  const component = await mount(<Markdown text="## Section Title" />);
  await expect(component.locator("h2")).toContainText("Section Title");
});

test("renders lists", async ({ mount }) => {
  const component = await mount(
    <Markdown text={"- Item A\n- Item B\n- Item C"} />,
  );
  await expect(component.locator("li")).toHaveCount(3);
});

test("renders GFM tables", async ({ mount }) => {
  const component = await mount(
    <Markdown text={"| A | B |\n|---|---|\n| 1 | 2 |"} />,
  );
  await expect(component.locator("table")).toBeVisible();
});

test("table uses collapsed borders and visible cell borders", async ({
  mount,
}) => {
  const component = await mount(
    <Markdown text={"| A | B |\n|---|---|\n| 1 | 2 |"} />,
  );
  const borderCollapse = await component
    .locator("table")
    .evaluate((el) => getComputedStyle(el).borderCollapse);
  expect(borderCollapse).toBe("collapse");

  const cellBorderWidth = await component
    .locator("td")
    .first()
    .evaluate((el) => parseFloat(getComputedStyle(el).borderTopWidth));
  expect(cellBorderWidth).toBeGreaterThan(0);
});

// ---------------------------------------------------------------------------
// Inline table styling — issue #214
//
// Tables were historically styled via styles.css, which loses on hosts that
// don't import the stylesheet. These tests assert the styles are now INLINE
// (read el.style.*, not getComputedStyle) so a dropped rule or unloaded
// sheet can't regress table rendering.
// ---------------------------------------------------------------------------

test("table has inline border-collapse: collapse", async ({ mount }) => {
  const component = await mount(
    <Markdown text={"| A | B |\n|---|---|\n| 1 | 2 |"} />,
  );
  const borderCollapse = await component
    .locator("table")
    .evaluate((el) => (el as HTMLElement).style.borderCollapse);
  expect(borderCollapse).toBe("collapse");
});

test("td has inline border", async ({ mount }) => {
  const component = await mount(
    <Markdown text={"| A | B |\n|---|---|\n| 1 | 2 |"} />,
  );
  const borderStyle = await component
    .locator("td")
    .first()
    .evaluate((el) => (el as HTMLElement).style.border);
  // style.border is a shorthand; inline value should be non-empty
  expect(borderStyle.length).toBeGreaterThan(0);
});

test("th has inline background and border", async ({ mount }) => {
  const component = await mount(
    <Markdown text={"| A | B |\n|---|---|\n| 1 | 2 |"} />,
  );
  const { border, background } = await component
    .locator("th")
    .first()
    .evaluate((el) => ({
      border: (el as HTMLElement).style.border,
      background: (el as HTMLElement).style.backgroundColor,
    }));
  expect(border.length).toBeGreaterThan(0);
  expect(background.length).toBeGreaterThan(0);
});

test("table inline styles survive an aggressive host CSS reset (issue #214)", async ({
  mount,
}) => {
  // Mirrors the "inline styles beat a host CSS reset" pattern for tables.
  // A Tailwind-style preflight routinely zeroes table borders and
  // collapses cell padding. Inline styles win on specificity without
  // !important.
  const resetCSS = `
    table { border-collapse: separate; border-spacing: 2px; }
    th, td { border: 0; padding: 0; background: transparent; }
    th { font-weight: 400; }
  `;
  const component = await mount(
    <div>
      <style dangerouslySetInnerHTML={{ __html: resetCSS }} />
      <Markdown text={"| A | B |\n|---|---|\n| 1 | 2 |"} />
    </div>,
  );

  // Table still collapses borders
  const borderCollapse = await component
    .locator("table")
    .evaluate((el) => getComputedStyle(el).borderCollapse);
  expect(borderCollapse).toBe("collapse");

  // td still has a visible border
  const borderWidth = await component
    .locator("td")
    .first()
    .evaluate((el) => parseFloat(getComputedStyle(el).borderTopWidth));
  expect(borderWidth).toBeGreaterThan(0);

  // td still has padding
  const padding = await component
    .locator("td")
    .first()
    .evaluate((el) => parseFloat(getComputedStyle(el).paddingTop));
  expect(padding).toBeGreaterThan(0);
});

test("renders GFM strikethrough", async ({ mount }) => {
  const component = await mount(<Markdown text="~~crossed out~~" />);
  await expect(component.locator("del")).toContainText("crossed out");
});

// ---------------------------------------------------------------------------
// Inline styling — issue #33
//
// These tests verify that markdown elements ship with default visual
// hierarchy as inline styles, NOT as a stylesheet rule the host might
// override or never load. The whole point is that prompts render
// correctly even when the host applies an aggressive CSS reset.
// ---------------------------------------------------------------------------

test("h1 renders with default size larger than body text", async ({
  mount,
}) => {
  const component = await mount(<Markdown text={"# Big\n\nSmall body."} />);
  const h1FontSize = await component
    .locator("h1")
    .evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
  const pFontSize = await component
    .locator("p")
    .evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
  expect(h1FontSize).toBeGreaterThan(pFontSize);
});

test("h1 > h2 > h3 > h4 > body in font size", async ({ mount }) => {
  const component = await mount(
    <Markdown text={"# H1\n\n## H2\n\n### H3\n\n#### H4\n\nBody paragraph."} />,
  );
  const sizes = await Promise.all(
    ["h1", "h2", "h3", "h4", "p"].map((sel) =>
      component
        .locator(sel)
        .evaluate((el) => parseFloat(getComputedStyle(el).fontSize)),
    ),
  );
  // Strictly decreasing: h1 > h2 > h3 > h4 > p
  for (let i = 0; i < sizes.length - 1; i++) {
    expect(sizes[i]).toBeGreaterThan(sizes[i + 1]);
  }
});

test("h1 has bold weight", async ({ mount }) => {
  const component = await mount(<Markdown text="# Heading" />);
  const weight = await component
    .locator("h1")
    .evaluate((el) => parseInt(getComputedStyle(el).fontWeight, 10));
  expect(weight).toBeGreaterThanOrEqual(700);
});

test("strong renders with bold weight (matches browser default)", async ({
  mount,
}) => {
  const component = await mount(<Markdown text="Some **bold** text" />);
  const weight = await component
    .locator("strong")
    .evaluate((el) => parseInt(getComputedStyle(el).fontWeight, 10));
  expect(weight).toBe(700);
});

test("em renders with italic style (matches browser default)", async ({
  mount,
}) => {
  const component = await mount(<Markdown text="Some *italic* text" />);
  const style = await component
    .locator("em")
    .evaluate((el) => getComputedStyle(el).fontStyle);
  expect(style).toBe("italic");
});

test("ul renders with disc bullets, not none", async ({ mount }) => {
  const component = await mount(<Markdown text={"- alpha\n- beta\n- gamma"} />);
  const listStyleType = await component
    .locator("ul")
    .evaluate((el) => getComputedStyle(el).listStyleType);
  expect(listStyleType).toBe("disc");
});

test("ol renders with decimal numbering", async ({ mount }) => {
  const component = await mount(
    <Markdown text={"1. first\n2. second\n3. third"} />,
  );
  const listStyleType = await component
    .locator("ol")
    .evaluate((el) => getComputedStyle(el).listStyleType);
  expect(listStyleType).toBe("decimal");
});

test("nested ol uses flat decimal numbering at every level", async ({
  mount,
}) => {
  // Locks in the intentional regression from the previous styles.css
  // implementation, which used CSS counters to render nested ordered
  // lists as 1., 1.1, 1.1.1. The new inline approach can't express
  // counter-based nested numbering (no ::before in inline styles), so
  // every level uses decimal "1., 2., 3.". If a researcher needs
  // counter-style nesting they can override --stagebook-prompt-* via
  // a host stylesheet that targets `.stagebook-markdown-* ol > li::before`
  // (each Markdown instance now carries a useId-generated class).
  const component = await mount(
    <Markdown text={"1. outer\n   1. inner\n   2. inner two"} />,
  );
  const outer = await component
    .locator("ol")
    .first()
    .evaluate((el) => getComputedStyle(el).listStyleType);
  const inner = await component
    .locator("ol ol")
    .first()
    .evaluate((el) => getComputedStyle(el).listStyleType);
  expect(outer).toBe("decimal");
  expect(inner).toBe("decimal");
});

test("links render with the stagebook-link color (default blue)", async ({
  mount,
}) => {
  const component = await mount(
    <Markdown text="[click](https://example.com)" />,
  );
  const color = await component
    .locator("a")
    .evaluate((el) => getComputedStyle(el).color);
  // Default is #2563eb = rgb(37, 99, 235)
  expect(color).toBe("rgb(37, 99, 235)");
});

test("blockquote has left border and background", async ({ mount }) => {
  const component = await mount(<Markdown text="> A quoted line." />);
  const styles = await component.locator("blockquote").evaluate((el) => {
    const cs = getComputedStyle(el);
    return {
      borderLeftWidth: cs.borderLeftWidth,
      borderLeftStyle: cs.borderLeftStyle,
      backgroundColor: cs.backgroundColor,
    };
  });
  // 0.25rem = 4px (assuming 16px root)
  expect(parseFloat(styles.borderLeftWidth)).toBeGreaterThan(0);
  expect(styles.borderLeftStyle).toBe("solid");
  expect(styles.backgroundColor).not.toBe("rgba(0, 0, 0, 0)");
});

test("CSS variable override changes h1 size", async ({ mount }) => {
  // Wrap in a div that sets the variable; the inline-styled h1 should pick
  // it up via var(--stagebook-prompt-h1-size, ...). This proves the override
  // mechanism works on hosts that don't ship the styles.css file.
  // Use an absolute unit so the assertion isn't sensitive to the host's
  // root font-size.
  const component = await mount(
    <div style={{ "--stagebook-prompt-h1-size": "48px" } as CSSProperties}>
      <Markdown text="# Override me" />
    </div>,
  );
  const fontSize = await component
    .locator("h1")
    .evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
  expect(fontSize).toBe(48);
});

test("CSS variable override changes link color", async ({ mount }) => {
  const component = await mount(
    <div style={{ "--stagebook-link": "rgb(255, 0, 0)" } as CSSProperties}>
      <Markdown text="[red link](https://example.com)" />
    </div>,
  );
  const color = await component
    .locator("a")
    .evaluate((el) => getComputedStyle(el).color);
  expect(color).toBe("rgb(255, 0, 0)");
});

test("inline styles beat a host CSS reset (the load-bearing claim)", async ({
  mount,
}) => {
  // The whole point of inline styles: a host stylesheet that resets
  // h1 { font-size: 16px } should LOSE to our inline style. This is what
  // fails on hosts that ship Tailwind preflight or normalize.css and is
  // the core motivation for issue #33.
  //
  // We mount Markdown alongside an aggressive <style> tag that targets
  // h1/p/blockquote with the same kind of selector a host reset would.
  // It does NOT use !important — so this test only passes if Stagebook's
  // inline styles win on specificity grounds (which they always do
  // against selector-based rules). If someone refactors back to a
  // stylesheet-based approach, this test catches it.
  const resetCSS = `
    h1, h2, h3, h4 { font-size: 16px; font-weight: 400; }
    p { font-size: 16px; }
    blockquote { background: transparent; border-left: 0; }
  `;
  const component = await mount(
    <div>
      <style dangerouslySetInnerHTML={{ __html: resetCSS }} />
      <Markdown text={"# Big heading\n\nBody.\n\n> Quote"} />
    </div>,
  );

  // h1 should still be larger than 16px (default 1.875rem ≈ 30px)
  const h1Size = await component
    .locator("h1")
    .evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
  expect(h1Size).toBeGreaterThan(16);

  // h1 should still be bold (default 700), not the reset's 400
  const h1Weight = await component
    .locator("h1")
    .evaluate((el) => parseInt(getComputedStyle(el).fontWeight, 10));
  expect(h1Weight).toBeGreaterThanOrEqual(700);

  // blockquote should still have a left border, not the reset's 0
  const borderWidth = await component
    .locator("blockquote")
    .evaluate((el) => parseFloat(getComputedStyle(el).borderLeftWidth));
  expect(borderWidth).toBeGreaterThan(0);
});

test("CSS variable override changes blockquote background", async ({
  mount,
}) => {
  const component = await mount(
    <div
      style={{ "--stagebook-blockquote-bg": "rgb(0, 255, 0)" } as CSSProperties}
    >
      <Markdown text="> green" />
    </div>,
  );
  const bg = await component
    .locator("blockquote")
    .evaluate((el) => getComputedStyle(el).backgroundColor);
  expect(bg).toBe("rgb(0, 255, 0)");
});

// ---------------------------------------------------------------------------
// <hr> and <pre> — issue #215
//
// `---` in markdown renders as <hr>, which Tailwind preflight and similar
// resets collapse with `border: 0`. Fenced code blocks wrap in <pre>; with
// no handler they render as naked pre-formatted text (no background, no
// monospace font, no overflow scroll). These tests lock in the inline
// styling that makes both render portably on any host.
// ---------------------------------------------------------------------------

test("hr renders with visible top border (survives UA stripping)", async ({
  mount,
}) => {
  const component = await mount(<Markdown text={"above\n\n---\n\nbelow"} />);
  const borderTopWidth = await component
    .locator("hr")
    .evaluate((el) => parseFloat(getComputedStyle(el).borderTopWidth));
  expect(borderTopWidth).toBeGreaterThan(0);
});

test("hr survives a host CSS reset that sets hr { border: 0 }", async ({
  mount,
}) => {
  // Mirrors the "inline styles beat a host CSS reset" pattern: Tailwind
  // preflight ships `hr { border: 0 }` which collapses the default UA
  // border. Our inline border-top must win on specificity.
  const resetCSS = `hr { border: 0; }`;
  const component = await mount(
    <div>
      <style dangerouslySetInnerHTML={{ __html: resetCSS }} />
      <Markdown text={"above\n\n---\n\nbelow"} />
    </div>,
  );
  const borderTopWidth = await component
    .locator("hr")
    .evaluate((el) => parseFloat(getComputedStyle(el).borderTopWidth));
  expect(borderTopWidth).toBeGreaterThan(0);
});

test("fenced code block renders with background, monospace font, and horizontal overflow", async ({
  mount,
}) => {
  const component = await mount(<Markdown text={"```js\nconst x = 1;\n```"} />);
  const styles = await component.locator("pre").evaluate((el) => {
    const cs = getComputedStyle(el);
    return {
      backgroundColor: cs.backgroundColor,
      fontFamily: cs.fontFamily,
      overflowX: cs.overflowX,
    };
  });
  expect(styles.backgroundColor).not.toBe("rgba(0, 0, 0, 0)");
  expect(styles.backgroundColor).not.toBe("transparent");
  expect(styles.fontFamily.toLowerCase()).toMatch(/mono|menlo|consolas|sfmono/);
  expect(styles.overflowX).toBe("auto");
});

test("fenced code block: inner <code> background is explicitly transparent (defeats host code-styling resets)", async ({
  mount,
}) => {
  // The <pre> carries the chip styling; the inner <code class="language-*">
  // must explicitly clear background + padding so host CSS that paints
  // behind every <code> (e.g. VS Code's webview applies
  // `code { background-color: var(--vscode-textPreformat-background) }`)
  // doesn't render a per-line tint behind the text inside our chip.
  // Asserts inline-style values, which beat any host CSS rule.
  //
  // Browsers normalize `background: transparent` differently when read
  // back from `el.style.background`: chromium/firefox keep
  // "transparent", webkit normalizes to "none". Both are equivalent
  // (zero painting) per the CSS background shorthand spec — accept
  // either (#419).
  const component = await mount(<Markdown text={"```js\nconst x = 1;\n```"} />);
  const innerCodeInline = await component
    .locator("pre > code")
    .evaluate((el) => ({
      background: (el as HTMLElement).style.background,
      padding: (el as HTMLElement).style.padding,
    }));
  expect(["transparent", "none"]).toContain(innerCodeInline.background);
  expect(innerCodeInline.padding).toBe("0px");
});

test("fenced code block survives a host CSS rule that paints behind <code> (#350 polish regression)", async ({
  mount,
}) => {
  // Regression for the VS Code webview bug where the inner <code>
  // showed a per-line tint behind the text. The hostile host CSS
  // simulated here paints bright red behind every <code> element
  // (matching what VS Code's webview does at lower intensity via
  // `--vscode-textPreformat-background`). Without our inline
  // transparent override, the inner code in a fenced block would
  // render red, making the outer chip look striped. Not using
  // `!important` because the actual host CSS that motivated this
  // (VS Code's webview defaults) is a plain non-!important rule.
  const component = await mount(
    <div>
      <style>{`code { background-color: rgb(255, 0, 0); padding: 4px; }`}</style>
      <Markdown text={"```js\nconst x = 1;\n```"} />
    </div>,
  );
  const innerCodeBg = await component
    .locator("pre > code")
    .evaluate((el) => getComputedStyle(el).backgroundColor);
  // Inline `background: transparent` beats the class selector (inline >
  // author class without !important). Expect transparent.
  expect(innerCodeBg).not.toBe("rgb(255, 0, 0)");
});

test("inline code renders as a styled chip with background and padding", async ({
  mount,
}) => {
  const component = await mount(<Markdown text="Use `npm test` to run." />);
  const styles = await component.locator("code").evaluate((el) => {
    const cs = getComputedStyle(el);
    return {
      backgroundColor: cs.backgroundColor,
      fontFamily: cs.fontFamily,
    };
  });
  expect(styles.backgroundColor).not.toBe("rgba(0, 0, 0, 0)");
  expect(styles.backgroundColor).not.toBe("transparent");
  expect(styles.fontFamily.toLowerCase()).toMatch(/mono|menlo|consolas|sfmono/);
});

// Issue #213: GFM task-list checkboxes are disabled <input type="checkbox">
// emitted by remark-gfm. They need the same inline primary-fill + check
// SVG as RadioGroup/CheckboxGroup so they render on hosts without
// styles.css loaded. Focus ring not needed (the inputs are disabled).
test("GFM task-list checkbox has inline base + check SVG when checked", async ({
  mount,
}) => {
  const component = await mount(<Markdown text={"- [x] done\n- [ ] todo"} />);
  const checked = component.locator('input[type="checkbox"]').first();
  const unchecked = component.locator('input[type="checkbox"]').nth(1);

  const checkedStyle = await checked.evaluate((el) => ({
    appearance: (el as HTMLElement).style.appearance,
    backgroundColor: (el as HTMLElement).style.backgroundColor,
    backgroundImage: (el as HTMLElement).style.backgroundImage,
  }));
  expect(checkedStyle.appearance).toBe("none");
  expect(checkedStyle.backgroundColor).toContain("--stagebook-primary");
  expect(checkedStyle.backgroundImage).toContain("data:image/svg+xml");

  const uncheckedStyle = await unchecked.evaluate((el) => ({
    appearance: (el as HTMLElement).style.appearance,
    backgroundColor: (el as HTMLElement).style.backgroundColor,
    backgroundImage: (el as HTMLElement).style.backgroundImage,
  }));
  expect(uncheckedStyle.appearance).toBe("none");
  expect(uncheckedStyle.backgroundColor).toContain("--stagebook-surface");
  expect(uncheckedStyle.backgroundImage).toBe("");
});

// ----------- UI polish (#350 sweep) -----------

test("link darkens on hover via --stagebook-link-hover", async ({ mount }) => {
  // Polish: links previously had no hover state. The scoped <style>
  // block now darkens the link color on hover. We can't observe
  // :hover via inline style; we read computed color before vs after
  // .hover().
  const component = await mount(
    <Markdown text="[click](https://example.com)" />,
  );
  const link = component.locator("a");
  const before = await link.evaluate((el) => getComputedStyle(el).color);
  await link.hover();
  await expect
    .poll(() => link.evaluate((el) => getComputedStyle(el).color), {
      timeout: 1500,
    })
    .not.toBe(before);
});

test("link gets focus ring on keyboard focus (:focus-visible)", async ({
  mount,
  page,
}) => {
  // Polish: links had no focus indicator (WCAG 2.4.7). Tabbing to a
  // link now shows an outline from the scoped <style> block.
  const component = await mount(
    <Markdown text="[click](https://example.com)" />,
  );
  const link = component.locator("a");
  const baseline = await link.evaluate(
    (el) => getComputedStyle(el).outlineWidth,
  );
  await page.keyboard.press("Tab");
  await expect(link).toBeFocused();
  await expect
    .poll(() => link.evaluate((el) => getComputedStyle(el).outlineWidth), {
      timeout: 1500,
    })
    .not.toBe(baseline);
});

test("default markdown link has no target attribute (no rel rewrite triggers)", async ({
  mount,
}) => {
  // Confirms the *baseline* of the rel-rewrite contract: a vanilla
  // markdown link never gets target=_blank from react-markdown, so
  // it shouldn't get a synthetic rel either. The actual rel-rewrite
  // logic (computeSafeRel) is unit-tested in Markdown.test.ts — it
  // can't be driven from markdown source without wiring rehype-raw.
  const component = await mount(<Markdown text="[ext](https://example.com)" />);
  const target = await component
    .locator("a")
    .evaluate((el) => (el as HTMLAnchorElement).target);
  const rel = await component
    .locator("a")
    .evaluate((el) => (el as HTMLAnchorElement).rel);
  expect(target).toBe("");
  expect(rel).toBe("");
});

test("pre is in the tab order (tabIndex=0) so keyboard users can scroll", async ({
  mount,
}) => {
  // Polish: <pre> has overflowX: auto but previously no tabIndex,
  // so keyboard users couldn't scroll long lines (WCAG 2.1.1).
  // tabIndex={0} puts it in the document tab order.
  const component = await mount(<Markdown text={"```js\nconst x = 1;\n```"} />);
  const pre = component.locator("pre");
  const tabIndex = await pre.evaluate((el) => (el as HTMLElement).tabIndex);
  expect(tabIndex).toBe(0);
});

test("pre shows focus ring on keyboard focus", async ({ mount, page }) => {
  const component = await mount(<Markdown text={"```js\nconst x = 1;\n```"} />);
  const pre = component.locator("pre");
  const baseline = await pre.evaluate(
    (el) => getComputedStyle(el).outlineWidth,
  );
  await page.keyboard.press("Tab");
  await expect(pre).toBeFocused();
  await expect
    .poll(() => pre.evaluate((el) => getComputedStyle(el).outlineWidth), {
      timeout: 1500,
    })
    .not.toBe(baseline);
});

test("h5 and h6 render with their configured sizes", async ({ mount }) => {
  // Polish: h5/h6 previously had no handlers and collapsed to body
  // text size on hosts that strip the UA stylesheet. They now read
  // from --stagebook-prompt-h5-size / -h6-size with sensible
  // defaults.
  const component = await mount(<Markdown text={"##### Five\n\n###### Six"} />);
  const h5 = await component
    .locator("h5")
    .evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
  const h6 = await component
    .locator("h6")
    .evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
  // Default h5 is 1rem = 16px, h6 is 0.875rem = 14px.
  expect(h5).toBeGreaterThanOrEqual(15);
  expect(h6).toBeGreaterThanOrEqual(13);
  // h5 should be at least as large as h6 (hierarchy preserved).
  expect(h5).toBeGreaterThanOrEqual(h6);
});

test("table is wrapped in a horizontal-scroll container on narrow viewports", async ({
  mount,
}) => {
  // Polish: wide GFM tables used to overflow the prompt container on
  // narrow viewports. The table is now wrapped in <div overflowX: auto>
  // so the table can scroll independently while the prompt stays in
  // bounds.
  const component = await mount(
    <Markdown text={"| A | B | C |\n|---|---|---|\n| 1 | 2 | 3 |"} />,
  );
  // The <table>'s immediate parent should be a div with overflowX: auto.
  const parentOverflowX = await component.locator("table").evaluate((el) => {
    const parent = el.parentElement;
    return parent ? getComputedStyle(parent).overflowX : null;
  });
  expect(parentOverflowX).toBe("auto");
});

test("table rows have zebra striping (even rows get a tint)", async ({
  mount,
}) => {
  // Polish: tables previously had no zebra striping. Body rows now
  // alternate background via tr:nth-child(even) in the scoped style
  // block, matching the GitHub / Notion consensus.
  const component = await mount(
    <Markdown
      text={"| A | B |\n|---|---|\n| 1 | a |\n| 2 | b |\n| 3 | c |\n| 4 | d |"}
    />,
  );
  // First body row (nth-child(1) = odd) → no tint.
  // Second body row (nth-child(2) = even) → tint.
  const evenTd = await component
    .locator("tbody tr:nth-child(2) td")
    .first()
    .evaluate((el) => getComputedStyle(el).backgroundColor);
  const oddTd = await component
    .locator("tbody tr:nth-child(1) td")
    .first()
    .evaluate((el) => getComputedStyle(el).backgroundColor);
  expect(evenTd).not.toBe(oddTd);
});

test("table rows darken on hover", async ({ mount }) => {
  const component = await mount(
    <Markdown text={"| A | B |\n|---|---|\n| 1 | 2 |"} />,
  );
  const td = component.locator("tbody td").first();
  const before = await td.evaluate(
    (el) => getComputedStyle(el).backgroundColor,
  );
  await component.locator("tbody tr").first().hover();
  await expect
    .poll(() => td.evaluate((el) => getComputedStyle(el).backgroundColor), {
      timeout: 1500,
    })
    .not.toBe(before);
});

test("blockquote uses muted text color (not body text)", async ({ mount }) => {
  // Polish: blockquote text is now muted so the quote visually steps
  // back from body text. Previously it inherited body color, making
  // the quote treatment depend on the (faint) bg + border alone.
  // Render a paragraph BEFORE the blockquote so the body comparison
  // doesn't accidentally pick up the <p> wrapped inside the quote.
  const component = await mount(
    <Markdown text={"A body paragraph.\n\n> A quoted line."} />,
  );
  const blockquoteColor = await component
    .locator("blockquote")
    .evaluate((el) => getComputedStyle(el).color);
  // The first <p> in the document is the body paragraph, not the
  // one nested in the blockquote. Scope explicitly anyway to be
  // explicit about intent.
  const bodyColor = await component
    .locator(":scope > div > p")
    .first()
    .evaluate((el) => getComputedStyle(el).color);
  // The default mute is #6b7280, body is #1f2937. Whatever the
  // exact computed values, they should differ.
  expect(blockquoteColor).not.toBe(bodyColor);
});

test("list markers are muted (not body text color)", async ({ mount }) => {
  // Polish: list markers now read as structure, not weight-competing
  // with body text. Asserted via ::marker color in the scoped style.
  // ::marker isn't fully directly inspectable via getComputedStyle on
  // the <li>, so we read the pseudo-element via getComputedStyle.
  const component = await mount(
    <Markdown text="- alpha\n- bravo\n- charlie" />,
  );
  const markerColor = await component
    .locator("li")
    .first()
    .evaluate((el) => getComputedStyle(el, "::marker").color);
  // Default --stagebook-text-muted is #6b7280 = rgb(107, 114, 128).
  // We don't pin the exact rgb (browsers may compute differently);
  // just assert it's not the body color (#1f2937 = rgb(31, 41, 55)).
  expect(markerColor).not.toBe("rgb(31, 41, 55)");
});

test("images get loading=lazy + decoding=async", async ({ mount }) => {
  // Polish: images in long-form prompts now defer offscreen loads,
  // freeing bandwidth for above-the-fold content.
  const component = await mount(
    <Markdown text="![alt text](https://example.com/i.png)" />,
  );
  const img = component.locator("img");
  const loading = await img.evaluate((el) => (el as HTMLImageElement).loading);
  const decoding = await img.evaluate(
    (el) => (el as HTMLImageElement).decoding,
  );
  expect(loading).toBe("lazy");
  expect(decoding).toBe("async");
});

test("two Markdown instances on the same page have unique per-instance classes", async ({
  mount,
}) => {
  // Polish: the previous `id="markdown"` was a duplicate-id bug on
  // any page rendering multiple Markdown blocks (e.g. a stage with
  // multiple Prompts). Now each instance has a useId()-backed class.
  const component = await mount(
    <div>
      <Markdown text="alpha" />
      <Markdown text="bravo" />
    </div>,
  );
  // Find both root divs (the className-bearing wrapper).
  const classes = await component
    .locator('[class^="stagebook-markdown-"]')
    .evaluateAll((els) => els.map((el) => el.className));
  expect(classes).toHaveLength(2);
  expect(classes[0]).not.toBe(classes[1]);
});
