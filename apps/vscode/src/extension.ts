import * as path from "path";
import * as vscode from "vscode";
import {
  validateTreatmentSource,
  type Diagnostic,
} from "./lib/validateTreatment";
import { validatePromptSource } from "./lib/validatePrompt";
import { pathToRange } from "./lib/yamlPositionMap";
import {
  computeSemanticTokens,
  type SemanticTokenType,
} from "./lib/semanticTokens";
import { expandAndValidate } from "./lib/expandAndValidate";
import { findClosestMatch } from "./lib/levenshtein";
import { UnrecognizedKeyQuickFixProvider } from "./lib/unrecognizedKeyQuickFix";
import { isWithinWorkspace, relativizePath } from "./lib/filePaths";
import {
  ASSET_GLOB,
  buildCompletionGlob,
  parseFilePathCompletionContext,
} from "./lib/filePathCompletion";
import {
  fillTemplates,
  getReferencedAssets,
  parseTreatmentYaml as parseStagebookYaml,
  resolveImportPath,
  resolveImports,
  treatmentFileSchema,
  type ParsedFile,
} from "stagebook";

const diagnosticCollection =
  vscode.languages.createDiagnosticCollection("stagebook");

const EXPANDED_SCHEME = "stagebook-expanded";

const DEBOUNCE_MS = 300;
const debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();

/** Version counter per document URI — used to discard stale async results. */
const validationVersions = new Map<string, number>();

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

function validateTreatmentFile(document: vscode.TextDocument): void {
  const uriKey = document.uri.toString();
  const version = (validationVersions.get(uriKey) ?? 0) + 1;
  validationVersions.set(uriKey, version);

  const source = document.getText();
  const result = validateTreatmentSource(source);

  const vscodeDiagnostics = result.diagnostics.map((d) => {
    const diag = new vscode.Diagnostic(
      toVscodeRange(d.range),
      d.message,
      toSeverity(d.severity),
    );
    diag.source = "stagebook";
    return diag;
  });

  diagnosticCollection.set(document.uri, vscodeDiagnostics);

  // File existence checking (async — updates diagnostics after stat)
  if (
    result.parsedObj &&
    typeof result.parsedObj === "object" &&
    vscode.workspace.workspaceFolders?.length
  ) {
    checkFileReferences(
      document,
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
 */
function checkFileReferences(
  document: vscode.TextDocument,
  obj: unknown,
  source: string,
  diagnostics: vscode.Diagnostic[],
  version: number,
): void {
  const assets = getReferencedAssets(obj);
  if (assets.length === 0) return;

  const treatmentDir = vscode.Uri.joinPath(document.uri, "..");
  const workspaceFolder =
    vscode.workspace.getWorkspaceFolder(document.uri) ??
    vscode.workspace.workspaceFolders![0];
  const uriKey = document.uri.toString();

  for (const asset of assets) {
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
      diagnosticCollection.set(document.uri, diagnostics);
      continue;
    }

    vscode.workspace.fs.stat(fileUri).then(
      () => {
        // File exists — extension validity (e.g. .prompt.md for prompts) is
        // enforced by schema (promptFilePathSchema), so no redundant check.
      },
      () => {
        if (validationVersions.get(uriKey) !== version) return;

        diagnostics.push(
          makeFileDiagnostic(
            source,
            asset.pathInTree,
            `File not found: ${asset.path}`,
            vscode.DiagnosticSeverity.Error,
          ),
        );
        diagnosticCollection.set(document.uri, diagnostics);
      },
    );
  }
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
  const source = document.getText();
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

  diagnosticCollection.set(document.uri, vscodeDiagnostics);
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

  provideTextDocumentContent(uri: vscode.Uri): string {
    const sourceUri = vscode.Uri.parse(decodeURIComponent(uri.query));
    const sourceDoc = vscode.workspace.textDocuments.find(
      (d) => d.uri.toString() === sourceUri.toString(),
    );
    if (!sourceDoc) {
      this.diagnostics.delete(uri);
      return "# Source document not found. Please reopen the preview.";
    }

    const result = expandAndValidate(sourceDoc.getText());
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
        const expandedUri = vscode.Uri.parse(
          `${EXPANDED_SCHEME}:${sourceUri.path} (expanded)?${encodeURIComponent(sourceUri.toString())}`,
        );
        this._onDidChange.fire(expandedUri);
      }, DEBOUNCE_MS),
    );
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
      --stagebook-primary: #3b82f6;
      --stagebook-primary-hover: #2563eb;
      --stagebook-text: #1f2937;
      --stagebook-text-secondary: #374151;
      --stagebook-text-muted: #6b7280;
      --stagebook-text-faint: #9ca3af;
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
      --stagebook-blockquote-border: #d1d5db;
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
 * After #277, this loads any `imports:` declared in the file (and
 * transitively in those imports) using vscode's filesystem API, then
 * merges every imported file's `templates:` into the root file's
 * templates list with path rewriting (per template, relative to the
 * file it was declared in). The merged result is then template-
 * expanded via `fillTemplates` and schema-validated.
 *
 * Async because import loading goes through `vscode.workspace.fs`.
 * Returns `null` on any failure (parse, missing import, validation)
 * — the caller surfaces a generic "could not parse" message and
 * leaves precise diagnostics to the in-editor validator.
 */
async function parseTreatmentForPreview(source: string, rootDir: vscode.Uri) {
  let rootParse: ReturnType<typeof parseStagebookYaml>;
  try {
    rootParse = parseStagebookYaml(source);
  } catch {
    return null;
  }
  const root = rootParse.parsed as ParsedFile;

  // Imports loading loop. The host owns the loop (per #277's
  // design); stagebook's helpers handle path canonicalization
  // (`resolveImportPath`) and merging (`resolveImports`).
  const loaded = new Map<string, ParsedFile>();
  const queue: string[] = rootParse.imports.map((p) =>
    // The root file's own path is the parent for resolving its imports.
    // Using a fictional `root.stagebook.yaml` here gives the right
    // relative behavior because `resolveImportPath` only uses the
    // parent's directory portion.
    resolveImportPath("root.stagebook.yaml", p),
  );
  const decoder = new TextDecoder();
  while (queue.length > 0) {
    const importPath = queue.shift()!;
    if (loaded.has(importPath)) continue;
    const importUri = vscode.Uri.joinPath(rootDir, importPath);
    let bytes: Uint8Array;
    try {
      bytes = await vscode.workspace.fs.readFile(importUri);
    } catch {
      // Import file not found / unreadable. Could surface a real
      // diagnostic here in a follow-up; for now the preview just
      // refuses to render.
      return null;
    }
    let importedParse: ReturnType<typeof parseStagebookYaml>;
    try {
      importedParse = parseStagebookYaml(decoder.decode(bytes));
    } catch {
      return null;
    }
    loaded.set(importPath, importedParse.parsed as ParsedFile);
    for (const next of importedParse.imports) {
      queue.push(resolveImportPath(importPath, next));
    }
  }

  // Merge templates with per-file path rewriting.
  let mergedTemplates: unknown[];
  try {
    mergedTemplates = resolveImports({ main: root, files: loaded });
  } catch {
    return null;
  }

  // Strip `imports:` from the root and replace `templates:` with the
  // merged set. This is what the schema/runtime expects (no imports
  // in the post-fill world).
  //
  // Re-attach `templates:` whenever the root explicitly had it,
  // even if the merged array is empty — preserves the schema's
  // rejection of `templates: []` in the root (an authoring error
  // that would otherwise be silently masked by stripping the key).
  const rootHadTemplates = "templates" in root;
  const { imports: _imports, templates: _origTemplates, ...rest } = root;
  void _imports;
  void _origTemplates;
  const merged: Record<string, unknown> = { ...rest };
  if (mergedTemplates.length > 0 || rootHadTemplates) {
    merged.templates = mergedTemplates;
  }

  // Template expansion (existing pipeline).
  let expanded: Record<string, unknown> = merged;
  if (mergedTemplates.length > 0) {
    try {
      const { result } = fillTemplates({
        obj: merged,
        templates: mergedTemplates,
        allowUnresolved: true,
      });
      expanded = result as Record<string, unknown>;
    } catch {
      return null;
    }
  }

  const parsed = treatmentFileSchema.safeParse(expanded);
  if (!parsed.success) return null;
  return parsed.data;
}

export function activate(context: vscode.ExtensionContext): void {
  context.subscriptions.push(diagnosticCollection);

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
  let currentTreatment: Awaited<ReturnType<typeof parseTreatmentForPreview>> =
    null;
  let currentTreatmentUri: vscode.Uri | undefined;
  let currentTreatmentDir: vscode.Uri | undefined;
  let currentWorkspaceRootFsPath: string | undefined;

  context.subscriptions.push(
    vscode.commands.registerCommand("stagebook.previewStage", async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor || !isStagebookYaml(editor.document)) {
        vscode.window.showWarningMessage("Open a .stagebook.yaml file first.");
        return;
      }

      const source = editor.document.getText();
      const previewRootDir = vscode.Uri.joinPath(editor.document.uri, "..");
      currentTreatment = await parseTreatmentForPreview(source, previewRootDir);
      if (!currentTreatment) {
        vscode.window.showErrorMessage(
          "Could not parse treatment file for preview.",
        );
        return;
      }

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

      if (previewPanel) {
        previewPanel.reveal(vscode.ViewColumn.Beside);
      } else {
        previewPanel = vscode.window.createWebviewPanel(
          "stagebook.stagePreview",
          "Stage Preview",
          vscode.ViewColumn.Beside,
          {
            enableScripts: true,
            localResourceRoots: [
              vscode.Uri.joinPath(context.extensionUri, "dist"),
              ...(vscode.workspace.workspaceFolders?.map((f) => f.uri) ?? []),
            ],
          },
        );
        previewPanel.onDidDispose(() => {
          previewPanel = undefined;
        });

        // Handle messages from the webview
        previewPanel.webview.onDidReceiveMessage(async (msg) => {
          if (msg.type === "ready" && currentTreatment && currentTreatmentDir) {
            const baseUri = previewPanel!.webview
              .asWebviewUri(currentTreatmentDir)
              .toString();
            previewPanel?.webview.postMessage({
              type: "treatment",
              treatmentFile: currentTreatment,
              introIndex: 0,
              treatmentIndex: 0,
              webviewBaseUri: baseUri,
            });
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
              const parsed = await parseTreatmentForPreview(
                doc.getText(),
                treatmentDir,
              );
              if (!parsed) {
                vscode.window.showErrorMessage(
                  "Refresh failed: could not parse treatment file.",
                );
                return;
              }
              currentTreatment = parsed;
              // Panel may have been disposed while we were awaiting above.
              if (!previewPanel) return;
              const baseUri = panel.webview
                .asWebviewUri(treatmentDir)
                .toString();
              panel.webview.postMessage({
                type: "treatment",
                treatmentFile: parsed,
                introIndex: 0,
                treatmentIndex: 0,
                webviewBaseUri: baseUri,
              });
            } catch (err) {
              vscode.window.showErrorMessage(
                `Refresh failed: ${err instanceof Error ? err.message : String(err)}`,
              );
            }
          } else if (msg.type === "readFile" && currentTreatmentDir) {
            // Guard against path traversal
            const filePath = String(msg.path);
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
          }
        });
      }

      previewPanel.webview.html = getWebviewContent(
        previewPanel.webview,
        context.extensionUri,
      );
    }),
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

  // Validate on edit (debounced)
  context.subscriptions.push(
    vscode.workspace.onDidChangeTextDocument((event) => {
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
      diagnosticCollection.delete(document.uri);
    }),
  );
}

export function deactivate(): void {}
