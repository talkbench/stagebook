import React from "react";

export interface ImageElementProps {
  src: string;
  width?: number;
  /**
   * Alt text for the `<img>` (#536). Supplied by the author via the treatment
   * `altText:` field. An explicit empty string (or omission) marks the image
   * decorative — hidden from screen readers — which is correct only when the
   * image carries no information.
   */
  alt?: string;
}

export function ImageElement({ src, width, alt }: ImageElementProps) {
  if (!src) return null;

  return (
    <div style={{ display: "flex", justifyContent: "center" }}>
      <img
        src={src}
        alt={alt ?? ""}
        style={{
          width: width ? `${width}%` : "100%",
          maxWidth: "100%",
          height: "auto",
        }}
      />
    </div>
  );
}
