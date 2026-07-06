import { useState } from "react";
import {
  getReferenceKeyAndPath,
  getNestedValueByPath,
} from "../../utils/index.js";
import { parseDottedReference } from "../../schemas/index.js";
import { Markdown } from "../../components/index.js";
import { ViewerStateStore, type PositionKey } from "../lib/store.js";
import { extractStageReferences } from "../lib/references.js";
import type { ViewerStep } from "../lib/steps.js";

/**
 * Resolve a reference string's position prefix to a store-level
 * `PositionKey` (or `undefined` for "all"-style aggregator reads that
 * span every player position).
 *
 * Pre-#298 references had no position prefix and the inspector
 * implicitly used the current participant's position for every
 * lookup/edit. After #298 the position is part of the reference
 * itself (`0.prompt.X`, `shared.survey.X`, `self.entryUrl.params.X`),
 * so the inspector must honor the reference's *named* position — not
 * the current participant — when reading or writing that reference's
 * stored value. Without this, `0.prompt.X` viewed/edited while the
 * current participant is position 1 would (a) display position 1's
 * value instead of position 0's, and (b) write inspector edits into
 * position 1's bucket instead of position 0's. (#349.)
 *
 * Returns `null` for invalid references (caller renders a disabled
 * "(invalid reference)" placeholder).
 */
export function resolveReferencePosition(
  reference: string,
  currentPosition: number,
): { kind: "single"; position: PositionKey } | { kind: "all" } | null {
  const parsed = parseDottedReference(reference);
  if (!parsed.ok) return null;
  const refPos = parsed.value.position;
  if (refPos === "self") return { kind: "single", position: currentPosition };
  if (refPos === "shared") return { kind: "single", position: "shared" };
  if (refPos === "all") return { kind: "all" };
  if (typeof refPos === "number") return { kind: "single", position: refPos };
  // Fallback for any future position-token shape we haven't taught
  // the inspector about yet.
  return { kind: "single", position: currentPosition };
}

// Mirrors the read-side guard in stagebook/utils/reference.ts. The viewer
// writes through these paths, so traversing into prototype slots would let
// a crafted reference mutate Object.prototype. Defence in depth.
const DISALLOWED_PATH_SEGMENTS = new Set([
  "__proto__",
  "constructor",
  "prototype",
]);

function hasUnsafeSegment(path: string[]): boolean {
  return path.some((seg) => DISALLOWED_PATH_SEGMENTS.has(seg));
}

/**
 * DOM id used to scroll a specific element's note into view. Encodes the
 * type and name so characters like spaces (which nameSchema permits in
 * some contexts) don't produce invalid HTML ids.
 */
export function noteAnchorId(
  elementType: string,
  elementName?: string,
): string {
  const type = encodeURIComponent(elementType);
  const name =
    elementName === undefined ? "" : `-${encodeURIComponent(elementName)}`;
  return `note-${type}${name}`;
}

interface StateInspectorProps {
  store: ViewerStateStore;
  currentStep: ViewerStep;
  stageIndex: number;
  position: number;
  playerCount: number;
  /**
   * Called after every store-mutating action triggered from the inspector
   * (Clear all state, ×-clear a reference). Components like Timeline read
   * `initialSelections` from the store once on mount and then own that
   * data locally, so a store edit alone doesn't update what's rendered —
   * the Viewer wires this to a `<Stage>` key bump that forces a remount,
   * letting elements re-read the post-edit store. (Issue #170.)
   */
  onResetStage?: () => void;
}

export function StateInspector({
  store,
  currentStep,
  stageIndex,
  position,
  playerCount,
  onResetStage,
}: StateInspectorProps) {
  const [showAll, setShowAll] = useState(false);
  const [confirmingClearAll, setConfirmingClearAll] = useState(false);

  const references = extractStageReferences(
    currentStep.elements as Record<string, unknown>[],
  );

  const isSubmitted = store.getSubmitted(stageIndex);

  return (
    <div style={containerStyle}>
      <div style={sectionHeaderStyle}>This stage</div>

      {/* Viewer controls */}
      <div style={controlGroupStyle}>
        <label style={controlLabelStyle}>
          <input
            type="checkbox"
            checked={isSubmitted}
            onChange={(e) => store.setSubmitted(stageIndex, e.target.checked)}
            style={checkboxStyle}
          />
          submitted
        </label>
      </div>

      {/* References relevant to this stage */}
      {references.length > 0 && (
        <>
          <div style={{ ...sectionHeaderStyle, marginTop: "1rem" }}>
            Referenced state
          </div>
          {references.map((ref) => (
            <ReferenceEditor
              key={ref}
              reference={ref}
              store={store}
              position={position}
              stageIndex={stageIndex}
              onAfterClear={onResetStage}
            />
          ))}
        </>
      )}

      {references.length === 0 && (
        <p style={emptyStyle}>No external references on this stage.</p>
      )}

      {/* Researcher notes (never shown to participants) */}
      <NotesSection currentStep={currentStep} />

      {/* All state expansion + clear */}
      <div style={allStateActionsStyle}>
        <button onClick={() => setShowAll(!showAll)} style={expandButtonStyle}>
          {showAll ? "▾ Hide all state" : "▸ Show all state"}
        </button>
        {confirmingClearAll ? (
          <div style={clearAllConfirmGroupStyle}>
            <button
              type="button"
              onClick={() => {
                store.clearAll();
                // Remount so components like Timeline re-read the now-empty
                // store; otherwise local state in mounted elements would
                // still display the pre-clear values. (Issue #170.)
                onResetStage?.();
                setConfirmingClearAll(false);
              }}
              style={clearAllConfirmButtonStyle}
              title="Wipe all stored state"
            >
              Confirm clear
            </button>
            <button
              type="button"
              onClick={() => setConfirmingClearAll(false)}
              style={clearAllCancelButtonStyle}
            >
              Cancel
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setConfirmingClearAll(true)}
            style={clearAllButtonStyle}
            title="Wipe all stored state in the viewer"
          >
            Clear all state
          </button>
        )}
      </div>

      {showAll && (
        <AllState
          store={store}
          currentStageIndex={stageIndex}
          playerCount={playerCount}
        />
      )}
    </div>
  );
}

interface ElementNote {
  type: string;
  name?: string;
  notes: string;
}

function NotesSection({ currentStep }: { currentStep: ViewerStep }) {
  const stageNote = currentStep.notes;
  const elementNotes: ElementNote[] = [];
  for (const el of currentStep.elements) {
    const e = el as { type: string; name?: string; notes?: string };
    if (e.notes) {
      elementNotes.push({ type: e.type, name: e.name, notes: e.notes });
    }
  }

  if (!stageNote && elementNotes.length === 0) return null;

  return (
    <>
      <div style={{ ...sectionHeaderStyle, marginTop: "1rem" }}>Notes</div>
      <div style={notesStackStyle}>
        {stageNote && (
          <div style={noteItemStyle}>
            <div style={noteLabelStyle}>Stage: {currentStep.name}</div>
            <div style={noteBodyStyle}>
              <Markdown text={stageNote} />
            </div>
          </div>
        )}
        {elementNotes.map((n, i) => (
          <div
            id={noteAnchorId(n.type, n.name)}
            key={`${n.type}-${n.name ?? "anon"}-${i}`}
            style={noteItemStyle}
          >
            <div style={noteLabelStyle}>
              Element: {n.name ?? "(unnamed)"}{" "}
              <span style={noteTypeStyle}>({n.type})</span>
            </div>
            <div style={noteBodyStyle}>
              <Markdown text={n.notes} />
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

function ReferenceEditor({
  reference,
  store,
  position,
  stageIndex,
  onAfterClear,
}: {
  reference: string;
  store: ViewerStateStore;
  position: number;
  stageIndex: number;
  /** Fired after a × clear so the parent can remount the stage and let
   *  read-once components (e.g. Timeline) pick up the post-delete store. */
  onAfterClear?: () => void;
}) {
  let referenceKey: string;
  let path: string[];
  try {
    ({ referenceKey, path } = getReferenceKeyAndPath(reference));
  } catch {
    return (
      <div style={refGroupStyle}>
        <label style={refLabelStyle}>{reference}</label>
        <input
          type="text"
          value=""
          disabled
          placeholder="(invalid reference)"
          style={{ ...refInputStyle, opacity: 0.5 }}
        />
      </div>
    );
  }

  const unsafe = hasUnsafeSegment(path);

  if (unsafe) {
    return (
      <div style={refGroupStyle}>
        <label style={refLabelStyle}>{reference}</label>
        <input
          type="text"
          value=""
          disabled
          placeholder="(unsafe path segment)"
          style={{ ...refInputStyle, opacity: 0.5 }}
        />
      </div>
    );
  }

  // Honor the reference's named position when reading + writing (#349).
  // `self` → current participant; `shared` → "shared"; numeric → that
  // slot index; `all` → read across every position (display only — no
  // single-cell edit target).
  const refPos = resolveReferencePosition(reference, position);
  if (refPos === null) {
    return (
      <div style={refGroupStyle}>
        <label style={refLabelStyle}>{reference}</label>
        <input
          type="text"
          value=""
          disabled
          placeholder="(invalid reference)"
          style={{ ...refInputStyle, opacity: 0.5 }}
        />
      </div>
    );
  }

  // For "all" refs, lookup with no position arg — store.lookup returns
  // every player position's value for the key. For single-position refs,
  // lookup with the resolved key.
  const rawValues =
    refPos.kind === "all"
      ? store.lookup(referenceKey)
      : store.lookup(referenceKey, refPos.position);
  const values = rawValues
    .map((v) => getNestedValueByPath(v, path))
    .filter((v) => v !== undefined);
  const firstValue = values[0];
  const isSet = values.length > 0;
  // Compound (object/array) values: pretty-print as JSON in a read-only
  // textarea so they render as e.g. `[{"start": 8.158, "end": 13.314}]`
  // instead of `[object Object]`. Editing compound values via the inspector
  // would require JSON parsing per keystroke (#169 explicitly punted on
  // that); for compound writes use "Show all state" or the ✕ clear.
  const isCompound = firstValue !== null && typeof firstValue === "object";
  // For "all" references showing N values, render as a JSON array (read
  // only) so the inspector surfaces every position's contribution.
  const isAggregateRead = refPos.kind === "all" && values.length > 1;
  const currentValue = !isSet
    ? ""
    : isAggregateRead
      ? JSON.stringify(values, null, 2)
      : isCompound
        ? JSON.stringify(firstValue, null, 2)
        : String(firstValue);

  // Edits are scoped to a single position. `all`-style references don't
  // have an unambiguous write target, so they're read-only here.
  const editPosition: PositionKey | null =
    refPos.kind === "single" ? refPos.position : null;

  const handleChange = (newValue: string) => {
    if (editPosition === null) return;
    if (path.length === 0) {
      // No nested path — store the value directly
      store.set(editPosition, referenceKey, newValue, stageIndex);
    } else {
      // Nested path (e.g., prompt → path=["value"]) — preserve existing
      // object structure and write the value at the correct path. Use
      // Object.hasOwn to avoid traversing inherited properties.
      const existing = store.get(editPosition, referenceKey)?.value;
      const obj =
        existing && typeof existing === "object" && !Array.isArray(existing)
          ? { ...(existing as Record<string, unknown>) }
          : {};
      let cursor: Record<string, unknown> = obj;
      for (let i = 0; i < path.length - 1; i++) {
        const seg = path[i];
        const child = Object.hasOwn(cursor, seg) ? cursor[seg] : undefined;
        if (typeof child !== "object" || child === null) {
          cursor[seg] = {};
        }
        cursor = cursor[seg] as Record<string, unknown>;
      }
      cursor[path[path.length - 1]] = newValue;
      store.set(editPosition, referenceKey, obj, stageIndex);
    }
  };

  const handleClear = () => {
    if (editPosition === null) return;
    if (path.length === 0) {
      store.delete(editPosition, referenceKey);
    } else {
      const existing = store.get(editPosition, referenceKey)?.value;
      if (
        !existing ||
        typeof existing !== "object" ||
        Array.isArray(existing)
      ) {
        // Nothing to prune at this path — drop the whole entry so `exists`
        // fails.
        store.delete(editPosition, referenceKey);
      } else {
        const root = deletePath(existing as Record<string, unknown>, path);
        if (root === undefined) {
          store.delete(editPosition, referenceKey);
        } else {
          store.set(editPosition, referenceKey, root, stageIndex);
        }
      }
    }
    // Remount the stage so read-once components (Timeline, etc.) pick up
    // the post-delete store; without this, local state would still show
    // the pre-clear values until manual navigation. (Issue #170.)
    onAfterClear?.();
  };

  // `all`-style references span every player position — there's no
  // single cell to edit or clear, so the inspector renders them
  // read-only with an explanatory title.
  const isReadOnly = editPosition === null || isAggregateRead;
  const readOnlyTitle =
    editPosition === null
      ? "Aggregate reference (`all`) — read-only across positions"
      : "Compound value — edit via 'Show all state' or clear with ×";

  return (
    <div style={refGroupStyle}>
      <label style={refLabelStyle}>{reference}</label>
      <div style={refInputRowStyle}>
        {isCompound || isReadOnly ? (
          <textarea
            value={currentValue}
            readOnly
            rows={Math.min(Math.max(currentValue.split("\n").length, 1), 10)}
            title={readOnlyTitle}
            style={refTextareaStyle}
          />
        ) : (
          <input
            type="text"
            value={currentValue}
            onChange={(e) => handleChange(e.target.value)}
            placeholder="(not set)"
            style={refInputStyle}
          />
        )}
        <button
          type="button"
          onClick={handleClear}
          disabled={!isSet || editPosition === null}
          aria-label={`Clear ${reference}`}
          title={
            editPosition === null
              ? "Aggregate reference — clear individual positions in 'Show all state'"
              : isSet
                ? "Remove this value entirely (so exists checks fail)"
                : "Not set"
          }
          style={
            isSet && editPosition !== null
              ? refClearButtonStyle
              : refClearButtonDisabledStyle
          }
        >
          ×
        </button>
      </div>
    </div>
  );
}

/**
 * Returns a new object with the leaf at `path` removed, pruning any
 * parent objects that become empty as a result. Returns `undefined` if
 * the entire root would become empty (signal to delete the entry).
 *
 * Defensive: rejects prototype-polluting segments and uses own-property
 * checks so callers can't reach into Object.prototype via crafted paths.
 */
function deletePath(
  obj: Record<string, unknown>,
  path: string[],
): Record<string, unknown> | undefined {
  if (path.length === 0) return undefined;
  const [head, ...rest] = path;
  if (DISALLOWED_PATH_SEGMENTS.has(head)) return obj;
  if (!Object.hasOwn(obj, head)) return obj;
  const next = { ...obj };
  if (rest.length === 0) {
    delete next[head];
  } else {
    const child = next[head];
    if (child && typeof child === "object" && !Array.isArray(child)) {
      const pruned = deletePath(child as Record<string, unknown>, rest);
      if (pruned === undefined) {
        delete next[head];
      } else {
        next[head] = pruned;
      }
    } else {
      // Path goes through a non-object — nothing to prune, leave as-is
      return obj;
    }
  }
  return Object.keys(next).length === 0 ? undefined : next;
}

function AllState({
  store,
  currentStageIndex,
  playerCount,
}: {
  store: ViewerStateStore;
  currentStageIndex: number;
  playerCount: number;
}) {
  const allEntries = store.getAll();

  if (allEntries.length === 0) {
    return <p style={emptyStyle}>No state values stored yet.</p>;
  }

  return (
    <div style={allStateStyle}>
      {allEntries.map(({ positionKey, storeKey, entry }) => {
        const isFuture = entry.setOnStageIndex > currentStageIndex;
        const posLabel =
          positionKey === "shared"
            ? "shared"
            : `pos ${positionKey}${positionKey < playerCount ? "" : " (out of range)"}`;

        return (
          <div
            key={`${String(positionKey)}-${storeKey}`}
            style={{
              ...allStateItemStyle,
              opacity: isFuture ? 0.4 : 1,
            }}
          >
            <div style={allStateKeyStyle}>
              <span>{storeKey}</span>
              <span style={allStateBadgeStyle}>{posLabel}</span>
            </div>
            <div style={allStateValueStyle}>
              {typeof entry.value === "object"
                ? JSON.stringify(entry.value)
                : String(entry.value)}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// --- Styles ---

const containerStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "0.25rem",
};

const sectionHeaderStyle: React.CSSProperties = {
  fontSize: "0.6875rem",
  fontWeight: 600,
  color: "#6b7280",
  textTransform: "uppercase" as const,
  letterSpacing: "0.05em",
  marginBottom: "0.25rem",
};

const controlGroupStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "0.5rem",
  fontSize: "0.8125rem",
};

const controlLabelStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "0.375rem",
  color: "#374151",
  fontSize: "0.8125rem",
  cursor: "pointer",
};

const checkboxStyle: React.CSSProperties = {
  cursor: "pointer",
};

const refGroupStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "0.125rem",
  marginBottom: "0.375rem",
};

const refLabelStyle: React.CSSProperties = {
  fontSize: "0.75rem",
  color: "#6b7280",
  fontFamily: "monospace",
};

const refInputRowStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "stretch",
  gap: "0.25rem",
};

const refInputStyle: React.CSSProperties = {
  flex: 1,
  minWidth: 0,
  padding: "0.25rem 0.375rem",
  border: "1px solid #d1d5db",
  borderRadius: "0.25rem",
  fontSize: "0.8125rem",
};

const refTextareaStyle: React.CSSProperties = {
  ...refInputStyle,
  fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
  fontSize: "0.75rem",
  lineHeight: 1.4,
  resize: "vertical",
  background: "#f9fafb",
  color: "#374151",
};

const refClearButtonBaseStyle: React.CSSProperties = {
  padding: "0 0.375rem",
  border: "none",
  background: "transparent",
  fontSize: "0.875rem",
  lineHeight: 1,
};

const refClearButtonStyle: React.CSSProperties = {
  ...refClearButtonBaseStyle,
  color: "#9ca3af",
  cursor: "pointer",
};

const refClearButtonDisabledStyle: React.CSSProperties = {
  ...refClearButtonBaseStyle,
  color: "transparent",
  cursor: "default",
};

const emptyStyle: React.CSSProperties = {
  fontSize: "0.75rem",
  color: "#9ca3af",
  marginTop: "0.5rem",
};

const allStateActionsStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: "0.5rem",
  marginTop: "1rem",
};

const expandButtonStyle: React.CSSProperties = {
  background: "none",
  border: "none",
  color: "#6b7280",
  fontSize: "0.75rem",
  cursor: "pointer",
  textAlign: "left" as const,
  padding: "0.25rem 0",
};

const clearAllButtonStyle: React.CSSProperties = {
  background: "none",
  border: "1px solid #e5e7eb",
  borderRadius: "0.25rem",
  color: "#b91c1c",
  fontSize: "0.75rem",
  cursor: "pointer",
  padding: "0.25rem 0.5rem",
};

const clearAllConfirmGroupStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "0.25rem",
};

const clearAllConfirmButtonStyle: React.CSSProperties = {
  background: "#b91c1c",
  border: "1px solid #b91c1c",
  borderRadius: "0.25rem",
  color: "white",
  fontSize: "0.75rem",
  cursor: "pointer",
  padding: "0.25rem 0.5rem",
};

const clearAllCancelButtonStyle: React.CSSProperties = {
  background: "white",
  border: "1px solid #e5e7eb",
  borderRadius: "0.25rem",
  color: "#6b7280",
  fontSize: "0.75rem",
  cursor: "pointer",
  padding: "0.25rem 0.5rem",
};

const allStateStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "0.375rem",
  marginTop: "0.25rem",
};

const allStateItemStyle: React.CSSProperties = {
  padding: "0.375rem 0.5rem",
  backgroundColor: "white",
  borderRadius: "0.25rem",
  border: "1px solid #e5e7eb",
  fontSize: "0.75rem",
};

const allStateKeyStyle: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  fontFamily: "monospace",
  color: "#374151",
};

const allStateBadgeStyle: React.CSSProperties = {
  fontSize: "0.625rem",
  color: "#9ca3af",
  backgroundColor: "#f3f4f6",
  padding: "0.0625rem 0.375rem",
  borderRadius: "0.25rem",
};

const allStateValueStyle: React.CSSProperties = {
  color: "#6b7280",
  marginTop: "0.125rem",
  wordBreak: "break-all" as const,
};

const notesStackStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "0.5rem",
  marginTop: "0.25rem",
};

const noteItemStyle: React.CSSProperties = {
  padding: "0.5rem 0.625rem",
  backgroundColor: "#fffbeb",
  border: "1px solid #fde68a",
  borderRadius: "0.375rem",
  fontSize: "0.75rem",
  color: "#374151",
  scrollMarginTop: "1rem",
  transition: "background-color 300ms ease-out",
};

const noteLabelStyle: React.CSSProperties = {
  fontSize: "0.6875rem",
  fontWeight: 600,
  color: "#92400e",
  marginBottom: "0.25rem",
};

const noteTypeStyle: React.CSSProperties = {
  fontWeight: 400,
  color: "#b45309",
  fontFamily: "monospace",
};

const noteBodyStyle: React.CSSProperties = {
  color: "#374151",
  lineHeight: 1.45,
};
