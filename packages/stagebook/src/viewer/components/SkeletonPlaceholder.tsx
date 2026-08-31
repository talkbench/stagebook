import React from "react";
import type { DiscussionType } from "../../schemas/index.js";
import { TEXTAREA_METRICS } from "../../components/form/TextArea.js";

interface SkeletonPlaceholderProps {
  type: string;
  config?: Record<string, unknown>;
}

interface SharedNotepadConfig {
  padName: string;
  defaultText?: string;
  rows?: number;
}

const chatTypeIcons: Record<string, string> = {
  video: "\uD83D\uDCF9", // 📹
  audio: "\uD83C\uDFA7", // 🎧
  text: "\uD83D\uDCAC", // 💬
};

const chatTypeLabels: Record<string, string> = {
  video: "Video Call",
  audio: "Audio Call",
  text: "Text Chat",
};

/**
 * Build a human-readable summary of discussion configuration options,
 * filtered to only those relevant to the chatType.
 */
function describeDiscussionConfig(config: DiscussionType): string[] {
  const lines: string[] = [];

  lines.push(`Nicknames: ${config.showNickname ? "shown" : "hidden"}`);

  if (config.chatType === "video") {
    lines.push(`Self-view: ${config.showSelfView ? "shown" : "hidden"}`);
  }

  lines.push(
    `Report missing: ${config.showReportMissing ? "available" : "unavailable"}`,
  );

  if (config.chatType === "audio" || config.chatType === "video") {
    lines.push(
      `Audio mute: ${config.showAudioMute ? "available" : "unavailable"}`,
    );
  }

  if (config.chatType === "video") {
    lines.push(
      `Video mute: ${config.showVideoMute ? "available" : "unavailable"}`,
    );
  }

  if (config.chatType === "text") {
    if (
      config.reactionEmojisAvailable &&
      config.reactionEmojisAvailable.length > 0
    ) {
      lines.push(`Reactions: ${config.reactionEmojisAvailable.join(" ")}`);
    }
    if (config.numReactionsPerMessage !== undefined) {
      lines.push(`Reactions per message: ${config.numReactionsPerMessage}`);
    }
    if (config.reactToSelf !== undefined) {
      lines.push(`React to own messages: ${config.reactToSelf ? "yes" : "no"}`);
    }
  }

  if (config.chatType === "video" && config.rooms) {
    lines.push(`Rooms: ${config.rooms.length} configured`);
  }

  if (config.chatType === "video" && config.layout) {
    lines.push("Layout: custom layout configured");
  }

  if (config.showToPositions) {
    lines.push(`Shown to positions: ${config.showToPositions.join(", ")}`);
  }

  if (config.hideFromPositions) {
    lines.push(`Hidden from positions: ${config.hideFromPositions.join(", ")}`);
  }

  return lines;
}

/**
 * REFERENCE_HOST_GEOMETRY
 *
 * The shared notepad is rendered by the host, and the only shipped
 * implementation is the runner's `CoeditField`
 * (`client/src/components/coedit/CoeditField.jsx`), which mounts a CodeMirror 6
 * editor — NOT a `<textarea>`. Its box is sized:
 *
 *     calc((rows + 1) * 1.5em + 0.5rem * 2)     // at font-size 0.875rem
 *
 * which is materially taller than a solo `<textarea rows={rows}>`: 60px vs
 * 38px at `rows: 1`, 165px vs 138px at `rows: 6`. Previewing the textarea
 * geometry would understate every shared notepad, worst proportionally at the
 * small `rows` values where a researcher is most likely to be checking fit.
 *
 * These constants are therefore a deliberate coupling to one host's layout,
 * isolated here so the drift risk is explicit and revisable in a single place.
 * Two things follow from that:
 *
 *   - If the runner retunes `fieldMinHeight`, this block goes stale silently.
 *     There is no cross-repo guard; it is a copy.
 *   - A host that implements `renderSharedNotepad` with something other than
 *     coedit will render a different size, and this preview will be wrong for
 *     them. That is an accepted trade: it is better to be right for the only
 *     real implementation than host-neutral and wrong for everybody.
 */
const REFERENCE_HOST_GEOMETRY = {
  /** CodeMirror line box, in em against the editor's own font-size. */
  lineEm: 1.5,
  /**
   * The runner reserves one line beyond `rows`; its own comment notes this
   * keeps `rows` buying the same number of writable lines once .cm-content's
   * border-box padding is counted.
   */
  extraRows: 1,
  /** `FIELD_PAD_Y` in CoeditField — vertical padding, applied twice. */
  paddingBlockRem: 0.5,
  /** The 1px border on the box wrapping the editor, counted on both edges. */
  borderWidthPx: 1,
  /**
   * The runner's own falsy branch: `rows ? ... : "8em"`. Reached when a host
   * calls this slot without a usable `rows` — `Prompt` always resolves one
   * (`metadata.rows ?? 5`), so this is unreachable in-product, but mirroring
   * it keeps the preview correct for a host driving the public
   * `createSkeletonRenderers()` export directly.
   */
  fallbackLinesEm: 8,
} as const;

/**
 * Height of the host's rendered notepad for a given `rows`. `em` (not `rem`)
 * matches the runner, and resolves against the box's own font-size, which is
 * pinned to TEXTAREA_METRICS below exactly as the runner pins its theme.
 */
export function sharedNotepadBoxHeight(rows?: number): string {
  const { lineEm, extraRows, paddingBlockRem, borderWidthPx, fallbackLinesEm } =
    REFERENCE_HOST_GEOMETRY;
  // `rows` arrives through a `Record<string, unknown>` cast at the public
  // SkeletonPlaceholder boundary, so it is only *typed* as a number. Guard the
  // arithmetic: `+` binds before `*`, so a string would concatenate rather
  // than add ("5" + 1 => "51", then * 1.5 => a ~1070px box) instead of
  // failing loudly.
  const usable = typeof rows === "number" && Number.isFinite(rows) && rows > 0;
  const lines = usable ? (rows + extraRows) * lineEm : fallbackLinesEm;
  return `calc(${lines}em + ${2 * paddingBlockRem}rem + ${2 * borderWidthPx}px)`;
}

/**
 * The long-form explanation of what a shared notepad is, copied verbatim from
 * the runner's `COEDIT_SHARED_DESCRIPTION` so the preview and the live study
 * say the same sentence. Like the runner, we do NOT render it as a visible
 * per-field caption — runner#421 removed exactly that, because it repeated
 * above every box on a multi-notepad stage. It survives as the chip's tooltip.
 */
const SHARED_NOTEPAD_DESCRIPTION =
  "This notepad is shared between you and the other members of your group.";

/**
 * The runner's placeholder fallback when a prompt file authors no `> ` line
 * (`placeholder(defaultText || "Start typing…")` in CoeditField). Previewing an
 * empty box where the participant will actually see this hint would misreport
 * the stage.
 */
const SHARED_NOTEPAD_FALLBACK_HINT = "Start typing…";

/**
 * The "Shared" pill, matching the runner's `SharedChip` — same position (below
 * the box, trailing edge aligned), same muted tokens, same icon + word.
 *
 * Position is load-bearing and was iterated twice upstream: it first shipped
 * inside the box's top-right corner (runner#421), which cost the field its
 * entire first line, and runner#572 moved it below the box. Previewing it in
 * the abandoned position would misrepresent the layout, so we follow.
 *
 * Unlike the runner we do NOT put `aria-hidden` on the chip. The runner can
 * hide it because it re-exposes the same sentence on its editor via
 * `aria-describedby` + a visually-hidden span; this stand-in has no editor to
 * describe, so hiding the chip would drop "shared" from the accessibility tree
 * entirely (and `aria-hidden` removes the `title` with it). Only the decorative
 * icon is hidden.
 */
function SharedChip() {
  return (
    <span
      data-testid="notepad-shared-chip"
      title={SHARED_NOTEPAD_DESCRIPTION}
      style={notepadChipStyle}
    >
      <svg
        width="12"
        height="12"
        viewBox="0 0 20 20"
        fill="currentColor"
        focusable="false"
        aria-hidden="true"
      >
        <path d="M7 8a3 3 0 100-6 3 3 0 000 6zM14.5 9a2.5 2.5 0 100-5 2.5 2.5 0 000 5zM1.615 16.428a1.224 1.224 0 01-.569-1.175 6.002 6.002 0 0111.908 0c.058.467-.172.92-.57 1.174A9.953 9.953 0 017 18a9.953 9.953 0 01-5.385-1.572zM14.5 16h-.106c.07-.297.088-.611.048-.933a7.47 7.47 0 00-1.588-3.755 4.502 4.502 0 015.874 2.636.818.818 0 01-.36.98A7.465 7.465 0 0114.5 16z" />
      </svg>
      Shared
    </span>
  );
}

/**
 * Stand-in for a host-rendered collaborative notepad (#591).
 *
 * The host owns the real editor, but the treatment already tells us two
 * things the host will honor — the field's `rows` and the author's
 * placeholder text — so the preview can show a box of approximately the
 * right height with the right hint text in it, rather than a generic grey
 * card that tells a researcher nothing about their layout.
 *
 * Everything that identifies the field is copied from the runner's real
 * `CoeditField` (the only host implementing this slot) — the chip's position,
 * styling, icon, tooltip sentence, and the empty-placeholder fallback — so the
 * preview reads like the thing being previewed rather than like a viewer
 * invention. The two deliberate differences are the dashed border and the
 * "host renders the live editor" note, which mark it as a stand-in.
 *
 * That note shares the chip's row rather than taking one of its own, so the
 * disclosure costs the same vertical space at `rows: 1` as at `rows: 20` and
 * never eats into the box we are trying to show at its true height.
 */
function SharedNotepadPlaceholder({
  padName,
  defaultText,
  rows,
}: SharedNotepadConfig) {
  return (
    <div data-testid="notepad-placeholder-root" data-pad-name={padName}>
      <div
        data-testid="notepad-box"
        style={{ ...notepadBoxStyle, height: sharedNotepadBoxHeight(rows) }}
      >
        {/* Rendered in placeholder grey, never as body text: `defaultText` is
            placeholder-ONLY (#581, runner#311) — a hint that disappears once
            anyone types, never seeded into the shared document nor part of the
            saved value. Styling it as content would preview semantics the
            runner explicitly does not implement. */}
        <span data-testid="notepad-placeholder" style={notepadHintStyle}>
          {defaultText || SHARED_NOTEPAD_FALLBACK_HINT}
        </span>
      </div>
      <div style={notepadChipRowStyle}>
        <span style={notepadStandInNoteStyle}>
          {padName ? `${padName} · ` : ""}preview &mdash; host renders the live
          editor
        </span>
        <SharedChip />
      </div>
    </div>
  );
}

export function SkeletonPlaceholder({
  type,
  config,
}: SkeletonPlaceholderProps) {
  if (type === "sharedNotepad" && config) {
    return (
      <SharedNotepadPlaceholder
        {...(config as unknown as SharedNotepadConfig)}
      />
    );
  }

  // Discussion gets a rich, type-aware placeholder
  if (type === "discussion" && config) {
    const discussion = config as unknown as DiscussionType;
    const icon = chatTypeIcons[discussion.chatType];
    const label = chatTypeLabels[discussion.chatType] ?? "Discussion";
    const configLines = describeDiscussionConfig(discussion);

    return (
      <div style={discussionContainerStyle}>
        <div style={discussionHeaderStyle}>
          {icon && <span style={discussionIconStyle}>{icon}</span>}
          <span style={discussionTitleStyle}>{label}</span>
        </div>
        <p style={discussionSubtitleStyle}>
          Requires live session with multiple participants
        </p>
        {configLines.length > 0 && (
          <ul style={configListStyle}>
            {configLines.map((line) => (
              <li key={line} style={configItemStyle}>
                {line}
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  }

  // Generic placeholder for other platform-coupled elements
  const labels: Record<string, string> = {
    survey: "Survey element — requires external survey platform",
    sharedNotepad:
      "Shared notepad — requires live session with multiple participants",
    qualtrics: "Qualtrics survey — requires external integration",
  };

  const label = labels[type] ?? `${type} — platform-coupled element`;

  return (
    <div style={containerStyle}>
      <div style={iconStyle}>&#9641;</div>
      <p style={labelStyle}>{label}</p>
      {config && Object.keys(config).length > 0 && (
        <details style={detailsStyle}>
          <summary style={summaryStyle}>Configuration</summary>
          <pre style={preStyle}>{JSON.stringify(config, null, 2)}</pre>
        </details>
      )}
    </div>
  );
}

/**
 * Create the platform-coupled renderer functions for the mock context.
 */
export function createSkeletonRenderers() {
  return {
    renderDiscussion: (config: Record<string, unknown>) => (
      <SkeletonPlaceholder type="discussion" config={config} />
    ),
    renderSurvey: (config: {
      surveyName: string;
      onComplete: (results: unknown) => void;
    }) => (
      <SkeletonPlaceholder
        type="survey"
        config={{ surveyName: config.surveyName }}
      />
    ),
    renderSharedNotepad: (config: {
      padName: string;
      defaultText?: string;
      rows?: number;
    }) => (
      <SkeletonPlaceholder
        type="sharedNotepad"
        config={{
          padName: config.padName,
          defaultText: config.defaultText,
          rows: config.rows,
        }}
      />
    ),
  };
}

// --- Discussion placeholder styles ---

const discussionContainerStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  // `flex-start` rather than `center` (#295): the real VideoCall renders
  // video tiles starting from the top of its container, so anchoring the
  // skeleton's informational content to the top matches the live
  // experience better. Centering left the "Video Call" label floating in
  // the middle of a mostly-empty dashed box at full height.
  justifyContent: "flex-start",
  gap: "0.75rem",
  padding: "2rem",
  border: "2px dashed #93c5fd",
  borderRadius: "0.75rem",
  backgroundColor: "#eff6ff",
  minHeight: "16rem",
  height: "100%",
};

const discussionHeaderStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "0.5rem",
};

const discussionIconStyle: React.CSSProperties = {
  fontSize: "1.5rem",
};

const discussionTitleStyle: React.CSSProperties = {
  fontSize: "1rem",
  fontWeight: 600,
  color: "#1e40af",
};

const discussionSubtitleStyle: React.CSSProperties = {
  fontSize: "0.8125rem",
  // Accent token (fallback = blue-600). blue-500 as text also failed AA at
  // this size; blue-600 passes.
  color: "var(--stagebook-primary, #2563eb)",
  margin: 0,
  textAlign: "center",
};

const configListStyle: React.CSSProperties = {
  listStyle: "none",
  padding: 0,
  margin: 0,
  display: "flex",
  flexDirection: "column",
  gap: "0.25rem",
  marginTop: "0.5rem",
};

const configItemStyle: React.CSSProperties = {
  fontSize: "0.75rem",
  color: "#6b7280",
  textAlign: "center",
};

// --- Shared-notepad placeholder styles ---

// One row under the box carrying both the stand-in note (left) and the
// "Shared" chip (right). Sharing a row keeps the disclosure's vertical cost
// constant and identical at every `rows` value.
const notepadChipRowStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: "0.5rem",
  marginTop: "0.25rem",
};

// Viewer-only: the runner has no equivalent, because in the runner this IS
// the live editor. Muted and set beneath the chip in weight so it reads as
// preview chrome rather than as participant-facing copy.
const notepadStandInNoteStyle: React.CSSProperties = {
  fontSize: "0.6875rem",
  color: "var(--stagebook-text-muted, #6b7280)",
};

// Copied from the runner's SharedChip so the pill in the preview matches the
// pill in the study: same muted tokens, same pill radius, same icon+word.
const notepadChipStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: "4px",
  fontSize: "0.75rem",
  fontWeight: 500,
  lineHeight: 1,
  padding: "3px 8px",
  borderRadius: "9999px",
  color: "var(--stagebook-text-muted, #6b7280)",
  background: "var(--stagebook-bg-muted, #f9fafb)",
  border: "1px solid var(--stagebook-border, #d1d5db)",
  whiteSpace: "nowrap",
};

const notepadBoxStyle: React.CSSProperties = {
  boxSizing: "border-box",
  // Typography from stagebook's own TextArea, which is also what the runner
  // pins its CodeMirror theme to — so the author's placeholder wraps here the
  // way it will wrap live. Height comes from sharedNotepadBoxHeight(rows) at
  // the call site, which follows the runner's editor, not the textarea.
  padding: `${TEXTAREA_METRICS.paddingBlockRem}rem ${TEXTAREA_METRICS.paddingInlineRem}rem`,
  fontSize: `${TEXTAREA_METRICS.fontSizeRem}rem`,
  lineHeight: `${TEXTAREA_METRICS.lineHeightRem}rem`,
  borderWidth: `${TEXTAREA_METRICS.borderWidthPx}px`,
  // Dashed rather than solid: the one visual difference from the real
  // field, marking the box itself as a stand-in.
  borderStyle: "dashed",
  borderColor: "#93c5fd",
  borderRadius: "0.375rem",
  backgroundColor: "#eff6ff",
  // Clip rather than grow, mirroring the runner: its editor holds the box at
  // a fixed min-height and scrolls (`.cm-scroller { overflow: auto }`), so an
  // overflowing placeholder is cut off at rest there too. Growing the box
  // would hide an authoring problem the researcher should see.
  //
  // NOTE (#590): #590 is about the NATIVE `<textarea placeholder>` path — a
  // solo openResponse field — where whether a participant can scroll an
  // overflowing placeholder into view is engine-dependent (Chrome and Safari
  // can, Firefox cannot). It does NOT govern this component: the runner
  // renders CodeMirror here, not a textarea, so none of that behavior
  // applies. The reason to revisit on #590 is narrower: if it is resolved by
  // changing how stagebook handles placeholder-vs-`rows` overflow generally
  // (e.g. an authoring-time warning), this preview should adopt whatever
  // visual signal that fix settles on.
  overflow: "hidden",
};

const notepadHintStyle: React.CSSProperties = {
  // Preserve authored line breaks. A prompt file may carry several `> ` lines
  // and Prompt joins them with "\n"; the solo <textarea> renders those as real
  // breaks via the native placeholder attribute, and the runner restores them
  // explicitly (`.cm-placeholder { white-space: pre-wrap }`). Without this the
  // preview collapses them to one wrapped run and under-reports how many lines
  // the placeholder occupies — wrong in exactly the box whose job is showing
  // that.
  whiteSpace: "pre-wrap",
  // gray-600, not the gray-400 a browser uses for placeholders: on this box's
  // blue-50 ground gray-400 measures 2.33:1, well under WCAG AA. The preview
  // deliberately renders the hint a shade darker than participants will see it
  // — the researcher has to be able to read their own placeholder, and the
  // dashed border plus chip row already mark the box as a stand-in.
  color: "#4b5563",
};

// --- Generic placeholder styles ---

const containerStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  justifyContent: "center",
  gap: "0.5rem",
  padding: "2rem",
  border: "2px dashed #d1d5db",
  borderRadius: "0.5rem",
  backgroundColor: "#f9fafb",
  minHeight: "8rem",
};

const iconStyle: React.CSSProperties = {
  fontSize: "1.5rem",
  color: "#9ca3af",
};

const labelStyle: React.CSSProperties = {
  fontSize: "0.8125rem",
  color: "#6b7280",
  textAlign: "center" as const,
  margin: 0,
};

const detailsStyle: React.CSSProperties = {
  width: "100%",
  maxWidth: "24rem",
};

const summaryStyle: React.CSSProperties = {
  fontSize: "0.75rem",
  color: "#9ca3af",
  cursor: "pointer",
};

const preStyle: React.CSSProperties = {
  fontSize: "0.6875rem",
  color: "#6b7280",
  backgroundColor: "white",
  padding: "0.5rem",
  borderRadius: "0.25rem",
  border: "1px solid #e5e7eb",
  overflow: "auto",
  maxHeight: "10rem",
};
