import React from "react";

interface AssetPlaceholderProps {
  /** The original `asset://…` URI, shown so the researcher can identify it. */
  uri: string;
  /** What the reference stands in for (e.g. "video", "audio", "image"). */
  kind?: string;
}

/**
 * Labeled placeholder for an `asset://` reference the host couldn't resolve
 * (#191).
 *
 * `asset://` media is materialized by the deployment platform at run time
 * (its `getAssetURL` maps the URI to a presigned URL or similar). A preview
 * host with no such resolver returns the `asset://` URI unchanged, so any
 * element whose resolved src is still an `asset://` URI renders this — a clear
 * "comes from the platform" stand-in — instead of a broken `<img>`/`<video>`
 * or a failed network request pointed at a nonsensical URL.
 */
export function AssetPlaceholder({ uri, kind }: AssetPlaceholderProps) {
  return (
    <div data-testid="asset-placeholder" data-asset-uri={uri} style={container}>
      <div aria-hidden="true" style={icon}>
        &#9638;
      </div>
      <p style={label}>Platform-provided {kind ?? "asset"}</p>
      <code style={uriText}>{uri}</code>
      <p style={hint}>
        Resolved by the platform at run time — not available here.
      </p>
    </div>
  );
}

// Themeable via the same `--stagebook-*` CSS variables the rest of the
// library uses; the fallbacks keep the default (host-unstyled) appearance.
const container: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  justifyContent: "center",
  gap: "0.5rem",
  padding: "2rem",
  border: "2px dashed var(--stagebook-border, #d1d5db)",
  borderRadius: "0.5rem",
  backgroundColor: "var(--stagebook-bg-muted, #f9fafb)",
  minHeight: "8rem",
};

const icon: React.CSSProperties = {
  fontSize: "1.75rem",
  color: "var(--stagebook-decoration, #9ca3af)",
};

const label: React.CSSProperties = {
  fontSize: "0.8125rem",
  fontWeight: 600,
  color: "var(--stagebook-text-secondary, #374151)",
  margin: 0,
  textAlign: "center",
};

const uriText: React.CSSProperties = {
  fontSize: "0.75rem",
  color: "var(--stagebook-text-muted, #6b7280)",
  backgroundColor: "var(--stagebook-surface, #fff)",
  padding: "0.2rem 0.45rem",
  borderRadius: "0.25rem",
  border: "1px solid var(--stagebook-border, #d1d5db)",
  wordBreak: "break-all",
  maxWidth: "100%",
};

const hint: React.CSSProperties = {
  fontSize: "0.75rem",
  color: "var(--stagebook-decoration, #9ca3af)",
  margin: 0,
  textAlign: "center",
};
