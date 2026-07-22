import { fromMarkdown } from "mdast-util-from-markdown";
import type { Nodes } from "mdast";
import { isCollectableLocalPath } from "./referencedAssets.js";

// Parse with `mdast-util-from-markdown` — the low-level CommonMark parser that
// `remark-parse` wraps and that `react-markdown` (the renderer) itself uses —
// NOT `unified().use(remarkParse)`. The `unified` processor drags in `vfile`,
// whose `minurl` module imports Node built-ins (`path`, `process`, `url`).
// `getMarkdownImageReferences` is re-exported from the `stagebook` barrel, which
// the browser-facing `stagebook`, `stagebook/viewer`, and `stagebook/components`
// entries transitively import — so bundling `vfile` broke the VS Code webview
// and the viewer app's browser builds ("path has been externalized …",
// "fileURLToPath is not exported"). `mdast-util-from-markdown` produces the
// IDENTICAL mdast (same `image` / `imageReference` nodes, urls, and positions)
// with no Node built-ins, so it bundles cleanly for every consumer. Kept in its
// own module (separate from `referencedAssets.ts`) so a bundler that never calls
// this can still drop the parser. See #576 / #577.

// Any RFC 3986 URI scheme (`data:`, `mailto:`, `blob:`, `file:`, `http:`,
// `asset:`, …). A local file path never carries a scheme; a scheme means the
// destination is an embedded (`data:`) or remote asset the host doesn't bundle
// as a local file. Mirrors `encodeAssetPath`'s scheme detector so the two
// agree on what counts as "already a URI". `isCollectableLocalPath` already
// rejects `http(s)://`, protocol-relative `//`, and `asset:`; this additionally
// catches `data:` (common in markdown) and every other scheme.
const URI_SCHEME_PATTERN = /^[a-z][a-z0-9+.-]*:/i;

// Perf guard for the CommonMark parse below. remark/micromark is linear on
// normal prose, but has super-linear (O(n²)) worst cases on adversarial input —
// most sharply its emphasis (attention) resolver on a `*_*_*_…` run: ~0.6s to
// parse a 10 KB run, ~1.5s at 16 KB, ~4s at 32 KB, ~90s at 100 KB. This runs
// SERVER-SIDE (preflight / manager / annotator / the VS Code extension host),
// so an unbounded parse of a hostile researcher-authored body would block the
// event loop and starve co-tenants. Real prompt bodies are a few KB (the repo's
// largest is ~2.4 KB), so this cap (~1600 words) sits well above any realistic
// prompt while keeping even the worst observed parse under ~1s. A skipped
// over-cap body simply isn't enumerated — the renderer parses the same body, so
// an oversized adversarial body is a rendering-time problem regardless, and
// preflight enumeration is advisory (a missed image surfaces as a runtime 404,
// not silent corruption). The cap is deliberately coarse: it bounds the worst
// case we can observe rather than proving no super-linear case exists past it.
const MAX_MARKDOWN_LENGTH = 10_000;

// `fromMarkdown` parses core CommonMark only — NO remark-gfm. The renderer
// (`Markdown.tsx`) parses with GFM, but GFM only ever *wraps* inline images (in
// table cells, task-list items, strikethrough) — it never changes the set of
// `image` nodes, their `url`/`alt`, or their positions (verified against a
// GFM-heavy fixture). Staying core keeps the image set identical to the
// renderer's while sidestepping GFM's even worse super-linear blow-up on
// adversarial input (~33× the core-CommonMark cost). The one known exception is
// negligible: an image that is the ENTIRE body of a GFM footnote definition
// (`[^f]: ![a](x.png)` with nothing else on the line) — core CommonMark reads
// that as a link definition, so the renderer shows the image but this doesn't
// report it. Any surrounding text makes it a paragraph and the image is found;
// a real footnote is essentially never a bare image.

/** One inline image reference found in a markdown body. */
export interface MarkdownImageReference {
  /** The image destination path, CommonMark-parsed (titles, `<…>` angle
   *  brackets, and surrounding whitespace already stripped). */
  path: string;
  /** The image's alt text (may be an empty string). */
  alt: string;
  /** 0-based line of the image syntax within the markdown string. */
  line: number;
  /** 0-based column (UTF-16 offset) of the leading `!` within its line. */
  column: number;
}

function isCollectableMarkdownImagePath(path: string): boolean {
  // Reuse the element-field rules (empty / `${…}` placeholder / `http(s)://`
  // / protocol-relative / `asset:`), then also drop any other URI scheme so a
  // `data:` (or `blob:`, `mailto:`, …) embedded asset isn't mistaken for a
  // local file to bundle.
  if (!isCollectableLocalPath(path)) return false;
  if (URI_SCHEME_PATTERN.test(path)) return false;
  return true;
}

// One image found in the tree, normalized to a raw destination + alt + 0-based
// position. Covers both inline (`![alt](url)`) and reference (`![alt][id]`)
// images, so the two are collected uniformly.
interface ParsedImage {
  url: string;
  alt: string;
  line: number;
  column: number;
}

// First pass: map every link/image reference definition (`[id]: url`) by its
// (normalized, case-insensitive) identifier. Per CommonMark the FIRST
// definition for an identifier wins, so we never overwrite.
function collectDefinitions(node: Nodes, into: Map<string, string>): void {
  if (node.type === "definition") {
    if (!into.has(node.identifier)) into.set(node.identifier, node.url);
  }
  if ("children" in node) {
    for (const child of node.children) collectDefinitions(child, into);
  }
}

// Second pass: collect every inline and reference image in document (tree)
// order. Images are phrasing leaves, but they appear inside paragraphs, table
// cells, list items, blockquotes, links, etc., so we descend through any node
// that has `children`. Reference images (`![alt][id]`) are resolved against
// `definitions` — the renderer (react-markdown) resolves them too, so we must,
// to stay in lockstep. (An UNDEFINED reference never parses to an
// `imageReference` node in the first place, so it's excluded for free.)
function collectImages(
  node: Nodes,
  definitions: Map<string, string>,
  into: ParsedImage[],
): void {
  if (node.type === "image" || node.type === "imageReference") {
    const url =
      node.type === "image" ? node.url : definitions.get(node.identifier);
    if (url !== undefined) {
      const start = node.position?.start;
      into.push({
        url,
        alt: node.alt ?? "",
        // mdast positions are 1-based line/column; convert to the 0-based
        // convention callers map into editor locations. Position is always
        // present when parsing from a string, but default defensively.
        line: start ? start.line - 1 : 0,
        column: start ? start.column - 1 : 0,
      });
    }
    return;
  }
  if ("children" in node) {
    for (const child of node.children) collectImages(child, definitions, into);
  }
}

/**
 * Enumerate the local-asset paths referenced by inline `![alt](path)` images
 * in a markdown body — the piece `getReferencedAssets` can't see, because
 * prompt bodies live in external `*.prompt.md` files, not the treatment tree.
 *
 * Pure and I/O-free: callers that already hold a prompt body (the VS Code
 * extension, the runner's preflight, the manager) pass it in and merge the
 * result with `getReferencedAssets(treatment)` for the full dependency set.
 * The returned `path` is the parsed destination — resolution against a base
 * (treatment-relative, CDN-root, …) is a consumer concern and deliberately
 * left out here, exactly as `getReferencedAssets` returns raw paths.
 *
 * Parses with the SAME CommonMark grammar the renderer (`Markdown.tsx` →
 * `react-markdown`) uses, so it flags exactly what the renderer requests (#576).
 * This means proper CommonMark semantics, not a regex/substring approximation:
 * titles are stripped (`![a](x.png "t")` → `x.png`), `<…>` angle destinations
 * are unwrapped (`![a](<my pic.png>)` → `my pic.png`), balanced parens survive
 * (`image(1).png`), surrounding whitespace is trimmed, bracketed alt is handled
 * (`![Figure [A]](a.png)`), and alt text may wrap across lines. A destination
 * containing an unescaped space is NOT an image (`![a](my pic.jpg)` renders as
 * literal text) and is therefore not reported — the angle-bracket form is the
 * supported way to embed a space. Reference-style images (`![alt][id]`,
 * collapsed `![id][]`, shortcut `![id]`) ARE reported — the renderer resolves
 * them against their `[id]: url` definition, so we resolve them the same way.
 *
 * Excludes the same non-local forms as `getReferencedAssets` (`${…}`
 * placeholders, `http(s)://`, protocol-relative `//`, `asset:`) plus every
 * other URI scheme (`data:`, `blob:`, …). Non-string / empty input yields `[]`.
 *
 * Not counted, because the renderer wouldn't render them as an image request:
 * an escaped bang (`\![…](…)`, literal text), images inside fenced or indented
 * code blocks and code spans, an unresolved reference (`![a][missing]` with no
 * definition), and raw `<img>` HTML (the Markdown component loads no
 * `rehype-raw`) — all handled for free by the CommonMark parse. Positions are
 * the mdast node's 0-based line/column (UTF-16) of the leading `!`.
 *
 * A real parse replaces the old substring scan: there is no regex over
 * untrusted text, and a `![![…` run resolves in near-linear time. A length cap
 * ({@link MAX_MARKDOWN_LENGTH}) bounds remark's super-linear worst cases on an
 * adversarial body (see that constant); an over-cap body yields `[]`.
 */
export function getMarkdownImageReferences(
  markdown: unknown,
): MarkdownImageReference[] {
  if (typeof markdown !== "string" || markdown.length === 0) return [];
  if (markdown.length > MAX_MARKDOWN_LENGTH) return [];

  const tree = fromMarkdown(markdown);
  const definitions = new Map<string, string>();
  collectDefinitions(tree, definitions);
  const images: ParsedImage[] = [];
  collectImages(tree, definitions, images);

  const results: MarkdownImageReference[] = [];
  for (const image of images) {
    if (!isCollectableMarkdownImagePath(image.url)) continue;
    results.push({
      path: image.url,
      alt: image.alt,
      line: image.line,
      column: image.column,
    });
  }
  return results;
}
