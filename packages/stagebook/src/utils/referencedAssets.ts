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

/** One inline image reference found in a markdown body. */
export interface MarkdownImageReference {
  /** The image destination path exactly as authored in the markdown. */
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

/**
 * Enumerate the local-asset paths referenced by inline `![alt](path)` images
 * in a markdown body — the piece `getReferencedAssets` can't see, because
 * prompt bodies live in external `*.prompt.md` files, not the treatment tree.
 *
 * Pure and I/O-free: callers that already hold a prompt body (the VS Code
 * extension, the runner's preflight, the manager) pass it in and merge the
 * result with `getReferencedAssets(treatment)` for the full dependency set.
 * The returned `path` is the raw authored string — resolution against a base
 * (treatment-relative, CDN-root, …) is a consumer concern and deliberately
 * left out here, exactly as `getReferencedAssets` returns raw paths.
 *
 * Mirrors what the RENDERER actually resolves rather than strict CommonMark:
 * `Markdown.tsx` rewrites images with the naive `/!\[(.*?)\]\((.*?)\)/` — alt
 * runs to the first `](`, the destination to the first `)` — then feeds that
 * destination to the host `resolveURL`. This scan reproduces that exactly, so
 * it catches every file the renderer will request (and thus every one that can
 * 404): a bare path may contain spaces (`![](my pic.jpg)`, a tested renderer
 * case) and a `]` may appear in the alt (`![Figure [A]](a.png)`). Titles and
 * `<…>` angle destinations are NOT special-cased — the renderer doesn't parse
 * them out, so they land in the destination verbatim (and, being unsupported,
 * resolve to a missing file, which is then correctly surfaced). Reference-style
 * images (`![a][ref]`) and raw `<img>` HTML stay out of scope: the renderer
 * resolves neither (the Markdown component loads no `rehype-raw`).
 *
 * Excludes the same non-local forms as `getReferencedAssets` (`${…}`
 * placeholders, `http(s)://`, protocol-relative `//`, `asset:`) plus every
 * other URI scheme (`data:`, `blob:`, …), evaluated on a whitespace-trimmed
 * copy so a *padded* URL/scheme is still excluded. The reported `path` is the
 * destination VERBATIM (surrounding whitespace kept) — the renderer requests
 * exactly that, so padded parens resolve to a missing file that this then
 * flags. Non-string / empty input yields `[]`.
 *
 * Not counted, because the renderer wouldn't render them as an image request:
 * - a `\![…](…)` with an escaped bang (CommonMark renders literal text);
 * - images inside fenced code blocks (```` ``` ```` or `~~~`, any info string,
 *   indented up to 3 spaces) — a fence closes only on a line of the same char
 *   at least as long as the opener, so a nested shorter fence doesn't end it.
 * Not tracked (rare, and each mirrors a renderer or block-parser edge we don't
 * reproduce): images whose alt text WRAPS across lines (the renderer's own
 * single-line rewrite regex also misses these, so they're already broken),
 * fences nested inside a blockquote/list, 4-space indented code blocks, and
 * `![](…)` inside a single-line `` `code span` ``.
 *
 * The scan is a linear `indexOf` walk (no backtracking regex, no length caps):
 * a `![![![…` run — where a backtracking matcher retries from every `![` and
 * goes O(n²) — costs one forward pass here, so an untrusted prompt body can't
 * trigger a ReDoS, and a long accessibility alt never disqualifies its image.
 */
export function getMarkdownImageReferences(
  markdown: unknown,
): MarkdownImageReference[] {
  if (typeof markdown !== "string" || markdown.length === 0) return [];
  const results: MarkdownImageReference[] = [];
  // Split on `\r?\n` so a CRLF file doesn't leave a trailing `\r` on every
  // line; line numbers stay aligned with what an editor shows.
  const lines = markdown.split(/\r?\n/);
  // When inside a fenced code block, the opener's fence char + length; else null.
  let fence: { char: string; len: number } | null = null;
  for (let lineNo = 0; lineNo < lines.length; lineNo++) {
    const line = lines[lineNo];
    // A fence may be indented up to 3 spaces (CommonMark); 4+ spaces is an
    // indented code block, a different construct we don't track.
    const fenceMatch = /^ {0,3}(`{3,}|~{3,})/.exec(line);
    if (fence) {
      // A closing fence is the same char, ≥ the opener's length, with nothing
      // but trailing whitespace after it (an info string is opener-only).
      if (
        fenceMatch &&
        fenceMatch[1][0] === fence.char &&
        fenceMatch[1].length >= fence.len &&
        line.slice(fenceMatch[0].length).trim() === ""
      ) {
        fence = null;
      }
      // Every line up to and including the close is code — never an image.
      continue;
    }
    if (fenceMatch) {
      fence = { char: fenceMatch[1][0], len: fenceMatch[1].length };
      continue;
    }
    let i = 0;
    while (i < line.length) {
      const bang = line.indexOf("![", i);
      if (bang < 0) break;
      // Shortest alt: the first `](` after the bang opens the destination.
      const destOpen = line.indexOf("](", bang + 2);
      // No `](` anywhere later on this line means no image can complete — the
      // early break is what keeps a `![![![…` run linear instead of O(n²).
      if (destOpen < 0) break;
      // Shortest destination: up to the first `)` (matching the renderer's
      // naive `.*?`, which stops there too).
      const destClose = line.indexOf(")", destOpen + 2);
      if (destClose < 0) break;
      // Skip an escaped bang (`\![…]`): an odd backslash run before the `!`
      // makes CommonMark render literal text — no image request.
      let backslashes = 0;
      for (let k = bang - 1; k >= 0 && line[k] === "\\"; k--) backslashes++;
      if (backslashes % 2 === 0) {
        // Report the destination VERBATIM — the renderer passes this exact
        // substring to `encodeAssetPath`/`resolveURL`, so padded parens
        // (`![](  x.png  )`) request `%20%20x.png%20%20` and 404. Reporting the
        // trimmed `x.png` would validate a file the broken image never loads.
        // The exclusion test runs on a TRIMMED copy so the anchored `^http(s)`
        // / `^asset:` / empty checks still reject a *padded* URL or blank ref.
        const path = line.slice(destOpen + 2, destClose);
        if (isCollectableMarkdownImagePath(path.trim())) {
          results.push({
            path,
            alt: line.slice(bang + 2, destOpen),
            line: lineNo,
            column: bang,
          });
        }
      }
      // Continue after this image's `)` — mirrors the renderer consuming the
      // whole `![…](…)` (including an escaped one) before matching again.
      i = destClose + 1;
    }
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
