// Shared UI state for the Taskgregator nav (left dock) and list (center) views.
// Both views read/write the same instance so a selection made in the nav is
// reflected by the list, and sort/group/collapse survive re-renders.

import { ContextScope, DueFilter } from "./context";

export type SortKey = "priority" | "due" | "start" | "created" | "reference" | "title";
export type GroupKey = "none" | "priority" | "due" | "reference";
export type Selection =
  | { type: "overdue" }
  | { type: "today" }
  | { type: "tomorrow" }
  | { type: "soon" }
  | { type: "aging" }
  | { type: "all" }
  | { type: "flagged" }
  | { type: "tags" }
  | { type: "smart"; tag: string; label: string }
  | { type: "node"; key: string; label: string };

export class TaskgregatorState {
  selection: Selection = { type: "today" };
  // Free-text filter layered on top of the current selection ("" = off).
  searchQuery = "";
  // Context-tree node keys the user has collapsed.
  collapsed: Set<string> = new Set();
  sortBy: SortKey = "priority";
  // Sort direction and whether the user explicitly chose a sort. When not
  // explicit, the list falls back to the default order (priority, natural).
  sortDir: "asc" | "desc" = "asc";
  sortExplicit = false;
  groupBy: GroupKey = "none";
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
