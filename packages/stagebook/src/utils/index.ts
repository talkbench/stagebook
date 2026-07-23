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
