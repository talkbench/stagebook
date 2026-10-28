import type { PostFillIssue } from "../lib/previewResolution.js";

/**
 * Where a post-fill issue sits: its path in the filled tree, plus the
 * `${field}`s that supplied the failing value, so a researcher knows which
 * input to fix.
 */
export function IssueLocation({ issue }: { issue: PostFillIssue }) {
  return (
    <>
      {/* Inherit rather than a host `code` default (VS Code's webview tints
          bare <code> amber). */}
      <code style={{ color: "inherit" }}>{issue.path}</code>
      {issue.fields && issue.fields.length > 0 && (
        <>
          {" "}
          (from{" "}
          {issue.fields.map((field, i) => (
            <span key={field}>
              {i > 0 && ", "}
              <code style={{ color: "inherit" }}>{"${" + field + "}"}</code>
            </span>
          ))}
          )
        </>
      )}
    </>
  );
}
