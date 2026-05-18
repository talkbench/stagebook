/**
 * Test wrapper for rendering Stage with a mock StagebookProvider.
 * Used by Playwright CT tests where function props can't be serialized.
 *
 * The mock provider returns static data — no real state management.
 * This is sufficient for testing layout, conditional rendering, and styling.
 */
import React from "react";
import {
  StagebookProvider,
  type StagebookContext,
} from "../StagebookProvider.js";
import { Stage, type StageConfig } from "../Stage.js";
import { getReferenceKeyAndPath } from "../../utils/reference.js";
import { sanitizeName } from "../../utils/deriveStorageKeyName.js";

export interface MockStageRendererProps {
  stage: StageConfig;
  position?: number;
  playerCount?: number;
  isSubmitted?: boolean;
  elapsedTime?: number;
  /**
   * Key-value map of DSL reference string → extracted value
   * (e.g., `"self.prompt.answer" → "yes"`). Per #298 the reference
   * needs a position prefix; the prefix itself is discarded when
   * computing the storage key, so any valid prefix works.
   */
  stateValues?: Record<string, unknown>;
  /**
   * Host advancement hook for stage-level conditions (#183). Default
   * is a no-op so existing tests aren't affected; tests that want to
   * verify stage-gate advancement can pass a mock to inspect.
   */
  advanceStage?: () => void;
  /** Opaque stage id — for the gate's latch-reset logic. */
  stageId?: string;
  /** Forwards to `<Stage scrollMode={...}>`. Default `"internal"` so
   *  existing tests are unaffected. (Issue #236.) */
  scrollMode?: "internal" | "host";
}

/** Wrap a value at a nested path, e.g. wrapAtPath("yes", ["value"]) → { value: "yes" } */
function wrapAtPath(value: unknown, path: string[]): unknown {
  if (path.length === 0) return value;
  const result: Record<string, unknown> = {};
  let cursor = result;
  for (let i = 0; i < path.length - 1; i++) {
    cursor[path[i]] = {};
    cursor = cursor[path[i]] as Record<string, unknown>;
  }
  cursor[path[path.length - 1]] = value;
  return result;
}

/** Convert DSL-reference-keyed stateValues to flat-key → raw-record map. */
function buildFlatValues(
  stateValues: Record<string, unknown>,
): Map<string, unknown> {
  const flat = new Map<string, unknown>();
  for (const [ref, val] of Object.entries(stateValues)) {
    const { referenceKey, path } = getReferenceKeyAndPath(ref);
    flat.set(referenceKey, wrapAtPath(val, path));
  }
  return flat;
}

export function MockStageRenderer({
  stage,
  position = 0,
  playerCount = 2,
  isSubmitted = false,
  elapsedTime = 0,
  stateValues = {},
  advanceStage,
  stageId,
  scrollMode,
}: MockStageRendererProps) {
  const flatValues = buildFlatValues(stateValues);

  const mockContext: StagebookContext = {
    get: (key: string) => {
      const val = flatValues.get(key);
      return val !== undefined ? [val] : [];
    },
    save: () => {},
    getElapsedTime: () => elapsedTime,
    submit: () => {},
    advanceStage,
    stageId,
    getAssetURL: (path: string) => `https://mock-cdn.test/${path}`,
    getTextContent: (path: string) =>
      Promise.resolve(
        // After #243 noResponse files are two-section (no trailing `---`).
        // After #360 the frontmatter `name:` is validated against
        // `nameSchema`, so synthesized names must be sanitized — raw
        // paths contain `/` and `.` which the regex rejects.
        `---\nname: ${sanitizeName(path)}\ntype: noResponse\n---\nMock content for ${path}\n`,
      ),
    progressLabel: `game_0_${stage.name}`,
    playerId: "test-player-1",
    position,
    playerCount,
    isSubmitted,
    renderDiscussion: stage.discussion
      ? () => (
          <div
            data-testid="mock-discussion"
            style={{
              width: "100%",
              height: "100%",
              minHeight: "200px",
              backgroundColor: "#f0f4f8",
              border: "2px dashed #94a3b8",
              borderRadius: "8px",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "#64748b",
              fontSize: "0.875rem",
            }}
          >
            Mock {stage.discussion?.chatType} discussion
          </div>
        )
      : undefined,
  };

  return (
    <StagebookProvider value={mockContext}>
      <Stage stage={stage} onSubmit={() => {}} scrollMode={scrollMode} />
    </StagebookProvider>
  );
}
