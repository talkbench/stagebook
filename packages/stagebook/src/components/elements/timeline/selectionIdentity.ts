import type { PointSelection, RangeSelection } from "./selections.js";

type TrackIdentity = { readonly position: number };
type Selection = PointSelection | RangeSelection;

/** Reducer/geometry use row indices; the storage boundary uses positions. */
export function saveSelectionIdentity(
  selections: readonly Selection[],
  tracks?: readonly TrackIdentity[],
) {
  if (!tracks) return selections;
  return selections.map(({ track, ...selection }) => {
    if (track === undefined) return selection;
    const identity = tracks[track];
    if (!identity)
      throw new Error(
        "Cannot save a selection on an unknown participant track.",
      );
    return { ...selection, position: identity.position };
  });
}

/** Unknown/legacy identities are discarded, never silently reattributed. */
export function restoreSelectionIdentity(
  raw: unknown,
  tracks?: readonly TrackIdentity[],
): unknown {
  if (!Array.isArray(raw)) return raw;
  return raw.flatMap((item: unknown) => {
    if (!item || typeof item !== "object") return [];
    const { position, track, ...selection } = item as Record<string, unknown>;
    if (!tracks) return position === undefined ? [item] : [];
    if (track !== undefined) return [];
    if (position === undefined) return [selection];
    const row = tracks.findIndex((t) => t.position === position);
    return row === -1 ? [] : [{ ...selection, track: row }];
  });
}
