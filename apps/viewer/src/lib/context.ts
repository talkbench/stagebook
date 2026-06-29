import type { StagebookContext } from "stagebook/components";
import { ViewerStateStore } from "./store";

export interface ViewerContextOptions {
  store: ViewerStateStore;
  position: number;
  stageIndex: number;
  playerCount: number;
  onSubmit: () => void;
  getTextContent: (path: string) => Promise<string>;
  getAssetURL: (path: string) => string;
  contentVersion?: number;
  renderers?: Partial<
    Pick<
      StagebookContext,
      "renderDiscussion" | "renderSurvey" | "renderSharedNotepad"
    >
  >;
}

/**
 * Create a mock StagebookContext backed by a ViewerStateStore.
 *
 * This is the bridge between the viewer's state management and
 * the stagebook component rendering contract.
 */
export function createViewerContext(
  options: ViewerContextOptions,
): StagebookContext {
  const {
    store,
    position,
    stageIndex,
    playerCount,
    onSubmit,
    getTextContent,
    getAssetURL,
    contentVersion,
    renderers,
  } = options;

  return {
    get(key: string, scope?: string): unknown[] {
      const mapped = mapPosition(scope, position);
      // Stagebook may pass `"player"` (default) → current position,
      // `"shared"`, a numeric slot index, or `"all"`. After #238, the
      // condition leaves use only the first three; `"all"` still
      // arrives via `display.position: "all"` (and similarly for
      // trackedLink/qualtrics urlParams), and stagebook normalizes
      // `display.position: "any"` to `"all"` before reaching this
      // callback so we only need to handle one aggregator scope.
      const raw =
        typeof mapped === "number" || mapped === "shared"
          ? store.lookup(key, mapped)
          : // `"all"` (or any unrecognized scope, defensively) reads
            // every participant's value for this key.
            store.lookup(key);
      // Synthesize a per-position default `stableParticipantId` (#473) so
      // previews work out of the box and a qualtrics element doesn't report a
      // (preview-only) contract violation; any value seeded via the
      // StateInspector overrides it.
      if (key === "attributes") {
        const posForId = typeof mapped === "number" ? mapped : position;
        return withDefaultAttributes(raw, posForId);
      }
      return raw;
    },

    save(key: string, value: unknown, scope?: "player" | "shared"): void {
      store.save(key, value, scope ?? "player", position, stageIndex);
    },

    getElapsedTime(): number {
      return store.getElapsedTime(stageIndex);
    },

    submit(): void {
      onSubmit();
    },

    // Single-participant preview: stage-level conditions (#183) end the
    // stage by the same mechanism a submit button does. No cross-client
    // coordination to do — just advance.
    advanceStage(): void {
      onSubmit();
    },

    // Opaque per-stage identity (just the index, which is unique per
    // flattened step). Lets the StageConditionGate's latch reset cleanly
    // when the stage changes.
    stageId: `stage-${String(stageIndex)}`,

    getAssetURL,
    getTextContent,
    contentVersion,

    progressLabel: `game_${stageIndex}`,
    playerId: "viewer",
    position,
    playerCount,

    get isSubmitted() {
      return store.getSubmitted(stageIndex);
    },

    ...renderers,
  };
}

/**
 * Ensure every `attributes` value carries a non-empty `stableParticipantId`
 * (#473). A seeded/inspector value wins only when it's a non-empty string;
 * otherwise the synthesized `viewer-p<n>` default fills the gap so a
 * freshly-loaded study previews without the host having to seed identity.
 * (A stored empty-string id must NOT clobber the default — that would make
 * the provider report a contract violation during preview.)
 */
function withDefaultAttributes(
  values: unknown[],
  positionForId: number,
): unknown[] {
  const fallbackId = `viewer-p${String(positionForId)}`;
  if (values.length === 0) return [{ stableParticipantId: fallbackId }];
  return values.map((v) => {
    const bag: Record<string, unknown> =
      v !== null && typeof v === "object" && !Array.isArray(v)
        ? { ...(v as Record<string, unknown>) }
        : {};
    const id = bag.stableParticipantId;
    if (typeof id !== "string" || id.trim().length === 0) {
      bag.stableParticipantId = fallbackId;
    }
    return bag;
  });
}

function mapPosition(
  positionArg: string | undefined,
  currentPosition: number,
): number | "shared" | "all" {
  if (positionArg === undefined || positionArg === "player") {
    return currentPosition;
  }
  if (positionArg === "shared") {
    return "shared";
  }
  if (positionArg === "all") {
    return "all";
  }
  const num = Number(positionArg);
  if (Number.isFinite(num) && Number.isInteger(num) && num >= 0) {
    return num;
  }
  return currentPosition;
}
