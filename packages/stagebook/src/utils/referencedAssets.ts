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

// Exported for `markdownImageReferences.ts` (kept in a separate module so its
// CommonMark parser can be tree-shaken from bundles that don't enumerate
// markdown — see that file's header). Not re-exported from the package barrel;
// it's an internal predicate.
export function isCollectableLocalPath(value: unknown): value is string {
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
