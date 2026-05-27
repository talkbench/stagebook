import { parseDocument, isMap, isSeq, isScalar, isPair } from "yaml";
import {
  validElementTypes,
  validComparators,
  validReferenceTypes,
} from "stagebook";
import { offsetToLineCol } from "stagebook/validate";

// Map domain concepts to VS Code's built-in semantic token types.
// These are standard types that all themes already color distinctly.
export type SemanticTokenType =
  | "type" // element types (prompt, submitButton) → teal/green
  | "keyword" // comparators (equals, isAbove) → purple
  | "variable" // reference strings (prompt.q1) → light blue
  | "string" // file paths → orange (distinct via modifier)
  | "property" // section keys (elements, treatments) → blue
  | "comment"; // notes: body → same color as `# …` YAML comments

export interface SemanticToken {
  line: number;
  startCol: number;
  length: number;
  tokenType: SemanticTokenType;
  /** The matched text, for testing */
  text: string;
}

const elementTypeSet = new Set<string>(validElementTypes);
const comparatorSet = new Set<string>(validComparators);
const referenceTypeSet = new Set<string>(validReferenceTypes);
const contentTypeSet = new Set([
  "introSequence",
  "introSequences",
  "elements",
  "element",
  "stage",
  "stages",
  "treatment",
  "treatments",
  "reference",
  "condition",
  "conditions",
  "player",
  "groupComposition",
  "introExitStep",
  "introSteps",
  "exitSteps",
  "discussion",
  "broadcastAxisValues",
]);

const separatorStyles = new Set(["thin", "thick", "regular"]);

// Position keyword values that should be highlighted as enum tokens.
// `all` and `any` remain valid on `display.position` (the
// `positionSelectorSchema` still accepts them; that's a render concern,
// not a condition aggregator). `percentAgreement` was removed entirely
// in #238 — it's no longer accepted on any field.
const enumValues = new Set([
  "shared",
  "player",
  "all",
  "any",
  "text",
  "audio",
  "video",
]);

const sectionKeys = new Set([
  "introSequences",
  "introSteps",
  "gameStages",
  "elements",
  "treatments",
  "templates",
  "exitSequence",
  "groupComposition",
  "contentType",
  "broadcast",
  "discussion",
  "conditions",
]);

/**
 * Compute semantic tokens for a treatment YAML source string.
 *
 * Walks the YAML AST and identifies domain-specific tokens based
 * on key names and value content. Returns tokens sorted by position.
 *
 * This is a pure function — no VS Code dependency.
 */
export function computeSemanticTokens(source: string): SemanticToken[] {
  const doc = parseDocument(source, { uniqueKeys: false });
  if (!doc.contents) return [];

  const tokens: SemanticToken[] = [];

  function addToken(
    offset: number,
    text: string,
    tokenType: SemanticTokenType,
  ): void {
    const { line, col } = offsetToLineCol(source, offset);
    tokens.push({
      line,
      startCol: col,
      length: text.length,
      tokenType,
      text,
    });
  }

  /**
   * Get the on-disk text and starting offset of a scalar value, with the
   * surrounding quotes stripped for `"..."` / `'...'` scalars. The yaml
   * library's `range` spans the whole quoted form while `value.value` holds
   * only the unquoted content, so deriving both text and offset from the raw
   * source slice keeps semantic tokens aligned with what the user typed.
   */
  function getScalarSource(
    range: [number, number, number] | undefined,
  ): { offset: number; text: string } | null {
    if (!range) return null;
    const raw = source.slice(range[0], range[1]);
    if (
      raw.length >= 2 &&
      ((raw[0] === '"' && raw[raw.length - 1] === '"') ||
        (raw[0] === "'" && raw[raw.length - 1] === "'"))
    ) {
      return { offset: range[0] + 1, text: raw.slice(1, -1) };
    }
    return { offset: range[0], text: raw };
  }

  const TEMPLATE_VAR_RE = /\$\{[a-zA-Z0-9_]+\}/g;

  /**
   * Emit variable tokens for ${...} placeholders within a string.
   * Only emits tokens for the placeholders, not the surrounding text.
   */
  function emitTemplateVarTokens(startOffset: number, text: string): void {
    TEMPLATE_VAR_RE.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = TEMPLATE_VAR_RE.exec(text)) !== null) {
      addToken(startOffset + match.index, match[0], "variable");
    }
  }

  /**
   * Emit comment tokens covering a `notes:` scalar value — one token per
   * non-blank content line. Works for inline plain/quoted scalars and for
   * block scalars (`notes: |` / `notes: >`), which we identify by the
   * presence of a newline in the raw source slice. For block scalars we
   * skip the indicator line (the one starting with `|` or `>`) and any
   * blank lines, coloring each content line from its first non-whitespace
   * column to end-of-line.
   */
  function addNotesTokens(range: [number, number, number] | undefined): void {
    if (!range) return;
    const raw = source.slice(range[0], range[1]);
    const isBlock = raw.includes("\n");

    if (!isBlock) {
      // Inline: strip surrounding quotes, color the content as one token.
      const src = getScalarSource(range);
      if (src && src.text.length > 0) {
        addToken(src.offset, src.text, "comment");
      }
      return;
    }

    // Block scalar: walk source line-by-line within the value's range.
    let lineStart = range[0];
    let isFirstLine = true;
    while (lineStart < range[1]) {
      const nlIdx = source.indexOf("\n", lineStart);
      const lineEnd = nlIdx === -1 || nlIdx >= range[1] ? range[1] : nlIdx;
      // Trim a trailing \r so CRLF-terminated files don't leak carriage
      // returns into the token's text/length.
      const lineTextEnd =
        lineEnd > lineStart && source[lineEnd - 1] === "\r"
          ? lineEnd - 1
          : lineEnd;
      const lineText = source.slice(lineStart, lineTextEnd);
      const firstNonWs = lineText.search(/\S/);
      if (firstNonWs !== -1) {
        // Only the first line of the scalar is the block-scalar indicator
        // (`|`, `>`, `|-`, `|+`, etc.). Later content lines may legitimately
        // consist of a single `|` or `>` character and must be highlighted.
        const isIndicator =
          isFirstLine && /^[|>][-+]?\s*$/.test(lineText.slice(firstNonWs));
        if (!isIndicator) {
          addToken(
            lineStart + firstNonWs,
            lineText.slice(firstNonWs),
            "comment",
          );
        }
      }
      isFirstLine = false;
      if (nlIdx === -1 || nlIdx >= range[1]) break;
      lineStart = nlIdx + 1;
    }
  }

  /**
   * Emit tokens for a file path, splitting around ${...} placeholders.
   * Path segments get "string", placeholders get "variable".
   */
  function addFilePathTokens(startOffset: number, text: string): void {
    let lastIndex = 0;
    TEMPLATE_VAR_RE.lastIndex = 0;
    let match: RegExpExecArray | null;

    while ((match = TEMPLATE_VAR_RE.exec(text)) !== null) {
      if (match.index > lastIndex) {
        addToken(
          startOffset + lastIndex,
          text.slice(lastIndex, match.index),
          "string",
        );
      }
      addToken(startOffset + match.index, match[0], "variable");
      lastIndex = match.index + match[0].length;
    }

    if (lastIndex < text.length) {
      addToken(startOffset + lastIndex, text.slice(lastIndex), "string");
    }
  }

  function walkNode(node: unknown, keyName?: string): void {
    if (isMap(node)) {
      for (const pair of node.items) {
        if (!isPair(pair)) continue;

        const key = pair.key;
        const value = pair.value;

        // Highlight the key itself if it's a known section key
        if (isScalar(key) && typeof key.value === "string" && key.range) {
          const keyStr = key.value;
          if (sectionKeys.has(keyStr)) {
            addToken(key.range[0], keyStr, "property");
          }
        }

        // `notes:` — researcher-facing commentary; render in comment color.
        if (
          isScalar(key) &&
          typeof key.value === "string" &&
          key.value === "notes" &&
          isScalar(value) &&
          typeof value.value === "string" &&
          value.range
        ) {
          addNotesTokens(value.range);
        }

        // Highlight the value based on the key name
        if (isScalar(key) && typeof key.value === "string") {
          const k = key.value;

          const scalarSrc =
            isScalar(value) && typeof value.value === "string"
              ? getScalarSource(value.range)
              : null;

          if (
            k === "type" &&
            isScalar(value) &&
            typeof value.value === "string" &&
            scalarSrc
          ) {
            if (elementTypeSet.has(value.value)) {
              addToken(scalarSrc.offset, scalarSrc.text, "type");
            }
          } else if (
            k === "comparator" &&
            isScalar(value) &&
            typeof value.value === "string" &&
            scalarSrc
          ) {
            if (comparatorSet.has(value.value)) {
              addToken(scalarSrc.offset, scalarSrc.text, "keyword");
            }
          } else if (
            k === "reference" &&
            isScalar(value) &&
            typeof value.value === "string" &&
            scalarSrc
          ) {
            // Per #298, references are position-prefixed:
            // `<position>.<source>.<...>`. Source is the second segment.
            const segments = value.value.split(".");
            const refType = segments[1];
            if (refType && referenceTypeSet.has(refType)) {
              addToken(scalarSrc.offset, scalarSrc.text, "variable");
            }
          } else if (
            k === "file" &&
            isScalar(value) &&
            typeof value.value === "string" &&
            scalarSrc
          ) {
            addFilePathTokens(scalarSrc.offset, scalarSrc.text);
          } else if (
            k === "contentType" &&
            isScalar(value) &&
            typeof value.value === "string" &&
            scalarSrc &&
            contentTypeSet.has(value.value)
          ) {
            addToken(scalarSrc.offset, scalarSrc.text, "type");
          } else if (
            k === "style" &&
            isScalar(value) &&
            typeof value.value === "string" &&
            scalarSrc &&
            separatorStyles.has(value.value)
          ) {
            addToken(scalarSrc.offset, scalarSrc.text, "keyword");
          } else if (
            (k === "position" || k === "chatType") &&
            isScalar(value) &&
            typeof value.value === "string" &&
            scalarSrc &&
            enumValues.has(value.value)
          ) {
            addToken(scalarSrc.offset, scalarSrc.text, "keyword");
          }

          // For any other scalar value containing ${...} placeholders,
          // emit variable tokens so template fields are highlighted
          // consistently everywhere they appear.
          if (
            scalarSrc &&
            k !== "file" && // file paths already handled above
            ((TEMPLATE_VAR_RE.lastIndex = 0),
            TEMPLATE_VAR_RE.test(scalarSrc.text))
          ) {
            emitTemplateVarTokens(scalarSrc.offset, scalarSrc.text);
          }

          walkNode(value, String(k));
        } else {
          walkNode(value);
        }
      }
    } else if (isSeq(node)) {
      for (const item of node.items) {
        walkNode(item, keyName);
      }
    }
  }

  walkNode(doc.contents);

  // Sort by position for consistent output
  tokens.sort((a, b) => a.line - b.line || a.startCol - b.startCol);

  return tokens;
}
