// Focus-indicator regression gate (issue #610).
//
// Every Stagebook control draws its own focus indicator, and until #610 they
// all shared one broken pattern: `outline: none` plus a 25%-alpha box-shadow
// ring. That failed twice —
//
//   1. The translucent ring sat at 1.03:1 against the gray-300 border it is
//      drawn beside, well under the 3:1 WCAG 1.4.11 floor for a non-text
//      indicator. (The palette gate in styles.test.ts couldn't see it: a
//      translucent token has no opaque hex to assert against.)
//   2. forced-colors mode drops `box-shadow` while honoring `outline`, so
//      pairing the ring with `outline: none` removed the indicator entirely
//      for the users who turned high contrast on — a control kept its focus
//      ring right up until Stagebook styled it.
//
// This gate holds both halves for every focusable primitive at once, because
// the defect was never in one component: it was one pattern copied sixteen
// times. See src/components/focusRing.ts for the shared treatment.
import { test, expect } from "@playwright/experimental-ct-react";
import type { Locator, Page } from "playwright/test";
import type React from "react";
import type { ReactNode } from "react";

import { RadioGroup } from "./form/RadioGroup";
import { CheckboxGroup } from "./form/CheckboxGroup";
import { Select } from "./form/Select";
import { TextArea } from "./form/TextArea";
import { Slider } from "./form/Slider";
import { Button } from "./form/Button";
import { RefreshGlyph } from "./testing/RefreshGlyph";
import { Markdown } from "./form/Markdown";
import { MockListSorter } from "./testing/MockListSorter";
import { MockTimeline } from "./testing/MockTimeline";
import { MockMediaPlayer } from "./testing/MockMediaPlayer";
import { TrackedLink } from "./elements/TrackedLink";

const options = [
  { key: "a", value: "Option A" },
  { key: "b", value: "Option B" },
];

/**
 * A focusable primitive plus where its indicator lands.
 *
 * `target` is the element that takes focus. `ring` is the element the
 * indicator is painted on — the same node everywhere except Slider, whose
 * real focus target is an invisible range input while the participant sees
 * the thumb.
 *
 * `kind` distinguishes the two legitimate treatments: `halo` for box-model
 * controls (a two-layer box-shadow, page-colored spacer under an opaque
 * accent ring, so the ring never abuts the control's own edge), `outline`
 * for inline text (a link inside a paragraph, where a box-shadow would wrap
 * the text fragment). Both must survive forced-colors.
 */
interface Case {
  name: string;
  node: ReactNode;
  target: string;
  ring?: string;
  kind: "halo" | "outline";
}

const cases: Case[] = [
  {
    // Deliberately the accent-filled variant. A secondary Button would
    // exercise the same CSS, but the primary is the control the halo exists
    // for: against its own fill a flat opaque ring is 1.00:1, and only the
    // page-colored spacer makes the indicator visible at all.
    name: "Button (primary)",
    node: <Button primary>Continue</Button>,
    target: "button",
    kind: "halo",
  },
  {
    // Icon-only (#622). Focus visibility matters more here than on a text
    // button: there is no underline or colour shift to lean on, so the
    // halo is the entire indicator. Secondary, because the bordered case
    // is where the old translucent ring measured 1.03:1.
    name: "Button (icon, secondary)",
    node: (
      <Button icon aria-label="Refresh devices" primary={false}>
        <RefreshGlyph />
      </Button>
    ),
    target: "button",
    kind: "halo",
  },
  {
    name: "Select",
    node: (
      <Select options={options} onChange={() => {}} label="Choose an option" />
    ),
    target: "select",
    kind: "halo",
  },
  {
    name: "TextArea",
    node: <TextArea value="Some typed response" ariaLabel="Your answer" />,
    target: "textarea",
    kind: "halo",
  },
  {
    // Checked, so the radio's fill is the accent — same reasoning as the
    // primary Button above.
    name: "RadioGroup (checked)",
    node: (
      <RadioGroup
        options={options}
        value="a"
        onChange={() => {}}
        label="Pick one"
      />
    ),
    target: 'input[type="radio"]',
    kind: "halo",
  },
  {
    name: "CheckboxGroup",
    node: (
      <CheckboxGroup
        options={options}
        value={["a"]}
        onChange={() => {}}
        label="Select all"
      />
    ),
    target: 'input[type="checkbox"]',
    kind: "halo",
  },
  {
    name: "Slider",
    node: <Slider min={0} max={100} interval={1} value={50} />,
    target: 'input[type="range"]',
    ring: '[data-testid="slider-thumb"]',
    kind: "halo",
  },
  {
    name: "ListSorter",
    node: <MockListSorter items={["Alpha", "Bravo", "Charlie"]} />,
    target: '[data-testid="draggable-0"]',
    kind: "halo",
  },
  {
    name: "TrackedLink",
    node: (
      <TrackedLink
        name="link"
        url="https://example.org/form"
        displayText="Open the linked form"
        save={() => {}}
        getElapsedTime={() => 0}
        progressLabel="game_0_gate"
      />
    ),
    target: "a",
    kind: "halo",
  },
  {
    name: "Markdown link",
    node: <Markdown text="Some text and a [link](https://example.org)." />,
    target: "a",
    kind: "outline",
  },
  {
    name: "Markdown code block",
    node: <Markdown text={"```\nconst x = 1;\n```"} />,
    target: "pre",
    kind: "outline",
  },
  {
    name: "Timeline container",
    node: (
      <MockTimeline
        source="coding_video"
        playerName="coding_video"
        name="interruptions"
        selectionType="range"
      />
    ),
    target: '[data-testid="timeline"]',
    kind: "halo",
  },
  {
    name: "Timeline zoom button",
    node: (
      <MockTimeline
        source="coding_video"
        playerName="coding_video"
        name="interruptions"
        selectionType="range"
      />
    ),
    target: '[data-testid="timeline-zoom-in"]',
    kind: "halo",
  },
  {
    name: "Timeline help button",
    node: (
      <MockTimeline
        source="coding_video"
        playerName="coding_video"
        name="interruptions"
        selectionType="range"
      />
    ),
    target: '[data-testid="timeline-help-button"]',
    kind: "halo",
  },
  {
    name: "Timeline mute button",
    node: (
      <MockTimeline
        source="coding_video"
        playerName="coding_video"
        name="interruptions"
        selectionType="range"
      />
    ),
    target: '[data-testid="track-mute"]',
    kind: "halo",
  },
  {
    name: "MediaPlayer (HTML5)",
    node: <MockMediaPlayer url="https://example.com/test.mp4" name="solo" />,
    target: '[data-testid="mediaPlayer"]',
    kind: "halo",
  },
  {
    // MediaPlayer renders two separate trees with two separate copies of the
    // focus rule; the HTML5 case above reaches only one of them.
    name: "MediaPlayer (YouTube)",
    node: <MockMediaPlayer url="https://youtu.be/QC8iQqtG0hg" name="yt" />,
    target: '[data-testid="mediaPlayer"]',
    kind: "halo",
  },
  {
    // The styles.css half of the fix, which no component case can reach: the
    // scoped `.class:focus-visible` rules that Select and TextArea carry
    // (specificity 0-2-0) outrank `select:focus` / `textarea:focus` (0-1-1),
    // so the stylesheet's rule never applies to them. A bare input is a host
    // surface Stagebook styles but never renders — reverting that block to
    // `outline: none` broke no test before this case existed.
    name: "native text input (styles.css)",
    // Wrapped in a div: `component.locator()` searches descendants, so a
    // bare input as the mount root is unreachable.
    node: (
      <div>
        <input type="text" aria-label="Native input" />
      </div>
    ),
    target: 'input[type="text"]',
    kind: "halo",
  },
];

/**
 * Focus `locator` with the keyboard modality set, so `:focus-visible` rules
 * apply. A bare `locator.focus()` is programmatic, and most controls don't
 * match `:focus-visible` after programmatic focus — but they do when the
 * previously focused element did, which one real Tab establishes.
 */
async function focusAsKeyboardUser(page: Page, locator: Locator) {
  await page.keyboard.press("Tab");
  await locator.focus();
  // Several targets are broad `.first()` selectors inside mocks that render
  // extra DOM. Without this, mis-targeting would surface as a baffling
  // computed-style mismatch rather than "the element isn't focused".
  await expect(locator).toBeFocused();
}

// The opaque accent (blue-600) and the page color the spacer is drawn in.
// Asserted as literal rgb() because that is what getComputedStyle resolves
// the tokens to — a translucent value would come back as rgba(...).
const ACCENT = "rgb(37, 99, 235)";
const PAGE = "rgb(255, 255, 255)";
// `<page spacer at 2px> then <accent ring at 4px>`, in that order. All three
// engines serialize a shadow layer as `color offset-x offset-y blur spread`.
const HALO =
  /rgb\(255, 255, 255\) 0px 0px 0px 2px.*rgb\(37, 99, 235\) 0px 0px 0px 4px/;

test.describe("focus indicator is opaque (1.4.11)", () => {
  for (const c of cases) {
    test(`${c.name}`, async ({ mount, page }) => {
      const component = await mount(c.node);
      const target = component.locator(c.target).first();
      await focusAsKeyboardUser(page, target);

      const ring = c.ring ? component.locator(c.ring).first() : target;

      if (c.kind === "halo") {
        // Polled, not read once: several of these controls transition
        // box-shadow, and mid-transition the ring is a partly-interpolated
        // translucent color — which is exactly the thing under test, so a
        // single read would flake against the real assertion.
        const shadow = () =>
          ring.evaluate((el) => getComputedStyle(el).boxShadow);
        // Both halo layers, in order and at the right spreads. Asserting
        // only that both colors appear *somewhere* would still pass with
        // the layers swapped — accent inside, page color outside — which
        // is precisely the "ring abuts the control's own border" geometry
        // that made the original 1.03:1 measurement.
        await expect.poll(shadow).toMatch(HALO);
      } else {
        await expect
          .poll(() => ring.evaluate((el) => getComputedStyle(el).outlineColor))
          .toBe(ACCENT);
      }
    });
  }
});

// styles.css is optional (#213): components carry their own styles, so a host
// may theme by defining --stagebook-primary alone and never load our
// stylesheet. That leaves --stagebook-focus-ring — which only styles.css
// defines — undefined, and the ring has to reach through to the accent
// rather than falling back to our hard-coded blue. `initial` on a custom
// property is the guaranteed-invalid value, which is exactly the state a
// host that skipped styles.css would be in.
test("the ring follows --stagebook-primary when the ring token is undefined", async ({
  mount,
  page,
}) => {
  const component = await mount(
    <div
      style={
        {
          "--stagebook-focus-ring": "initial",
          "--stagebook-primary": "rgb(200, 0, 0)",
        } as React.CSSProperties
      }
    >
      <Button primary>Themed</Button>
    </div>,
  );
  const button = component.locator("button").first();
  await focusAsKeyboardUser(page, button);
  await expect
    .poll(() => button.evaluate((el) => getComputedStyle(el).boxShadow))
    .toContain("rgb(200, 0, 0) 0px 0px 0px 4px");
});

// Stagebook suppresses the focus outline on its *own* range input, because
// the Slider draws the indicator on the visible thumb instead. Before #610
// that rule was written as a bare `input[type="range"]:focus`, so mounting
// one Slider stripped the outline from every range input on the host page —
// controls Stagebook doesn't render and has no business restyling, and under
// forced-colors the outline is the only indicator there is.
test("a Slider does not strip the focus outline from a host's own range input", async ({
  mount,
  page,
  browserName,
}) => {
  test.skip(
    browserName === "webkit",
    "WebKit emulates the forced-colors media query but not its rendering",
  );
  const component = await mount(
    <div>
      <Slider min={0} max={100} interval={1} value={50} />
      <input type="range" data-testid="foreign" aria-label="Not ours" />
    </div>,
  );
  const foreign = component.locator('[data-testid="foreign"]');
  await focusAsKeyboardUser(page, foreign);
  await page.emulateMedia({ forcedColors: "active" });

  await expect
    .poll(() => foreign.evaluate((el) => getComputedStyle(el).outlineStyle))
    .not.toBe("none");
});

test.describe("focus indicator survives forced-colors (1.4.1 / 2.4.7)", () => {
  test.beforeEach(({ browserName }) => {
    // WebKit's emulation flips the media query but does not implement the
    // mode's rendering: measured under emulateMedia, WebKit keeps painting
    // box-shadow and leaves the transparent outline transparent. There is
    // nothing here it could tell us — so skip rather than assert something
    // weaker. Chromium and Firefox both emulate it faithfully, and what is
    // under test is which properties the mode drops, not engine-specific
    // behavior.
    test.skip(
      browserName === "webkit",
      "WebKit emulates the forced-colors media query but not its rendering",
    );
  });

  for (const c of cases) {
    test(`${c.name}`, async ({ mount, page }) => {
      const component = await mount(c.node);
      const target = component.locator(c.target).first();
      await focusAsKeyboardUser(page, target);

      // NOT `test.use({ forcedColors })` — that silently does nothing under
      // Playwright CT (the page is created before the context option takes
      // effect), which quietly made an earlier draft of this whole describe
      // vacuous. emulateMedia applies to the live page, and the box-shadow
      // assertion below is the tripwire that proves it actually took.
      await page.emulateMedia({ forcedColors: "active" });

      // Assert on the element the indicator is painted on, not the one that
      // holds focus — for Slider those differ, and the thumb is the part the
      // participant can actually see.
      const ring = c.ring ? component.locator(c.ring).first() : target;
      const painted = () =>
        ring.evaluate((el) => {
          const s = getComputedStyle(el);
          // Alpha, explicitly: `rgb(0, 0, 0)` is opaque black (a perfectly
          // good forced color), while `rgba(0, 0, 0, 0)` is the transparent
          // outline painting nothing. Only the 4-argument form carries an
          // alpha; the 3-argument form is opaque by definition.
          const parts =
            /^rgba?\(([^)]+)\)$/.exec(s.outlineColor)?.[1].split(",") ?? [];
          return {
            boxShadow: s.boxShadow,
            outlineStyle: s.outlineStyle,
            outlineWidth: parseFloat(s.outlineWidth),
            outlineColor: s.outlineColor,
            outlineAlpha: parts.length === 4 ? parseFloat(parts[3]) : 1,
          };
        });

      // The mode is really in effect: it drops box-shadow, so the halo —
      // the entire indicator in normal mode — is gone.
      await expect.poll(async () => (await painted()).boxShadow).toBe("none");

      const now = await painted();
      // What's left has to actually be an indicator: present, thick enough,
      // and repainted from the system palette. The alpha check is the one
      // that matters — `outline: 2px solid transparent` satisfies the first
      // two while painting nothing at all, so without it this test would
      // pass on an outline the participant cannot see.
      expect(now.outlineStyle).not.toBe("none");
      expect(now.outlineWidth).toBeGreaterThanOrEqual(2);
      expect(
        now.outlineAlpha,
        `outline stayed transparent (${now.outlineColor})`,
      ).toBeGreaterThan(0);
    });
  }
});
