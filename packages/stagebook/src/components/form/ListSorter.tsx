import React, { useEffect, useId, useState } from "react";
import {
  DragDropContext,
  Droppable,
  Draggable,
  type DropResult,
} from "@hello-pangea/dnd";

// Drag handle glyph — ⠿ (vertical-pair-of-three-dots Braille
// character) is the de-facto "drag me" affordance across modern web
// UI (shadcn, Notion, GitHub PR reorder UI). Replaces the previous
// `⇅` which read more like a "sort" icon than a drag handle.
const DRAG_HANDLE_GLYPH = "⠿";

const reorder = (
  list: string[],
  startIndex: number,
  endIndex: number,
): string[] => {
  const result = Array.from(list);
  const [removed] = result.splice(startIndex, 1);
  result.splice(endIndex, 0, removed);
  return result;
};

function ListItem({
  id,
  index,
  text,
  itemClass,
}: {
  id: string;
  index: number;
  text: string;
  itemClass: string;
}) {
  return (
    <Draggable key={id} draggableId={id} index={index}>
      {(provided, snapshot) => (
        <div
          ref={provided.innerRef}
          {...provided.draggableProps}
          {...provided.dragHandleProps}
          data-testid={`draggable-${index}`}
          data-dragging={snapshot.isDragging ? "true" : "false"}
          className={itemClass}
          style={{
            ...provided.draggableProps.style,
            padding: "0.5rem 0.75rem",
            // Touch-target sizing — matches the form-input row
            // height token used by Radio / Checkbox so drag rows
            // are comfortably tappable on touch.
            minHeight: "var(--stagebook-row-min-height, 2.25rem)",
            display: "flex",
            alignItems: "center",
            gap: "0.5rem",
            // Border longhands (no color here — state-dependent
            // bg / border / shadow live in the <style> block so
            // hover / focus-visible rules can override them.
            // Inline-style specificity would block those CSS
            // rules, same trap as Slider / Button / TextArea.)
            borderWidth: "1px",
            borderStyle: "solid",
            borderRadius: "0.375rem",
            fontSize: "0.875rem",
            color: "var(--stagebook-text, #1f2937)",
            cursor: snapshot.isDragging ? "grabbing" : "grab",
            // `transition` lives in the <style> block (not inline)
            // so the `@media (prefers-reduced-motion: reduce)` rule
            // can override it. Inline-style specificity would block
            // the media-query rule, same trap as the state-dependent
            // bg / border / shadow above.
          }}
        >
          <span
            aria-hidden="true"
            style={{
              // Glyph size scaled up from 1rem — at body text size the
              // ⠿ Braille pattern reads anemic against a 2.25rem row.
              color: "var(--stagebook-text-muted, #6b7280)",
              fontSize: "1.5rem",
              lineHeight: 1,
              userSelect: "none",
              flexShrink: 0,
            }}
          >
            {DRAG_HANDLE_GLYPH}
          </span>
          <span>{text}</span>
        </div>
      )}
    </Draggable>
  );
}

function List({ items, itemClass }: { items: string[]; itemClass: string }) {
  const displayIndex = [...Array(items.length + 1).keys()].slice(1);
  return (
    <div
      style={{
        display: "flex",
        borderWidth: "1px",
        borderStyle: "solid",
        borderColor: "var(--stagebook-border, #d1d5db)",
        borderRadius: "0.375rem",
        boxShadow: "0 1px 2px 0 rgba(0, 0, 0, 0.05)",
      }}
    >
      <div
        style={{
          display: "grid",
          padding: "0.5rem",
          alignContent: "start",
          gap: "0.5rem",
          color: "var(--stagebook-text-muted, #6b7280)",
          fontSize: "0.875rem",
        }}
      >
        {displayIndex.map((i) => (
          <p
            key={i}
            style={{
              margin: 0,
              padding: "0.5rem 0",
              // Match the row min-height AND the row's 1px top/bottom
              // border so position labels stay aligned with their
              // corresponding draggable rows. Without the transparent
              // border the rows are 2px taller per item, causing the
              // numbers to drift 12px out of alignment by row 6.
              minHeight: "var(--stagebook-row-min-height, 2.25rem)",
              borderTop: "1px solid transparent",
              borderBottom: "1px solid transparent",
              lineHeight: "1.25rem",
              display: "flex",
              alignItems: "center",
            }}
          >
            {i}.{" "}
          </p>
        ))}
      </div>
      <Droppable droppableId="droppable">
        {(provided) => (
          <div
            {...provided.droppableProps}
            ref={provided.innerRef}
            style={{
              display: "grid",
              gap: "0.5rem",
              padding: "0.5rem",
              flex: 1,
            }}
          >
            {items.map((item, index) => (
              <ListItem
                key={item}
                id={item}
                index={index}
                text={item}
                itemClass={itemClass}
              />
            ))}
            {provided.placeholder}
          </div>
        )}
      </Droppable>
    </div>
  );
}

export interface ListSorterProps {
  items: string[];
  onChange: (reordered: string[]) => void;
}

export function ListSorter({ items, onChange }: ListSorterProps) {
  // Optimistic local state. @hello-pangea/dnd renders whatever order
  // we pass in, so a purely controlled component shows the OLD order
  // for the moment between drop and the parent's onChange-driven
  // prop update — which on hosts that persist via a server roundtrip
  // can be 100s of ms. The visible effect is a "snap back to old
  // order, then flash to new order" that makes it unclear whether
  // the drop landed.
  //
  // Holding the order locally and updating it synchronously in
  // onDragEnd eliminates the snap-back. The useEffect resyncs from
  // props if the parent ever externally changes items (e.g. resets
  // the list, or the server returns a different order). Parent
  // remains authoritative.
  const [order, setOrder] = useState(items);
  useEffect(() => {
    setOrder(items);
  }, [items]);

  const onDragEnd = (result: DropResult) => {
    if (!result.destination) return;
    const reordered = reorder(
      order,
      result.source.index,
      result.destination.index,
    );
    setOrder(reordered);
    onChange(reordered);
  };

  // Per-instance class name for hover / focus-visible / reduced-motion
  // rules. Same useId + sanitize pattern as the sibling form components.
  const reactId = useId();
  const safeId = reactId.replace(/[^a-zA-Z0-9_-]/g, "");
  const itemClass = `stagebook-listsorter-item-${safeId}`;

  return (
    <>
      <style>{`
        /* Base row fill — gray-muted background with a 1px gray
           border and a subtle elevation shadow. Lives in CSS (not
           inline) so the hover / focus-visible / dragging state
           rules below can override it without specificity fights. */
        .${itemClass} {
          background-color: var(--stagebook-bg-muted, #f9fafb);
          border-color: var(--stagebook-border, #d1d5db);
          box-shadow: 0 1px 2px 0 rgba(0, 0, 0, 0.05);
          transition:
            background-color 120ms ease-out,
            box-shadow 120ms ease-out,
            border-color 120ms ease-out;
        }
        /* Dragging state — white background + darker border +
           stronger elevation shadow so the lifted row visually
           "picks up" from the list. */
        .${itemClass}[data-dragging="true"] {
          background-color: var(--stagebook-bg, #ffffff);
          border-color: var(--stagebook-text-secondary, #374151);
          box-shadow:
            0 4px 8px rgba(0, 0, 0, 0.12),
            0 1px 2px 0 rgba(0, 0, 0, 0.05);
        }
        /* Hover affordance on static rows — shifts the background
           to --stagebook-hover-bg, the same token Radio / Checkbox
           rows use. Skipped while dragging so the drag-state
           styling isn't masked. */
        .${itemClass}[data-dragging="false"]:hover {
          background-color: var(--stagebook-hover-bg, #f3f4f6);
        }
        /* :focus-visible (keyboard focus only). The draggable row
           receives keyboard focus when the user tabs through the
           list; the ring tells them they're holding the lift target
           before pressing Space to grab. Scoped to non-dragging
           rows so the ring rule and drag-state rule don't fight
           on specificity during an active drag — drag has its own
           loud visual state (stronger shadow + darker border)
           that already serves the "I'm holding this" purpose. */
        .${itemClass}[data-dragging="false"]:focus-visible {
          outline: none;
          box-shadow:
            0 0 0 2px var(--stagebook-focus-ring, rgba(59, 130, 246, 0.25)),
            0 1px 2px 0 rgba(0, 0, 0, 0.05);
        }
        @media (prefers-reduced-motion: reduce) {
          .${itemClass} {
            transition: none;
          }
        }
      `}</style>
      <DragDropContext onDragEnd={onDragEnd}>
        <List items={order} itemClass={itemClass} />
      </DragDropContext>
    </>
  );
}
