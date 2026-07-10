import React from "react";

export interface SeparatorProps {
  style?: "" | "thin" | "regular" | "thick";
}

// Border longhands (not the `border` shorthand) — React's inline-style
// diff routinely clears the longhand without re-emitting the shorthand
// expansion, which would surface here as a stray default 1-3px border
// stripe overlapping the colored bar. Same #367-pattern defense as the
// sibling form components. `borderStyle: "none"` covers all four sides.
//
// `backgroundColor` + explicit `height` is what draws the visible rule;
// using these (not `border-top`) lets the rule render correctly even
// on hosts that ship `hr { border: 0 }` in their reset (Tailwind
// preflight). The inline `backgroundColor` wins on specificity over a
// host's `hr { background-color: transparent }`. See issue #215 for
// the related `<hr>` rendering work in Markdown.
const baseStyle: React.CSSProperties = {
  margin: "1rem 0",
  width: "100%",
  borderStyle: "none",
};

// Three sizes, three colors. Thin and regular share the gray-400
// `--stagebook-decoration` token; thick steps up to the heavier
// `--stagebook-text-muted` to read as a strong separator. Researchers
// pick the style via the prompt-file frontmatter; the default ("")
// resolves to regular.
const VARIANT_STYLES: Record<
  Exclude<SeparatorProps["style"], undefined | "">,
  React.CSSProperties
> = {
  thin: {
    ...baseStyle,
    height: "1px",
    backgroundColor: "var(--stagebook-decoration, #9ca3af)",
  },
  regular: {
    ...baseStyle,
    height: "3px",
    backgroundColor: "var(--stagebook-decoration, #9ca3af)",
  },
  thick: {
    ...baseStyle,
    height: "5px",
    backgroundColor: "var(--stagebook-text-muted, #6b7280)",
  },
};

export function Separator({ style = "" }: SeparatorProps) {
  // `""` is the legacy "no style specified" sentinel from the
  // prompt-file schema — resolves to the regular variant.
  const variant = style === "" ? "regular" : style;
  return <hr style={VARIANT_STYLES[variant]} />;
}
