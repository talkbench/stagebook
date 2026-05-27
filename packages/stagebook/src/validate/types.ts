import type { SourceRange } from "./yamlPositionMap.js";

export interface Diagnostic {
  message: string;
  severity: "error" | "warning";
  range: SourceRange | null;
}
