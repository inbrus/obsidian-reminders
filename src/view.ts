import { ItemView, WorkspaceLeaf } from "obsidian";
import { TaskItem, TreeNode } from "./types";
import { TaskStore } from "./store";
import { TaskWriter } from "./services/writer";
import { nodeKeyForFile } from "./parser";
import { TaskgregatorSettings } from "./settings";
import { TaskRowCtx, renderTaskRow, promptDate } from "./ui";
import { Selection, SortKey, GroupKey, TaskgregatorState } from "./state";
import { sortTasksBy, groupTasks } from "./core/query";

export { promptDate };
export { sortTasksBy };

export const VIEW_TYPE_TASKGREGATOR = "taskgregator-view";

const SORT_OPTIONS: [SortKey, string][] = [
  ["priority", "Priority"],
  ["due", "Due date"],
  ["start", "Start date"],
  ["created", "Age"],
  ["mtime", "Modified"],
  ["ctime", "Created"],
  ["reference", "Reference"],
  ["title", "Title"],
];

const GROUP_OPTIONS: [GroupKey, string][] = [
  ["none", "None"],
  ["priority", "Priority"],
  ["due", "Due date"],
  ["mtime", "Modified"],
  ["ctime", "Created"],
  ["type", "Type"],
  ["reference", "Reference"],
];

export interface ViewDeps {
  store: TaskStore;
  writer: TaskWriter;
  settings: TaskgregatorSettings;
  state: TaskgregatorState;
  reindexFile: (path: string) => Promise<void>;
  // Reindex the vault, then re-render every view.
  refresh: () => void;
  // Ensure/reveal the center list view (called when a nav item is chosen).
  openList: () => Promise<void>;
  // Re-render nav + list + context views without reindexing.
  rerenderAll: () => void;
  // Re-render only the center list view(s) (used by search-as-you-type so the
  // nav's search input keeps focus).
  rerenderList: () => void;
}

/**
 * The list view: renders the task list for the current selection (held in shared
 * state). Navigation lives in the separate nav view (left dock).
 */
export class TaskgregatorView extends ItemView {
  deps: ViewDeps;
  mainEl!: HTMLElement;

  constructor(leaf: WorkspaceLeaf, deps: ViewDeps) {
    super(leaf);
    this.deps = deps;
  }

  private get state(): TaskgregatorState {
    return this.deps.state;
  }

  getViewType(): string {
    return VIEW_TYPE_TASKGREGATOR;
  }
  getDisplayText(): string {
    return "Taskgregator";
  }
  getIcon(): string {
    return "check-check";
  }

  async onOpen(): Promise<void> {
    const root = this.contentEl;
    root.empty();
    root.addClass("taskgregator", "tg-list-view");
    this.mainEl = root.createDiv({ cls: "tg-main" });
    this.render();
  }

  render(): void {
    this.renderMain();
  }

  /** Focus the node that contains a given source file (used by external reveal). */
  revealTask(filePath: string): void {
    const { fileKey, flat, rootName } = nodeKeyForFile(filePath, this.deps.settings);
    const base = filePath.split("/").pop()?.replace(/\.md$/i, "") || filePath;
    this.state.selection = {
      type: "node",
      key: fileKey,
      label: flat ? rootName : base,
    };
    this.render();
  }

  private rowCtx(): TaskRowCtx {
    return {
      app: this.app,
      writer: this.deps.writer,
      reindexFile: this.deps.reindexFile,
      rerender: () => this.render(),
      agingDays: this.deps.settings.agingDays,
      onTagClick: (tag: string) => {
        this.state.selection = { type: "smart", tag, label: "#" + tag };
        void this.deps.openList();
        this.deps.rerenderAll();
      },
    };
  }

  private currentTasks(): { title: string; tasks: TaskItem[] } {
    const s: Selection = this.state.selection;
    switch (s.type) {
      case "overdue":
        return { title: "Overdue", tasks: this.deps.store.overdue() };
      case "today":
        return { title: "Today", tasks: this.deps.store.dueToday() };
      case "tomorrow":
        return { title: "Tomorrow", tasks: this.deps.store.dueTomorrow() };
      case "soon":
        return { title: "Soon", tasks: this.deps.store.dueSoon() };
      case "inbox":
        return { title: "Inbox", tasks: this.deps.store.untagged() };
      case "flagged":
        return {
          title: "Flagged",
          tasks: this.deps.store.visible().filter((t) => t.priority > 0 && t.priority <= 2),
        };
      case "all":
        return { title: "All tasks", tasks: this.deps.store.visible() };
      case "inprogress":
        return { title: "In Progress", tasks: this.deps.store.inProgress() };
      case "completed":
        return { title: "Completed", tasks: this.deps.store.completed() };
      case "tags":
        return { title: "All Tags", tasks: this.deps.store.taggedTasks() };
      case "smart":
        return { title: s.label, tasks: this.deps.store.tasksWithTag(s.tag) };
      case "node": {
        const roots = this.deps.store.buildContextTree();
        const node = findNode(roots, s.key);
        const tasks = node ? this.deps.store.tasksForNode(node) : [];
        return { title: s.label, tasks };
      }
    }
  }

  private renderMain(): void {
    const el = this.mainEl;
    el.empty();
    const { title, tasks: baseTasks } = this.currentTasks();
    const query = this.state.searchQuery.trim();
    const tasks = query ? this.deps.store.filterByQuery(baseTasks, query) : baseTasks;

    const head = el.createDiv({ cls: "tg-main-header" });
    head.createEl("h2", { text: title });
    head.createSpan({ cls: "tg-count", text: `${tasks.length}` });

    if (query) this.renderSearchCallout(el, query, title);

    if (tasks.length === 0) {
      this.renderControls(el);
      let msg = "No tasks here. Nice.";
      if (query) {
        msg = `No tasks match "${query}" in ${title}.`;
      }
      el.createDiv({ cls: "tg-empty", text: msg });
      return;
    }

    this.renderControls(el);

    const key = this.state.sortExplicit ? this.state.sortBy : "ctime";
    const dir = this.state.sortExplicit ? this.state.sortDir : "desc";
    const sorted = sortTasksBy(tasks, key, dir);
    const list = el.createDiv({ cls: "tg-list" });

    if (this.state.groupBy === "none") {
      for (const t of sorted) this.renderTaskRow(list, t);
      return;
    }

    for (const group of groupTasks(sorted, this.state.groupBy)) {
      const header = list.createDiv({ cls: "tg-group-header" });
      header.createSpan({ cls: "tg-group-label", text: group.label });
      header.createSpan({ cls: "tg-group-count", text: String(group.tasks.length) });
      for (const t of group.tasks) this.renderTaskRow(list, t);
    }
  }

  /** Callout shown while a search filter is active, with a clear action. */
  private renderSearchCallout(el: HTMLElement, query: string, scope: string): void {
    const bar = el.createDiv({ cls: "tg-search-callout" });
    const label = bar.createSpan({ cls: "tg-search-callout-text" });
    label.appendText("Searching ");
    label.createSpan({ cls: "tg-search-term", text: query });
    label.appendText(" in ");
    label.createSpan({ cls: "tg-search-scope", text: scope });
    const clear = bar.createSpan({ cls: "tg-search-clear", text: "clear" });
    clear.onclick = () => {
      this.state.searchQuery = "";
      this.deps.rerenderAll();
    };
  }

  private renderControls(el: HTMLElement): void {
    const bar = el.createDiv({ cls: "tg-controls" });
    this.renderSortRow(bar);
    this.renderPillRow(bar, "Group", GROUP_OPTIONS, this.state.groupBy, (v) => {
      this.state.groupBy = v;
      this.renderMain();
    });
  }

  /** Sort row: tri-state pills. Click cycles asc → desc → off (default order). */
  private renderSortRow(parent: HTMLElement): void {
    const s = this.state;
    const row = parent.createDiv({ cls: "tg-pillrow" });
    row.createSpan({ cls: "tg-pillrow-label", text: "Sort" });
    for (const [val, text] of SORT_OPTIONS) {
      const active = s.sortExplicit && s.sortBy === val;
      const pill = row.createDiv({ cls: "tg-pill" + (active ? " is-active" : "") });
      pill.createSpan({ text });
      if (active) {
        pill.createSpan({ cls: "tg-pill-dir", text: s.sortDir === "asc" ? "↑" : "↓" });
      }
      pill.onclick = () => {
        this.cycleSort(val);
        this.renderMain();
      };
    }
  }

  /** Advance a sort pill through asc → desc → off (reset to default order). */
  private cycleSort(key: SortKey): void {
    const s = this.state;
    if (!s.sortExplicit || s.sortBy !== key) {
      s.sortExplicit = true;
      s.sortBy = key;
      s.sortDir = "asc";
    } else if (s.sortDir === "asc") {
      s.sortDir = "desc";
    } else {
      s.sortExplicit = false;
      s.sortBy = "ctime";
      s.sortDir = "desc";
    }
  }

  /** A labeled row of small clickable pills (used for Sort and Group). */
  private renderPillRow<T extends string>(
    parent: HTMLElement,
    label: string,
    options: [T, string][],
    active: T,
    onPick: (val: T) => void
  ): void {
    const row = parent.createDiv({ cls: "tg-pillrow" });
    row.createSpan({ cls: "tg-pillrow-label", text: label });
    for (const [val, text] of options) {
      const pill = row.createDiv({
        cls: "tg-pill" + (active === val ? " is-active" : ""),
      });
      pill.setText(text);
      pill.onclick = () => {
        if (active === val) return;
        onPick(val);
      };
    }
  }

  private renderTaskRow(parent: HTMLElement, task: TaskItem): void {
    renderTaskRow(parent, task, this.rowCtx());
  }
}

function findNode(roots: TreeNode[], key: string): TreeNode | undefined {
  for (const r of roots) {
    if (r.key === key) return r;
    const found = findNode(r.children, key);
    if (found) return found;
  }
  return undefined;
}
