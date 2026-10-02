// Shared UI state for the obsidian-reminders nav (left dock) and list (center)
// views. Both views read/write the same instance so a selection made in the nav
// is reflected by the list, and sort/group/collapse survive re-renders.
//
// The pure SortKey/GroupKey/Selection types live in core/models.ts and are
// re-exported here for backward-compatible imports.

import type { ContextScope, DueFilter, Selection, SortKey, GroupKey } from "./core/models";

export type { SortKey, GroupKey, Selection } from "./core/models";

export class TaskgregatorState {
  selection: Selection = { type: "today" };
  // Free-text filter layered on top of the current selection ("" = off).
  searchQuery = "";
  // Context-tree node keys the user has collapsed.
  collapsed: Set<string> = new Set();
  sortBy: SortKey = "ctime";
  // Sort direction and whether the user explicitly chose a sort. When not
  // explicit, the list falls back to the default order (created, new to old).
  sortDir: "asc" | "desc" = "desc";
  sortExplicit = false;
  groupBy: GroupKey = "ctime";
  // Context sidebar (right panel) selections. Persist for the session so the
  // panel doesn't reset when the active file changes or the leaf reloads.
  contextTab: ContextScope = "all";
  contextDueFilter: DueFilter = "all";
  // Context sidebar sort. Mirrors the main list's tri-state model: pick a key,
  // click again to flip direction, a third click clears back to the natural
  // scope order (page -> section -> reference). Only one key is active.
  contextSortBy: SortKey = "priority";
  contextSortDir: "asc" | "desc" = "asc";
  contextSortExplicit = false;
}
