import { test, expect } from "@playwright/experimental-ct-react";
import { TrackedLink } from "./TrackedLink";
import { MockTrackedLink } from "../testing/MockTrackedLink";

interface LinkRecord {
  events: { type: string; timeAwaySeconds?: number }[];
  totalTimeAwaySeconds: number;
}

async function readLastRecord(
  component: import("@playwright/test").Locator,
): Promise<LinkRecord | null> {
  const text = await component
    .locator('[data-testid="save-log"]')
    .textContent();
  const saves = JSON.parse(text ?? "[]") as { value: unknown }[];
  if (saves.length === 0) return null;
  return saves[saves.length - 1].value as LinkRecord;
}

test("renders link with display text", async ({ mount }) => {
  const component = await mount(
    <TrackedLink
      name="signup"
      url="https://example.org/form"
      displayText="Complete the signup form"
      save={() => {}}
      getElapsedTime={() => 0}
      progressLabel="game_0_test"
    />,
  );
  await expect(component).toContainText("Complete the signup form");
  await expect(component.locator("a")).toHaveAttribute(
    "href",
    "https://example.org/form",
  );
});

test("link opens in new tab", async ({ mount }) => {
  const component = await mount(
    <TrackedLink
      name="signup"
      url="https://example.org/form"
      displayText="Open form"
      save={() => {}}
      getElapsedTime={() => 0}
      progressLabel="game_0_test"
    />,
  );
  await expect(component.locator("a")).toHaveAttribute("target", "_blank");
  await expect(component.locator("a")).toHaveAttribute("rel", /noreferrer/);
});

test("shows default helper text when helperText prop is omitted", async ({
  mount,
}) => {
  const component = await mount(
    <TrackedLink
      name="signup"
      url="https://example.org/form"
      displayText="Open form"
      save={() => {}}
      getElapsedTime={() => 0}
      progressLabel="game_0_test"
    />,
  );
  await expect(component).toContainText(
    "Link opens in a new tab. Return to this tab to complete the study.",
  );
});

test("renders custom helperText when provided", async ({ mount }) => {
  const component = await mount(
    <TrackedLink
      name="signup"
      url="https://example.org/form"
      displayText="Open form"
      helperText="You'll need about 5 minutes. Return here when done."
      save={() => {}}
      getElapsedTime={() => 0}
      progressLabel="game_0_test"
    />,
  );
  await expect(component).toContainText(
    "You'll need about 5 minutes. Return here when done.",
  );
  // Default text should not appear when custom helperText is provided
  await expect(component).not.toContainText(
    "Return to this tab to complete the study",
  );
});

test("empty helperText hides the helper line entirely", async ({ mount }) => {
  const component = await mount(
    <TrackedLink
      name="signup"
      url="https://example.org/form"
      displayText="Open form"
      helperText=""
      save={() => {}}
      getElapsedTime={() => 0}
      progressLabel="game_0_test"
    />,
  );
  await expect(component).not.toContainText("opens in a new tab");
  await expect(component.locator("p")).toHaveCount(0);
});

test("appends resolved params to URL", async ({ mount }) => {
  const component = await mount(
    <TrackedLink
      name="signup"
      url="https://example.org/form"
      displayText="Open form"
      resolvedParams={[
        { key: "source", value: "deliberation_lab" },
        { key: "id", value: "abc123" },
      ]}
      save={() => {}}
      getElapsedTime={() => 0}
      progressLabel="game_0_test"
    />,
  );
  await expect(component.locator("a")).toHaveAttribute(
    "href",
    "https://example.org/form?source=deliberation_lab&id=abc123",
  );
});

test("renders external link icon", async ({ mount }) => {
  const component = await mount(
    <TrackedLink
      name="signup"
      url="https://example.org/form"
      displayText="Open form"
      save={() => {}}
      getElapsedTime={() => 0}
      progressLabel="game_0_test"
    />,
  );
  await expect(component.locator("svg")).toBeVisible();
});

// ================================================================
// Event semantics + urlParam edge cases (issue #232)
// ================================================================
//
// These pin behavior previously only exercised by deliberation-empirica's
// cypress 01 omnibus: clicking emits a `click` event in the saved record;
// blur after a click + focus on return accumulate `totalTimeAwaySeconds`;
// urlParams resolved to empty strings still appear in the href (`&key=`)
// rather than being dropped; resolved values are URL-encoded.

test("clicking the link saves a record with a `click` event", async ({
  mount,
}) => {
  const component = await mount(
    <MockTrackedLink
      name="signup"
      url="https://example.org/form"
      displayText="Open form"
      getElapsedTime={() => 12.5}
      progressLabel="game_0_intro"
    />,
  );
  // Use dispatchEvent rather than .click() to fire the click handler
  // without the browser following the `target="_blank"` link out of the
  // test context.
  await component
    .locator("a")
    .evaluate((el) =>
      el.dispatchEvent(new MouseEvent("click", { bubbles: true })),
    );
  const record = await readLastRecord(component);
  if (!record) throw new Error("no save was emitted");
  expect(record.events.map((e) => e.type)).toEqual(["click"]);
  // Pre-blur, no time-away accumulation yet.
  expect(record.totalTimeAwaySeconds).toBe(0);
});

test("blur after click then focus accumulates totalTimeAwaySeconds", async ({
  mount,
  page,
}) => {
  const component = await mount(
    <MockTrackedLink
      name="signup"
      url="https://example.org/form"
      displayText="Open form"
      getElapsedTime={() => 0}
      progressLabel="game_0_intro"
    />,
  );

  // Click first — handleBlur is a no-op until lastClickRef has been set.
  await component
    .locator("a")
    .evaluate((el) =>
      el.dispatchEvent(new MouseEvent("click", { bubbles: true })),
    );
  // Confirm pre-blur state: totalTimeAwaySeconds is still 0 after just a click.
  let record = await readLastRecord(component);
  expect(record?.totalTimeAwaySeconds).toBe(0);

  // Dispatch a window blur (simulates user switching to the linked tab).
  await page.evaluate(() => window.dispatchEvent(new Event("blur")));
  // Wait briefly so the focus event sees a non-zero time-away delta.
  await page.waitForTimeout(75);
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));

  await expect
    .poll(async () => {
      const r = await readLastRecord(component);
      return r?.totalTimeAwaySeconds ?? 0;
    })
    .toBeGreaterThan(0.05);

  record = await readLastRecord(component);
  if (!record) throw new Error("no save");
  expect(record.events.map((e) => e.type)).toEqual(["click", "blur", "focus"]);
  // The focus event carries the per-trip timeAwaySeconds.
  const focusEvent = record.events.find((e) => e.type === "focus");
  expect(focusEvent?.timeAwaySeconds).toBeGreaterThan(0.05);
});

test("urlParam with empty value is rendered as `&key=` (not dropped)", async ({
  mount,
}) => {
  // Cypress 01 line 802 asserted href.endsWith("flag=") — i.e. an empty
  // resolved value still appears in the query string. Without this, a
  // host that resolves a missing variable to "" would silently drop the
  // param key, changing the URL contract.
  const component = await mount(
    <TrackedLink
      name="signup"
      url="https://example.org/form"
      displayText="Open form"
      resolvedParams={[
        { key: "id", value: "abc123" },
        { key: "flag", value: "" },
      ]}
      save={() => {}}
      getElapsedTime={() => 0}
      progressLabel="game_0_test"
    />,
  );
  await expect(component.locator("a")).toHaveAttribute(
    "href",
    "https://example.org/form?id=abc123&flag=",
  );
});

test("attributes-style values are URL-encoded into the href", async ({
  mount,
}) => {
  // Cypress 01 line 800 asserted href contains a URL-encoded
  // `attributes.name` value. The ref is resolved by the host before
  // it ever reaches TrackedLink — the contract here is that whatever
  // string the host hands us gets encoded correctly into the href.
  const nicknameRaw = "nickname_user with space&danger=1";
  const component = await mount(
    <TrackedLink
      name="signup"
      url="https://example.org/form"
      displayText="Open form"
      resolvedParams={[{ key: "participant", value: nicknameRaw }]}
      save={() => {}}
      getElapsedTime={() => 0}
      progressLabel="game_0_test"
    />,
  );
  // URLSearchParams encodes spaces as `+` and other reserved chars
  // percent-encoded — what matters is that the value is preserved
  // round-trippably (and the special chars don't bleed into the query
  // structure as separators).
  const href = await component.locator("a").getAttribute("href");
  if (!href) throw new Error("no href");
  // Exactly one query parameter — special chars in the value did NOT
  // create new params.
  const url = new URL(href);
  expect([...url.searchParams.keys()]).toEqual(["participant"]);
  expect(url.searchParams.get("participant")).toBe(nicknameRaw);
});

// ----------- UI polish -----------

test("polish: link darkens on hover", async ({ mount }) => {
  // Pre-polish: link color stayed at primary on hover, with no
  // affordance change. Now hover shifts to primary-hover (matches the
  // Button hover treatment).
  const component = await mount(
    <TrackedLink
      name="hover"
      url="https://example.org/"
      displayText="Hover me"
      save={() => {}}
      getElapsedTime={() => 0}
      progressLabel="t"
    />,
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

test("polish: link shows focus-visible ring on keyboard focus", async ({
  mount,
  page,
}) => {
  // Pre-polish: keyboard tab to the link → no ring. Now :focus-visible
  // shows the 2px focus-ring box-shadow (mouse clicks don't leave a
  // lingering ring after release).
  const component = await mount(
    <TrackedLink
      name="ring"
      url="https://example.org/"
      displayText="Tab to me"
      save={() => {}}
      getElapsedTime={() => 0}
      progressLabel="t"
    />,
  );
  const link = component.locator("a");
  const baseline = await link.evaluate((el) => getComputedStyle(el).boxShadow);
  await page.keyboard.press("Tab");
  await expect(link).toBeFocused();
  await expect
    .poll(() => link.evaluate((el) => getComputedStyle(el).boxShadow), {
      timeout: 1500,
    })
    .not.toBe(baseline);
});

test("polish: displayText is underlined (WCAG 1.4.1 — link not signalled by color alone)", async ({
  mount,
}) => {
  // Pre-polish: the <a> had textDecoration: "none" and relied
  // entirely on the primary-blue color to signal "this is a link"
  // — which fails for colorblind users and is a WCAG 1.4.1
  // ("Use of Color") violation. Polish: underline the visible
  // text. The external-link icon stays separate (decorative,
  // no underline on it).
  const component = await mount(
    <TrackedLink
      name="underline"
      url="https://example.org/"
      displayText="Visible text"
      save={() => {}}
      getElapsedTime={() => 0}
      progressLabel="t"
    />,
  );
  const decoration = await component
    .locator('a span:has-text("Visible text")')
    .evaluate((el) => getComputedStyle(el).textDecorationLine);
  expect(decoration).toContain("underline");
});

test("polish: prefers-reduced-motion drops the hover color transition", async ({
  mount,
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const component = await mount(
    <TrackedLink
      name="rm"
      url="https://example.org/"
      displayText="Reduced motion"
      save={() => {}}
      getElapsedTime={() => 0}
      progressLabel="t"
    />,
  );
  const link = component.locator("a");
  const transition = await link.evaluate(
    (el) => getComputedStyle(el).transition,
  );
  // "all 0s ease 0s" is the computed-value form of `transition: none`.
  expect(transition).toMatch(/all 0s|none/);
});
