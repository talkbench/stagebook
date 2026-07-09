import { useState, useRef, useEffect, useMemo, useCallback } from "react";
import { mergeBannerPrefixes } from "./resolveAsset.js";

/**
 * Drives the asset-mount picker banner (#524).
 *
 * The host-side scan (`unmappedAssetPrefixes`) only sees `asset://` refs in the
 * treatment YAML. The webview is the one place that sees EVERY ref at render
 * time — including those in prompt bodies (`![](asset://…)`) and field-supplied
 * values (`file: ${clipUrl}`) — because `getAssetURL` is called for each. This
 * hook collects the unresolved prefixes `getAssetURL` reports (via
 * `collectUnresolved`) and unions them with the host-side scan.
 *
 * Collection is a ref write during render (safe; not state), promoted to state
 * by an effect after commit. `setState` bails when the sorted set is unchanged,
 * so it converges: a re-render collects the same prefixes and produces no
 * further update. The accumulation resets whenever `contentVersion` changes (a
 * new treatment), during render, so a treatment whose refs live only in prompt
 * bodies still re-collects from scratch.
 *
 * @param unmappedAssetPrefixes host-side static scan (all treatment arms)
 * @param assetRoots            prefix → mounted webview URI (to drop mounted)
 * @param contentVersion        bumped per treatment message; resets collection
 * @returns `bannerPrefixes` (sorted, deduped, mounted-filtered) and
 *          `collectUnresolved` for `getAssetURL` to report into
 */
export function useAssetBanner(
  unmappedAssetPrefixes: string[],
  assetRoots: Record<string, string>,
  contentVersion: number,
): { bannerPrefixes: string[]; collectUnresolved: (prefix: string) => void } {
  const [seenUnresolved, setSeenUnresolved] = useState<string[]>([]);
  const unresolvedRef = useRef<Set<string>>(new Set());
  const lastContentVersionRef = useRef(contentVersion);

  // Reset DURING render (before the child tree calls getAssetURL) so this pass
  // re-collects from scratch. An effect would clear the just-collected set and
  // then never re-run for a treatment whose refs are all in prompt bodies.
  // Resetting `seenUnresolved` here too (React's set-state-during-render, which
  // re-renders before paint) avoids a one-frame flash of the previous
  // treatment's accumulated prefixes on a bump render.
  if (lastContentVersionRef.current !== contentVersion) {
    lastContentVersionRef.current = contentVersion;
    unresolvedRef.current = new Set();
    setSeenUnresolved((prev) => (prev.length === 0 ? prev : []));
  }

  // Stable, so it doesn't churn a getAssetURL/contentFns memo; reads the ref
  // dynamically.
  const collectUnresolved = useCallback((prefix: string) => {
    unresolvedRef.current.add(prefix);
  }, []);

  // Promote the render-collected set to state after each render. Bails when
  // unchanged → converges.
  useEffect(() => {
    const collected = [...unresolvedRef.current].sort();
    setSeenUnresolved((prev) =>
      prev.length === collected.length &&
      prev.every((p, i) => p === collected[i])
        ? prev
        : collected,
    );
  });

  const bannerPrefixes = useMemo(
    () =>
      mergeBannerPrefixes(unmappedAssetPrefixes, seenUnresolved, assetRoots),
    [unmappedAssetPrefixes, seenUnresolved, assetRoots],
  );

  return { bannerPrefixes, collectUnresolved };
}
