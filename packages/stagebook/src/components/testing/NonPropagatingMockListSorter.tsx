/**
 * Test wrapper for ListSorter that intentionally does NOT feed
 * `onChange` reorderings back into `items`. Simulates a host whose
 * parent state is slow to update (e.g. round-tripping to a server
 * before the new order shows up in props).
 *
 * Used to verify that ListSorter renders from its own internal
 * order — without optimistic state, the visible row order would
 * snap back to `initialItems` immediately after every drop.
 */
import React from "react";
import { ListSorter } from "../form/ListSorter.js";

export interface NonPropagatingMockListSorterProps {
  items: string[];
}

export function NonPropagatingMockListSorter({
  items,
}: NonPropagatingMockListSorterProps) {
  return <ListSorter items={items} onChange={() => {}} />;
}
