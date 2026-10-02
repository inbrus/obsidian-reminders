import { ItemView, WorkspaceLeaf, setIcon } from "obsidian";
import { TreeNode } from "./types";
import { ViewDeps } from "./view";
import { NAV_SECTIONS } from "./parser";
import { Selection } from "./core/models";

export const VIEW_TYPE_TASKGREGATOR_NAV = "taskgregator-nav-view";

/**
 * The navigator (left dock): smart lists (Today/Flagged/All + tag lists) and the
 * context tree. Choosing an item sets the shared selection and opens/reveals the
 * center list view.
 */
export class TaskgregatorNavView extends ItemView {
  deps: ViewDeps;
  private searchInput: HTMLInputElement | null = null;
  private unsubscribers: Array<() => void> = [];

  constructor(leaf: WorkspaceLeaf, deps: ViewDeps) {
    super(leaf);
    this.deps = deps;
  }

  private get state() {
    return this.deps.state;
  }

  getViewType(): string {
    return VIEW_TYPE_TASKGREGATOR_NAV;
  }
  getDisplayText(): string {
    return "Tasks";
  }
  getIcon(): string {
    return "check-check";
  }

  async onOpen(): Promise<void> {
    this.contentEl.addClass("taskgregator", "tg-nav-view");
    this.unsubscribers = [
      this.deps.bus.on("index:updated", () => this.render()),
      this.deps.bus.on("selection:changed", () => this.render()),
      this.deps.bus.on("settings:changed", () => this.render()),
    ];
    this.render();
  }

  async onClose(): Promise<void> {
    for (const u of this.unsubscribers) u();
    this.unsubscribers = [];
  }

  /** Set the selection (emits selection:changed) and reveal the list. */
  private choose(): void {
    void this.deps.openList();
  }

  render(): void {
    const el = this.contentEl;
    // Preserve search-box focus + caret across re-renders (e.g. background reindex).
    const prev = this.searchInput;
    const keepFocus = prev != null && document.activeElement === prev;
    const caret = prev ? prev.selectionStart : null;
    el.empty();
    const c = this.deps.store.counts();

    this.renderSearch(el, keepFocus, caret);

    const smart = el.createDiv({ cls: "tg-section" });
    if (c.overdue > 0) {
      this.sideItem(smart, "alert-triangle", "Overdue", c.overdue, this.state.selection.type === "overdue", () => {
        this.state.selection = { type: "overdue" };
        this.choose();
      }, { alert: true });
    }
    const counts: Record<string, number> = {
      today: c.today,
      tomorrow: c.tomorrow,
      soon: c.soon,
      inbox: c.inbox,
      inprogress: c.inprogress,
      flagged: c.flagged,
      all: c.total,
      completed: c.completed,
    };
    for (const id of this.deps.settings.navOrder) {
      if (this.deps.settings.navHidden.includes(id)) continue;
      const def = NAV_SECTIONS.find((d) => d.id === id);
      if (!def) continue;
      const count = counts[id] ?? 0;
      this.sideItem(smart, def.icon, def.label, count, this.state.selection.type === id, () => {
        this.state.selection = { type: id } as Selection;
        this.choose();
      }, { showCount: this.deps.settings.navShowCounts[id] !== false });
    }

    // Tag-driven smart lists.
    const lists = el.createDiv({ cls: "tg-section" });
    lists.createDiv({ cls: "tg-section-title", text: "Lists" });
    for (const sl of this.deps.settings.smartLists) {
      const n = this.deps.store.tasksWithTag(sl.tag).length;
      const active = this.state.selection.type === "smart" && this.state.selection.tag === sl.tag;
      this.sideItem(lists, sl.icon || "hash", sl.name, n, active, () => {
        this.state.selection = { type: "smart", tag: sl.tag, label: sl.name };
        this.choose();
      });
    }
    this.renderAllTags(lists);

    // Context tree.
    const tree = el.createDiv({ cls: "tg-section" });
    tree.createDiv({ cls: "tg-section-title", text: "Context" });
    const roots = this.deps.store.buildContextTree();
    for (const r of roots) {
      if (r.count === 0) continue;
      this.renderTreeNode(tree, r, 0);
    }
  }

  /** The search box (under the title). Filters the current selection's tasks. */
  private renderSearch(el: HTMLElement, keepFocus: boolean, caret: number | null): void {
    const wrap = el.createDiv({ cls: "tg-search" });
    const input = wrap.createEl("input", {
      cls: "tg-search-input",
      attr: { type: "text", placeholder: "Search tasks…", spellcheck: "false" },
    });
    input.value = this.state.searchQuery;
    this.searchInput = input;

    const clearBtn = wrap.createSpan({ cls: "tg-search-x", attr: { "aria-label": "Clear search" } });
    setIcon(clearBtn, "x");
    clearBtn.toggle(this.state.searchQuery.length > 0);

    const apply = (query: string): void => {
      this.state.searchQuery = query;
      clearBtn.toggle(query.length > 0);
      // Ensure the list is visible; searchQuery emits search:changed so the list
      // re-renders while this input keeps focus.
      void this.deps.openList();
    };

    const clear = (): void => {
      input.value = "";
      this.state.searchQuery = "";
    };

    input.addEventListener("input", () => apply(input.value));
    input.addEventListener("keydown", (e) => {
      if (e.key === "Escape") clear();
    });
    clearBtn.onclick = () => clear();

    // Reindex action lives inline with search (header was removed).
    const reload = wrap.createSpan({ cls: "tg-icon-btn" });
    setIcon(reload, "refresh-cw");
    reload.setAttr("aria-label", "Reindex");
    reload.onclick = () => void this.deps.reindex();

    if (keepFocus) {
      input.focus();
      const pos = caret ?? input.value.length;
      input.setSelectionRange(pos, pos);
    }
  }

  /**
   * "All Tags": a collapsible folder under Lists that treats every tag in use
   * like a context folder. The header rolls up all tagged tasks and is itself
   * selectable; each child is that tag's list. Collapse state lives under the
   * reserved key "@tags".
   */
  private renderAllTags(parent: HTMLElement): void {
    const tagCounts = this.deps.store.tagCounts();
    if (tagCounts.length === 0) return;

    const collapseKey = "@tags";
    const isCollapsed = this.state.collapsed.has(collapseKey);
    const rollup = this.deps.store.taggedTasks().length;
    const active = this.state.selection.type === "tags";

    const row = parent.createDiv({ cls: "tg-tree-row" + (active ? " is-active" : "") });
    row.setCssStyles({ paddingLeft: "8px" });

    const twisty = row.createSpan({ cls: "tg-twisty" });
    setIcon(twisty, isCollapsed ? "chevron-right" : "chevron-down");
    twisty.onclick = (e) => {
      e.stopPropagation();
      if (isCollapsed) this.state.collapsed.delete(collapseKey);
      else this.state.collapsed.add(collapseKey);
      this.render();
    };

    const ic = row.createSpan({ cls: "tg-tree-icon" });
    setIcon(ic, "tags");
    row.createSpan({ cls: "tg-tree-label", text: "→" });
    row.createSpan({ cls: "tg-badge", text: String(rollup) });
    row.onclick = () => {
      this.state.selection = { type: "tags" };
      this.choose();
    };

    if (isCollapsed) return;
    for (const { tag, count } of tagCounts) {
      const tagActive =
        this.state.selection.type === "smart" && this.state.selection.tag === tag;
      const child = parent.createDiv({ cls: "tg-tree-row" + (tagActive ? " is-active" : "") });
      child.setCssStyles({ paddingLeft: 8 + 14 + "px" });
      child.createSpan({ cls: "tg-twisty tg-twisty-empty" });
      const cic = child.createSpan({ cls: "tg-tree-icon" });
      setIcon(cic, "hash");
      child.createSpan({ cls: "tg-tree-label", text: tag });
      child.createSpan({ cls: "tg-badge", text: String(count) });
      child.onclick = () => {
        this.state.selection = { type: "smart", tag, label: "#" + tag };
        this.choose();
      };
    }
  }

  private renderTreeNode(parent: HTMLElement, node: TreeNode, depth: number): void {
    const active = this.state.selection.type === "node" && this.state.selection.key === node.key;
    const hasChildren = node.children.some((c) => c.count > 0);
    const isCollapsed = this.state.collapsed.has(node.key);

    const row = parent.createDiv({ cls: "tg-tree-row" + (active ? " is-active" : "") });
    row.setCssStyles({ paddingLeft: 8 + depth * 14 + "px" });

    // Twisty (caret) toggles collapse without changing selection.
    const twisty = row.createSpan({ cls: "tg-twisty" });
    if (hasChildren) {
      setIcon(twisty, isCollapsed ? "chevron-right" : "chevron-down");
      twisty.onclick = (e) => {
        e.stopPropagation();
        if (isCollapsed) this.state.collapsed.delete(node.key);
        else this.state.collapsed.add(node.key);
        this.render();
      };
    } else {
      twisty.addClass("tg-twisty-empty");
    }

    const icon = node.kind === "root" || node.kind === "folder" ? "folder" : "file-text";
    const ic = row.createSpan({ cls: "tg-tree-icon" });
    setIcon(ic, icon);
    row.createSpan({ cls: "tg-tree-label", text: node.label });
    row.createSpan({ cls: "tg-badge", text: String(node.count) });
    row.onclick = () => {
      this.state.selection = { type: "node", key: node.key, label: node.label };
      this.choose();
    };

    if (isCollapsed) return;
    for (const child of node.children) {
      if (child.count === 0) continue;
      this.renderTreeNode(parent, child, depth + 1);
    }
  }

  private sideItem(
    parent: HTMLElement,
    icon: string,
    label: string,
    count: number,
    active: boolean,
    onClick: () => void,
    opts?: { alert?: boolean; showCount?: boolean }
  ): void {
    const row = parent.createDiv({
      cls: "tg-side-item" + (active ? " is-active" : "") + (opts?.alert ? " is-alert" : ""),
    });
    const ic = row.createSpan({ cls: "tg-tree-icon" });
    setIcon(ic, icon);
    row.createSpan({ cls: "tg-tree-label", text: label });
    if (count > 0 && opts?.showCount !== false)
      row.createSpan({ cls: "tg-badge", text: String(count) });
    row.onclick = onClick;
  }
}
