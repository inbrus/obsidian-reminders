// UiStateStore: shared UI state for the nav, list, and context views. Replaces
// ObsidianRemindersState. Selection and search emit bus events on write (so other
// views react); the rest (sort/group/collapse/context-tab) are per-view visual
// state that the owning view re-renders itself, so they need no event.

import { EventBus } from "./event-bus";
import type {
  Selection,
  SortKey,
  GroupKey,
  ContextScope,
  DueFilter,
} from "../core/models";

export class UiStateStore {
  constructor(private bus: EventBus) {}

  private _selection: Selection = { type: "today" };
  get selection(): Selection {
    return this._selection;
  }
  set selection(v: Selection) {
    this._selection = v;
    this.bus.emit("selection:changed", undefined);
  }

  private _searchQuery = "";
  get searchQuery(): string {
    return this._searchQuery;
  }
  set searchQuery(v: string) {
    this._searchQuery = v;
    this.bus.emit("search:changed", undefined);
  }

  // Context-tree node keys the user has collapsed (nav view visual state).
  collapsed: Set<string> = new Set();

  // List sort/group state (list view re-renders itself).
  sortBy: SortKey = "ctime";
  sortDir: "asc" | "desc" = "desc";
  sortExplicit = false;
  groupBy: GroupKey = "ctime";

  // Context sidebar (right panel) state (context view re-renders itself).
  contextTab: ContextScope = "all";
  contextDueFilter: DueFilter = "all";
  contextSortBy: SortKey = "priority";
  contextSortDir: "asc" | "desc" = "asc";
  contextSortExplicit = false;
}
