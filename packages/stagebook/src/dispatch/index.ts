// stagebook/dispatch
// Pure-function dispatchers for assigning participants to treatments
// (#448). The structural-invariant contract harness (`runContractSuite`)
// lives at `stagebook/dispatch/contract` — a separate subpath so the
// harness's vitest dependency stays out of the main runtime bundle.

export * from "./types.js";
export { extractConditionKeys } from "./extractConditionKeys.js";
export { makeEligibilityTable } from "./makeEligibilityTable.js";
export { uniformRandom, type UniformRandomArgs } from "./uniformRandom.js";
export { weightedRandom, type WeightedRandomArgs } from "./weightedRandom.js";
export {
  urnRandomization,
  type UrnRandomizationArgs,
  type UrnRandomizationResult,
} from "./urnRandomization.js";
export {
  weightedKnockdown,
  type WeightedKnockdownArgs,
  type WeightedKnockdownResult,
} from "./weightedKnockdown.js";
export {
  validateDispatcherConfig,
  type DispatcherConfigDiagnostic,
  type DispatcherConfigValidationResult,
} from "./validateDispatcherConfig.js";
