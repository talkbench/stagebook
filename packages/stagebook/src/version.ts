// The published package version, inlined by tsup's `define` (tsup.config.ts).
// Builds that compile from source — the viewer, component tests, vitest —
// don't define it, and report "unknown".

declare const __STAGEBOOK_VERSION__: string | undefined;

export const STAGEBOOK_VERSION: string =
  typeof __STAGEBOOK_VERSION__ === "string" ? __STAGEBOOK_VERSION__ : "unknown";
