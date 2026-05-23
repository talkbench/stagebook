import React, { useId } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { encodeAssetPath } from "../../utils/encodeAssetPath.js";

export interface MarkdownProps {
  text: string;
  resolveURL?: (path: string) => string;
}

// ---------------------------------------------------------------------------
// Inline styles for markdown elements
// ---------------------------------------------------------------------------
//
// Why inline styles instead of a stylesheet?
//
// Stagebook is consumed as a library. The same Stagebook study should render
// consistently across every host platform — that's the whole point of the
// portable treatment file. But hosts ship wildly different CSS environments:
// one ships Tailwind preflight, another ships Bootstrap reboot, another
// ships normalize.css, another ships nothing. CSS resets routinely collapse
// every heading level to body text size, so a researcher's `## Watch the
// clip` renders as a paragraph that happens to start with capital letters.
//
// Author CSS shipped from node_modules loses specificity battles against
// host CSS. Inline styles win against everything except !important, so
// prompt content renders with the intended hierarchy regardless of what
// the host's reset does. This is the same logic that makes Stagebook own
// button shapes, slider thumbs, and the media player controls — visual
// behavior is part of the contract, not a property of the host.
//
// State-dependent behavior (`:hover`, `:focus-visible`, `:visited`,
// `::marker`, `tr:nth-child`) is NOT expressible inline. A small
// `<style>` block scoped to a per-instance class (via `useId()`) adds
// just those pseudo-class rules — the host can't override them unless
// they also know the generated class name. Same pattern as Button /
// Slider / ListSorter.
//
// These styles are tunable, but not every value is exposed as a CSS
// custom property. Key typography and color values are variable-backed
// (heading sizes/weights, link color, body line-height, blockquote
// border/background, code background/font, prompt max-width). Spacing
// and structural values (margins, padding, list bullet style, em
// italics, strong weight) are hard-coded inline to keep the visual
// consistent across hosts. If a researcher needs to tune one of those,
// add a new variable in styles.css :root and reference it here.
//
// To override the exposed variables, set them on a parent element or
// :root — no selector-based CSS needed:
//
//   :root {
//     --stagebook-prompt-h1-size: 1.5rem;
//     --stagebook-prompt-line-height: 1.6;
//     --stagebook-link: #1e40af;
//   }
//
// See issue #33 for the full discussion.

const headingBase: React.CSSProperties = {
  lineHeight: 1.2,
  marginBlock: "0.75em 0.5em",
};

const h1Style: React.CSSProperties = {
  ...headingBase,
  fontSize: "var(--stagebook-prompt-h1-size, 1.875rem)",
  fontWeight: "var(--stagebook-prompt-h1-weight, 700)",
};

const h2Style: React.CSSProperties = {
  ...headingBase,
  fontSize: "var(--stagebook-prompt-h2-size, 1.5rem)",
  fontWeight: "var(--stagebook-prompt-h2-weight, 600)",
};

const h3Style: React.CSSProperties = {
  ...headingBase,
  fontSize: "var(--stagebook-prompt-h3-size, 1.25rem)",
  fontWeight: "var(--stagebook-prompt-h3-weight, 600)",
  marginBlock: "0.5em 0.25em",
};

const h4Style: React.CSSProperties = {
  ...headingBase,
  fontSize: "var(--stagebook-prompt-h4-size, 1.125rem)",
  fontWeight: "var(--stagebook-prompt-h4-weight, 600)",
  marginBlock: "0.5em 0.25em",
};

const h5Style: React.CSSProperties = {
  ...headingBase,
  fontSize: "var(--stagebook-prompt-h5-size, 1rem)",
  fontWeight: "var(--stagebook-prompt-h5-weight, 600)",
  marginBlock: "0.5em 0.25em",
};

const h6Style: React.CSSProperties = {
  ...headingBase,
  fontSize: "var(--stagebook-prompt-h6-size, 0.875rem)",
  fontWeight: "var(--stagebook-prompt-h6-weight, 600)",
  marginBlock: "0.5em 0.25em",
};

const pStyle: React.CSSProperties = {
  marginBlock: "0.5em",
};

const ulStyle: React.CSSProperties = {
  marginBlock: "0.5em",
  paddingInlineStart: "1.5em",
  listStyle: "disc",
};

const olStyle: React.CSSProperties = {
  marginBlock: "0.5em",
  paddingInlineStart: "1.5em",
  listStyle: "decimal",
};

const liStyle: React.CSSProperties = {
  marginBlock: "0.125em",
};

const strongStyle: React.CSSProperties = {
  // Match the browser-default <strong> weight so **bold** looks bold even
  // on hosts that strip the UA stylesheet.
  fontWeight: 700,
};

const emStyle: React.CSSProperties = {
  fontStyle: "italic",
};

// Neutralize host code-styling resets on the inner <code> of a
// fenced block. The outer <pre> already has the chip background;
// without these overrides, host CSS like VS Code's
// `code { background-color: var(--vscode-textPreformat-background); }`
// paints a per-line tint behind the text inside our chip. Background
// transparent + padding 0 defeats that without affecting the chip.
const fencedInnerCodeStyle: React.CSSProperties = {
  background: "transparent",
  padding: 0,
};

// Inline code only — `like this`. Fenced code blocks (```...```) get
// className="language-*" from react-markdown; the <pre> wrapper receives
// the block-level chip styling (see preStyle), so the inner <code> is
// passed through without its own background/padding to avoid a nested
// box look.
const inlineCodeStyle: React.CSSProperties = {
  fontFamily:
    "var(--stagebook-code-font, ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace)",
  fontSize: "0.9em",
  background: "var(--stagebook-code-bg, rgba(0,0,0,0.06))",
  padding: "0.1em 0.3em",
  borderRadius: "0.25rem",
};

// Fenced code block wrapper. react-markdown emits
// <pre><code class="language-*">...</code></pre>, so the <pre> carries
// all of the block-level chip styling (background, padding, radius,
// horizontal scroll). The inner <code> keeps only the font so the block
// doesn't render as a nested box. Tailwind preflight and similar resets
// strip the UA <pre> monospace font, so we reassert it here. See #215.
//
// `tabIndex={0}` is supplied unconditionally at the render site (not
// here) so every fenced block joins the tab order. We don't measure
// overflow at render time, so the simplest path is to make every
// block focusable; for non-overflowing blocks the tab stop is
// harmless (no scroll happens). Without this, keyboard users can't
// horizontally scroll long lines (WCAG 2.1.1). The `:focus-visible`
// ring is in the scoped <style> block.
const preStyle: React.CSSProperties = {
  background: "var(--stagebook-code-bg, rgba(0,0,0,0.06))",
  padding: "0.75rem 1rem",
  borderRadius: "0.375rem",
  overflowX: "auto",
  fontFamily:
    "var(--stagebook-code-font, ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace)",
  lineHeight: 1.4,
  marginBlock: "0.5em",
};

// Horizontal rule (`---`). Tailwind preflight ships `hr { border: 0 }`
// which makes the rule disappear entirely. Inline border-top wins on
// specificity and restores a visible rule on any host. We zero the other
// border sides so a future host rule like `hr { border-width: 1px }`
// doesn't accidentally give us a full box. See #215.
const hrStyle: React.CSSProperties = {
  border: 0,
  borderTopWidth: "1px",
  borderTopStyle: "solid",
  borderTopColor: "var(--stagebook-border, #d1d5db)",
  marginBlock: "1em",
};

/**
 * Compute the `rel` attribute for a markdown-rendered `<a>`. When the
 * link opens in a new tab (`target="_blank"`), append `noopener` and
 * `noreferrer` to whatever the source rel already contains so the new
 * tab can't reach back to `window.opener` (tab-nabbing) and the
 * destination doesn't receive a Referer header. Same security parity
 * shadcn / GitHub markdown extensions enforce.
 *
 * Exported so the contract is unit-testable without wiring rehype-raw
 * just to introduce a `target="_blank"` into the rendered DOM.
 */
export function computeSafeRel(
  target: string | undefined,
  rel: string | undefined,
): string | undefined {
  if (target !== "_blank") return rel;
  return rel ? `${rel} noopener noreferrer` : "noopener noreferrer";
}

// Only `text-decoration: underline` stays inline — the base color
// AND the `:hover` / `:focus-visible` / `:visited` overrides all
// live in the scoped <style> block. Putting the base color inline
// would block the hover/visited rules on specificity (inline beats
// any class selector, including pseudo-classes). Same trap as
// Slider / Button / TextArea — structural inline, state in CSS.
const aStyle: React.CSSProperties = {
  textDecoration: "underline",
};

// Shared with Display.tsx (intentional inline duplication, see issue #33).
// Both render <blockquote> and should look identical.
//
// Polish (#350 sweep): dropped the redundant inner maxWidth (parent
// already caps at 36rem), tightened padding to read taller-than-wide
// like a quote rather than a box, muted text color so the quote
// visually steps back from body text, bumped the default border to
// gray-400 in styles.css so the rail actually reads against the page.
const blockquoteStyle: React.CSSProperties = {
  wordBreak: "break-word",
  padding: "0.75rem 1rem",
  margin: "1rem 0",
  borderLeftWidth: "0.25rem",
  borderLeftStyle: "solid",
  borderLeftColor: "var(--stagebook-blockquote-border, #9ca3af)",
  background: "var(--stagebook-blockquote-bg, #f9fafb)",
  color: "var(--stagebook-text-muted, #6b7280)",
};

const imgStyle: React.CSSProperties = {
  maxWidth: "100%",
  height: "auto",
};

// GFM tables. Inlined (per issue #214) so tables render with borders and
// padding even on hosts that don't import styles.css. thead / tbody / tr
// have no handlers here — browser defaults are acceptable once the table
// itself has border-collapse and the cells have borders + padding.
//
// On narrow viewports the table now lives inside a horizontal-scroll
// wrapper (see tableWrapperStyle) so wide tables don't overflow the
// prompt container. Zebra striping and row hover are in the scoped
// <style> block (need `:nth-child` / `:hover`).
const tableWrapperStyle: React.CSSProperties = {
  overflowX: "auto",
  maxWidth: "var(--stagebook-prompt-max-width, 36rem)",
  marginBlock: "1rem",
};

const tableStyle: React.CSSProperties = {
  borderCollapse: "collapse",
  width: "100%",
};

const tableCellBase: React.CSSProperties = {
  border: "1px solid var(--stagebook-border, #d1d5db)",
  padding: "0.5rem 0.75rem",
  textAlign: "left",
  fontSize: "0.875rem",
  color: "var(--stagebook-table-text, #4a5568)",
};

const thStyle: React.CSSProperties = {
  ...tableCellBase,
  backgroundColor: "var(--stagebook-bg-muted, #f9fafb)",
  fontWeight: 500,
  color: "var(--stagebook-table-header-text, #1a202c)",
};

const tdStyle: React.CSSProperties = tableCellBase;

// GFM task-list checkboxes (`- [x]` / `- [ ]`). remark-gfm emits them as
// `<input type="checkbox" disabled [checked]>` inside a task-list <li>.
// Because they're disabled we don't need a focus ring, but the base +
// checked visuals still need to be inline so the checkbox stays a filled
// blue box on hosts without styles.css loaded (Tailwind preflight strips
// the default OS chrome via `appearance: none`). See issue #213.
const taskListCheckboxBaseStyle: React.CSSProperties = {
  appearance: "none",
  WebkitAppearance: "none",
  width: "1rem",
  height: "1rem",
  border: "1px solid var(--stagebook-border, #d1d5db)",
  borderRadius: "0.125rem",
  backgroundColor: "var(--stagebook-surface, #fff)",
  backgroundSize: "100% 100%",
  backgroundPosition: "center",
  backgroundRepeat: "no-repeat",
  verticalAlign: "middle",
  margin: "0 0.25rem 0 0",
};

const TASKLIST_CHECK_SVG =
  "url(\"data:image/svg+xml,%3csvg viewBox='0 0 16 16' fill='white' xmlns='http://www.w3.org/2000/svg'%3e%3cpath d='M12.207 4.793a1 1 0 010 1.414l-5 5a1 1 0 01-1.414 0l-2-2a1 1 0 011.414-1.414L6.5 9.086l4.293-4.293a1 1 0 011.414 0z'/%3e%3c/svg%3e\")";

const taskListCheckboxCheckedStyle: React.CSSProperties = {
  backgroundColor: "var(--stagebook-primary, #3b82f6)",
  borderColor: "var(--stagebook-primary, #3b82f6)",
  backgroundImage: TASKLIST_CHECK_SVG,
};

export function Markdown({ text, resolveURL }: MarkdownProps) {
  let displayText = text;

  // Rewrite relative image paths if a resolver is provided
  if (resolveURL) {
    displayText = text?.replace(
      /!\[(.*?)\]\((.*?)\)/g,
      (_match, alt: string, path: string) => {
        // Skip absolute URLs
        if (path.startsWith("http://") || path.startsWith("https://")) {
          return `![${alt}](${path})`;
        }
        // Encode the markdown source path before handing it to the
        // host's resolver — researchers write raw filesystem paths
        // (`images/my pic.jpg`), while the host's resolver returns an
        // already-encoded base. Encoding the resolved URL would
        // double-encode the host's intentional `%XX` sequences
        // (e.g. VS Code's `asWebviewUri` `%2B` → `%252B`). See #431.
        const resolved = resolveURL(encodeAssetPath(path));
        // Reject non-http protocols (e.g., javascript:)
        if (
          !resolved.startsWith("http://") &&
          !resolved.startsWith("https://") &&
          !resolved.startsWith("data:")
        ) {
          return `![${alt}](${path})`; // fall back to original path
        }
        return `![${alt}](${resolved})`;
      },
    );
  }

  // Per-instance class for pseudo-class rules. The previous
  // `id="markdown"` was a duplicate-id bug on any page rendering
  // multiple Markdown blocks (e.g. a stage with multiple Prompts).
  // useId() returns an opaque string; sanitize for use as a CSS
  // identifier (same regex as Button / Slider / ListSorter).
  const reactId = useId();
  const safeId = reactId.replace(/[^a-zA-Z0-9_-]/g, "");
  const rootClass = `stagebook-markdown-${safeId}`;

  return (
    <>
      <style>{`
        /* Base link color (in CSS, not inline) so the hover /
           visited rules below can override it. Underline lives
           inline so the link still reads as a link even if our
           <style> tag is stripped by something exotic. */
        .${rootClass} a {
          color: var(--stagebook-link, #2563eb);
        }
        /* Links — hover / focus-visible / visited. */
        .${rootClass} a:hover {
          color: var(--stagebook-link-hover, #1d4ed8);
        }
        .${rootClass} a:visited {
          color: var(--stagebook-link-visited, #7c3aed);
        }
        .${rootClass} a:focus-visible {
          outline: 2px solid var(--stagebook-focus-ring, rgba(59, 130, 246, 0.25));
          outline-offset: 2px;
          border-radius: 0.125rem;
        }
        /* Code blocks — keyboard scroll. The <pre> carries
           tabIndex={0} so keyboard users can horizontally scroll
           long lines (WCAG 2.1.1); the focus-visible ring tells
           them it's selected. */
        .${rootClass} pre:focus-visible {
          outline: 2px solid var(--stagebook-focus-ring, rgba(59, 130, 246, 0.25));
          outline-offset: 2px;
        }
        /* List markers — muted so the bullet/number reads as
           structure, not weight-competing with body text. */
        .${rootClass} li::marker {
          color: var(--stagebook-text-muted, #6b7280);
        }
        /* Tables — zebra striping (every other body row) +
           row hover. Cells already have borders + padding from
           the inline thStyle / tdStyle. */
        .${rootClass} tbody tr:nth-child(even) td {
          background-color: var(--stagebook-bg-muted, #f9fafb);
        }
        .${rootClass} tbody tr:hover td {
          background-color: var(--stagebook-hover-bg, #f3f4f6);
        }
        /* Reduced motion: there are no transitions here today,
           but if a future polish round adds one (link color
           transition, hover fade) this gate is in place. */
        @media (prefers-reduced-motion: reduce) {
          .${rootClass} * {
            transition: none !important;
          }
        }
      `}</style>
      <div
        className={rootClass}
        style={{
          maxWidth: "var(--stagebook-prompt-max-width, 36rem)",
          fontSize: "var(--stagebook-prompt-text-size, 1rem)",
          lineHeight: "var(--stagebook-prompt-line-height, 1.5)",
          color: "var(--stagebook-text, #1f2937)",
        }}
      >
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          components={{
            h1: ({ node: _node, ...props }) => (
              <h1 style={h1Style} {...props} />
            ),
            h2: ({ node: _node, ...props }) => (
              <h2 style={h2Style} {...props} />
            ),
            h3: ({ node: _node, ...props }) => (
              <h3 style={h3Style} {...props} />
            ),
            h4: ({ node: _node, ...props }) => (
              <h4 style={h4Style} {...props} />
            ),
            h5: ({ node: _node, ...props }) => (
              <h5 style={h5Style} {...props} />
            ),
            h6: ({ node: _node, ...props }) => (
              <h6 style={h6Style} {...props} />
            ),
            p: ({ node: _node, ...props }) => <p style={pStyle} {...props} />,
            ul: ({ node: _node, ...props }) => (
              <ul style={ulStyle} {...props} />
            ),
            ol: ({ node: _node, ...props }) => (
              <ol style={olStyle} {...props} />
            ),
            li: ({ node: _node, ...props }) => (
              <li style={liStyle} {...props} />
            ),
            strong: ({ node: _node, ...props }) => (
              <strong style={strongStyle} {...props} />
            ),
            em: ({ node: _node, ...props }) => (
              <em style={emStyle} {...props} />
            ),
            code: ({ node: _node, className, ...props }) => {
              // react-markdown v10 dropped the `inline` prop. Fenced code
              // blocks get className="language-*"; inline code has no
              // className. The inline variant gets the chip styling
              // (background, padding, radius); the fenced variant's
              // block-level chip is supplied by the surrounding <pre>
              // (preStyle), so we explicitly neutralize the inner
              // <code>'s background + padding. Host CSS sometimes
              // paints behind ALL <code> elements (VS Code's webview
              // does this via --vscode-textPreformat-background), so
              // an empty style would let that host rule render a
              // line-by-line chip behind the text inside the <pre>'s
              // outer chip. Setting background: transparent + padding: 0
              // defeats any host code-styling reset for the fenced case.
              // See #215.
              const isFenced =
                typeof className === "string" &&
                className.startsWith("language-");
              return isFenced ? (
                <code
                  className={className}
                  style={fencedInnerCodeStyle}
                  {...props}
                />
              ) : (
                <code style={inlineCodeStyle} {...props} />
              );
            },
            // `tabIndex={0}` puts the <pre> in the tab order so a
            // keyboard user can horizontally scroll long lines via
            // arrow keys. The :focus-visible ring (in the scoped
            // <style>) confirms selection.
            pre: ({ node: _node, ...props }) => (
              <pre style={preStyle} tabIndex={0} {...props} />
            ),
            hr: ({ node: _node, ...props }) => (
              <hr style={hrStyle} {...props} />
            ),
            // External links (anything with an explicit target=_blank
            // from the host or rehype-raw) get `rel="noopener
            // noreferrer"` for security parity with shadcn / GitHub.
            // No visual external-link arrow is added — adding chrome
            // to researcher-authored text would change what
            // participants see relative to the prompt source. If
            // researchers want an indicator they can write one.
            a: ({ node: _node, target, rel, ...props }) => (
              <a
                style={aStyle}
                target={target}
                rel={computeSafeRel(target, rel)}
                {...props}
                // Explicit tabIndex={0} so Safari includes the link
                // in the Tab order. macOS Safari skips <a> from the
                // default keyboard navigation unless the system
                // setting is on — explicit tabindex overrides that
                // (#419 / #415 / #413). Placed after {...props} so a
                // future rehype-raw integration with raw-HTML tabindex
                // can't accidentally re-enable the Safari skip.
                tabIndex={0}
              />
            ),
            blockquote: ({ node: _node, ...props }) => (
              <blockquote style={blockquoteStyle} {...props} />
            ),
            // `loading="lazy"` defers offscreen image loads, freeing
            // bandwidth for above-the-fold content in long prompts.
            // `decoding="async"` lets the browser decode off the main
            // thread. Both are no-ops on unsupported browsers.
            // Inline max-width keeps markdown-embedded images inside
            // the prompt container on any host, regardless of what
            // reset the host chose. See issue #211.
            img: ({ node: _node, ...props }) => (
              <img
                style={imgStyle}
                loading="lazy"
                decoding="async"
                {...props}
                alt={props.alt ?? ""}
              />
            ),
            // GFM tables (issue #214). The table itself lives inside a
            // horizontal-scroll wrapper so wide tables on narrow
            // viewports don't overflow the prompt container. Zebra
            // striping + row hover come from the scoped <style> block
            // (need :nth-child / :hover, not inline-expressible).
            table: ({ node: _node, ...props }) => (
              <div style={tableWrapperStyle}>
                <table style={tableStyle} {...props} />
              </div>
            ),
            th: ({ node: _node, ...props }) => (
              <th style={thStyle} {...props} />
            ),
            td: ({ node: _node, ...props }) => (
              <td style={tdStyle} {...props} />
            ),
            // GFM task-list checkboxes (#213). The task-list input is
            // rendered as a disabled <input type="checkbox">, so no focus
            // ring is needed — but the base + checked visuals still need
            // inline styling to survive hosts without styles.css. Other
            // `<input>` types emitted from raw HTML (if any ever passed
            // through rehype-raw) aren't styled here; the contract is
            // specifically about the GFM task-list case.
            input: ({ node: _node, type, checked, ...props }) => {
              if (type !== "checkbox") {
                return <input type={type} checked={checked} {...props} />;
              }
              return (
                <input
                  type="checkbox"
                  checked={checked}
                  {...props}
                  style={{
                    ...taskListCheckboxBaseStyle,
                    ...(checked ? taskListCheckboxCheckedStyle : {}),
                  }}
                />
              );
            },
          }}
        >
          {displayText}
        </ReactMarkdown>
      </div>
    </>
  );
}
