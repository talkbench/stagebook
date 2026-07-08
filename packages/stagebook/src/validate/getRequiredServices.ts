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
//
// The result is keyed BY ARM (per treatment, per intro sequence, per
// consent arm) plus an `overall` whole-file union. A launch selects
// (treatment set) × (intro sequence) × (consent arm) — the treatment/
// intro axes are exactly `checkPairing`'s inputs, and consent is
// selected separately by `consentName` — so a host that keeps pilot/
// control variants in one file can provision precisely what the SELECTED
// arms need instead of the whole file's union. coedit, video and
// textChat are game-stage-only, so they only ever surface under
// `byTreatment`; `externalSurvey` is the one that can also come from an
// intro sequence or a consent arm (a Qualtrics consent/demographics
// step), which is why those are reported as their own keyed axes.

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

export interface RequiredServicesReport {
  /**
   * Union over the ENTIRE file — every treatment and intro sequence. The
   * safe whole-file default (over- rather than under-provisioning) for a
   * host that doesn't narrow to selected arms.
   */
  overall: RequiredServices;
  /**
   * Per-treatment needs, keyed by treatment `name`. coedit / video /
   * textChat are game-stage-only, so they surface here (never under an
   * intro sequence).
   */
  byTreatment: Record<string, RequiredServices>;
  /**
   * Per-intro-sequence needs, keyed by intro sequence `name`. In
   * practice only `externalSurvey` can originate here (a Qualtrics step);
   * intro/exit steps carry no `discussion` and may not host `shared`
   * prompts, so coedit / video / textChat stay false.
   */
  byIntroSequence: Record<string, RequiredServices>;
  /**
   * Per-consent-arm needs, keyed by consent arm `name` (the top-level
   * `consent:` collection, #481 — a launch axis selected by `consentName`
   * separate from treatments and intro sequences). Consent steps reuse
   * the intro/exit step shape, so — like intro sequences — only
   * `externalSurvey` can originate here (a Qualtrics consent form).
   */
  byConsent: Record<string, RequiredServices>;
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
 * OR-combine several `RequiredServices` into one. A host computes a
 * launch's needs by merging the selected arms:
 *
 *   const needs = mergeRequiredServices(
 *     ...treatmentNames.map((t) => report.byTreatment[t]),
 *     report.byIntroSequence[introSequenceName],
 *   );
 *
 * Undefined entries (an unknown arm name) are skipped, so a missing key
 * contributes nothing rather than throwing.
 */
export function mergeRequiredServices(
  ...services: (RequiredServices | undefined)[]
): RequiredServices {
  const present = services.filter(
    (s): s is RequiredServices => s !== undefined,
  );
  return {
    coedit: present.some((s) => s.coedit),
    video: present.some((s) => s.video),
    textChat: present.some((s) => s.textChat),
    externalSurvey: present.some((s) => s.externalSurvey),
  };
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

interface ScopeScan {
  video: boolean;
  textChat: boolean;
  externalSurvey: boolean;
  /** `file:` paths of `shared: true` prompt elements found in this
   *  scope, deduped. Resolved to coedit after the walk. */
  sharedPromptFiles: Set<string>;
}

function newScan(): ScopeScan {
  return {
    video: false,
    textChat: false,
    externalSurvey: false,
    sharedPromptFiles: new Set<string>(),
  };
}

// A `${...}` template placeholder that survived expansion (e.g. an
// unbound field in an `allowUnresolved` parse). We never hand such a
// path to `loadPrompt` — it isn't a real file — mirroring how
// `getReferencedAssets` excludes placeholder paths.
const PLACEHOLDER_PATTERN = /\$\{[^}]*\}/;

/** Classify a node reached AS a stage/step element (an item of an
 *  `elements:` array). Detection is deliberately scoped to this position
 *  rather than "any node with `type: prompt`" so a matching object inside
 *  an opaque `z.unknown()` bag (e.g. a discussion layout feed's
 *  `options`) isn't mistaken for a real element. */
function classifyElement(el: Record<string, unknown>, acc: ScopeScan): void {
  const type = el.type;
  // Shared open-response prompt → candidate for coedit. Only the path is
  // collected here; the frontmatter is resolved (async) after the walk.
  if (
    type === "prompt" &&
    el.shared === true &&
    typeof el.file === "string" &&
    !PLACEHOLDER_PATTERN.test(el.file)
  ) {
    acc.sharedPromptFiles.add(el.file);
  }
  if (type === "qualtrics") {
    acc.externalSurvey = true;
  }
}

/** Classify a node reached AS a stage's `discussion:` block. `chatType`
 *  is the discussion schema's enum; gating on its values is precise. */
function classifyDiscussion(d: Record<string, unknown>, acc: ScopeScan): void {
  const chatType = d.chatType;
  if (chatType === "video" || chatType === "audio") {
    acc.video = true;
  } else if (chatType === "text") {
    acc.textChat = true;
  }
}

function walk(node: unknown, acc: ScopeScan, seen: WeakSet<object>): void {
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

  // Classify by the KEY a child sits under, not by finding `type:`
  // anywhere — so service triggers can only come from real DSL positions
  // (`elements:` items, a `discussion:` block), never from arbitrary
  // opaque config values. Still recurse into every value so nested
  // stages/steps deeper in the tree are reached.
  const record = node as Record<string, unknown>;
  for (const [key, value] of Object.entries(record)) {
    if (key === "elements" && Array.isArray(value)) {
      for (const item of value) if (isRecord(item)) classifyElement(item, acc);
    } else if (key === "discussion" && isRecord(value)) {
      classifyDiscussion(value, acc);
    }
    walk(value, acc, seen);
  }
}

/** Walk one subtree into a fresh scope scan. */
function scan(node: unknown): ScopeScan {
  const acc = newScan();
  walk(node, acc, new WeakSet<object>());
  return acc;
}

/** Named top-level records under `key` (treatments / introSequences),
 *  paired with their `name`. Unnamed or non-record entries are dropped —
 *  they can't be a launch-selection target. */
function namedEntries(
  root: Record<string, unknown>,
  key: string,
): { name: string; node: Record<string, unknown> }[] {
  const list = Array.isArray(root[key]) ? (root[key] as unknown[]) : [];
  const out: { name: string; node: Record<string, unknown> }[] = [];
  for (const item of list) {
    if (isRecord(item) && typeof item.name === "string") {
      out.push({ name: item.name, node: item });
    }
  }
  return out;
}

/**
 * Walk an expanded treatment file and report the external services it
 * requires, keyed by arm.
 *
 * Expects a fully HYDRATED tree — imports merged AND templates expanded
 * (`fillTemplates` run), e.g. `parseTreatmentSource(...).data` or the
 * host's own hydration pipeline. A merely import-merged tree
 * (`loadAndMergeImports().merged`) is NOT enough: it still carries
 * `templates:` definitions and unsubstituted `${...}` fields, which would
 * leak triggers from unused templates and produce placeholder prompt
 * paths. (Defensively, a top-level `templates:` key is dropped from the
 * `overall` walk and `${...}` prompt paths are skipped, but the arm-level
 * maps assume expanded input.) Accepts `unknown`; a non-object yields an
 * all-false `overall` and empty maps, mirroring `getReferencedAssets`'
 * tolerance of pre-schema input.
 *
 * Async because the coedit signal is split across files: `shared: true`
 * lives in the treatment YAML but `type: openResponse` lives in the
 * separate `.prompt.md`, so shared prompts' frontmatter must be resolved
 * via `opts.loadPrompt`. Every referenced shared prompt is loaded at
 * most once across all arms; loader errors propagate to the caller — a
 * host that can't read a referenced prompt should surface that rather
 * than silently under-provision.
 *
 * Returns `{ overall, byTreatment, byIntroSequence, byConsent }`.
 * `overall` is the whole-file union (the safe default for a host that
 * provisions per file); the per-arm maps let a host that keeps pilot/
 * control variants together provision precisely what the SELECTED arms
 * need — merge the selected treatments, intro sequence and consent arm
 * with `mergeRequiredServices` (the treatment × intro selection is the
 * same one it passes to `checkPairing`; consent is selected by
 * `consentName`).
 */
export async function getRequiredServices(
  mergedFile: unknown,
  opts: GetRequiredServicesOptions,
): Promise<RequiredServicesReport> {
  const root = isRecord(mergedFile) ? mergedFile : {};

  // `overall` is a genuine whole-file walk (not the union of the maps),
  // so any stray or unnamed service-bearing content is still caught in
  // the safe over-provisioning direction. Drop a top-level `templates:`
  // key first: template DEFINITIONS aren't launchable content, and a
  // caller that passed a merely import-merged (not template-expanded)
  // tree would otherwise leak service triggers from unused templates.
  const { templates: _templates, ...withoutTemplates } = root;
  void _templates;
  const overallScan = scan(
    isRecord(mergedFile) ? withoutTemplates : mergedFile,
  );
  const scanEntries = (key: string) =>
    namedEntries(root, key).map((e) => ({ name: e.name, scan: scan(e.node) }));
  const treatments = scanEntries("treatments");
  const introSequences = scanEntries("introSequences");
  const consent = scanEntries("consent");

  // Resolve every referenced shared prompt exactly once across all
  // scopes, then answer coedit per scope from the shared cache.
  const allScans: ScopeScan[] = [
    overallScan,
    ...[...treatments, ...introSequences, ...consent].map((e) => e.scan),
  ];
  const allSharedFiles = new Set<string>();
  for (const s of allScans) {
    for (const f of s.sharedPromptFiles) allSharedFiles.add(f);
  }
  const openResponseByFile = new Map<string, boolean>();
  await Promise.all(
    [...allSharedFiles].map(async (path) => {
      const isOpen = isOpenResponsePrompt(await opts.loadPrompt(path));
      openResponseByFile.set(path, isOpen);
    }),
  );

  const toServices = (s: ScopeScan): RequiredServices => ({
    coedit: [...s.sharedPromptFiles].some(
      (f) => openResponseByFile.get(f) === true,
    ),
    video: s.video,
    textChat: s.textChat,
    externalSurvey: s.externalSurvey,
  });

  // Key by arm `name` into a null-prototype map so a schema-valid but
  // hostile arm name (`__proto__`, `constructor`) can't rebind the map's
  // prototype and become enumeration-invisible — a narrowing host must
  // be able to see and look up every arm. Duplicate names are folded
  // (OR) rather than letting a later entry silently drop an earlier
  // one's needs.
  const keyed = (
    entries: { name: string; scan: ScopeScan }[],
  ): Record<string, RequiredServices> => {
    const map: Record<string, RequiredServices> = Object.create(null);
    for (const { name, scan: s } of entries) {
      map[name] = mergeRequiredServices(map[name], toServices(s));
    }
    return map;
  };

  return {
    overall: toServices(overallScan),
    byTreatment: keyed(treatments),
    byIntroSequence: keyed(introSequences),
    byConsent: keyed(consent),
  };
}
