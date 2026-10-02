// TaskStore: in-memory index of tasks. Stateful; depends on the ports (vault
// scanner, link resolver, clock) and settings — never on Obsidian directly.
// Pure filtering/sorting/grouping and context-tree building live in
// core/query.ts and core/context.ts.

import { TaskItem, TreeNode } from "./types";
import { TaskgregatorSettings } from "./settings";
import { VaultScanner } from "./services/scanner";
import { ILinkResolver } from "./ports/link-resolver";
import { IClock } from "./ports/clock";
import { filterByQuery as filterTasks } from "./core/query";
import { buildContextTree } from "./core/context";

export class TaskStore {
  tasks: Map<string, TaskItem> = new Map();

  constructor(
    private scanner: VaultScanner,
    private linkResolver: ILinkResolver,
    private clock: IClock,
    readonly settings: TaskgregatorSettings
  ) {}

  async rebuild(): Promise<void> {
    const all = await this.scanner.scan();
    this.tasks.clear();
    for (const t of all) this.tasks.set(t.id, t);
  }

  /** Resolve a wikilink target to a vault path (delegates to the link resolver). */
  resolveLink(link: string, fromPath: string): string | undefined {
    return this.linkResolver.resolve(link, fromPath);
  }

  all(): TaskItem[] {
    return Array.from(this.tasks.values());
  }

  /** Open (actionable) tasks. Completed tasks live in the dedicated Completed hub. */
  visible(): TaskItem[] {
    return this.all().filter((t) => t.status === "open" || t.status === "inProgress");
  }

  /** Completed (done) tasks, shown only in the Completed hub. */
  completed(): TaskItem[] {
    return this.all().filter((t) => t.status === "done");
  }

  /** In-progress tasks. */
  inProgress(): TaskItem[] {
    return this.all().filter((t) => t.status === "inProgress");
  }

  byId(id: string): TaskItem | undefined {
    return this.tasks.get(id);
  }

  /** Delegate free-text filtering to the pure query engine. */
  filterByQuery(tasks: TaskItem[], query: string): TaskItem[] {
    return filterTasks(tasks, query);
  }

  /**
   * Build the context tree, resolving wikilinks through the injected resolver.
   * The tree-building itself is pure (core/context.ts).
   */
  buildContextTree(): TreeNode[] {
    return buildContextTree(
      this.visible(),
      { bucketRoots: this.settings.bucketRoots, inboxRoots: this.settings.inboxRoots },
      (link, fromPath) => this.linkResolver.resolve(link, fromPath)
    );
  }

  /** Tasks that reference a given file/person by wikilink (cross-index). */
  tasksLinking(nameOrPath: string): TaskItem[] {
    const target = nameOrPath.split("/").pop() || nameOrPath;
    return this.visible().filter((t) =>
      t.links.some((l) => l === nameOrPath || (l.split("/").pop() || l) === target)
    );
  }

  /** Tasks for a context-tree node key. */
  tasksForNode(node: TreeNode): TaskItem[] {
    const ids = new Set<string>(node.taskIds);
    const collect = (n: TreeNode) => {
      n.taskIds.forEach((id) => ids.add(id));
      n.children.forEach(collect);
    };
    collect(node);
    return Array.from(ids)
      .map((id) => this.tasks.get(id))
      .filter((t): t is TaskItem => !!t);
  }

  /** Tasks carrying a given tag (smart list). */
  tasksWithTag(tag: string): TaskItem[] {
    return this.visible().filter((t) => t.tags.includes(tag));
  }

  /** Visible tasks that carry at least one tag (the "All Tags" rollup). */
  taggedTasks(): TaskItem[] {
    return this.visible().filter((t) => t.tags.length > 0);
  }

  /** Visible tasks with no tags at all (the Inbox list). */
  untagged(): TaskItem[] {
    return this.visible().filter((t) => t.tags.length === 0);
  }

  /** Distinct tags in use with their open-task counts, sorted alphabetically. */
  tagCounts(): { tag: string; count: number }[] {
    const counts = new Map<string, number>();
    for (const t of this.visible()) {
      for (const tag of new Set(t.tags)) counts.set(tag, (counts.get(tag) || 0) + 1);
    }
    return Array.from(counts.entries())
      .map(([tag, count]) => ({ tag, count }))
      .sort((a, b) => a.tag.localeCompare(b.tag, "en"));
  }

  /** Tasks due before today (Overdue smart list core). */
  overdue(): TaskItem[] {
    const today = this.clock.todayIso();
    return this.visible().filter((t) => t.meta.due && t.meta.due < today);
  }

  /** Tasks due exactly today (Today smart list core). */
  dueToday(): TaskItem[] {
    const today = this.clock.todayIso();
    return this.visible().filter((t) => t.meta.due === today);
  }

  /** Tasks due tomorrow. */
  dueTomorrow(): TaskItem[] {
    const tomorrow = this.clock.offsetDays(1);
    return this.visible().filter((t) => t.meta.due === tomorrow);
  }

  /** Tasks due within the next `soonDays` days (after today, through today+N). */
  dueSoon(): TaskItem[] {
    const today = this.clock.todayIso();
    const end = this.clock.offsetDays(Math.max(1, this.settings.soonDays));
    return this.visible().filter((t) => t.meta.due && t.meta.due > today && t.meta.due <= end);
  }

  /**
   * Aging tasks: still-open tasks whose created date is `agingDays` days ago or
   * older (i.e. they've been sitting around). Tasks with no created date are
   * excluded since we can't tell how old they are. Reads created from either
   * the ➕ emoji or the [created:: …] Dataview field (handled by the parser).
   */
  aging(): TaskItem[] {
    const cutoff = this.clock.offsetDays(-Math.max(1, this.settings.agingDays));
    return this.visible().filter((t) => t.meta.created && t.meta.created <= cutoff);
  }

  counts() {
    const v = this.visible();
    return {
      total: v.length,
      overdue: this.overdue().length,
      today: this.dueToday().length,
      tomorrow: this.dueTomorrow().length,
      soon: this.dueSoon().length,
      inbox: this.untagged().length,
      inprogress: this.inProgress().length,
      completed: this.completed().length,
      flagged: v.filter((t) => t.priority > 0 && t.priority <= 2).length,
    };
  }
}
