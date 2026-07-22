import { unified } from "unified";
import remarkParse from "remark-parse";
import type { Nodes } from "mdast";

// Which element types have file-like fields, and which fields they are.
// This table is the single source of truth for "what counts as a local asset
// reference" — callers (VS Code extension file-existence checks, annotator
// manifest freezes, docs/CI tooling) depend on it instead of hard-coding
// field names like `file`.
//
// Order within each entry is the "field-declaration order" used to order
// results within a single element.
const FILE_FIELDS_BY_ELEMENT_TYPE: Record<string, readonly string[]> = {
  prompt: ["file"],
  image: ["file"],
  audio: ["file"],
  mediaPlayer: ["file", "captionsFile"],
  // timeline.source is a name reference to another element, not a file path
  timeline: [],
};

const PLACEHOLDER_PATTERN = /\$\{[^}]*\}/;
const FULL_URL_PATTERN = /^(?:https?:)?\/\//i;
// Platform-provided assets (see #188) live outside the repo — the host
// resolves them via `getAssetURL()`, so they aren't collectable as local
// files for bundling/manifest purposes. Match the whole `asset:` scheme
// (not just the `asset://` form) so a malformed opaque variant like
// `asset:clip.mp4` isn't silently misclassified as a local file path.
const ASSET_URI_PATTERN = /^asset:/i;

export interface ReferencedAsset {
  /** The raw path as it appears in the treatment YAML. */
  path: string;
  /** Which field the path came from (e.g. "file", "captionsFile", "url"). */
  field: string;
  /** The element type ("prompt", "mediaPlayer", "image", "audio", …). */
  elementType: string;
  /** Element name if the element has one. */
  elementName?: string;
  /** Location of the scalar value in the parsed object, useful for source
   *  mapping. `[…element path, fieldName]`. */
  pathInTree: (string | number)[];
}

function isCollectableLocalPath(value: unknown): value is string {
  if (typeof value !== "string") return false;
  if (value.length === 0) return false;
  if (PLACEHOLDER_PATTERN.test(value)) return false;
  if (FULL_URL_PATTERN.test(value)) return false;
  if (ASSET_URI_PATTERN.test(value)) return false;
  return true;
}

/**
 * Walk a parsed treatment file and return every local-asset path it
 * references, per the per-element-type allowlist above.
 *
 * Accepts `unknown` because callers typically pass the raw result of
 * parsing YAML — before schema validation — so that the asset list is
 * available even if the treatment doesn't yet validate. Non-object input
 * yields `[]`.
 *
 * Excludes template-placeholder paths (`${…}`), full URLs (`http://…`,
 * `https://…`, `//…`), `asset://…` platform-provided references (#188),
 * and empty strings. Order is stable tree-walk order (outer-to-inner,
 * then insertion order within each object), with field-declaration order
 * from the table above within a single element.
 */
export function getReferencedAssets(treatmentFile: unknown): ReferencedAsset[] {
  const results: ReferencedAsset[] = [];
  visitFileFields(treatmentFile, [], (info) => {
    if (!isCollectableLocalPath(info.value)) return;
    const asset: ReferencedAsset = {
      path: info.value,
      field: info.field,
      elementType: info.elementType,
      pathInTree: info.pathInTree,
    };
    if (info.elementName !== undefined) {
      asset.elementName = info.elementName;
    }
    results.push(asset);
  });
  return results;
}

// Matches the hierarchical `asset://<prefix>/…` form only (the mountable
// shape). The scheme is case-insensitive because `fileSchema` accepts
// `ASSET://`; `[^/]+` captures the prefix up to the first slash. An opaque
// `asset:clip.mp4` (no `//host`) has no mount prefix and is intentionally not
// matched.
const ASSET_PREFIX_PATTERN = /^asset:\/\/([^/]+)/i;

/**
 * Collect the distinct mount prefixes referenced by `asset://<prefix>/…` URIs
 * in a treatment (#192), using the same file-field allowlist as
 * {@link getReferencedAssets}.
 *
 * The `asset:` scheme match is case-insensitive (fileSchema accepts
 * `ASSET://`), but the prefix case is PRESERVED — it's a literal mount key a
 * host looks up exactly, so lowercasing it would break a mixed-case mount.
 * Prefixes that still contain a `${…}` template placeholder are skipped (they
 * can't be mounted until the field binds).
 *
 * Pass the EXPANDED (template-filled) treatment so a `${field}` inside a
 * prefix has already resolved to a concrete name. Non-object input yields
 * `[]`. Order is stable tree-walk order.
 */
export function collectAssetPrefixes(treatmentFile: unknown): string[] {
  const prefixes = new Set<string>();
  visitFileFields(treatmentFile, [], (info) => {
    if (typeof info.value !== "string") return;
    const match = ASSET_PREFIX_PATTERN.exec(info.value);
    if (!match) return;
    const prefix = match[1];
    // A prefix containing an unresolved `${…}` (or the start of one) isn't a
    // concrete mount key — skip it rather than mount a literal placeholder.
    if (prefix.includes("${")) return;
    prefixes.add(prefix);
  });
  return [...prefixes];
}

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

// A `unified` processor configured for CommonMark parsing only — NO remark-gfm.
// The renderer (`Markdown.tsx`) parses with GFM, but GFM only ever *wraps*
// inline images (in table cells, task-list items, strikethrough) — it never
// changes the set of `image` nodes, their `url`/`alt`, or their positions
// (verified against a GFM-heavy fixture). Omitting the extension keeps the
// image set identical to the renderer's while sidestepping GFM's even worse
// super-linear blow-up on adversarial input (~33× the core-CommonMark cost).
// The one known exception is negligible: an image that is the ENTIRE body of a
// GFM footnote definition (`[^f]: ![a](x.png)` with nothing else on the line)
// — core CommonMark reads that as a link definition, so the renderer shows the
// image but this doesn't report it. Any surrounding text makes it a paragraph
// and the image is found; a real footnote is essentially never a bare image.
const markdownParser = unified().use(remarkParse);

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

  const tree = markdownParser.parse(markdown);
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

/** Info passed to a {@link visitFileFields} callback for one file-like field. */
interface FileFieldVisit {
  /** The raw field value (may be any type; callers narrow to string). */
  value: unknown;
  field: string;
  elementType: string;
  elementName?: string;
  pathInTree: (string | number)[];
}

/**
 * Shared recursive walker behind {@link getReferencedAssets} and
 * {@link collectAssetPrefixes}: invokes `visit` once for every file-like field
 * (per {@link FILE_FIELDS_BY_ELEMENT_TYPE}) of every element in the tree, so
 * both callers stay pinned to the same field source-of-truth.
 */
function visitFileFields(
  node: unknown,
  path: (string | number)[],
  visit: (info: FileFieldVisit) => void,
): void {
  if (Array.isArray(node)) {
    node.forEach((item, i) => {
      visitFileFields(item, [...path, i], visit);
    });
    return;
  }

  if (node === null || typeof node !== "object") return;

  const record = node as Record<string, unknown>;
  const type = record.type;

  // `Object.hasOwn` rather than `in` so prototype-chain keys
  // (e.g. type: "toString") can't turn `fields` into a non-array.
  if (
    typeof type === "string" &&
    Object.hasOwn(FILE_FIELDS_BY_ELEMENT_TYPE, type)
  ) {
    const elementName =
      typeof record.name === "string" ? record.name : undefined;
    for (const field of FILE_FIELDS_BY_ELEMENT_TYPE[type]) {
      visit({
        value: record[field],
        field,
        elementType: type,
        elementName,
        pathInTree: [...path, field],
      });
    }
  }

  for (const [key, value] of Object.entries(record)) {
    visitFileFields(value, [...path, key], visit);
  }
}
