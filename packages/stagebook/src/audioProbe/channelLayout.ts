/** Host-supplied identity of one source channel in a group recording. */
export interface ChannelMappingEntry {
  readonly index: number;
  /** Only participant channels are supported; legacy mix roles are refused. */
  readonly role: string;
  readonly position: number;
  readonly label?: string;
}

export interface ChannelLayoutDiagnostic {
  readonly code:
    | "mapping"
    | "count"
    | "index"
    | "role"
    | "position"
    | "label"
    | "probe"
    | "capture";
  readonly message: string;
}

/** A displayed row, after undoing decoder reordering and sorting positions. */
export interface ParticipantAudioTrack {
  readonly position: number;
  readonly label?: string;
  readonly decodedChannel: number;
}

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function nonnegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}
function permutation(value: unknown, count: number): value is number[] {
  return (
    Array.isArray(value) &&
    value.length === count &&
    Array.from(value).every((n) => nonnegativeInteger(n) && n < count) &&
    new Set(value).size === count
  );
}

/**
 * Pure host/task validation, also used by MediaPlayer. Omit `probe` on the
 * server to check only the sidecar. Include it (even undefined) to require
 * usable session calibration for a multichannel recording. No DOM or assets.
 */
export function checkChannelLayout(options: {
  mapping: unknown;
  probe?: unknown;
}): ChannelLayoutDiagnostic[] {
  const { mapping, probe } = options;
  if (!Array.isArray(mapping))
    return [
      {
        code: "mapping",
        message: "A group recording requires an audio channel mapping.",
      },
    ];
  const errors: ChannelLayoutDiagnostic[] = [];
  const add = (code: ChannelLayoutDiagnostic["code"], message: string) =>
    errors.push({ code, message });
  const count = mapping.length;
  if (count < 1 || count > 8)
    add("count", "A group recording must contain 1 to 8 participant channels.");
  if (
    !permutation(
      mapping.map((entry: unknown) =>
        object(entry) ? entry.index : undefined,
      ),
      count,
    )
  ) {
    add(
      "index",
      "Channel indices must be exactly 0 through C−1, without duplicates.",
    );
  }
  const positions = new Set<number>();
  for (const entry of mapping as unknown[]) {
    if (!object(entry)) {
      add("mapping", "Every channel mapping entry must be an object.");
      continue;
    }
    if (entry.role !== "participant") {
      add(
        "role",
        entry.role === "mix_left" || entry.role === "mix_right"
          ? "Old N+2 layout: re-compose this recording."
          : "Every channel role must be participant.",
      );
    }
    if (!nonnegativeInteger(entry.position) || positions.has(entry.position)) {
      add(
        "position",
        "Participant positions must be unique non-negative integers.",
      );
    } else positions.add(entry.position);
    if (
      entry.label !== undefined &&
      (typeof entry.label !== "string" || !entry.label.trim())
    ) {
      add("label", "A supplied channel label must be a non-empty string.");
    }
  }
  if (count >= 2 && "probe" in options) {
    if (
      !object(probe) ||
      probe.verdict !== "pass" ||
      !object(probe.mappings) ||
      !permutation(probe.mappings[count], count)
    ) {
      add(
        "probe",
        `This recording requires a passing session probe with a valid ${count}-channel permutation.`,
      );
    }
  }
  return errors;
}

/** Carries structured diagnostics through the host's onElementError hook. */
export class ChannelLayoutError extends Error {
  constructor(readonly diagnostics: readonly ChannelLayoutDiagnostic[]) {
    super(diagnostics.map((d) => d.message).join("\n"));
    this.name = "ChannelLayoutError";
  }
}

/** Internal player boundary; never infer participant identity from row order. */
export function resolveChannelLayout(
  mapping: unknown,
  probe?: unknown,
): ParticipantAudioTrack[] {
  const diagnostics = checkChannelLayout({ mapping, probe });
  if (diagnostics.length) throw new ChannelLayoutError(diagnostics);
  const entries = mapping as ChannelMappingEntry[];
  const decodedToSource =
    entries.length === 1
      ? [0]
      : (probe as { mappings: Record<number, number[]> }).mappings[
          entries.length
        ];
  return [...entries]
    .sort((a, b) => a.position - b.position)
    .map((entry) => ({
      position: entry.position,
      ...(entry.label !== undefined && { label: entry.label }),
      decodedChannel: decodedToSource.indexOf(entry.index),
    }));
}
