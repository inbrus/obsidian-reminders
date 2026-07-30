import { ItemView, WorkspaceLeaf, TFile, setIcon } from "obsidian";
import { ViewDeps } from "./view";
import { computeContext, ContextScope, DueFilter } from "./context";
import { TaskItem } from "./types";
import { TaskRowCtx, renderTaskRow } from "./ui";

export const VIEW_TYPE_TASKGREGATOR_CONTEXT = "taskgregator-context-view";

const TABS: [ContextScope, string][] = [
  ["all", "All"],
  ["page", "Page"],
  ["section", "Section"],
  ["reference", "Reference"],
];

// Due-date filter options shown above the scope tabs.
const DUE_FILTERS: [DueFilter, string][] = [
  ["all", "All"],
  ["overdue", "Overdue"],
  ["today", "Today"],
  ["soon", "Soon"],
];

/**
 * A right-sidebar panel that follows the active file and shows the tasks in its
 * context: tasks on the page (or, for a folder note, the whole folder subtree)
 * plus tasks elsewhere that reference it. Reuses the hub view's task rows.
 */
export class TaskgregatorContextView extends ItemView {
  deps: ViewDeps;
  file: TFile | null = null;

  constructor(leaf: WorkspaceLeaf, deps: ViewDeps) {
    super(leaf);
    this.deps = deps;
  }

  getViewType(): string {
    return VIEW_TYPE_TASKGREGATOR_CONTEXT;
  }
  getDisplayText(): string {
    return "Task context";
  }
  getIcon(): string {
    return "list-checks";
  }

  async onOpen(): Promise<void> {
    this.contentEl.addClass("taskgregator", "tg-context");
    this.render();
  }

  /** Point the panel at a file (called as the active file changes). */
  setFile(file: TFile | null): void {
    if (file?.path === this.file?.path) return;
    this.file = file;
    this.render();
  }

  /** Filter a task list by the selected due-date window. */
  private filterByDue(tasks: TaskItem[], filter: DueFilter): TaskItem[] {
    if (filter === "all") return tasks;
    const today = new Date().toISOString().slice(0, 10);
    if (filter === "overdue") return tasks.filter((t) => t.meta.due && t.meta.due < today);
    if (filter === "today") return tasks.filter((t) => t.meta.due === today);
    // "soon": due after today, through today + soonDays.
    const end = new Date();
    end.setDate(end.getDate() + Math.max(1, this.deps.settings.soonDays));
    const endStr = end.toISOString().slice(0, 10);
    return tasks.filter((t) => t.meta.due && t.meta.due > today && t.meta.due <= endStr);
  }

  private rowCtx(): TaskRowCtx {    return {
      app: this.app,
      writer: this.deps.writer,
      reindexFile: this.deps.reindexFile,
      rerender: () => this.render(),
      onTagClick: (tag: string) => {
        this.deps.state.selection = { type: "smart", tag, label: "#" + tag };
        void this.deps.openList();
        this.deps.rerenderAll();
      },
    };
  }

  render(): void {
    const root = this.contentEl;
    root.empty();

    if (!this.file) {
      root.createDiv({ cls: "tg-empty", text: "Open a note to see its tasks." });
      return;
    }

    const ctx = computeContext(this.app, this.deps.store, this.file);

    const header = root.createDiv({ cls: "tg-context-header" });
    const title = header.createDiv({ cls: "tg-context-title" });
    const ic = title.createSpan({ cls: "tg-tree-icon" });
    setIcon(ic, ctx.isFolderNote ? "folder" : "file-text");
    title.createSpan({ cls: "tg-context-name", text: ctx.title });
    header.createSpan({ cls: "tg-count", text: String(ctx.total) });
    root.createDiv({ cls: "tg-context-sub", text: ctx.subtitle });

    // Subtle due-date filter (applies within the active scope tab).
    const state = this.deps.state;
    const scopeTasks = ctx.scopes[state.contextTab];
    const filterRow = root.createDiv({ cls: "tg-duefilter" });
    for (const [key, label] of DUE_FILTERS) {
      const n = this.filterByDue(scopeTasks, key).length;
      const seg = filterRow.createDiv({
        cls:
          "tg-duefilter-seg" +
          (state.contextDueFilter === key ? " is-active" : "") +
          (key !== "all" && n === 0 ? " is-empty" : ""),
      });
      seg.setText(label);
      seg.onclick = () => {
        if (state.contextDueFilter === key) return;
        state.contextDueFilter = key;
        this.render();
      };
    }

    // Subtle filter tabs.
    const tabs = root.createDiv({ cls: "tg-tabs" });
    for (const [scope, label] of TABS) {
      const n = ctx.scopes[scope].length;
      const tab = tabs.createDiv({
        cls: "tg-tab" + (state.contextTab === scope ? " is-active" : "") + (n === 0 ? " is-empty" : ""),
      });
      tab.createSpan({ cls: "tg-tab-label", text: label });
      tab.createSpan({ cls: "tg-tab-count", text: String(n) });
      tab.onclick = () => {
        if (state.contextTab === scope) return;
        state.contextTab = scope;
        this.render();
      };
    }

    const tasks = this.filterByDue(scopeTasks, state.contextDueFilter);
    if (tasks.length === 0) {
      root.createDiv({ cls: "tg-empty", text: "Nothing in this view." });
      return;
    }

    const rowCtx = this.rowCtx();
    const list = root.createDiv({ cls: "tg-list" });
    for (const task of tasks) renderTaskRow(list, task, rowCtx);
  }
}
