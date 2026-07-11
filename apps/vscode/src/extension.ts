import * as path from "path";
import * as vscode from "vscode";
import {
  type Diagnostic,
  validateTreatmentWithDiff,
  validatePromptSource,
  pathToRange,
  expandAndValidateWithImports,
  parseTreatmentSource,
  type ParseResult,
} from "stagebook/validate";
import {
  computeSemanticTokens,
  type SemanticTokenType,
} from "./lib/semanticTokens";
import { findClosestMatch } from "./lib/levenshtein";
import { UnrecognizedKeyQuickFixProvider } from "./lib/unrecognizedKeyQuickFix";
import { isWithinWorkspace, relativizePath } from "./lib/filePaths";
import { runPool } from "./lib/runPool";
import { buildFindExcludeGlob } from "./lib/findExclude";
import {
  summarizeDiagnostics,
  formatValidationStatusBar,
  type DiagnosticSeverityLabel,
} from "./lib/diagnosticSummary";
import {
  ASSET_GLOB,
  buildCompletionGlob,
  parseFilePathCompletionContext,
} from "./lib/filePathCompletion";
import { getReferencedAssets, collectAssetPrefixes } from "stagebook";
import {
  ASSET_MOUNTS_STATE_KEY,
  mergeAssetMounts,
  splitAssetMounts,
  extraAssetRoots,
  parseMountedAsset,
} from "./lib/assetMounts";

const diagnosticCollection =
  vscode.languages.createDiagnosticCollection("stagebook");

const EXPANDED_SCHEME = "stagebook-expanded";

const DEBOUNCE_MS = 300;
const debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();

/** Version counter per document URI — used to discard stale async results. */
const validationVersions = new Map<string, number>();

/**
 * Last source text successfully (or unsuccessfully) validated per document
 * URI. When `validateDocument` is re-invoked on the same URI with identical
 * source — typical for `onDidOpenTextDocument` / `onDidChangeActiveTextEditor`
 * after tab focus changes that don't actually mutate text — we skip the
 * full parse + import-load + double-schema-pass pipeline. With large
 * broadcast-expanded treatments the validation pass is several seconds of
 * sync Zod recursion, so eliminating these redundant fires is the biggest
 * single user-facing CPU win in the extension host.
 *
 * Caveat: the cache key is the *root* document's source only. If a file
 * referenced via `imports:` changes, the root's validation result may be
 * stale even though its own source didn't change. The cache is invalidated
 * on every edit to the root doc; an import edit will re-fire on save when
 * the user touches the root, or via the existing onDidChange flow for the
 * import doc itself. A more aggressive cross-file cache could watch import
 * paths explicitly — out of scope for this pass.
 */
const lastValidatedSource = new Map<string, string>();

function isStagebookYaml(document: vscode.TextDocument): boolean {
  return (
    document.languageId === "stagebookYaml" ||
    document.fileName.endsWith(".stagebook.yaml")
  );
}

function isStagebookPrompt(document: vscode.TextDocument): boolean {
  return (
    document.languageId === "stagebookPrompt" ||
    document.fileName.endsWith(".prompt.md")
  );
}

function validateDocument(document: vscode.TextDocument): void {
  // The expanded-preview virtual documents also carry the stagebookYaml
  // language (for syntax highlighting), but their diagnostics are owned by
  // ExpandedTemplatesProvider. Skip them here to avoid clobbering.
  if (document.uri.scheme === EXPANDED_SCHEME) return;

  if (isStagebookYaml(document)) {
    validateTreatmentFile(document);
  } else if (isStagebookPrompt(document)) {
    validatePromptFile(document);
  } else {
    diagnosticCollection.delete(document.uri);
  }
}

function validateDocumentDebounced(document: vscode.TextDocument): void {
  const key = document.uri.toString();
  const existing = debounceTimers.get(key);
  if (existing) clearTimeout(existing);

  debounceTimers.set(
    key,
    setTimeout(() => {
      debounceTimers.delete(key);
      validateDocument(document);
    }, DEBOUNCE_MS),
  );
}

function toSeverity(
  severity: Diagnostic["severity"],
): vscode.DiagnosticSeverity {
  return severity === "warning"
    ? vscode.DiagnosticSeverity.Warning
    : vscode.DiagnosticSeverity.Error;
}

function toVscodeRange(range: Diagnostic["range"]): vscode.Range {
  if (!range) {
    return new vscode.Range(0, 0, 0, 0);
  }
  return new vscode.Range(
    range.startLine,
    range.startCol,
    range.endLine,
    range.endCol,
  );
}

function validateTreatmentFile(document: vscode.TextDocument): Promise<void> {
  return validateTreatmentSourceAt(document.uri, document.getText());
}

/**
 * Validate a treatment from `(uri, source)` without requiring a live
 * `vscode.TextDocument`. Used both for open editors (via
 * `validateTreatmentFile`) and for on-disk files swept by the
 * "Validate Workspace" command. Results land in the shared
 * `diagnosticCollection` keyed by `uri`, so a later live edit cleanly
 * overwrites a workspace-run entry for the same file.
 */
async function validateTreatmentSourceAt(
  uri: vscode.Uri,
  source: string,
): Promise<void> {
  const uriKey = uri.toString();

  // Skip when re-validating an identical source — e.g. tab-focus or
  // doc-open events that fire after the user looked at another file
  // and came back. With a large broadcast-expanded treatment, each
  // validation pass is several seconds of sync Zod recursion; this
  // short-circuit is the biggest single CPU win in the extension host.
  if (lastValidatedSource.get(uriKey) === source) return;

  const version = (validationVersions.get(uriKey) ?? 0) + 1;
  validationVersions.set(uriKey, version);
  const rootDir = vscode.Uri.joinPath(uri, "..");
  const workspaceFolder =
    vscode.workspace.getWorkspaceFolder(uri) ??
    vscode.workspace.workspaceFolders?.[0];
  const decoder = new TextDecoder();

  // `validateTreatmentFile` runs fire-and-forget from the debounced
  // validator; any uncaught rejection becomes an unhandled-promise
  // warning that destabilizes the extension host. Catch everything
  // and surface as a top-of-file diagnostic so the editor stays
  // responsive.
  let result;
  try {
    result = await validateTreatmentWithDiff({
      source,
      loadImport: async (importPath: string) => {
        // Boundary guard: `resolveImportPath` can produce paths that
        // start with `..` (legal for `./..` declarations in source)
        // or even absolute paths. Without an explicit check,
        // `vscode.workspace.fs.readFile` would happily read arbitrary
        // files outside the workspace on every edit. Refuse those
        // outright so validation can never trigger an unbounded read.
        const importUri = vscode.Uri.joinPath(rootDir, importPath);
        if (
          workspaceFolder &&
          !isWithinWorkspace(importUri.fsPath, workspaceFolder.uri.fsPath)
        ) {
          throw new Error(`Import path escapes workspace: ${importPath}`);
        }
        const bytes = await vscode.workspace.fs.readFile(importUri);
        return decoder.decode(bytes);
      },
    });
  } catch (e) {
    if (validationVersions.get(uriKey) !== version) return;
    const message = e instanceof Error ? e.message : String(e);
    const fallback = new vscode.Diagnostic(
      new vscode.Range(0, 0, 0, 1),
      `Stagebook validator failed unexpectedly: ${message}`,
      vscode.DiagnosticSeverity.Error,
    );
    fallback.source = "stagebook";
    diagnosticCollection.set(uri, [fallback]);
    return;
  }

  // Stale-version guard: if another edit fired while we were awaiting,
  // discard this result rather than clobbering the newer one.
  if (validationVersions.get(uriKey) !== version) return;

  const vscodeDiagnostics = result.diagnostics.map((d) => {
    const diag = new vscode.Diagnostic(
      toVscodeRange(d.range),
      d.message,
      toSeverity(d.severity),
    );
    diag.source = "stagebook";
    return diag;
  });

  diagnosticCollection.set(uri, vscodeDiagnostics);
  // Stamp the cache after the schema/diff pass succeeds. We deliberately
  // stamp BEFORE the async `checkFileReferences` call below — file-existence
  // checks update the diagnostic set in place and don't need to re-trigger
  // the expensive schema work if the source comes back unchanged.
  lastValidatedSource.set(uriKey, source);

  // File existence checking (async — updates diagnostics after stat)
  if (
    result.parsedObj &&
    typeof result.parsedObj === "object" &&
    vscode.workspace.workspaceFolders?.length
  ) {
    await checkFileReferences(
      uri,
      result.parsedObj,
      source,
      vscodeDiagnostics,
      version,
    );
  }
}

/**
 * Walk the parsed treatment object and check that every local-asset path
 * referenced by an element exists. `getReferencedAssets` owns the per-element-
 * type allowlist of file-like fields (prompt.file, image.file, audio.file,
 * mediaPlayer.file, mediaPlayer.captionsFile) and filters out template
 * placeholders and full URLs; we still apply a path-traversal guard here.
 *
 * Awaits every `fs.stat` and applies the resulting diagnostics in a single
 * batched `set`. Callers (`validateTreatmentSourceAt`) await it, so the
 * "Validate Workspace" summary counts file-existence errors accurately rather
 * than racing the stats; the live debounced path is fire-and-forget either way.
 */
async function checkFileReferences(
  uri: vscode.Uri,
  obj: unknown,
  source: string,
  diagnostics: vscode.Diagnostic[],
  version: number,
): Promise<void> {
  const assets = getReferencedAssets(obj);
  if (assets.length === 0) return;

  const treatmentDir = vscode.Uri.joinPath(uri, "..");
  const workspaceFolder =
    vscode.workspace.getWorkspaceFolder(uri) ??
    vscode.workspace.workspaceFolders![0];
  const uriKey = uri.toString();

  let changed = false;
  await Promise.all(
    assets.map(async (asset) => {
      const fileUri = vscode.Uri.joinPath(treatmentDir, asset.path);

      if (!isWithinWorkspace(fileUri.fsPath, workspaceFolder.uri.fsPath)) {
        diagnostics.push(
          makeFileDiagnostic(
            source,
            asset.pathInTree,
            `File path escapes workspace: ${asset.path}`,
            vscode.DiagnosticSeverity.Error,
          ),
        );
        changed = true;
        return;
      }

      try {
        await vscode.workspace.fs.stat(fileUri);
        // File exists — extension validity (e.g. .prompt.md for prompts) is
        // enforced by schema (promptFilePathSchema), so no redundant check.
      } catch {
        diagnostics.push(
          makeFileDiagnostic(
            source,
            asset.pathInTree,
            `File not found: ${asset.path}`,
            vscode.DiagnosticSeverity.Error,
          ),
        );
        changed = true;
      }
    }),
  );

  // Stale-version guard: a newer edit may have fired while we awaited the
  // stats. Discard rather than clobber the newer result.
  if (validationVersions.get(uriKey) !== version) return;
  if (changed) diagnosticCollection.set(uri, diagnostics);
}

function makeFileDiagnostic(
  source: string,
  objPath: (string | number)[],
  message: string,
  severity: vscode.DiagnosticSeverity,
): vscode.Diagnostic {
  const range = pathToRange(source, objPath);
  const vscodeRange = range
    ? new vscode.Range(
        range.startLine,
        range.startCol,
        range.endLine,
        range.endCol,
      )
    : new vscode.Range(0, 0, 0, 0);

  const diag = new vscode.Diagnostic(vscodeRange, message, severity);
  diag.source = "stagebook";
  return diag;
}

function validatePromptFile(document: vscode.TextDocument): void {
  validatePromptSourceAt(document.uri, document.getText());
}

/**
 * Validate a prompt from `(uri, source)` without requiring a live
 * `vscode.TextDocument`. Used both for open editors and for on-disk files
 * swept by the "Validate Workspace" command.
 */
function validatePromptSourceAt(uri: vscode.Uri, source: string): void {
  const result = validatePromptSource(source);

  const vscodeDiagnostics = result.diagnostics.map((d) => {
    const diag = new vscode.Diagnostic(
      toVscodeRange(d.range),
      d.message,
      toSeverity(d.severity),
    );
    diag.source = "stagebook";
    return diag;
  });

  diagnosticCollection.set(uri, vscodeDiagnostics);
}

// --- Validate Workspace command ---

/** Max treatment/prompt validations in flight during a workspace sweep. */
const WORKSPACE_VALIDATION_CONCURRENCY = 4;

/** Command id for opening the Problems panel (status-bar click-through). */
const OPEN_PROBLEMS_COMMAND = "workbench.actions.view.problems";

/**
 * Set a single top-of-file error diagnostic when a swept file can't be read.
 * Uses `source: "stagebook"` so `updateWorkspaceStatusBar` counts it — a read
 * failure must not be reported as a clean scan.
 */
function setReadErrorDiagnostic(uri: vscode.Uri, err: unknown): void {
  const message = err instanceof Error ? err.message : String(err);
  const diag = new vscode.Diagnostic(
    new vscode.Range(0, 0, 0, 1),
    `Stagebook could not read this file: ${message}`,
    vscode.DiagnosticSeverity.Error,
  );
  diag.source = "stagebook";
  diagnosticCollection.set(uri, [diag]);
}

/**
 * Validate every Stagebook file in the workspace, not just the ones the user
 * has opened this session (issue #442). Globs `**\/*.stagebook.yaml` and
 * `**\/*.prompt.md` (honoring `files.exclude` / `search.exclude` via
 * `findFiles`; `.gitignore` is intentionally NOT applied — see PR), runs the
 * same validators the live editor flow uses so diagnostics are identical, and
 * surfaces an aggregate count in the status bar.
 */
async function validateWorkspace(
  statusBar: vscode.StatusBarItem,
): Promise<void> {
  if (!vscode.workspace.workspaceFolders?.length) {
    void vscode.window.showWarningMessage(
      "Stagebook: open a folder to validate its treatment and prompt files.",
    );
    return;
  }

  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Window,
      title: "Stagebook: validating workspace…",
    },
    async () => {
      // Honor the user's configured excludes. `findFiles` drops both
      // `files.exclude` and `search.exclude` as soon as a concrete exclude
      // glob is passed, so merge them (plus node_modules) ourselves.
      const excludeGlob = buildFindExcludeGlob(
        vscode.workspace
          .getConfiguration("files")
          .get<Record<string, unknown>>("exclude") ?? {},
        vscode.workspace
          .getConfiguration("search")
          .get<Record<string, unknown>>("exclude") ?? {},
        ["**/node_modules/**"],
      );

      const [treatments, prompts] = await Promise.all([
        vscode.workspace.findFiles("**/*.stagebook.yaml", excludeGlob),
        vscode.workspace.findFiles("**/*.prompt.md", excludeGlob),
      ]);

      // Prefer the live editor buffer when a file is open so workspace results
      // match exactly what live validation shows (including unsaved edits);
      // otherwise read committed bytes from disk. Reading bytes — rather than
      // `openTextDocument` — is deliberate: documents opened-but-never-shown
      // can be disposed by VS Code, firing `onDidCloseTextDocument`, which
      // would wipe the diagnostics we just set.
      const openByUri = new Map(
        vscode.workspace.textDocuments.map((d) => [d.uri.toString(), d]),
      );
      const decoder = new TextDecoder();
      const readSource = async (uri: vscode.Uri): Promise<string> => {
        const open = openByUri.get(uri.toString());
        if (open) return open.getText();
        return decoder.decode(await vscode.workspace.fs.readFile(uri));
      };

      const tasks: Array<() => Promise<void>> = [
        ...treatments.map((uri) => async () => {
          // The user explicitly asked to re-validate, so bypass the
          // source-equality short-circuit for this run.
          lastValidatedSource.delete(uri.toString());
          let source: string;
          try {
            source = await readSource(uri);
          } catch (e) {
            // A matched file can become unreadable between findFiles and the
            // read (deleted, permissions). runPool swallows task rejections,
            // so surface it as a diagnostic rather than letting the URI count
            // as a clean scan.
            setReadErrorDiagnostic(uri, e);
            return;
          }
          await validateTreatmentSourceAt(uri, source);
        }),
        ...prompts.map((uri) => async () => {
          let source: string;
          try {
            source = await readSource(uri);
          } catch (e) {
            setReadErrorDiagnostic(uri, e);
            return;
          }
          validatePromptSourceAt(uri, source);
        }),
      ];

      await runPool(tasks, WORKSPACE_VALIDATION_CONCURRENCY);

      // Drop the source-equality cache for scanned files that aren't currently
      // open. Those files get no `onDidCloseTextDocument` to clear the stamp,
      // so leaving it set would let a later open hit the shortcut and keep
      // stale cross-file diagnostics after an import/prompt/asset changes on
      // disk. Open files keep their stamp (live editing manages it).
      const openKeys = new Set(
        vscode.workspace.textDocuments.map((d) => d.uri.toString()),
      );
      for (const uri of treatments) {
        const key = uri.toString();
        if (!openKeys.has(key)) lastValidatedSource.delete(key);
      }

      updateWorkspaceStatusBar(statusBar, [...treatments, ...prompts]);
    },
  );
}

/**
 * Render the status-bar summary for a completed sweep. Counts only the
 * `source === "stagebook"` diagnostics on the files this run actually scanned
 * (`scannedUris`) — NOT every Stagebook diagnostic in the collection. The
 * latter would fold in files outside the glob (e.g. a `node_modules` file the
 * user happens to have open and edited), so the "across N files" headline and
 * the "of N scanned" tooltip would attribute errors to a scan that never
 * touched the offending file.
 */
function updateWorkspaceStatusBar(
  statusBar: vscode.StatusBarItem,
  scannedUris: vscode.Uri[],
): void {
  const perFile: DiagnosticSeverityLabel[][] = [];
  for (const uri of scannedUris) {
    const labels = vscode.languages
      .getDiagnostics(uri)
      .filter((d) => d.source === "stagebook")
      .map<DiagnosticSeverityLabel>((d) =>
        d.severity === vscode.DiagnosticSeverity.Error ? "error" : "warning",
      );
    if (labels.length > 0) perFile.push(labels);
  }

  const summary = summarizeDiagnostics(perFile);
  const { text, tooltip } = formatValidationStatusBar(
    summary,
    scannedUris.length,
  );
  statusBar.text = text;
  statusBar.tooltip = tooltip;
  statusBar.command = OPEN_PROBLEMS_COMMAND;
  statusBar.show();
}

// Standard VS Code semantic token types — every theme colors these
const semanticTokenTypes: SemanticTokenType[] = [
  "type",
  "keyword",
  "variable",
  "string",
  "property",
  "comment",
];

const tokenLegend = new vscode.SemanticTokensLegend(semanticTokenTypes);

class TreatmentSemanticTokenProvider
  implements vscode.DocumentSemanticTokensProvider
{
  provideDocumentSemanticTokens(
    document: vscode.TextDocument,
  ): vscode.SemanticTokens {
    const builder = new vscode.SemanticTokensBuilder(tokenLegend);
    const source = document.getText();
    const tokens = computeSemanticTokens(source);

    for (const token of tokens) {
      builder.push(
        new vscode.Range(
          token.line,
          token.startCol,
          token.line,
          token.startCol + token.length,
        ),
        token.tokenType,
      );
    }

    return builder.build();
  }
}

// --- File Path Quick-Fix ---

class FilePathQuickFixProvider implements vscode.CodeActionProvider {
  static readonly providedCodeActionKinds = [vscode.CodeActionKind.QuickFix];

  // Cache workspace file paths to avoid re-globbing on every cursor move
  private cachedPaths: string[] = [];
  private cacheTimestamp = 0;
  private cachedTreatmentDir = "";
  private static readonly CACHE_TTL_MS = 5000;

  async provideCodeActions(
    document: vscode.TextDocument,
    range: vscode.Range,
  ): Promise<vscode.CodeAction[]> {
    const diagnostics = vscode.languages
      .getDiagnostics(document.uri)
      .filter(
        (d) =>
          d.source === "stagebook" &&
          d.message.startsWith("File not found:") &&
          d.range.intersection(range),
      );

    if (diagnostics.length === 0 || !vscode.workspace.workspaceFolders?.length)
      return [];

    const actions: vscode.CodeAction[] = [];
    const workspaceFolder =
      vscode.workspace.getWorkspaceFolder(document.uri) ??
      vscode.workspace.workspaceFolders[0];
    // Suggestions should be relative to the treatment file's directory
    const treatmentDirFsPath = vscode.Uri.joinPath(document.uri, "..").fsPath;

    // Refresh the cached file list if stale or treatment dir changed
    const now = Date.now();
    if (
      now - this.cacheTimestamp > FilePathQuickFixProvider.CACHE_TTL_MS ||
      this.cachedTreatmentDir !== treatmentDirFsPath
    ) {
      const allFiles = await vscode.workspace.findFiles(
        new vscode.RelativePattern(workspaceFolder, ASSET_GLOB),
        "**/node_modules/**",
        5000,
      );
      this.cachedPaths = allFiles.map((f) =>
        relativizePath(treatmentDirFsPath, f.fsPath),
      );
      this.cacheTimestamp = now;
      this.cachedTreatmentDir = treatmentDirFsPath;
    }

    for (const diagnostic of diagnostics) {
      const badPath = diagnostic.message.replace("File not found: ", "");
      const suggestion = findClosestMatch(badPath, this.cachedPaths);
      if (!suggestion) continue;

      const action = new vscode.CodeAction(
        `Did you mean: ${suggestion}?`,
        vscode.CodeActionKind.QuickFix,
      );
      action.edit = new vscode.WorkspaceEdit();
      action.edit.replace(document.uri, diagnostic.range, suggestion);
      action.isPreferred = true;
      action.diagnostics = [diagnostic];
      actions.push(action);
    }

    return actions;
  }
}

// --- File Path Autocomplete ---

class FilePathCompletionProvider implements vscode.CompletionItemProvider {
  async provideCompletionItems(
    document: vscode.TextDocument,
    position: vscode.Position,
  ): Promise<vscode.CompletionItem[] | undefined> {
    const line = document.lineAt(position).text;
    const prefix = line.substring(0, position.character);

    // Trigger inside the value of any recognised file-path field:
    // `file:` (prompt/image/audio/mediaPlayer — including local video
    // files) or `captionsFile:` (mediaPlayer captions).
    const ctx = parseFilePathCompletionContext(prefix);
    if (!ctx) return undefined;

    if (!vscode.workspace.workspaceFolders?.length) return undefined;

    const workspaceFolder =
      vscode.workspace.getWorkspaceFolder(document.uri) ??
      vscode.workspace.workspaceFolders[0];
    // Completions should be relative to the treatment file's directory
    const treatmentDirFsPath = vscode.Uri.joinPath(document.uri, "..").fsPath;

    const globPattern = buildCompletionGlob(ctx.partial);
    const files = await vscode.workspace.findFiles(
      new vscode.RelativePattern(workspaceFolder, globPattern),
      "**/node_modules/**",
      50,
    );

    // Find the end of the value (stop at comment or end of line)
    const valueEndMatch = line.substring(position.character).match(/\s+#/);
    const valueEnd = valueEndMatch
      ? position.character + valueEndMatch.index!
      : line.length;

    return files.map((fileUri) => {
      const relativePath = relativizePath(treatmentDirFsPath, fileUri.fsPath);
      const item = new vscode.CompletionItem(
        relativePath,
        vscode.CompletionItemKind.File,
      );
      item.insertText = relativePath;
      // Replace only the value portion (not trailing comments)
      item.range = new vscode.Range(
        position.line,
        ctx.valueStart,
        position.line,
        valueEnd,
      );
      return item;
    });
  }
}

// --- Expanded Templates Preview ---

class ExpandedTemplatesProvider implements vscode.TextDocumentContentProvider {
  private _onDidChange = new vscode.EventEmitter<vscode.Uri>();
  readonly onDidChange = this._onDidChange.event;

  constructor(private readonly diagnostics: vscode.DiagnosticCollection) {}

  async provideTextDocumentContent(uri: vscode.Uri): Promise<string> {
    const sourceUri = vscode.Uri.parse(decodeURIComponent(uri.query));
    const sourceDoc = vscode.workspace.textDocuments.find(
      (d) => d.uri.toString() === sourceUri.toString(),
    );
    if (!sourceDoc) {
      this.diagnostics.delete(uri);
      return "# Source document not found. Please reopen the preview.";
    }

    // Use the imports-aware expander so cross-file `template:` invocations
    // resolve in the preview (per #321 Repro 2 — without imports loaded
    // here, the preview surfaces a misleading "Template not found" error
    // for templates defined in module files).
    const sourceDir = vscode.Uri.joinPath(sourceUri, "..");
    const decoder = new TextDecoder();
    const result = await expandAndValidateWithImports({
      source: sourceDoc.getText(),
      loadImport: async (importPath: string) => {
        const importUri = vscode.Uri.joinPath(sourceDir, importPath);
        const bytes = await vscode.workspace.fs.readFile(importUri);
        return decoder.decode(bytes);
      },
    });
    if (result.expandError) {
      this.diagnostics.delete(uri);
      const commentedError = result.expandError
        .split(/\r?\n/)
        .map((line) => `# ${line}`)
        .join("\n");
      return `# Template expansion error:\n${commentedError}`;
    }

    // Attach schema-validation diagnostics to the expanded preview URI.
    // Positions reference the full expanded YAML; diagnostics past the
    // truncation line still appear in the Problems panel.
    const vscodeDiagnostics = result.diagnostics.map((d) => {
      const diag = new vscode.Diagnostic(
        toVscodeRange(d.range),
        d.message,
        toSeverity(d.severity),
      );
      diag.source = "stagebook";
      return diag;
    });
    this.diagnostics.set(uri, vscodeDiagnostics);

    return result.yaml;
  }

  /**
   * Request a re-render of the expanded preview for `sourceUri`. Debounced
   * per-source so that rapid keystrokes don't each trigger full expand +
   * schema-validation work in `provideTextDocumentContent`.
   */
  refreshForSource(sourceUri: vscode.Uri): void {
    const key = sourceUri.toString();
    const existing = this.refreshTimers.get(key);
    if (existing) clearTimeout(existing);

    this.refreshTimers.set(
      key,
      setTimeout(() => {
        this.refreshTimers.delete(key);
        this.fireChangeForSource(sourceUri);
      }, DEBOUNCE_MS),
    );
  }

  /**
   * Fire the change event immediately (no debounce) for the expanded
   * preview corresponding to `sourceUri`. Used by the command handler
   * right after the expanded document is opened, to force VS Code to
   * re-fetch the content. Diagnostics set during the very first
   * `provideTextDocumentContent` call don't attach to the editor's
   * squiggle layer (the doc isn't fully open yet); a second fetch after
   * the document is visible makes them appear without waiting for the
   * user to edit the source.
   */
  fireChangeForSource(sourceUri: vscode.Uri): void {
    const expandedUri = vscode.Uri.parse(
      `${EXPANDED_SCHEME}:${sourceUri.path} (expanded)?${encodeURIComponent(sourceUri.toString())}`,
    );
    this._onDidChange.fire(expandedUri);
  }

  dispose(): void {
    for (const timer of this.refreshTimers.values()) clearTimeout(timer);
    this.refreshTimers.clear();
  }

  private readonly refreshTimers = new Map<
    string,
    ReturnType<typeof setTimeout>
  >();
}

// --- Stage Preview Webview ---

function getWebviewContent(
  webview: vscode.Webview,
  extensionUri: vscode.Uri,
): string {
  const scriptUri = webview.asWebviewUri(
    vscode.Uri.joinPath(extensionUri, "dist", "webview.js"),
  );
  const nonce = getNonce();
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy"
    content="default-src 'none'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline'; img-src ${webview.cspSource} data:; font-src ${webview.cspSource}; media-src ${webview.cspSource} data:;">
  <style>
    :root {
      --viewer-sidebar-width: 280px;
      /* Keep these token values in sync with packages/stagebook/src/styles.css
       * (:root). This block is the webview's only source of :root tokens
       * (the bundled styles.css is loaded as text, not auto-injected), so a
       * stale value here overrides the whole preview: pre-#535 this pinned
       * --stagebook-primary to the retired blue-500, which is why every
       * var(--stagebook-primary) rendered old-blue while the (absent-here)
       * playhead correctly fell back to rose-700. Tracked for a durable fix
       * (inject the real styles.css) in #494. */
      --stagebook-primary: #2563eb;
      --stagebook-primary-hover: #1d4ed8;
      --stagebook-primary-active: #1e40af;
      --stagebook-text: #1f2937;
      --stagebook-text-secondary: #374151;
      --stagebook-text-muted: #6b7280;
      --stagebook-decoration: #9ca3af;
      --stagebook-border: #d1d5db;
      --stagebook-bg-muted: #f9fafb;
      --stagebook-bg-track: #e5e7eb;
      --stagebook-prompt-max-width: 36rem;
      --stagebook-prompt-text-size: 1rem;
      --stagebook-prompt-line-height: 1.5;
      --stagebook-prompt-h1-size: 1.875rem;
      --stagebook-prompt-h2-size: 1.5rem;
      --stagebook-prompt-h3-size: 1.25rem;
      --stagebook-prompt-h1-weight: 700;
      --stagebook-prompt-h2-weight: 600;
      --stagebook-prompt-h3-weight: 600;
      --stagebook-link: #2563eb;
      --stagebook-code-bg: rgba(0, 0, 0, 0.06);
      --stagebook-code-font: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      --stagebook-blockquote-border: #9ca3af;
      --stagebook-blockquote-bg: #f9fafb;
    }
    body {
      margin: 0;
      padding: 0;
      background-color: #ffffff;
      color: var(--stagebook-text);
      font-family: ui-sans-serif, system-ui, sans-serif;
      -webkit-font-smoothing: antialiased;
      font-size: 14px;
      line-height: 1.5;
    }
    /* Reset VS Code webview defaults */
    code, pre {
      font-family: var(--stagebook-code-font);
      background-color: var(--stagebook-code-bg);
      color: var(--stagebook-text);
    }
    pre {
      padding: 0.75rem 1rem;
      border-radius: 0.375rem;
      overflow-x: auto;
    }
    code {
      padding: 0.125rem 0.25rem;
      border-radius: 0.25rem;
      font-size: 0.875em;
    }
    /* Form resets */
    input[type="checkbox"], input[type="radio"] {
      appearance: none;
      width: 1rem; height: 1rem;
      border: 1px solid var(--stagebook-border);
      border-radius: 0.125rem;
      background-color: #fff;
      vertical-align: middle;
      cursor: pointer;
    }
    input[type="radio"] { border-radius: 9999px; }
    input[type="checkbox"]:checked, input[type="radio"]:checked {
      background-color: var(--stagebook-primary);
      border-color: var(--stagebook-primary);
      background-image: url("data:image/svg+xml,%3csvg viewBox='0 0 16 16' fill='white' xmlns='http://www.w3.org/2000/svg'%3e%3cpath d='M12.207 4.793a1 1 0 010 1.414l-5 5a1 1 0 01-1.414 0l-2-2a1 1 0 011.414-1.414L6.5 9.086l4.293-4.293a1 1 0 011.414 0z'/%3e%3c/svg%3e");
      background-size: 100% 100%; background-position: center; background-repeat: no-repeat;
    }
    input[type="radio"]:checked {
      background-image: url("data:image/svg+xml,%3csvg viewBox='0 0 16 16' fill='white' xmlns='http://www.w3.org/2000/svg'%3e%3ccircle cx='8' cy='8' r='3'/%3e%3c/svg%3e");
    }
    table { border-collapse: collapse; margin: 1rem 0; width: 100%; max-width: var(--stagebook-prompt-max-width); }
    th, td { border: 1px solid var(--stagebook-border); padding: 0.5rem 0.75rem; text-align: left; font-size: 0.875rem; }
    th { background-color: var(--stagebook-bg-muted); font-weight: 500; }
  </style>
</head>
<body>
  <div id="root"></div>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
}

function getNonce(): string {
  const chars =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let nonce = "";
  for (let i = 0; i < 32; i++) {
    nonce += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return nonce;
}

/**
 * Parse a Stagebook treatment file for the preview command.
 *
 * Thin VS Code-side shim that wraps `parseTreatmentSource` (the pure,
 * testable core) with a `loadImport` callback backed by
 * `vscode.workspace.fs`. The shim returns the structured result
 * unchanged — callers surface the `message` field on failure rather
 * than the previous generic "could not parse" notification (the root
 * cause of #321 Repro 1, which silently swallowed all six failure
 * modes in this function).
 */
async function parseTreatmentForPreview(
  source: string,
  rootDir: vscode.Uri,
): Promise<ParseResult> {
  const decoder = new TextDecoder();
  return parseTreatmentSource({
    source,
    loadImport: async (importPath: string) => {
      const importUri = vscode.Uri.joinPath(rootDir, importPath);
      const bytes = await vscode.workspace.fs.readFile(importUri);
      return decoder.decode(bytes);
    },
  });
}

export function activate(context: vscode.ExtensionContext): void {
  context.subscriptions.push(diagnosticCollection);

  // Status bar item for the "Validate Workspace" summary. Hidden until the
  // command runs (created here so it can be disposed on deactivate).
  const workspaceStatusBar = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Right,
    100,
  );
  context.subscriptions.push(workspaceStatusBar);
  context.subscriptions.push(
    vscode.commands.registerCommand("stagebook.validateWorkspace", () =>
      validateWorkspace(workspaceStatusBar),
    ),
  );

  // Register semantic token provider for treatment files
  context.subscriptions.push(
    vscode.languages.registerDocumentSemanticTokensProvider(
      { language: "stagebookYaml" },
      new TreatmentSemanticTokenProvider(),
      tokenLegend,
    ),
  );

  // Register file path quick-fix provider
  context.subscriptions.push(
    vscode.languages.registerCodeActionsProvider(
      "stagebookYaml",
      new FilePathQuickFixProvider(),
      {
        providedCodeActionKinds:
          FilePathQuickFixProvider.providedCodeActionKinds,
      },
    ),
  );

  // Register unrecognized-key quick-fix provider (#123) — offers
  // "Change to 'X'" actions on rich "Did you mean 'X'?" diagnostics
  // that come from `safeParseTreatmentFile`.
  context.subscriptions.push(
    vscode.languages.registerCodeActionsProvider(
      "stagebookYaml",
      new UnrecognizedKeyQuickFixProvider(),
      {
        providedCodeActionKinds:
          UnrecognizedKeyQuickFixProvider.providedCodeActionKinds,
      },
    ),
  );

  // Register file path autocomplete provider. Trigger characters limit
  // VS Code to invoking the provider only at likely path-completion
  // points rather than on every keystroke — meaningful because the
  // provider can hit `workspace.findFiles`.
  context.subscriptions.push(
    vscode.languages.registerCompletionItemProvider(
      "stagebookYaml",
      new FilePathCompletionProvider(),
      ":",
      "/",
      ".",
      " ",
    ),
  );

  // Register expanded templates content provider
  const expandedProvider = new ExpandedTemplatesProvider(diagnosticCollection);
  context.subscriptions.push(expandedProvider);
  context.subscriptions.push(
    vscode.workspace.registerTextDocumentContentProvider(
      EXPANDED_SCHEME,
      expandedProvider,
    ),
  );

  // Register the expand command
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "stagebook.previewExpandedTemplates",
      async () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor || !isStagebookYaml(editor.document)) {
          vscode.window.showWarningMessage(
            "Open a .stagebook.yaml file first.",
          );
          return;
        }

        const sourceUri = editor.document.uri;
        const expandedUri = vscode.Uri.parse(
          `${EXPANDED_SCHEME}:${sourceUri.path} (expanded)?${encodeURIComponent(sourceUri.toString())}`,
        );

        const doc = await vscode.workspace.openTextDocument(expandedUri);
        await vscode.window.showTextDocument(doc, {
          viewColumn: vscode.ViewColumn.Beside,
          preview: true,
          preserveFocus: true,
        });
        // Set language for syntax highlighting. Using stagebookYaml (rather
        // than plain yaml) wires up the TextMate grammar and semantic-tokens
        // provider, so the expanded preview gets the same colorization as
        // source treatment files (element types, comparators, template
        // variables, schema keywords).
        await vscode.languages.setTextDocumentLanguage(doc, "stagebookYaml");
        // Force a re-fetch of the content now that the document is fully
        // open. Diagnostics attached during the very first
        // `provideTextDocumentContent` call don't appear in the editor
        // until a subsequent fetch happens (the doc wasn't fully open
        // yet, so VS Code didn't wire them to the squiggle layer). The
        // second fetch hits the warmed-up pipeline (~60ms on pilot_3)
        // and surfaces the diagnostics immediately instead of waiting
        // for the user to edit the source file.
        expandedProvider.fireChangeForSource(sourceUri);
      },
    ),
  );

  // Auto-refresh the expanded preview when the source changes. The preview
  // document itself also has languageId "stagebookYaml"; skip it by scheme
  // so we don't feed its (read-only, virtual) text back as a "source".
  context.subscriptions.push(
    vscode.workspace.onDidChangeTextDocument((e) => {
      if (
        e.document.uri.scheme !== EXPANDED_SCHEME &&
        isStagebookYaml(e.document)
      ) {
        expandedProvider.refreshForSource(e.document.uri);
      }
    }),
  );

  // Register stage preview webview command
  let previewPanel: vscode.WebviewPanel | undefined;
  // Mutable state updated on each command invocation — avoids stale closures
  type CurrentTreatment = Extract<ParseResult, { ok: true }>["data"] | null;
  let currentTreatment: CurrentTreatment = null;
  let currentTreatmentUri: vscode.Uri | undefined;
  let currentTreatmentDir: vscode.Uri | undefined;
  let currentWorkspaceRootFsPath: string | undefined;

  // --- #192: asset:// local mount resolution ---
  //
  // Merge the `stagebook.assetRoots` setting (a committable shared convention;
  // relative paths resolve against the workspace root) with the user's
  // interactive folder picks in workspaceState (which win on conflict), into
  // prefix → absolute directory. The setting is `scope: resource`, so it's read
  // with the treatment URI to honor per-folder overrides in a multi-root
  // workspace (matching the relative-path base below).
  //
  // The mount map is chosen by a human — a folder picked via showOpenDialog, or
  // a setting the person committed to their own trusted workspace (a treatment
  // FILE can never set it). Even a repo-committed setting only widens the
  // webview's read-only `localResourceRoots`, gated by Workspace Trust and a
  // strict CSP (no script/connect back-channel), so it can't exfiltrate.
  const getAssetMountDirs = (): Record<string, string> =>
    mergeAssetMounts(
      vscode.workspace
        .getConfiguration("stagebook", currentTreatmentUri)
        .get<Record<string, unknown>>("assetRoots", {}),
      context.workspaceState.get<Record<string, unknown>>(
        ASSET_MOUNTS_STATE_KEY,
        {},
      ),
      currentWorkspaceRootFsPath,
    );

  // dist + every workspace folder + only those mount dirs NOT already covered
  // by one of those roots. The webview can only load resources under these
  // roots, so a mount OUTSIDE the workspace (the point of #192) must be listed;
  // a mount INSIDE the workspace is already covered recursively, so we omit it
  // — adding it would change the root set and force a spurious reload on pick.
  const buildLocalResourceRoots = (
    mountDirs: Record<string, string>,
  ): vscode.Uri[] => {
    const baseRoots = [
      vscode.Uri.joinPath(context.extensionUri, "dist"),
      ...(vscode.workspace.workspaceFolders?.map((f) => f.uri) ?? []),
    ];
    const extra = extraAssetRoots(
      Object.values(mountDirs),
      baseRoots.map((uri) => uri.fsPath),
    );
    return [...baseRoots, ...extra.map((dir) => vscode.Uri.file(dir))];
  };

  // Post the current treatment to the webview: the asset-mount map (prefix →
  // webview URI) and the still-unmapped prefixes that drive the picker card.
  const postTreatment = (panel: vscode.WebviewPanel): void => {
    if (!currentTreatment || !currentTreatmentDir) return;
    const mountDirs = getAssetMountDirs();
    // Advertise EVERY configured/picked mount, not just the prefixes the
    // treatment statically references — so a field-supplied `file: ${clipUrl}`
    // bound to `asset://…`, or an `asset://` ref inside a loaded prompt body,
    // also resolves when its prefix is configured. localResourceRoots already
    // covers each of these dirs, so the webview URIs are loadable.
    const assetRoots: Record<string, string> = {};
    for (const [prefix, dir] of Object.entries(mountDirs)) {
      assetRoots[prefix] = panel.webview
        .asWebviewUri(vscode.Uri.file(dir))
        .toString();
    }
    // The picker card lists prefixes the treatment STATICALLY references that
    // aren't mounted yet. (A prefix appearing only in a field value or a prompt
    // body can't be discovered host-side, but a configured mount still resolves
    // it via the map above.)
    const { unmapped } = splitAssetMounts(
      collectAssetPrefixes(currentTreatment),
      mountDirs,
    );
    panel.webview.postMessage({
      type: "treatment",
      treatmentFile: currentTreatment,
      introIndex: 0,
      treatmentIndex: 0,
      webviewBaseUri: panel.webview
        .asWebviewUri(currentTreatmentDir)
        .toString(),
      assetRoots,
      unmappedAssetPrefixes: unmapped,
    });
  };

  // Ensure the panel's localResourceRoots cover every mount dir, then refresh
  // the webview's asset map. When the roots already cover the mounts, post
  // directly — no reload. When they don't (a new out-of-workspace mount), the
  // added root must take effect, which requires reloading the webview.
  const syncAssetRoots = (panel: vscode.WebviewPanel): void => {
    const desired = buildLocalResourceRoots(getAssetMountDirs());
    const currentKeys = new Set(
      (panel.webview.options.localResourceRoots ?? []).map((u) => u.toString()),
    );
    const desiredKeys = new Set(desired.map((u) => u.toString()));
    const unchanged =
      currentKeys.size === desiredKeys.size &&
      [...desiredKeys].every((k) => currentKeys.has(k));
    if (unchanged) {
      postTreatment(panel);
      return;
    }
    // Update localResourceRoots (a whole new options object — an in-place array
    // mutation is ignored), then force the reload deterministically by
    // re-setting the html rather than relying on the options reassignment alone
    // to reload. The reloaded webview posts a fresh "ready" → postTreatment, so
    // it picks up both the new CSP roots and the new assetRoots map.
    panel.webview.options = {
      ...panel.webview.options,
      localResourceRoots: desired,
    };
    panel.webview.html = getWebviewContent(panel.webview, context.extensionUri);
  };

  // Prompt for a folder to mount at `prefix`, persist it (workspace-scoped),
  // and refresh the preview. Shared by the picker card and the configure
  // command. A cancelled dialog leaves the mount unchanged.
  const pickFolderForPrefix = async (prefix: string): Promise<void> => {
    const picked = await vscode.window.showOpenDialog({
      canSelectFiles: false,
      canSelectFolders: true,
      canSelectMany: false,
      openLabel: "Mount as assets",
      title: `Choose the folder for asset://${prefix}/`,
      defaultUri: currentTreatmentDir,
    });
    if (!picked || picked.length === 0) return;
    const next = {
      ...context.workspaceState.get<Record<string, unknown>>(
        ASSET_MOUNTS_STATE_KEY,
        {},
      ),
      [prefix]: picked[0].fsPath,
    };
    await context.workspaceState.update(ASSET_MOUNTS_STATE_KEY, next);
    if (previewPanel) syncAssetRoots(previewPanel);
  };

  context.subscriptions.push(
    vscode.commands.registerCommand("stagebook.previewStage", async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor || !isStagebookYaml(editor.document)) {
        vscode.window.showWarningMessage("Open a .stagebook.yaml file first.");
        return;
      }

      const source = editor.document.getText();
      const previewRootDir = vscode.Uri.joinPath(editor.document.uri, "..");
      const parseResult = await parseTreatmentForPreview(
        source,
        previewRootDir,
      );
      if (!parseResult.ok) {
        vscode.window.showErrorMessage(
          `Could not preview treatment: ${parseResult.message}`,
        );
        return;
      }
      currentTreatment = parseResult.data;

      const workspaceFolder =
        vscode.workspace.getWorkspaceFolder(editor.document.uri) ??
        vscode.workspace.workspaceFolders?.[0];

      if (!workspaceFolder) {
        vscode.window.showErrorMessage(
          "No workspace folder found. Open a folder first.",
        );
        return;
      }

      currentTreatmentUri = editor.document.uri;
      currentTreatmentDir = vscode.Uri.joinPath(editor.document.uri, "..");
      currentWorkspaceRootFsPath = workspaceFolder.uri.fsPath;

      // Pre-seed localResourceRoots with the configured/remembered asset
      // mounts (#192) so an out-of-workspace mount is loadable up front — only
      // a brand-new pick this session forces a reload (see syncAssetRoots).
      const desiredRoots = buildLocalResourceRoots(getAssetMountDirs());

      if (previewPanel) {
        // Keep the roots in sync with the current mounts (a setting edit or a
        // prior pick may have changed them). Reassigning a new options object
        // is required for the change to take effect; VS Code no-ops when the
        // roots are unchanged.
        previewPanel.webview.options = {
          ...previewPanel.webview.options,
          localResourceRoots: desiredRoots,
        };
        previewPanel.reveal(vscode.ViewColumn.Beside);
      } else {
        previewPanel = vscode.window.createWebviewPanel(
          "stagebook.stagePreview",
          "Stage Preview",
          vscode.ViewColumn.Beside,
          {
            enableScripts: true,
            localResourceRoots: desiredRoots,
          },
        );
        previewPanel.onDidDispose(() => {
          previewPanel = undefined;
        });

        // Handle messages from the webview
        previewPanel.webview.onDidReceiveMessage(async (msg) => {
          if (msg.type === "ready") {
            if (previewPanel) postTreatment(previewPanel);
          } else if (msg.type === "refresh") {
            // Re-read the source file, re-parse, and push the updated
            // treatment. Viewer state (stageIndex, position, saved responses,
            // filled-in fields) persists across this prop update because the
            // webview's React tree doesn't unmount.
            if (!currentTreatmentUri || !currentTreatmentDir) return;
            // Capture the panel before any awaits. If the user closes the
            // preview mid-refresh, onDidDispose clears `previewPanel` and
            // a non-null assertion on the outer ref would throw.
            const panel = previewPanel;
            const treatmentDir = currentTreatmentDir;
            if (!panel) return;
            try {
              const doc =
                await vscode.workspace.openTextDocument(currentTreatmentUri);
              const refreshResult = await parseTreatmentForPreview(
                doc.getText(),
                treatmentDir,
              );
              if (!refreshResult.ok) {
                vscode.window.showErrorMessage(
                  `Refresh failed: ${refreshResult.message}`,
                );
                return;
              }
              currentTreatment = refreshResult.data;
              // Panel may have been disposed while we were awaiting above.
              if (!previewPanel) return;
              // syncAssetRoots (not postTreatment) so a settings edit that
              // added an out-of-workspace mount since the panel opened updates
              // localResourceRoots too, not just the assetRoots map (#192).
              syncAssetRoots(panel);
            } catch (err) {
              vscode.window.showErrorMessage(
                `Refresh failed: ${err instanceof Error ? err.message : String(err)}`,
              );
            }
          } else if (msg.type === "readFile" && currentTreatmentDir) {
            const filePath = String(msg.path);
            // #192: an asset:// prompt/text ref resolves against its local
            // mount and is read from there — bounded by the mount dir, not the
            // workspace (out-of-workspace is the point), mirroring the media
            // path. Without this, a mounted asset:// prompt would still fail.
            if (/^asset:\/\//i.test(filePath)) {
              const resolved = parseMountedAsset(filePath, getAssetMountDirs());
              if (!resolved) {
                previewPanel?.webview.postMessage({
                  type: "fileContent",
                  requestId: msg.requestId,
                  error: `Cannot resolve asset: ${filePath}`,
                });
                return;
              }
              try {
                const assetUri = vscode.Uri.joinPath(
                  vscode.Uri.file(resolved.dir),
                  resolved.rest,
                );
                // Defense in depth: keep the resolved file within the mount dir
                // (parseMountedAsset already rejects `..`). Does not resolve
                // symlinks — same caveat as the workspace guard below.
                if (!isWithinWorkspace(assetUri.fsPath, resolved.dir)) {
                  previewPanel?.webview.postMessage({
                    type: "fileContent",
                    requestId: msg.requestId,
                    error: `Path escapes mount: ${filePath}`,
                  });
                  return;
                }
                const assetContent =
                  await vscode.workspace.fs.readFile(assetUri);
                previewPanel?.webview.postMessage({
                  type: "fileContent",
                  requestId: msg.requestId,
                  content: new TextDecoder().decode(assetContent),
                });
              } catch {
                previewPanel?.webview.postMessage({
                  type: "fileContent",
                  requestId: msg.requestId,
                  error: `Failed to read: ${filePath}`,
                });
              }
              return;
            }
            // Guard against path traversal (workspace-relative reads)
            if (filePath.includes("..") || path.isAbsolute(filePath)) {
              previewPanel?.webview.postMessage({
                type: "fileContent",
                requestId: msg.requestId,
                error: `Invalid path: ${filePath}`,
              });
              return;
            }
            try {
              const fileUri = vscode.Uri.joinPath(
                currentTreatmentDir,
                filePath,
              );
              // Post-resolution workspace boundary check (defense in depth
              // against path traversal and shared-prefix edge cases that the
              // substring check on `..` doesn't catch). Does not resolve
              // symlinks — a symlink inside the workspace pointing out will
              // still be followed by fs.readFile.
              if (
                currentWorkspaceRootFsPath &&
                !isWithinWorkspace(fileUri.fsPath, currentWorkspaceRootFsPath)
              ) {
                previewPanel?.webview.postMessage({
                  type: "fileContent",
                  requestId: msg.requestId,
                  error: `Path escapes workspace: ${filePath}`,
                });
                return;
              }
              const content = await vscode.workspace.fs.readFile(fileUri);
              previewPanel?.webview.postMessage({
                type: "fileContent",
                requestId: msg.requestId,
                content: new TextDecoder().decode(content),
              });
            } catch {
              previewPanel?.webview.postMessage({
                type: "fileContent",
                requestId: msg.requestId,
                error: `Failed to read: ${filePath}`,
              });
            }
          } else if (
            msg.type === "pickAssetFolder" &&
            typeof msg.prefix === "string"
          ) {
            // #192: the picker card asked to mount a local folder at this
            // asset prefix. Prompt, persist, and refresh the preview.
            await pickFolderForPrefix(msg.prefix);
          }
        });
      }

      previewPanel.webview.html = getWebviewContent(
        previewPanel.webview,
        context.extensionUri,
      );
    }),
  );

  // #192: manage the remembered asset-folder mounts — re-pick a wrong folder
  // or clear them all (the recovery path when the picker card is gone because
  // a prefix is already mapped to the wrong directory).
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "stagebook.configureAssetMounts",
      async () => {
        const picks = context.workspaceState.get<Record<string, unknown>>(
          ASSET_MOUNTS_STATE_KEY,
          {},
        );
        const entries = Object.entries(picks).filter(
          ([, dir]) => typeof dir === "string" && dir.length > 0,
        );
        if (entries.length === 0) {
          vscode.window.showInformationMessage(
            "No asset folders are mounted for this workspace. Open a stage preview and use “Choose folder…” on the asset banner.",
          );
          return;
        }
        const CLEAR_ALL = "$(trash) Clear all asset mounts";
        const selection = await vscode.window.showQuickPick(
          [
            ...entries.map(([prefix, dir]) => ({
              label: `asset://${prefix}/`,
              description: String(dir),
              prefix: prefix as string | undefined,
            })),
            { label: CLEAR_ALL, description: "", prefix: undefined },
          ],
          {
            title: "Stagebook asset mounts",
            placeHolder: "Re-pick a folder for a prefix, or clear all mounts",
          },
        );
        if (!selection) return;
        if (selection.label === CLEAR_ALL) {
          await context.workspaceState.update(ASSET_MOUNTS_STATE_KEY, {});
          if (previewPanel) syncAssetRoots(previewPanel);
          return;
        }
        if (selection.prefix) await pickFolderForPrefix(selection.prefix);
      },
    ),
  );

  // Validate the active document on activation (no debounce)
  if (vscode.window.activeTextEditor) {
    validateDocument(vscode.window.activeTextEditor.document);
  }

  // Validate on open (no debounce)
  context.subscriptions.push(
    vscode.workspace.onDidOpenTextDocument((document) => {
      validateDocument(document);
    }),
  );

  // Validate on edit (debounced).
  //
  // ALSO: invalidate the source-equality cache for every other open
  // stagebookYaml doc whenever any one of them changes. A root file's
  // validation result depends on its `imports:` — if an imported file
  // changes, the root's cached "this source was validated" stamp is no
  // longer trustworthy. Clearing other entries is cheap and keeps the
  // common-case win (skipping redundant tab-focus revalidations of the
  // unchanged active doc) while ensuring import edits cause the root to
  // re-validate on its next trigger.
  //
  // A treatment's validation result ALSO depends on its referenced
  // prompts' frontmatter `locale` (the locale-consistency rule). Editing
  // a `.prompt.md` — e.g. fixing or removing a `locale:` tag — must
  // likewise invalidate the treatment caches so the stale locale-mismatch
  // diagnostic clears on the treatment's next trigger. Prompt docs aren't
  // themselves cache-keyed here (only treatments are), so clear every
  // entry.
  context.subscriptions.push(
    vscode.workspace.onDidChangeTextDocument((event) => {
      if (isStagebookYaml(event.document)) {
        const changedKey = event.document.uri.toString();
        for (const k of lastValidatedSource.keys()) {
          if (k !== changedKey) lastValidatedSource.delete(k);
        }
      } else if (isStagebookPrompt(event.document)) {
        for (const k of lastValidatedSource.keys()) {
          lastValidatedSource.delete(k);
        }
      }
      validateDocumentDebounced(event.document);
    }),
  );

  // Validate on editor focus change (no debounce)
  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor((editor) => {
      if (editor) {
        validateDocument(editor.document);
      }
    }),
  );

  // Clean up timers and diagnostics when documents close
  context.subscriptions.push(
    vscode.workspace.onDidCloseTextDocument((document) => {
      const key = document.uri.toString();
      const timer = debounceTimers.get(key);
      if (timer) clearTimeout(timer);
      debounceTimers.delete(key);
      validationVersions.delete(key);
      lastValidatedSource.delete(key);
      diagnosticCollection.delete(document.uri);
    }),
  );
}

export function deactivate(): void {}
