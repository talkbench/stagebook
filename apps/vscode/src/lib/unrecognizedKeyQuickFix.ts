import * as vscode from "vscode";
import { UNRECOGNIZED_KEY_DID_YOU_MEAN_RE } from "stagebook/validate";

// Why parse the suggestion out of the message instead of attaching
// structured params: vscode.Diagnostic has no extension-data field
// that survives the round-trip through `vscode.languages.getDiagnostics`.
// The regex/message pair is owned end-to-end by stagebook + this
// extension, and `unrecognizedKeyQuickFix.test.ts` pins them together
// — so drift is caught in CI rather than in the field.
export { UNRECOGNIZED_KEY_DID_YOU_MEAN_RE };

/**
 * Quick-fix provider that offers a "Change to 'X'" action for each
 * `safeParseTreatmentFile` diagnostic that includes a suggestion.
 *
 * The diagnostic's range covers the *key token* (e.g., `survyName`)
 * because `validateTreatment` resolves unrecognized-key issues via
 * the position mapper's `resolveKey()` method. Replacing
 * `diagnostic.range` with the suggestion therefore renames the key,
 * not its value — no regex over the document text needed.
 */
export class UnrecognizedKeyQuickFixProvider
  implements vscode.CodeActionProvider
{
  static readonly providedCodeActionKinds = [vscode.CodeActionKind.QuickFix];

  provideCodeActions(
    document: vscode.TextDocument,
    range: vscode.Range,
  ): vscode.CodeAction[] {
    const diagnostics = vscode.languages
      .getDiagnostics(document.uri)
      .filter(
        (d) =>
          d.source === "stagebook" &&
          UNRECOGNIZED_KEY_DID_YOU_MEAN_RE.test(d.message) &&
          d.range.intersection(range),
      );

    const actions: vscode.CodeAction[] = [];
    for (const diagnostic of diagnostics) {
      const match = UNRECOGNIZED_KEY_DID_YOU_MEAN_RE.exec(diagnostic.message);
      if (!match) continue;
      const [, , suggestion] = match;

      const action = new vscode.CodeAction(
        `Change to '${suggestion}'`,
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
