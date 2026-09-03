/**
 * Renders the same six heading levels twice: once as the host's own bare
 * tags, once as researcher markdown. `host-typography.ct.tsx` injects the
 * real `stagebook/host-typography` stylesheet over this and compares the two
 * surfaces post-cascade (#607).
 *
 * Lives in its own module because Playwright CT can only mount components
 * defined outside the test file.
 */
import React from "react";
import { Markdown } from "../form/Markdown.js";

const LEVELS = [1, 2, 3, 4, 5, 6] as const;

const HEADING_TEXT = "Check your headphones now";

const MARKDOWN_HEADINGS = LEVELS.map(
  (level) => `${"#".repeat(level)} ${HEADING_TEXT}`,
).join("\n\n");

export function HeadingSurfaces() {
  return (
    <>
      <div data-surface="bare">
        <h1>{HEADING_TEXT}</h1>
        <h2>{HEADING_TEXT}</h2>
        <h3>{HEADING_TEXT}</h3>
        <h4>{HEADING_TEXT}</h4>
        <h5>{HEADING_TEXT}</h5>
        <h6>{HEADING_TEXT}</h6>
      </div>
      <div data-surface="markdown">
        <Markdown text={MARKDOWN_HEADINGS} />
      </div>
    </>
  );
}
