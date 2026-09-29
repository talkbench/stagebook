export { compare, type Comparator } from "./compare.js";
export { computeWatchedRanges } from "./watchedRanges.js";
export {
  getReferenceKeyAndPath,
  getNestedValueByPath,
  type ReferenceKeyAndPath,
} from "./reference.js";
export {
  evaluateCondition,
  evaluateConditions,
  type Condition,
  type ConditionNode,
} from "./evaluateConditions.js";
export {
  getReferencedAssets,
  collectAssetPrefixes,
  type ReferencedAsset,
} from "./referencedAssets.js";
// Kept in a separate module so its CommonMark parser can be tree-shaken from
// bundles that don't enumerate markdown (see that file's header + #577).
export {
  getMarkdownImageReferences,
  type MarkdownImageReference,
} from "./markdownImageReferences.js";
export { sanitizeName, deriveStorageKeyName } from "./deriveStorageKeyName.js";
export {
  checkResponse,
  type ResponseConstraints,
  type ResponseCheck,
} from "./checkResponse.js";
export {
  buildPromptRecord,
  type BuildPromptRecordOptions,
  type PromptRecord,
} from "./buildPromptRecord.js";
export type {
  TypingStats,
  PasteAttempt,
  DebugMessage,
} from "./promptTelemetry.js";
export {
  parseNumericEntry,
  couldBecomeValidByAppending,
  filterNumericInsertion,
  formatNumericPlain,
  numericInputMode,
  NUMERIC_ENTRY_LIMIT,
  NUMERIC_SIGNIFICANT_DIGITS,
  type NumericConstraints,
  type NumericParseResult,
  type NumericInsertion,
  type NumericInsertionResult,
} from "./numericResponse.js";
