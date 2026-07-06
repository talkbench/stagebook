export type PositionKey = number | "shared";

export interface StoreEntry {
  value: unknown;
  setOnStageIndex: number;
}

export interface StoreRecord {
  positionKey: PositionKey;
  storeKey: string;
  entry: StoreEntry;
}

type Listener = () => void;

export class ViewerStateStore {
  private data = new Map<PositionKey, Map<string, StoreEntry>>();
  private submitted = new Map<number, boolean>();
  private elapsed = new Map<number, number>();
  private listeners = new Set<Listener>();
  private version = 0;

  /** Write a value via the save() contract (position-scoped or shared). */
  save(
    key: string,
    value: unknown,
    scope: "player" | "shared",
    position: number,
    stageIndex: number,
  ): void {
    const posKey: PositionKey = scope === "shared" ? "shared" : position;
    this.set(posKey, key, value, stageIndex);
  }

  /** Direct write — used by the state inspector to inject values. */
  set(
    positionKey: PositionKey,
    storeKey: string,
    value: unknown,
    stageIndex: number,
  ): void {
    let bucket = this.data.get(positionKey);
    if (!bucket) {
      bucket = new Map();
      this.data.set(positionKey, bucket);
    }
    bucket.set(storeKey, { value, setOnStageIndex: stageIndex });
    this.notify();
  }

  /** Read a single entry by position and key. */
  get(positionKey: PositionKey, storeKey: string): StoreEntry | undefined {
    return this.data.get(positionKey)?.get(storeKey);
  }

  /**
   * Remove a single entry. Prunes the position bucket if it becomes empty
   * so getAll() doesn't surface ghost positions. After deletion, lookup()
   * returns [] for the key — matching the "never set" case, so condition
   * checks like `exists` correctly fail.
   */
  delete(positionKey: PositionKey, storeKey: string): void {
    const bucket = this.data.get(positionKey);
    if (!bucket) return;
    if (!bucket.delete(storeKey)) return;
    if (bucket.size === 0) {
      this.data.delete(positionKey);
    }
    this.notify();
  }

  /** Wipe all stored values, submitted flags, and elapsed time. */
  clearAll(): void {
    this.data.clear();
    this.submitted.clear();
    this.elapsed.clear();
    this.notify();
  }

  /** Return all entries across all positions. */
  getAll(): StoreRecord[] {
    const records: StoreRecord[] = [];
    for (const [positionKey, bucket] of this.data) {
      for (const [storeKey, entry] of bucket) {
        records.push({ positionKey, storeKey, entry });
      }
    }
    return records;
  }

  /**
   * Look up raw stored values by storage key.
   * If position is a number, returns that position's value.
   * If position is "shared", returns the shared value.
   * If position is undefined, returns values from all player positions.
   */
  lookup(key: string, position?: number | "shared"): unknown[] {
    if (position === "shared") {
      return this.lookupOne("shared", key);
    }

    if (position !== undefined) {
      return this.lookupOne(position, key);
    }

    // No position specified — collect from all player positions
    const values: unknown[] = [];
    for (const [posKey, bucket] of this.data) {
      if (posKey === "shared") continue;
      const entry = bucket.get(key);
      if (entry !== undefined) {
        values.push(entry.value);
      }
    }
    return values;
  }

  private lookupOne(posKey: PositionKey, key: string): unknown[] {
    const entry = this.data.get(posKey)?.get(key);
    return entry !== undefined ? [entry.value] : [];
  }

  // --- Submitted ---

  getSubmitted(stageIndex: number): boolean {
    return this.submitted.get(stageIndex) ?? false;
  }

  setSubmitted(stageIndex: number, value: boolean): void {
    this.submitted.set(stageIndex, value);
    this.notify();
  }

  // --- Elapsed time ---

  getElapsedTime(stageIndex: number): number {
    return this.elapsed.get(stageIndex) ?? 0;
  }

  setElapsedTime(stageIndex: number, seconds: number): void {
    this.elapsed.set(stageIndex, seconds);
    this.notify();
  }

  // --- Change notification ---

  /** Monotonic version counter — stable snapshot for useSyncExternalStore. */
  getVersion(): number {
    return this.version;
  }

  onChange(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(): void {
    this.version++;
    for (const listener of this.listeners) {
      listener();
    }
  }
}

/**
 * Factory for a fresh {@link ViewerStateStore}. The function-style entry
 * point for hosts assembling a custom viewer harness; the class stays
 * exported so callers can type the store instance they pass around.
 */
export function createViewerStateStore(): ViewerStateStore {
  return new ViewerStateStore();
}
