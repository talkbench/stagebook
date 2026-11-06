import { useId, useMemo, type ReactNode } from "react";
import type { TreatmentFileType } from "../../schemas/index.js";
import { expandTreatmentFile } from "../lib/expandTreatmentFile.js";
import {
  describeTaskParameterKey,
  parseTaskParameters,
  resolveTaskParameterEntry,
  type TaskParameterEntry,
} from "../lib/taskParameters.js";

/**
 * A loaded task parameter file: a display name (a path or file name) and its
 * text, or why it couldn't be read. Should be referentially stable — a new
 * object re-parses the file.
 */
export type TaskParameterSource =
  | { name: string; text: string }
  | { name: string; readError: string };

/** PreviewHost's `taskParameters` prop (#815). */
export interface TaskParametersControl {
  /**
   * The loaded file, or null when none is loaded. Re-read it from disk on
   * refresh so edits to the file show up.
   */
  source: TaskParameterSource | null;
  /**
   * The chosen entry's key (`id:<callerTaskId>` or `entry:<n>`), or null
   * before one is chosen. Keep it across refreshes of the same file; reset it
   * when a different file is loaded.
   */
  selectedKey: string | null;
  onSelect: (key: string) => void;
  /** Open the host's file picker. */
  onLoad: () => void;
  /** Unload the file and return to manual field entry. */
  onClear: () => void;
}

/**
 * Renders the parameter bar for where it goes: `"viewer"` inside the Viewer
 * (whose header has its own refresh), `"page"` above anything else.
 */
export type ToolbarRender = (placement: "viewer" | "page") => ReactNode;

/** What TaskParameterPreview asks PreviewHost to render. */
export type ParameterPreviewSpec =
  | { task: false; toolbar?: ToolbarRender }
  | {
      task: true;
      treatmentFile: TreatmentFileType;
      additionalFields: Record<string, unknown>;
      toolbar: ToolbarRender;
    };

interface TaskParameterPreviewProps {
  control: TaskParametersControl;
  treatmentFile: TreatmentFileType;
  additionalFields?: Record<string, unknown>;
  /** The host's refresh, offered on screens without the Viewer header. */
  onRefresh?: () => void;
  /**
   * Render the preview. `key` changes whenever the previewed task does, so
   * the preview remounts: responses, media state, and manual overrides never
   * carry from one task to another.
   */
  renderPreview: (key: string, spec: ParameterPreviewSpec) => ReactNode;
}

/**
 * PreviewHost's parameter mode: shows the parameter bar, lets the researcher
 * choose a task entry, and previews the workflow narrowed to that entry's
 * treatment with its fields bound — or says why it can't.
 */
export function TaskParameterPreview({
  control,
  treatmentFile,
  additionalFields,
  onRefresh,
  renderPreview,
}: TaskParameterPreviewProps) {
  const { source, selectedKey } = control;
  const parsed = useMemo(
    () =>
      source !== null && "text" in source
        ? parseTaskParameters(source.text)
        : null,
    [source],
  );
  const entries = parsed?.ok ? parsed.entries : [];
  const entry = entries.find((e) => e.key === selectedKey);
  const resolution = useMemo(
    () =>
      entry === undefined
        ? null
        : resolveTaskParameterEntry(treatmentFile, entry, additionalFields),
    [treatmentFile, entry, additionalFields],
  );
  const hasFields = useMemo(() => {
    try {
      return expandTreatmentFile(treatmentFile).unresolvedFields.length > 0;
    } catch {
      // A file that won't expand has its own error path in PreviewHost.
      return false;
    }
  }, [treatmentFile]);

  if (source === null) {
    return renderPreview("manual", {
      task: false,
      toolbar: hasFields
        ? (placement) => (
            <TaskParameterBar
              control={control}
              onRefresh={placement === "page" ? onRefresh : undefined}
            />
          )
        : undefined,
    });
  }

  const toolbar: ToolbarRender = (placement) => (
    <TaskParameterBar
      control={control}
      source={source}
      entries={entries}
      warnings={resolution?.ok ? resolution.warnings : []}
      onRefresh={placement === "page" ? onRefresh : undefined}
    />
  );

  if ("readError" in source) {
    return (
      <Problem
        toolbar={toolbar("page")}
        title={`Couldn't read ${source.name}`}
        messages={[source.readError]}
      />
    );
  }
  if (parsed !== null && !parsed.ok) {
    return (
      <Problem
        toolbar={toolbar("page")}
        title={`${source.name} isn't a valid task parameter file`}
        messages={[parsed.error]}
      />
    );
  }
  if (selectedKey === null) {
    return (
      <>
        {toolbar("page")}
        <TaskList
          title="Choose a task to preview"
          entries={entries}
          onSelect={control.onSelect}
        />
      </>
    );
  }
  if (entry === undefined || resolution === null) {
    // Never substitute another entry: the researcher picked this one.
    return (
      <>
        <Problem
          toolbar={toolbar("page")}
          title={`The selected task "${describeTaskParameterKey(selectedKey)}" is no longer in ${source.name}.`}
          messages={[]}
        />
        <TaskList
          title="Choose another task"
          entries={entries}
          onSelect={control.onSelect}
        />
      </>
    );
  }
  if (!resolution.ok) {
    return (
      <Problem
        toolbar={toolbar("page")}
        title={`Task "${entry.label}" can't be previewed`}
        messages={resolution.errors}
      />
    );
  }

  return renderPreview(
    // A refresh that leaves the task as it was keeps the preview's state, as
    // a workflow refresh does. A task re-pointed at another treatment or given
    // new field values is a new case, so the preview starts over: answers
    // from the old values don't linger, a manual override can't outlive the
    // value it replaced, and a position key that now names another entry
    // doesn't inherit the old one's state.
    `task:${source.name}:${entry.key}:${entry.treatment}:${JSON.stringify(entry.fields)}`,
    {
      task: true,
      treatmentFile: resolution.treatmentFile,
      additionalFields: resolution.fields,
      toolbar,
    },
  );
}

function TaskParameterBar({
  control,
  source,
  entries = [],
  warnings = [],
  onRefresh,
}: {
  control: TaskParametersControl;
  source?: TaskParameterSource;
  entries?: TaskParameterEntry[];
  warnings?: string[];
  onRefresh?: () => void;
}) {
  const selectId = useId();
  const selected = entries.some((e) => e.key === control.selectedKey);
  return (
    <div
      data-testid="task-parameter-bar"
      role="region"
      aria-label="Task parameters"
      style={barStyle}
    >
      <div style={barRowStyle}>
        <strong>Task parameters</strong>
        {source === undefined ? (
          <span style={mutedStyle}>
            None loaded — template fields are entered by hand.
          </span>
        ) : (
          <code title={source.name} style={fileChipStyle}>
            {source.name}
          </code>
        )}
        {entries.length > 0 && (
          <>
            <label htmlFor={selectId} style={mutedStyle}>
              Task
            </label>
            <select
              id={selectId}
              value={selected ? (control.selectedKey ?? "") : ""}
              onChange={(e) => control.onSelect(e.target.value)}
              style={selectStyle}
            >
              {!selected && (
                <option value="" disabled>
                  Choose a task…
                </option>
              )}
              {entries.map((e) => (
                <option key={e.key} value={e.key}>
                  {entryOptionText(e)}
                </option>
              ))}
            </select>
          </>
        )}
        <span style={spacerStyle} />
        {onRefresh && (
          <button
            type="button"
            title="Re-read the workflow, its prompts, and the task file"
            onClick={onRefresh}
            style={buttonStyle}
          >
            Refresh
          </button>
        )}
        <button type="button" onClick={control.onLoad} style={buttonStyle}>
          Load parameters…
        </button>
        {source !== undefined && (
          <button type="button" onClick={control.onClear} style={buttonStyle}>
            Clear
          </button>
        )}
      </div>
      {warnings.length > 0 && (
        <ul style={warningListStyle}>
          {warnings.map((warning) => (
            <li key={warning}>{warning}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

function entryOptionText(entry: TaskParameterEntry): string {
  const treatment = entry.treatment ?? "no treatment";
  const invalid = entry.problems.length > 0 ? " (invalid)" : "";
  return `${entry.label} — ${treatment}${invalid}`;
}

function Problem({
  toolbar,
  title,
  messages,
}: {
  toolbar: ReactNode;
  title: string;
  messages: string[];
}) {
  return (
    <>
      {toolbar}
      <div style={panelStyle}>
        <div
          data-testid="task-parameter-problem"
          role="alert"
          style={problemStyle}
        >
          <strong>{title}</strong>
          {messages.length > 0 && (
            <ul style={problemListStyle}>
              {messages.map((message) => (
                <li key={message}>{message}</li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </>
  );
}

function TaskList({
  title,
  entries,
  onSelect,
}: {
  title: string;
  entries: TaskParameterEntry[];
  onSelect: (key: string) => void;
}) {
  return (
    <div style={panelStyle}>
      <h2 style={listTitleStyle}>{title}</h2>
      <div style={listStyle}>
        {entries.map((entry) => (
          <button
            key={entry.key}
            type="button"
            onClick={() => onSelect(entry.key)}
            style={optionStyle}
          >
            <span style={optionNameStyle}>{entry.label}</span>
            <span style={optionDetailStyle}>
              {entry.problems.length > 0
                ? "invalid entry"
                : (entry.treatment ?? "")}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

// Preview chrome, matching the Viewer header's light palette.
const barStyle: React.CSSProperties = {
  padding: "0.5rem 1rem",
  borderBottom: "1px solid #e5e7eb",
  backgroundColor: "#f9fafb",
  color: "#374151",
  fontFamily: "system-ui, sans-serif",
  fontSize: "0.8125rem",
};

const barRowStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  flexWrap: "wrap",
  gap: "0.5rem",
};

const mutedStyle: React.CSSProperties = {
  color: "#6b7280",
};

const fileChipStyle: React.CSSProperties = {
  fontFamily: "monospace",
  backgroundColor: "rgba(0, 0, 0, 0.06)",
  // Inherit rather than VS Code's amber `code` default.
  color: "inherit",
  padding: "0.125rem 0.25rem",
  borderRadius: "0.25rem",
  maxWidth: "24rem",
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};

const selectStyle: React.CSSProperties = {
  padding: "0.25rem 0.5rem",
  borderRadius: "0.25rem",
  border: "1px solid #d1d5db",
  fontSize: "0.8125rem",
  color: "#1f2937",
  maxWidth: "20rem",
};

const spacerStyle: React.CSSProperties = {
  flex: 1,
};

const buttonStyle: React.CSSProperties = {
  padding: "0.25rem 0.625rem",
  borderRadius: "0.25rem",
  border: "1px solid #d1d5db",
  backgroundColor: "white",
  color: "#1f2937",
  cursor: "pointer",
  fontSize: "0.8125rem",
};

const warningListStyle: React.CSSProperties = {
  margin: "0.375rem 0 0",
  paddingLeft: "1.25rem",
  color: "#92400e",
};

const panelStyle: React.CSSProperties = {
  maxWidth: "40rem",
  margin: "2rem auto",
  padding: "0 1.5rem",
  fontFamily: "system-ui, sans-serif",
};

const problemStyle: React.CSSProperties = {
  padding: "0.75rem 1rem",
  borderRadius: "0.375rem",
  border: "1px solid #fecaca",
  backgroundColor: "#fef2f2",
  color: "#991b1b",
  fontSize: "0.875rem",
};

const problemListStyle: React.CSSProperties = {
  margin: "0.5rem 0 0",
  paddingLeft: "1.25rem",
};

const listTitleStyle: React.CSSProperties = {
  fontSize: "1rem",
  fontWeight: 600,
  color: "#1f2937",
  margin: "0 0 0.75rem",
};

const listStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "0.5rem",
};

const optionStyle: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  gap: "1rem",
  padding: "0.75rem 1rem",
  borderRadius: "0.375rem",
  border: "1px solid #e5e7eb",
  backgroundColor: "white",
  cursor: "pointer",
  textAlign: "left",
};

const optionNameStyle: React.CSSProperties = {
  fontWeight: 500,
  color: "#1f2937",
  fontSize: "0.875rem",
};

const optionDetailStyle: React.CSSProperties = {
  color: "#6b7280",
  fontSize: "0.75rem",
};
