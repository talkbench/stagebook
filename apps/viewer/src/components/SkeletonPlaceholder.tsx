import React from "react";
import type { DiscussionType } from "stagebook";

interface SkeletonPlaceholderProps {
  type: string;
  config?: Record<string, unknown>;
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

export function SkeletonPlaceholder({
  type,
  config,
}: SkeletonPlaceholderProps) {
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
    renderSharedNotepad: (config: { padName: string }) => (
      <SkeletonPlaceholder
        type="sharedNotepad"
        config={{ padName: config.padName }}
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
  color: "#3b82f6",
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
