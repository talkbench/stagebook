/**
 * Pure aggregation + formatting for the "Validate Workspace" status-bar
 * summary. Kept free of the `vscode` API so it can be unit-tested; the
 * extension maps `vscode.Diagnostic.severity` to these string labels and
 * groups by file before calling in.
 */

export type DiagnosticSeverityLabel = "error" | "warning";

export interface ValidationSummary {
  errors: number;
  warnings: number;
  /** Number of files that have at least one Stagebook diagnostic. */
  filesWithDiagnostics: number;
}

/**
 * Aggregate per-file diagnostic severities into totals. `perFile[i]` is the
 * list of Stagebook diagnostic severities for one file (already filtered to
 * `source === "stagebook"` by the caller).
 */
export function summarizeDiagnostics(
  perFile: DiagnosticSeverityLabel[][],
): ValidationSummary {
  let errors = 0;
  let warnings = 0;
  let filesWithDiagnostics = 0;

  for (const file of perFile) {
    if (file.length === 0) continue;
    filesWithDiagnostics += 1;
    for (const severity of file) {
      if (severity === "error") errors += 1;
      else warnings += 1;
    }
  }

  return { errors, warnings, filesWithDiagnostics };
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

/**
 * Build the status-bar `text` and `tooltip` for a completed workspace
 * validation. `filesValidated` is the total number of Stagebook files scanned
 * (not just those with diagnostics).
 */
export function formatValidationStatusBar(
  summary: ValidationSummary,
  filesValidated: number,
): { text: string; tooltip: string } {
  const filesScanned = plural(filesValidated, "file");

  if (summary.errors === 0 && summary.warnings === 0) {
    return {
      text: `$(check) Stagebook: no issues in ${filesScanned}`,
      tooltip: `Validated ${filesScanned}, no issues found — click to open the Problems panel.`,
    };
  }

  const text =
    `$(warning) Stagebook: ${plural(summary.errors, "error")}, ` +
    `${plural(summary.warnings, "warning")} across ${filesScanned}`;

  const affected = plural(summary.filesWithDiagnostics, "file");
  const tooltip =
    `${plural(summary.errors, "error")}, ${plural(summary.warnings, "warning")} ` +
    `in ${affected} (of ${filesScanned} scanned) — click to open the Problems panel.`;

  return { text, tooltip };
}
