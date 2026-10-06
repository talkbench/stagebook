import type { SourceRange } from "./yamlPositionMap.js";

export interface Diagnostic {
  /** Stable rule id lets later passes replace diagnostics with better evidence. */
  code?: string;
  message: string;
  severity: "error" | "warning";
  range: SourceRange | null;
}
