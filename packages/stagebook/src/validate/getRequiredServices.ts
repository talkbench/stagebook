// Host primitive: analyze an expanded treatment for the external
// services it requires (#508).
//
// `getRequiredServices` is the third member of the host-facing analysis
// family stagebook ships alongside `getReferencedAssets` (→ asset
// mirror) and `checkPairing` (→ intro pairing): walk the expanded
// treatment tree, tell the host what infrastructure it must provision.
//
// A host that provisions study infrastructure (the manager) needs to
// know which external services a treatment uses so it can spawn exactly
// those and nothing more — a coedit pod, a forwarded Daily key,
// required Qualtrics credentials. That signal is split across files and
// is a moving target, so re-deriving it host-side rots the moment the
// DSL changes. This keeps the trigger→service mapping in lockstep with
// the schema, in one place.
//
// Trigger → service mapping (walk of the EXPANDED treatment):
//
//   coedit         prompt element, `shared: true`, whose referenced
//                  prompt file frontmatter is `type: openResponse`.
//                  The `shared` flag lives in the treatment YAML; the
//                  `type` lives in the separate `.prompt.md` file, so
//                  the frontmatter must be resolved via the injected
//                  loader (same injection shape as `loadAndMergeImports`).
//   video          stage `discussion` block, `chatType: video` or
//                  `audio` (→ Daily / WebRTC).
//   textChat       stage `discussion` block, `chatType: text`.
//   externalSurvey `type: qualtrics` element (needs Qualtrics creds).
//                  The native `type: survey` element is host-rendered
//                  and needs no external service.

import { load as loadYaml } from "js-yaml";
import { splitOnTopLevelHrules } from "../schemas/promptFile.js";

export interface RequiredServices {
  /** Any shared openResponse prompt → a paired coedit pod. */
  coedit: boolean;
  /** A discussion with `chatType` video/audio → Daily / WebRTC. */
  video: boolean;
  /** A discussion with `chatType` text → text chat only. */
  textChat: boolean;
  /** Any `qualtrics` element → external survey (Qualtrics creds). */
  externalSurvey: boolean;
  // Room to grow as new service-backed elements land.
}

export interface GetRequiredServicesOptions {
  /**
   * Resolve a prompt file's raw source given the `file:` path exactly as
   * it appears on the (expanded) treatment's prompt element. Same
   * injection shape as `loadAndMergeImports`' `loadImport`: the host
   * owns path resolution and I/O. Only called for prompts flagged
   * `shared: true`; a treatment with no shared prompts never invokes it.
   */
  loadPrompt: (path: string) => Promise<string>;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

/**
 * Read just the `type:` from a prompt file's frontmatter.
 *
 * Deliberately loose — it parses the frontmatter YAML directly rather
 * than running the full `promptFileSchema`, so a body-section problem
 * (a `>` marker mismatch, a stray delimiter) in an otherwise
 * openResponse prompt can't hide the fact that it IS openResponse and
 * so needs coedit. Anything we can't read as an openResponse type is
 * treated as "not coedit"; hosts call this on already-validated,
 * expanded treatments, so a malformed shared prompt is an upstream
 * error, not this primitive's concern.
 */
function isOpenResponsePrompt(source: string): boolean {
  const sections = splitOnTopLevelHrules(source.trim());
  // sections[0] is the empty string before the leading `---`;
  // sections[1] is the frontmatter YAML.
  if (sections.length < 2) return false;
  let metadata: unknown;
  try {
    metadata = loadYaml(sections[1]);
  } catch {
    return false;
  }
  return isRecord(metadata) && metadata.type === "openResponse";
}

interface WalkAccumulator {
  video: boolean;
  textChat: boolean;
  externalSurvey: boolean;
  /** `file:` paths of `shared: true` prompt elements, deduped so each
   *  file is loaded and parsed at most once. */
  sharedPromptFiles: Set<string>;
}

function walk(
  node: unknown,
  acc: WalkAccumulator,
  seen: WeakSet<object>,
): void {
  if (node === null || typeof node !== "object") return;
  // Guard against cyclic object graphs. YAML anchors/aliases can produce
  // genuine cycles (e.g. `a: &x { child: [*x] }`), which would otherwise
  // stack-overflow this recursive walk — and the input is treatment
  // source a study author controls.
  if (seen.has(node)) return;
  seen.add(node);

  if (Array.isArray(node)) {
    for (const item of node) walk(item, acc, seen);
    return;
  }

  const record = node as Record<string, unknown>;
  const type = record.type;

  // Shared open-response prompt → candidate for coedit. Resolve the
  // frontmatter after the walk (async), so here we only collect paths.
  if (
    type === "prompt" &&
    record.shared === true &&
    typeof record.file === "string"
  ) {
    acc.sharedPromptFiles.add(record.file);
  }

  if (type === "qualtrics") {
    acc.externalSurvey = true;
  }

  // Discussion block. `chatType` is unique to the discussion schema, so
  // gating on its enum values is a precise signal without needing to key
  // off the `discussion` parent key.
  const chatType = record.chatType;
  if (chatType === "video" || chatType === "audio") {
    acc.video = true;
  } else if (chatType === "text") {
    acc.textChat = true;
  }

  for (const value of Object.values(record)) walk(value, acc, seen);
}

/**
 * Walk an expanded treatment file and report the external services it
 * requires.
 *
 * Expects EXPANDED, import-merged input (e.g. the `merged` output of
 * `loadAndMergeImports` / `expandAndValidateWithImports`, or the host's
 * own hydration pipeline). Accepts `unknown` and returns all-false for a
 * non-object, mirroring `getReferencedAssets`' tolerance of pre-schema
 * input.
 *
 * Async because the coedit signal is split across files: `shared: true`
 * lives in the treatment YAML but `type: openResponse` lives in the
 * separate `.prompt.md`, so shared prompts' frontmatter must be resolved
 * via `opts.loadPrompt`. Loader errors propagate to the caller — a host
 * that can't read a referenced prompt should surface that rather than
 * silently under-provision.
 *
 * SCOPE: reports the union over EVERY treatment and intro sequence in
 * the file, not a selected launch subset — same whole-file contract as
 * `getReferencedAssets`. In a file that keeps pilot/control variants
 * together, an unlaunched arm's video discussion, qualtrics element, or
 * shared openResponse prompt therefore still flips the flag. That is the
 * safe direction (over- rather than under-provisioning), but a host that
 * wants per-launch precision should pass a tree narrowed to the selected
 * arms — the same selection it already passes to `checkPairing` — rather
 * than the whole merged file.
 */
export async function getRequiredServices(
  mergedFile: unknown,
  opts: GetRequiredServicesOptions,
): Promise<RequiredServices> {
  const acc: WalkAccumulator = {
    video: false,
    textChat: false,
    externalSurvey: false,
    sharedPromptFiles: new Set<string>(),
  };
  walk(mergedFile, acc, new WeakSet<object>());

  const openResponse = await Promise.all(
    [...acc.sharedPromptFiles].map(async (path) =>
      isOpenResponsePrompt(await opts.loadPrompt(path)),
    ),
  );

  return {
    coedit: openResponse.some(Boolean),
    video: acc.video,
    textChat: acc.textChat,
    externalSurvey: acc.externalSurvey,
  };
}
