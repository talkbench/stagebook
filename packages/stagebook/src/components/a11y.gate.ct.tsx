// Accessibility regression gate (issue #20; states, marks and known failures
// #633).
//
// Mounts each participant-facing component in its correctly-used form — and
// in the states a participant's pointer or keyboard puts it in — and asserts
// the axe-core violations at the WCAG 2.2 AA ruleset the project committed
// to (docs/decisions/2026-07-accessibility.md) are exactly the ones recorded
// as known failures: none, for almost every case.
//
// Contrast is measured here, from the render, and nowhere else. The palette
// gate that used to live in styles.test.ts asserted hand-written token
// pairings and reimplemented CSS colour resolution to score them; about a
// third of its claims named a pairing nothing rendered, and the algebra had
// bugs of its own (#628, #633). The browser resolves var(), color-mix, alpha
// and stacking correctly for free — so the rule is: mount the component,
// drive it into the state, and read what is on screen.
//
// Three readers, because axe's contrast rule is text-only and skips some of
// that:
//   - axe, for text. It also reports what it could NOT score (a background
//     image, an overlapping element), and each of those needs an explicit
//     `unmeasured` entry with the reason — the same discipline as a known
//     failure, so nothing drops out silently.
//   - `marks`, for opaque non-text indicators (WCAG 1.4.11: a control's
//     border, a progress fill, a checkmark glyph) and for text axe skips
//     (<option> rows, a trigger with a background image). Two computed
//     styles and the WCAG ratio; a translucent value fails loudly.
//   - `pixels`, for a mark whose colour is only knowable from the paint:
//     the Slider's ticks are drawn at opacity 0.4 over a translucent tint,
//     which no computed style expresses. Two screenshot pixels.
// Focus indicators have no axe rule and live in focus.gate.ct.tsx. Canvas
// is invisible to all three readers; the waveform's tokens are excluded
// explicitly in styles.test.ts's token ledger.
//
// Known failures (#616) are asserted to STILL fail, so fixing one flips its
// entry red and prompts its removal.
import { test, expect } from "@playwright/experimental-ct-react";
import AxeBuilder from "@axe-core/playwright";
import type { Page } from "playwright/test";
import type { ReactNode } from "react";
import type { MetadataType } from "../schemas/promptFile";

import { RadioGroup } from "./form/RadioGroup";
import { CheckboxGroup } from "./form/CheckboxGroup";
import { Select } from "./form/Select";
import { TextArea } from "./form/TextArea";
import { Slider } from "./form/Slider";
import { Button } from "./form/Button";
import { Loading } from "./form/Loading";
import { RefreshGlyph } from "./testing/RefreshGlyph";
import { Markdown } from "./form/Markdown";
import { Separator } from "./form/Separator";
import { MockListSorter } from "./testing/MockListSorter";
import { MockKitchenTimer } from "./testing/MockKitchenTimer";
import { MockTimeline } from "./testing/MockTimeline";
import { MockMediaPlayer } from "./testing/MockMediaPlayer";
import { BoundaryTestHarness } from "./testing/BoundaryTestHarness";
import { Prompt } from "./elements/Prompt";
import { Display } from "./elements/Display";
import { SubmitButton } from "./elements/SubmitButton";
import { ImageElement } from "./elements/ImageElement";
import { TrackedLink } from "./elements/TrackedLink";
import { AssetPlaceholder } from "./elements/AssetPlaceholder";
import { MockWaveformTimeline } from "./testing/MockWaveformTimeline";
import {
  multipleChoiceSingle,
  multipleChoiceMultiple,
  openResponse,
  openResponseWithLimits,
  slider as sliderPrompt,
  listSorter as listSorterPrompt,
} from "./elements/fixtures/prompts";

// WCAG 2.2 AA = 2.0/2.1/2.2 at levels A and AA.
const WCAG_22_AA = [
  "wcag2a",
  "wcag2aa",
  "wcag21a",
  "wcag21aa",
  "wcag22a",
  "wcag22aa",
];

const AA = 4.5; // text
const UI = 3.0; // non-text indicators (1.4.11)

const options = [
  { key: "a", value: "Option A" },
  { key: "b", value: "Option B" },
  { key: "c", value: "Option C" },
];

// 1×1 transparent PNG.
const testImage =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==";

const promptProps = {
  progressLabel: "game_0_gate",
  save: () => {},
  getElapsedTime: () => 0,
};

const dropdownPrompt = {
  metadata: {
    name: "projects/example/dropdown.md",
    type: "dropdown",
  } as MetadataType,
  body: "# Choose your favorite\n\nPick one from the list.",
  responseItems: ["Alpha", "Bravo", "Charlie"],
  responsePoints: [],
  sliderPoints: [],
};

// Eight buckets of interleaved min/max peaks — enough for the waveform to
// draw bars the track label and playhead actually sit over.
const peaks = [-0.2, 0.2, -0.8, 0.8, -0.5, 0.5, -0.1, 0.1];

/**
 * An axe result that is expected: a violation recorded in #616, or a node
 * axe declined to score. Matched on the rule id, the element it sits
 * inside, and (when that element also holds passing text) a fragment of
 * the node's text — never on the selector axe generates, which carries
 * React ids and nth-child positions. A recorded failure can pin its ratio,
 * so "still fails" means "still fails this way", not "fails worse".
 */
interface Known {
  rule: string;
  within: string;
  text?: string;
  /** `fails`: a measured violation. `unmeasured`: axe could not score it. */
  kind: "fails" | "unmeasured";
  /** The ratio axe measured, to two decimals; matched within 0.05. */
  ratio?: number;
  /**
   * For `unmeasured`: axe's own reason (its `messageKey` — bgImage,
   * bgOverlap, nonBmp, …), so a new obstruction on the same element does
   * not ride on a waiver written for the old one.
   */
  reason?: string;
  why: string;
  /**
   * Covers a set of like nodes (the ruler's timestamps). Otherwise an entry
   * is consumed by exactly one node, so a second node of the same shape
   * fails closed instead of riding on an entry written for one.
   */
  many?: boolean;
  /** Expected on this engine only, when the others score the node. */
  engine?: "chromium" | "webkit" | "firefox";
}

/**
 * One side of a measured mark: a property read off a rendered element (or
 * its pseudo-element), or a CSS colour expression resolved by the browser
 * on a probe — for a state scripts cannot drive, such as `:visited`.
 */
type Side =
  | {
      el: string;
      prop: "color" | "background-color" | "border-top-color" | "outline-color";
      pseudo?: string;
      /** What shows through when the property is fully transparent. */
      behind?: Side;
    }
  | { value: string }
  /**
   * The paint just inside an element's left edge at mid-height — its own
   * padding, where its background shows without text. For a background
   * only the paint knows: translucent over a canvas, which axe will not
   * composite.
   */
  | { inside: string };

/** A contrast floor measured from two computed styles. */
interface Mark {
  name: string;
  fg: Side;
  bg: Side;
  min: number;
  /**
   * A known failure: asserted to still measure this ratio (within 0.05),
   * with its reference — so it can neither quietly pass nor quietly worsen.
   */
  fails?: { ratio: number; why: string };
}

/**
 * A contrast floor measured from two painted pixels: the centre of `at`,
 * and the point `beside` it (a CSS-px offset) that shows its backdrop.
 */
interface Pixel {
  name: string;
  at: string;
  beside: [number, number];
  min: number;
  fails?: { ratio: number; why: string };
}

interface Scan {
  known?: Known[];
  marks?: Mark[];
  pixels?: Pixel[];
}

/**
 * A state the mounted tree only reaches under a participant: a hovered
 * row, a pressed button, an opened picker. Scanned in addition to rest.
 */
interface State extends Scan {
  name: string;
  enter: (page: Page) => Promise<void>;
}

interface Case extends Scan {
  name: string;
  node: ReactNode;
  /** Runs after mount, before the rest scan and before any state. */
  prepare?: (page: Page) => Promise<void>;
  /** Skip on an engine without the customizable select (#627). */
  needsBaseSelect?: boolean;
  states?: State[];
}

/** Hover the first match, and keep the pointer there through the scan. */
const hover = (selector: string) => async (page: Page) => {
  await page.locator(selector).first().hover();
};

/** Hover and press, holding the button down through the scan. */
const press = (selector: string) => async (page: Page) => {
  await page.locator(selector).first().hover();
  await page.mouse.down();
};

const openPicker = async (page: Page) => {
  const select = page.locator("select");
  await select.click();
  await expect
    .poll(() => select.evaluate((el) => el.matches(":open")))
    .toBe(true);
};

/**
 * Render the stylesheet's static fallbacks. styles.css re-declares its
 * translucent accent derivatives under `@supports (color: color-mix(…))`,
 * so on an engine here the override branch is what renders and the static
 * branch — what a supported host without color-mix paints (Firefox 92–112,
 * Safari 15.4–16.1; docs/engineer/platform-requirements.md) — never does.
 * Dropping that block from the CSSOM is exactly what such a browser does
 * with it, so the scan then reads the fallback branch from the render.
 */
const withoutColorMix = async (page: Page) => {
  const dropped = await page.evaluate(() => {
    let n = 0;
    for (const sheet of document.styleSheets) {
      const rules = sheet.cssRules;
      for (let i = rules.length - 1; i >= 0; i -= 1) {
        const rule = rules[i];
        if (
          rule instanceof CSSSupportsRule &&
          rule.conditionText.includes("color-mix")
        ) {
          sheet.deleteRule(i);
          n += 1;
        }
      }
    }
    return n;
  });
  expect(dropped, "the stylesheet's color-mix @supports block").toBe(1);
};

// The page, for a mark whose backdrop is the host page rather than an
// element of ours. `scan` paints the page with --stagebook-bg — the token
// components already take the page to be (the focus halo's spacer is drawn
// in it) — so this reads a render, not a token. A host that paints its page
// another colour without retuning the token is outside what the gate
// measures; the ADR says so.
const PAGE: Side = { el: "html", prop: "background-color" };

// The Select trigger draws its chevron as a background image, and axe will
// not score text over one. The trigger's text is a mark instead.
const SELECT_CHEVRON: Known = {
  rule: "color-contrast",
  within: "select",
  kind: "unmeasured",
  reason: "bgImage",
  why: "the trigger's chevron is a background-image, which axe declines to see through; the text is measured as a mark",
};
const selectTriggerText: Mark = {
  name: "trigger text on the control surface",
  fg: { el: "select", prop: "color" },
  bg: { el: "select", prop: "background-color" },
  min: AA,
};

/**
 * A picker row's text and, when checked, its checkmark, on the row's fill:
 * the hover fill when hovered or walked, otherwise the picker's surface
 * showing through the row's transparent background.
 */
const rowFill = (value: string): Side => ({
  el: `option[value="${value}"]`,
  prop: "background-color",
  behind: {
    el: "select",
    prop: "background-color",
    pseudo: "::picker(select)",
  },
});
const pickerRow = (value: string, checked = false): Mark[] => {
  const fill = rowFill(value);
  return [
    {
      name: `row "${value}" text on its fill`,
      fg: { el: `option[value="${value}"]`, prop: "color" },
      bg: fill,
      min: AA,
    },
    ...(checked
      ? [
          {
            name: `row "${value}" checkmark on its fill`,
            fg: {
              el: `option[value="${value}"]`,
              prop: "color" as const,
              pseudo: "::checkmark",
            },
            bg: fill,
            min: UI,
          },
        ]
      : []),
  ];
};

// The timeline's text sits over its own chrome in ways axe cannot resolve,
// and the ruler's timestamps are a recorded failure.
const TIMELINE_KNOWN: Known[] = [
  {
    rule: "color-contrast",
    within: '[data-testid="time-ruler"]',
    kind: "fails",
    ratio: 2.53,
    many: true,
    why: "#616: --stagebook-decoration timestamps, 2.53:1 on --stagebook-bg (TimeRuler.tsx)",
  },
  {
    rule: "color-contrast",
    within: '[data-testid="time-ruler"]',
    kind: "unmeasured",
    reason: "bgOverlap",
    why: "the playhead's line crosses the timestamp at 0:00; the others measure as the entry above",
  },
  {
    rule: "color-contrast",
    within: '[data-testid="playhead"]',
    kind: "unmeasured",
    reason: "bgOverlap",
    why: "the time box overlaps the ruler; measured as a mark instead",
  },
  {
    rule: "color-contrast",
    within: '[data-testid="track-label"]',
    kind: "unmeasured",
    reason: "bgOverlap",
    why: "#616: the label sits over the waveform canvas, which no reader here can see — 4.02:1 over a bar, by hand",
  },
];
const playheadMarks: Mark[] = [
  {
    // Against the page: the timeline paints no background of its own, and
    // the lane the line mostly crosses is canvas (excluded).
    name: "playhead line on the page",
    fg: {
      el: '[data-testid="playhead"] > div:last-child',
      prop: "background-color",
    },
    bg: PAGE,
    min: UI,
  },
  {
    name: "playhead time-box text on its box",
    fg: {
      el: '[data-testid="playhead"] > div[draggable="false"]',
      prop: "color",
    },
    bg: {
      el: '[data-testid="playhead"] > div[draggable="false"]',
      prop: "background-color",
    },
    min: AA,
  },
];

/** The timer's fill on its track. */
const timerFill = (fails?: Mark["fails"]): Mark => ({
  name: "fill on the track",
  fg: { el: '[data-testid="timer-fill"]', prop: "background-color" },
  bg: {
    el: '[data-testid="kitchen-timer"] > div:first-of-type',
    prop: "background-color",
  },
  min: UI,
  fails,
});

// The Slider's ticks, read from the paint (see `Pixel`). Snap ticks are
// gray at opacity 0.4; labelled ticks are opaque. Each against the track
// 6px to its right — the next tick is 10% of the width away.
const SNAP_TICK = ':nth-match([data-testid="slider-snap-tick"], 2)';
const LABEL_TICK = ':nth-match([data-testid="slider-label-tick"], 2)';
const tickPixels = (track: string): Pixel[] => [
  {
    name: `snap tick on the ${track} track`,
    at: SNAP_TICK,
    beside: [6, 0],
    min: UI,
    fails:
      track === "hovered"
        ? {
            ratio: 1.21,
            why: "#616: --stagebook-decoration at opacity 0.4 over --stagebook-primary-tint (Slider.tsx)",
          }
        : {
            ratio: 1.31,
            why: "#633: --stagebook-decoration at opacity 0.4 over --stagebook-bg-track (Slider.tsx) — not in #616; found by this probe",
          },
  },
  {
    name: `labelled tick on the ${track} track`,
    at: LABEL_TICK,
    beside: [6, 0],
    min: UI,
  },
];

const MUTED_LABEL_ON_HOVER: Known = {
  rule: "color-contrast",
  within: '[data-testid="option"]',
  kind: "fails",
  ratio: 4.39,
  why: "#616: --stagebook-text-muted label on --stagebook-hover-bg, 4.39:1",
};

/** A checked control's accent fill on the row it sits in (1.4.11). */
const checkedFill = (input: string): Mark => ({
  name: "checked control fill on its row",
  fg: { el: `${input}:checked`, prop: "background-color" },
  bg: { el: '[data-testid="option"]', prop: "background-color", behind: PAGE },
  min: UI,
});

// The track's mute button is an icon-only control whose glyph takes
// --stagebook-decoration — the same 2.53:1 the ruler's timestamps get, on
// a control rather than decoration. Not among #616's seven; found here.
const MUTE_GLYPH_REST = {
  ratio: 2.53,
  why: "#633: --stagebook-decoration as the mute glyph, on the page (TimelineTrack.tsx)",
};
// #635 restores the hover fill. The glyph remains a known contrast failure
// (#616); measure it against the background that now actually paints.
const MUTE_GLYPH_HOVERED = {
  ratio: 2.31,
  why: "#616: --stagebook-decoration as the mute glyph on --stagebook-hover-bg (#635 restores the fill)",
};
const muteGlyph = (fails?: Mark["fails"]): Mark => ({
  name: "mute glyph on its button",
  fg: { el: '[data-testid="track-mute"]', prop: "color" },
  bg: {
    el: '[data-testid="track-mute"]',
    prop: "background-color",
    behind: PAGE,
  },
  min: UI,
  fails,
});

/** The slider's thumb on the track beside it. */
const thumbPixel = (track: string): Pixel => ({
  name: `thumb on the ${track} track`,
  at: '[data-testid="slider-thumb"]',
  beside: [18, 0],
  min: UI,
});

// Each case is a participant-facing component in its correctly-used (named,
// themed) form.
const cases: Case[] = [
  {
    // Checked, so the first row's control carries the accent fill: a
    // state indicator (1.4.11) on the row it sits in. The row fill under a
    // hovered option is the one surface the label text sits on that rest
    // never shows.
    name: "RadioGroup",
    node: (
      <RadioGroup
        options={options}
        value="a"
        onChange={() => {}}
        label="Pick one"
      />
    ),
    marks: [checkedFill('input[type="radio"]')],
    states: [
      {
        name: "row hovered",
        enter: hover('[data-testid="option"]'),
        known: [MUTED_LABEL_ON_HOVER],
        marks: [checkedFill('input[type="radio"]')],
      },
    ],
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
    marks: [checkedFill('input[type="checkbox"]')],
    states: [
      {
        name: "row hovered",
        enter: hover('[data-testid="option"]'),
        known: [MUTED_LABEL_ON_HOVER],
        marks: [checkedFill('input[type="checkbox"]')],
      },
    ],
  },
  {
    name: "Select",
    node: (
      <Select options={options} onChange={() => {}} label="Choose an option" />
    ),
    known: [SELECT_CHEVRON],
    marks: [selectTriggerText],
  },
  {
    // Nothing chosen yet, so the trigger shows the placeholder in the muted
    // text colour — the one pairing on the control surface the other Select
    // cases never render (Codex review on #634).
    name: "Select (placeholder)",
    node: (
      <Select
        options={options}
        onChange={() => {}}
        label="Choose an option"
        placeholder="Pick one…"
      />
    ),
    known: [SELECT_CHEVRON],
    marks: [selectTriggerText],
  },
  {
    // Disabled and empty (#620): the runner's no-device state — the only
    // option is the placeholder carrying the state copy, and the control is
    // held still. A disabled control is exempt from the contrast minimum,
    // but its label still has to name it and the axe rules still apply.
    name: "Select (disabled, empty)",
    node: (
      <Select
        options={[]}
        onChange={() => {}}
        label="Camera"
        placeholder="No camera found."
        disabled
      />
    ),
  },
  {
    // Open (#627): under `appearance: base-select` the rows are in-page DOM
    // — a top-layer popover, not the OS menu — so axe can reach their roles
    // and names. Not their colours: axe skips <option> outright, so each
    // row's text, and the checked row's checkmark, are marks on the fill
    // the row has in that state — the surface at rest, the hover fill when
    // hovered or walked.
    name: "Select (picker open)",
    node: (
      <Select
        options={options}
        value="b"
        onChange={() => {}}
        label="Choose an option"
      />
    ),
    needsBaseSelect: true,
    prepare: openPicker,
    known: [SELECT_CHEVRON],
    marks: [...pickerRow("a"), ...pickerRow("b", true)],
    states: [
      {
        name: "checked row hovered",
        enter: hover('option[value="b"]'),
        known: [SELECT_CHEVRON],
        marks: pickerRow("b", true),
      },
      {
        name: "row hovered",
        enter: hover('option[value="c"]'),
        known: [SELECT_CHEVRON],
        marks: pickerRow("c"),
      },
      {
        // Walked by keyboard, the row takes the hover fill and the inset
        // focus ring (#627): the one focus indicator drawn as an outline
        // directly on a fill, so its floor is measured here on that fill.
        // Its survival under forced-colors is focus.gate.ct.tsx's.
        name: "row walked",
        enter: async (page) => {
          await expect(page.locator('option[value="b"]')).toBeFocused();
          await page.keyboard.press("ArrowDown");
          await expect(page.locator('option[value="c"]')).toBeFocused();
        },
        known: [SELECT_CHEVRON],
        marks: [
          ...pickerRow("c"),
          {
            name: 'inset focus ring on row "c"',
            fg: { el: 'option[value="c"]', prop: "outline-color" },
            bg: rowFill("c"),
            min: UI,
          },
        ],
      },
    ],
  },
  {
    name: "TextArea",
    node: <TextArea value="Some typed response" ariaLabel="Your answer" />,
    marks: [
      {
        name: "control border on the page",
        fg: { el: "textarea", prop: "border-top-color" },
        bg: PAGE,
        min: UI,
        fails: {
          ratio: 1.47,
          why: "#616: --stagebook-border is gray-300 on white — a design decision about every control's edge",
        },
      },
    ],
  },
  {
    name: "Slider (anchored)",
    node: <Slider min={0} max={100} interval={1} value={50} />,
    states: [
      { name: "track hovered", enter: hover('[data-testid="slider-track"]') },
    ],
  },
  {
    name: "Slider (unanchored)",
    node: <Slider min={0} max={100} interval={1} />,
    states: [
      { name: "track hovered", enter: hover('[data-testid="slider-track"]') },
    ],
  },
  {
    // Ten snap points and four labelled ones, spaced so a pixel beside a
    // tick is track and not the next tick. Hovering swaps the track for the
    // translucent primary tint the ticks then sit on.
    name: "Slider (ticks)",
    node: (
      <Slider
        min={0}
        max={100}
        interval={10}
        value={50}
        labelPts={[0, 30, 70, 100]}
        showValue
      />
    ),
    pixels: [...tickPixels("resting"), thumbPixel("resting")],
    states: [
      {
        name: "track hovered",
        enter: hover('[data-testid="slider-track"]'),
        pixels: [...tickPixels("hovered"), thumbPixel("hovered")],
      },
      {
        // The hover tint's static fallback, for hosts without color-mix.
        name: "track hovered, without color-mix",
        enter: async (page) => {
          await withoutColorMix(page);
          await hover('[data-testid="slider-track"]')(page);
        },
        pixels: [...tickPixels("hovered"), thumbPixel("hovered")],
      },
    ],
  },
  {
    name: "Button",
    node: <Button>Continue</Button>,
    marks: [
      {
        // The ring token, resolved by the browser against the page: the
        // indicator's colour floor, which every halo shares. Its layering,
        // opacity and forced-colors survival are focus.gate.ct.tsx's.
        name: "focus ring on the page",
        fg: {
          value:
            "var(--stagebook-focus-ring, var(--stagebook-primary, #2563eb))",
        },
        bg: PAGE,
        min: UI,
      },
    ],
    states: [
      { name: "hovered", enter: hover("button") },
      { name: "pressed", enter: press("button") },
    ],
  },
  {
    name: "Button (secondary)",
    node: <Button primary={false}>Back</Button>,
    states: [
      { name: "hovered", enter: hover("button") },
      { name: "pressed", enter: press("button") },
    ],
  },
  {
    // Icon-only (#621 / #622): the glyph is decorative and hidden from the
    // name computation, so the name is the aria-label alone. This is the
    // shape the checklist means by "icon-only buttons need one too".
    name: "Button (icon-only)",
    node: (
      <Button icon aria-label="Refresh devices" primary={false}>
        <RefreshGlyph />
      </Button>
    ),
  },
  {
    name: "SubmitButton",
    node: <SubmitButton onSubmit={() => {}} name="submit" save={() => {}} />,
  },
  {
    name: "ImageElement",
    node: <ImageElement src={testImage} alt="A small test image" />,
  },
  {
    name: "AssetPlaceholder",
    node: <AssetPlaceholder uri="asset://videos/intro.mp4" kind="video" />,
    known: [
      {
        rule: "color-contrast",
        within: '[data-testid="asset-placeholder"]',
        text: "not available here",
        kind: "fails",
        ratio: 2.42,
        why: "#616: --stagebook-decoration hint text, 2.42:1 on --stagebook-bg-muted (AssetPlaceholder.tsx)",
      },
      {
        rule: "color-contrast",
        within: '[data-testid="asset-placeholder"]',
        text: "▦",
        kind: "unmeasured",
        reason: "nonBmp",
        why: "the ▦ glyph is outside the Basic Multilingual Plane, which axe will not score; it is aria-hidden decoration",
      },
    ],
  },
  {
    // The fallback an element renders when its child throws: the danger
    // pill, and the only place the status pair renders in stagebook.
    name: "ElementErrorBoundary",
    node: (
      <BoundaryTestHarness
        elementType="prompt"
        elementName="broken"
        crashMessage="boom"
      />
    ),
  },
  {
    name: "Loading",
    node: <Loading />,
    states: [
      {
        name: "reduced motion",
        enter: (page) => page.emulateMedia({ reducedMotion: "reduce" }),
      },
    ],
  },
  {
    name: "WaveformTimeline",
    node: (
      <MockWaveformTimeline
        label="Recording amplitude timeline"
        duration={8}
        currentTime={2}
        mockPeaks={peaks}
      />
    ),
  },
  {
    // Ranges restored from a save, so the range fills, their handles and
    // the ruler all render; a hovered handle shows its time tooltip; the
    // mute button is read hovered and muted.
    name: "Timeline (ranges)",
    node: (
      <MockTimeline
        source="player"
        playerName="player"
        name="ranges"
        selectionType="range"
        multiSelect
        mockDuration={8}
        mockChannelCount={1}
        mockPeaks={[peaks]}
        trackLabels={["Interviewer"]}
        initialSelections={[
          { start: 1, end: 3 },
          { start: 5, end: 6 },
        ]}
      />
    ),
    known: TIMELINE_KNOWN,
    marks: [...playheadMarks, muteGlyph(MUTE_GLYPH_REST)],
    states: [
      {
        name: "mute hovered",
        enter: hover('[data-testid="track-mute"]'),
        known: TIMELINE_KNOWN,
        marks: [muteGlyph(MUTE_GLYPH_HOVERED)],
      },
      {
        // Muted, the glyph takes the danger colour — on the hover fill,
        // since the pointer that clicked it is still there.
        name: "track muted",
        enter: async (page) => {
          await page.locator('[data-testid="track-mute"]').click();
        },
        known: TIMELINE_KNOWN,
        marks: [muteGlyph()],
      },
      {
        name: "handle hovered",
        enter: hover('[data-testid="range-0-handle-end"]'),
        known: TIMELINE_KNOWN,
      },
      {
        // The tooltip's background is the one color-mix token that carries
        // text; its static fallback is a translucent rgba the override
        // branch never shows.
        name: "handle hovered, without color-mix",
        enter: async (page) => {
          await withoutColorMix(page);
          await hover('[data-testid="range-0-handle-end"]')(page);
        },
        known: [
          ...TIMELINE_KNOWN,
          {
            rule: "color-contrast",
            within: '[data-testid="handle-tooltip"]',
            kind: "unmeasured",
            reason: "imgNode",
            why: "the fallback background is translucent over the waveform canvas, which axe will not composite; read from the paint below",
          },
        ],
        marks: [
          {
            name: "tooltip text on its fallback background",
            fg: { el: '[data-testid="handle-tooltip"]', prop: "color" },
            bg: { inside: '[data-testid="handle-tooltip"]' },
            min: AA,
          },
        ],
      },
    ],
  },
  {
    // No player registered under the source: the danger text on the page.
    name: "Timeline (no player)",
    node: <MockTimeline source="player" name="orphan" selectionType="range" />,
  },
  {
    name: "MediaPlayer",
    node: <MockMediaPlayer url="/sample-video.mp4" name="video" />,
  },
  {
    name: "Timeline (points)",
    node: (
      <MockTimeline
        source="player"
        playerName="player"
        name="points"
        selectionType="point"
        multiSelect
        mockDuration={8}
        mockChannelCount={1}
        mockPeaks={[peaks]}
        initialSelections={[{ time: 2 }, { time: 5 }]}
      />
    ),
    known: TIMELINE_KNOWN,
    marks: playheadMarks,
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
    states: [{ name: "hovered", enter: hover("a") }],
  },
  {
    name: "KitchenTimer",
    node: <MockKitchenTimer startTime={0} endTime={60} elapsedTime={20} />,
    marks: [
      timerFill({
        ratio: 2.05,
        why: "#616: --stagebook-timer-fill is blue-400 on --stagebook-bg-track",
      }),
    ],
  },
  {
    // Inside the warning window: the fill swaps to the danger colour.
    name: "KitchenTimer (warning)",
    node: <MockKitchenTimer startTime={0} endTime={60} elapsedTime={55} />,
    marks: [timerFill()],
  },
  {
    name: "ListSorter",
    node: <MockListSorter items={["Alpha", "Bravo", "Charlie", "Delta"]} />,
    states: [
      { name: "item hovered", enter: hover('[data-testid="draggable-1"]') },
    ],
  },
  {
    name: "Markdown",
    node: (
      <Markdown
        text={"Some **bold** text and a [link](https://example.org)."}
      />
    ),
    marks: [
      {
        // `:visited` cannot be driven, and browsers hide its computed
        // colour from scripts — so this is the token resolved by the
        // browser, against the page, rather than a rendered link.
        name: "visited link text on the page",
        fg: { value: "var(--stagebook-link-visited, #7c3aed)" },
        bg: PAGE,
        min: AA,
      },
    ],
    states: [{ name: "link hovered", enter: hover("a") }],
  },
  {
    // Every block the prose renderer styles with a colour of its own: a
    // blockquote on its tinted panel, inline and fenced code on the code
    // tint, and a table with its header band and hoverable rows.
    name: "Markdown (rich)",
    node: (
      <Markdown
        text={[
          "# Heading",
          "",
          "> A quoted line of instructions.",
          "",
          "Inline `code` in a sentence.",
          "",
          "```",
          "a fenced block",
          "```",
          "",
          "| Item | Value |",
          "| --- | --- |",
          "| Alpha | 1 |",
          "| Bravo | 2 |",
        ].join("\n")}
      />
    ),
    states: [{ name: "table row hovered", enter: hover("tbody tr") }],
  },
  { name: "Separator", node: <Separator /> },
  {
    name: "Display",
    node: <Display reference="prompt.q1" values={["A displayed answer"]} />,
  },
  {
    name: "Prompt: multiple choice (single)",
    node: (
      <Prompt
        {...multipleChoiceSingle}
        {...promptProps}
        name="mcSingle"
        value={undefined}
      />
    ),
  },
  {
    name: "Prompt: multiple choice (multiple)",
    node: (
      <Prompt
        {...multipleChoiceMultiple}
        {...promptProps}
        name="mcMulti"
        value={[]}
      />
    ),
  },
  {
    name: "Prompt: open response",
    node: <Prompt {...openResponse} {...promptProps} name="open" value="" />,
  },
  {
    // With limits, so the character counter renders — muted below the
    // minimum, the success colour once inside the range.
    name: "Prompt: open response (below minimum)",
    node: (
      <Prompt
        {...openResponseWithLimits}
        {...promptProps}
        name="limits"
        value="Too short."
      />
    ),
  },
  {
    name: "Prompt: open response (within limits)",
    node: (
      <Prompt
        {...openResponseWithLimits}
        {...promptProps}
        name="limits"
        value="A response that is comfortably longer than the fifty-character minimum."
      />
    ),
  },
  {
    name: "Prompt: slider",
    node: (
      <Prompt {...sliderPrompt} {...promptProps} name="slider" value={50} />
    ),
    known: [
      {
        // Firefox's font metrics run the fixture's last two labels into
        // each other, and axe will not score text that overlaps text.
        // Chromium and WebKit lay them out apart and score the label.
        rule: "color-contrast",
        within: '[data-testid="slider"]',
        text: "Super Hot",
        kind: "unmeasured",
        reason: "elmPartiallyObscuring",
        engine: "firefox",
        why: "elmPartiallyObscuring on Firefox only: the end label overlaps its neighbour there",
      },
    ],
  },
  {
    name: "Prompt: list sorter",
    node: (
      <Prompt
        {...listSorterPrompt}
        {...promptProps}
        name="sorter"
        value={undefined}
      />
    ),
  },
  {
    name: "Prompt: dropdown",
    node: (
      <Prompt
        {...dropdownPrompt}
        {...promptProps}
        name="dropdown"
        value={undefined}
      />
    ),
    known: [SELECT_CHEVRON],
    marks: [selectTriggerText],
  },
];

/**
 * Let CSS transitions finish, so a scan reads the state and not a frame on
 * the way to it — the first run of this gate scored a button hover halfway
 * between its two blues. Transitions only: the Loading spinner never ends.
 */
async function settle(page: Page) {
  await page.evaluate(async () => {
    await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));
    await Promise.all(
      document
        .getAnimations()
        .filter((a) => a instanceof CSSTransition)
        .map((a) => a.finished.catch(() => undefined)),
    );
  });
}

/** WCAG 2.x contrast ratio of two opaque sRGB triples. */
function contrast(a: number[], b: number[]): number {
  const lum = (rgb: number[]) => {
    const [r, g, b] = rgb.map((c) => {
      const s = c / 255;
      return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * Assert a measured ratio against its floor — or, for a known failure,
 * against the ratio recorded for it, so a fix is noticed and so is a
 * regression to something worse.
 */
function assertRatio(
  label: string,
  ratio: number,
  min: number,
  fails: Mark["fails"],
  fg: string,
  bg: string,
) {
  const measured = `${fg} on ${bg} = ${ratio.toFixed(2)}:1, floor ${String(min)}`;
  if (fails) {
    expect(
      ratio,
      `${label}: known failure now passes (${measured}) — drop its \`fails\` so it is asserted. Was: ${fails.why}`,
    ).toBeLessThan(min);
    expect(
      Math.abs(ratio - fails.ratio),
      `${label}: known failure measures ${measured}, recorded as ${String(fails.ratio)}:1 (${fails.why}) — update the record if the change is intended`,
    ).toBeLessThanOrEqual(0.05);
  } else {
    expect(ratio, `${label}: ${measured}`).toBeGreaterThanOrEqual(min);
  }
}

/**
 * Resolve a side to an opaque rgb triple, in the browser. A translucent
 * result — an alpha channel, or an element with opacity below 1 — is
 * refused: its rendered colour depends on what is behind it, which is what
 * axe and the pixel reader are for.
 */
async function computed(page: Page, side: Side): Promise<number[]> {
  if ("inside" in side) {
    const box = await page.locator(side.inside).boundingBox();
    if (!box) throw new Error(`${side.inside} is not rendered`);
    return pixel(
      page,
      Math.floor(box.x + 2),
      Math.floor(box.y + box.height / 2),
    );
  }
  const out = await page.evaluate((s) => {
    let raw: string;
    let opacity = "1";
    if ("value" in s) {
      const probe = document.createElement("span");
      probe.style.color = s.value;
      document.body.appendChild(probe);
      raw = getComputedStyle(probe).color;
      probe.remove();
    } else {
      const el = document.querySelector(s.el);
      if (!el) return { error: `no element matches ${s.el}` };
      raw = getComputedStyle(el, s.pseudo).getPropertyValue(s.prop);
      // The paint is the colour through every opacity above it: the
      // element's, each ancestor's, and the pseudo-element's own.
      for (let a: Element | null = el; a; a = a.parentElement) {
        const o = getComputedStyle(a).opacity;
        if (o !== "1") opacity = o;
      }
      if (s.pseudo) {
        const o = getComputedStyle(el, s.pseudo).opacity;
        if (o !== "1") opacity = o;
      }
    }
    // Every engine serialises a resolved color-mix() as `color(srgb r g b)`
    // with channels in 0–1, and everything else as rgb() / rgba().
    const rgb = /^rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)$/.exec(raw);
    const srgb =
      /^color\(srgb ([\d.]+) ([\d.]+) ([\d.]+)(?: \/ ([\d.]+))?\)$/.exec(raw);
    const m = rgb ?? srgb;
    if (!m) return { error: `cannot read \`${raw}\` as a colour` };
    const channels = [m[1], m[2], m[3]].map((c) =>
      rgb ? Number(c) : Math.round(Number(c) * 255),
    );
    const alpha = m[4] === undefined ? 1 : Number(m[4]);
    if (alpha === 0) return { transparent: true as const };
    if (alpha !== 1 || opacity !== "1") {
      return {
        error: `\`${raw}\` at opacity ${opacity} is translucent — its rendered colour depends on the backdrop; read it as a pixel, or exclude it with a reason`,
      };
    }
    return { rgb: channels };
  }, side);
  if ("transparent" in out) {
    if ("el" in side && side.behind) return computed(page, side.behind);
    throw new Error(
      `${JSON.stringify(side)}: fully transparent — name what shows through it with \`behind\``,
    );
  }
  if ("error" in out) throw new Error(`${JSON.stringify(side)}: ${out.error}`);
  return out.rgb;
}

/** The painted colour at a CSS-px point, read back from a screenshot. */
async function pixel(page: Page, x: number, y: number): Promise<number[]> {
  const png = await page.screenshot({
    clip: { x, y, width: 1, height: 1 },
    scale: "css",
  });
  return page.evaluate(async (b64) => {
    const img = new Image();
    img.src = `data:image/png;base64,${b64}`;
    await img.decode();
    const canvas = document.createElement("canvas");
    canvas.width = 1;
    canvas.height = 1;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("no 2d context");
    ctx.drawImage(img, 0, 0);
    const d = ctx.getImageData(0, 0, 1, 1).data;
    return [d[0], d[1], d[2]];
  }, png.toString("base64"));
}

const hex = (rgb: number[]) =>
  "#" + rgb.map((c) => c.toString(16).padStart(2, "0")).join("");

async function scan(page: Page, engine: string, label: string, s: Scan) {
  // The harness leaves the page the UA's white; paint it from the token so
  // both axe and the PAGE-backed marks read the page a themed host has. On
  // the root element, not <body>: WebKit and Firefox lay the body's box
  // short of a heading's collapsed top margin, and axe then reports the
  // heading partially obscured. The root is under every point on every
  // engine.
  await page.evaluate(() => {
    document.documentElement.style.backgroundColor =
      "var(--stagebook-bg, #fff)";
  });
  await settle(page);
  const results = await new AxeBuilder({ page })
    .include("#root")
    .withTags(WCAG_22_AA)
    .analyze();

  // Every reported node, violation or unscored, matched to the entry that
  // expects it — in the page, since the match is by ancestry. `why` is
  // axe's own reason for not scoring a node (bgOverlap, bgImage, …).
  const nodes = [
    ...results.violations.flatMap((r) =>
      r.nodes.map((n) => ({ rule: r.id, kind: "fails" as const, node: n })),
    ),
    ...results.incomplete.flatMap((r) =>
      r.nodes.map((n) => ({
        rule: r.id,
        kind: "unmeasured" as const,
        node: n,
      })),
    ),
  ].map((x) => {
    const data = x.node.any[0]?.data as
      | { messageKey?: string; contrastRatio?: number }
      | undefined;
    return {
      rule: x.rule,
      kind: x.kind,
      target: x.node.target.join(" "),
      html: x.node.html,
      why: data?.messageKey,
      ratio: data?.contrastRatio,
    };
  });
  const known = (s.known ?? []).filter(
    (k) => k.engine === undefined || k.engine === engine,
  );
  for (const k of known) {
    if (k.kind === "unmeasured" && k.reason === undefined) {
      throw new Error(
        `${label}: unmeasured entry within ${k.within} needs axe's reason (its messageKey) — see \`Known.reason\``,
      );
    }
  }
  const matches = await page.evaluate(
    ({ nodes, known }) => {
      // Each entry is consumed by one node unless it declares `many`, so an
      // entry written for one node cannot absorb a second of the same shape.
      const used = new Set<number>();
      return nodes.map((n) => {
        const els = [...document.querySelectorAll(n.target)];
        const i = known.findIndex((k, j) => {
          const { text, ratio } = k;
          return (
            (k.many === true || !used.has(j)) &&
            k.rule === n.rule &&
            k.kind === n.kind &&
            (k.reason === undefined || k.reason === n.why) &&
            (ratio === undefined ||
              (n.ratio !== undefined && Math.abs(n.ratio - ratio) <= 0.05)) &&
            els.length > 0 &&
            els.every((el) => el.closest(k.within) !== null) &&
            (text === undefined ||
              els.every((el) => (el.textContent ?? "").includes(text)))
          );
        });
        if (i >= 0) used.add(i);
        return i;
      });
    },
    { nodes, known },
  );

  const describe = (n: (typeof nodes)[number]) =>
    `${n.rule}${n.why ? ` (${n.why})` : ""}${n.ratio !== undefined ? ` ${String(n.ratio)}:1` : ""} @ ${n.target} — ${n.html}`;
  expect(
    nodes.filter((n, i) => n.kind === "fails" && matches[i] < 0).map(describe),
    `${label}: WCAG 2.2 AA violations not recorded as known failures`,
  ).toEqual([]);
  expect(
    nodes
      .filter((n, i) => n.kind === "unmeasured" && matches[i] < 0)
      .map(describe),
    `${label}: axe could not score these — make them measurable, or record each as \`unmeasured\` with the reason`,
  ).toEqual([]);
  expect(
    known
      .filter((_, i) => !matches.includes(i))
      .map(
        (k) =>
          `${k.kind}${k.reason ? ` (${k.reason})` : ""}: ${k.rule}${k.ratio !== undefined ? ` at ${String(k.ratio)}:1` : ""} within ${k.within} (${k.why})`,
      ),
    `${label}: entries that matched nothing — the failure is fixed or the element moved; remove or update them`,
  ).toEqual([]);

  for (const m of s.marks ?? []) {
    const fg = await computed(page, m.fg);
    const bg = await computed(page, m.bg);
    assertRatio(
      `${label}: ${m.name}`,
      contrast(fg, bg),
      m.min,
      m.fails,
      hex(fg),
      hex(bg),
    );
  }

  for (const p of s.pixels ?? []) {
    const box = await page.locator(p.at).boundingBox();
    if (!box) throw new Error(`${label}: ${p.at} is not rendered`);
    const cx = Math.floor(box.x + box.width / 2);
    const cy = Math.floor(box.y + box.height / 2);
    const fg = await pixel(page, cx, cy);
    const bg = await pixel(page, cx + p.beside[0], cy + p.beside[1]);
    assertRatio(
      `${label}: ${p.name}`,
      contrast(fg, bg),
      p.min,
      p.fails,
      hex(fg),
      hex(bg),
    );
  }
}

for (const c of cases) {
  const scans: { suffix: string; state?: State; scan: Scan }[] = [
    { suffix: "", scan: c },
    ...(c.states ?? []).map((s) => ({
      suffix: ` [${s.name}]`,
      state: s,
      scan: s,
    })),
  ];
  for (const s of scans) {
    test(`a11y: ${c.name}${s.suffix}`, async ({ mount, page, browserName }) => {
      test.skip(
        c.needsBaseSelect === true &&
          !(await page.evaluate(() =>
            CSS.supports("appearance", "base-select"),
          )),
        "the picker is the native popup here, outside the DOM scan",
      );
      await mount(c.node);
      await c.prepare?.(page);
      await s.state?.enter(page);
      await scan(page, browserName, `${c.name}${s.suffix}`, s.scan);
    });
  }
}
