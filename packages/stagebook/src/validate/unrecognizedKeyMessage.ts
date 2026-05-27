/**
 * Match the rich "Unrecognized key 'X' on …. Did you mean 'Y'? …"
 * diagnostic produced by stagebook's `safeParseTreatmentFile` wrapper
 * (#123). The first capture group is the bad key; the second is the
 * suggested replacement.
 *
 * Lives in its own module (no `vscode` import) so the regression test
 * can import it without pulling in the VS Code extension API. The
 * test pins the regex's compatibility with the messages stagebook
 * actually emits — so if either side drifts, CI catches it before the
 * quick-fix silently stops offering replacements.
 */
export const UNRECOGNIZED_KEY_DID_YOU_MEAN_RE =
  /^Unrecognized key '([^']+)' on [^.]+\. Did you mean '([^']+)'\?/;
