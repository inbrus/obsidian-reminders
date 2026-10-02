// TaskStore: in-memory index of tasks with inverted indexes for O(1) slices.
// Stateful; depends on the ports (scanner, link resolver, clock) and settings —
// never on Obsidian directly. applyFile/removeFile give incremental updates;
// rebuild() is the full rescan (startup / Reindex / scope change). Pure
// filtering/sorting/grouping and context-tree building live in core/query.ts
// and core/context.ts.

import { TaskItem, TaskStatus, TreeNode } from "./types";
import { TaskgregatorSettings } from "./settings";
import { VaultScanner } from "./services/scanner";
import { ILinkResolver } from "./ports/link-resolver";
import { IClock } from "./ports/clock";
import { filterByQuery as filterTasks } from "./core/query";
import { buildContextTree } from "./core/context";
import { IndexSnapshot, INDEX_SCHEMA_VERSION } from "./services/index-persistence";

function addIndex<K>(map: Map<K, Set<string>>, key: K, id: string): void {
  let s = map.get(key);
  if (!s) map.set(key, (s = new Set()));
  s.add(id);
}

function removeIndex<K>(map: Map<K, Set<string>>, key: K, id: string): void {
  const s = map.get(key);
  if (!s) return;
  s.delete(id);
  if (s.size === 0) map.delete(key);
}

export class TaskStore {
  tasks: Map<string, TaskItem> = new Map();
  private byFile = new Map<string, Set<string>>();
  private byTag = new Map<string, Set<string>>();
  private byLink = new Map<string, Set<string>>();
  private byDue = new Map<string, Set<string>>();
  private byStatus = new Map<TaskStatus, Set<string>>();
  private byBlockIdIndex = new Map<string, string>();

  constructor(
    private scanner: VaultScanner,
    private linkResolver: ILinkResolver,
    private clock: IClock,
    readonly settings: TaskgregatorSettings
  ) {}

  // --- index maintenance ---

  private indexOne(t: TaskItem): void {
    this.tasks.set(t.id, t);
    addIndex(this.byFile, t.filePath, t.id);
    for (const tag of t.tags) addIndex(this.byTag, tag, t.id);
    for (const l of t.links) addIndex(this.byLink, l, t.id);
    if (t.meta.due) addIndex(this.byDue, t.meta.due, t.id);
    addIndex(this.byStatus, t.status, t.id);
    if (t.blockId) this.byBlockIdIndex.set(t.blockId, t.id);
  }

  private unindexOne(t: TaskItem): void {
    this.tasks.delete(t.id);
    removeIndex(this.byFile, t.filePath, t.id);
    for (const tag of t.tags) removeIndex(this.byTag, tag, t.id);
    for (const l of t.links) removeIndex(this.byLink, l, t.id);
    if (t.meta.due) removeIndex(this.byDue, t.meta.due, t.id);
    removeIndex(this.byStatus, t.status, t.id);
    if (t.blockId) this.byBlockIdIndex.delete(t.blockId);
  }

  private clearIndexes(): void {
    this.tasks.clear();
    this.byFile.clear();
    this.byTag.clear();
    this.byLink.clear();
    this.byDue.clear();
    this.byStatus.clear();
    this.byBlockIdIndex.clear();
  }

  /**
   * Full (re)scan: startup, Reindex command, or a scope/settings change. When a
   * prior cache snapshot is provided, files whose mtime is unchanged are
   * restored from the cache instead of being re-read from disk.
   */
  async rebuild(cache?: IndexSnapshot): Promise<void> {
    const files = await this.scanner.listFiles();
    this.clearIndexes();
    for (const f of files) {
      const cached = cache?.files[f.path];
      if (cached && cached.mtime === f.mtime) {
        for (const t of cached.tasks) this.indexOne(t);
      } else {
        const tasks = await this.scanner.scanFile(f.path);
        for (const t of tasks) this.indexOne(t);
      }
    }
  }

  /** Serialize the current index into a cache snapshot for IndexPersistence. */
  buildSnapshot(): IndexSnapshot {
    const files: Record<string, { mtime: number; tasks: TaskItem[] }> = {};
    for (const [path, ids] of this.byFile) {
      let mtime = 0;
      const tasks: TaskItem[] = [];
      for (const id of ids) {
        const t = this.tasks.get(id);
        if (!t) continue;
        tasks.push(t);
        if (t.mtime > mtime) mtime = t.mtime;
      }
      files[path] = { mtime, tasks };
    }
    return { schemaVersion: INDEX_SCHEMA_VERSION, files, builtAt: Date.now() };
  }

  /** Incrementally re-read one file and replace its tasks in the index. */
  async applyFile(path: string): Promise<void> {
    const oldIds = this.byFile.get(path);
    if (oldIds) {
      for (const id of Array.from(oldIds)) {
        const t = this.tasks.get(id);
        if (t) this.unindexOne(t);
      }
    }
    const fresh = await this.scanner.scanFile(path);
    for (const t of fresh) this.indexOne(t);
  }

  /** Drop every task belonging to a deleted or renamed file. */
  removeFile(path: string): void {
    const oldIds = this.byFile.get(path);
    if (!oldIds) return;
    for (const id of Array.from(oldIds)) {
      const t = this.tasks.get(id);
      if (t) this.unindexOne(t);
    }
  }

  // --- lookups ---

  /** Resolve a wikilink target to a vault path (delegates to the link resolver). */
  resolveLink(link: string, fromPath: string): string | undefined {
    return this.linkResolver.resolve(link, fromPath);
  }

  all(): TaskItem[] {
    return Array.from(this.tasks.values());
  }

  byId(id: string): TaskItem | undefined {
    return this.tasks.get(id);
  }

  /** Find a task by its block id (without caret). */
  byBlockId(blockId: string): TaskItem | undefined {
    const id = this.byBlockIdIndex.get(blockId);
    return id ? this.tasks.get(id) : undefined;
  }

  private fromIndex<K>(map: Map<K, Set<string>>, key: K): TaskItem[] {
    const ids = map.get(key);
    if (!ids) return [];
    return Array.from(ids)
      .map((id) => this.tasks.get(id))
      .filter((t): t is TaskItem => !!t);
  }

  /** Open (actionable) tasks. Completed tasks live in the dedicated Completed hub. */
  visible(): TaskItem[] {
    return this.all().filter((t) => t.status === "open" || t.status === "inProgress");
  }

  /** Completed (done) tasks, shown only in the Completed hub. */
  completed(): TaskItem[] {
    return this.fromIndex(this.byStatus, "done");
  }

  /** In-progress tasks. */
  inProgress(): TaskItem[] {
    return this.fromIndex(this.byStatus, "inProgress");
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
    const out: TaskItem[] = [];
    const seen = new Set<string>();
    for (const [link, ids] of this.byLink) {
      const linkName = link.split("/").pop() || link;
      if (link !== nameOrPath && linkName !== target) continue;
      for (const id of ids) {
        if (seen.has(id)) continue;
        seen.add(id);
        const t = this.tasks.get(id);
        if (t && (t.status === "open" || t.status === "inProgress")) out.push(t);
      }
    }
    return out;
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
    return this.fromIndex(this.byTag, tag).filter(
      (t) => t.status === "open" || t.status === "inProgress"
    );
  }

  /** Visible tasks that carry at least one tag (the "All Tags" rollup). */
  taggedTasks(): TaskItem[] {
    const ids = new Set<string>();
    for (const [, s] of this.byTag) for (const id of s) ids.add(id);
    return Array.from(ids)
      .map((id) => this.tasks.get(id))
      .filter(
        (t): t is TaskItem => !!t && (t.status === "open" || t.status === "inProgress")
      );
  }

  /** Visible tasks with no tags at all (the Inbox list). */
  untagged(): TaskItem[] {
    return this.visible().filter((t) => t.tags.length === 0);
  }

  /** Distinct tags in use with their open-task counts, sorted alphabetically. */
  tagCounts(): { tag: string; count: number }[] {
    const counts: { tag: string; count: number }[] = [];
    for (const [tag, ids] of this.byTag) {
      let n = 0;
      for (const id of ids) {
        const t = this.tasks.get(id);
        if (t && (t.status === "open" || t.status === "inProgress")) n++;
      }
      if (n > 0) counts.push({ tag, count: n });
    }
    return counts.sort((a, b) => a.tag.localeCompare(b.tag, "en"));
  }

  // --- due slices (local calendar) ---

  /** Tasks due before today (Overdue smart list core). */
  overdue(): TaskItem[] {
    return this.dueBefore(this.clock.todayIso());
  }

  /** Tasks due exactly today (Today smart list core). */
  dueToday(): TaskItem[] {
    return this.fromIndex(this.byDue, this.clock.todayIso()).filter(
      (t) => t.status === "open" || t.status === "inProgress"
    );
  }

  /** Tasks due tomorrow. */
  dueTomorrow(): TaskItem[] {
    return this.fromIndex(this.byDue, this.clock.offsetDays(1)).filter(
      (t) => t.status === "open" || t.status === "inProgress"
    );
  }

  /** Tasks due within the next `soonDays` days (after today, through today+N). */
  dueSoon(): TaskItem[] {
    const today = this.clock.todayIso();
    const end = this.clock.offsetDays(Math.max(1, this.settings.soonDays));
    return this.dueBetween(today, end);
  }

  private dueBefore(date: string): TaskItem[] {
    const out: TaskItem[] = [];
    for (const [due, ids] of this.byDue) {
      if (due >= date) continue;
      for (const id of ids) {
        const t = this.tasks.get(id);
        if (t && (t.status === "open" || t.status === "inProgress")) out.push(t);
      }
    }
    return out;
  }

  private dueBetween(after: string, end: string): TaskItem[] {
    const out: TaskItem[] = [];
    for (const [due, ids] of this.byDue) {
      if (due <= after || due > end) continue;
      for (const id of ids) {
        const t = this.tasks.get(id);
        if (t && (t.status === "open" || t.status === "inProgress")) out.push(t);
      }
    }
    return out;
  }

  /**
   * Aging tasks: still-open tasks whose created date is `agingDays` days ago or
   * older. Reads created from the ➕ emoji or the [created:: …] Dataview field.
   */
  aging(): TaskItem[] {
    const cutoff = this.clock.offsetDays(-Math.max(1, this.settings.agingDays));
    return this.visible().filter((t) => t.meta.created && t.meta.created <= cutoff);
  }

  /** Single-pass counts over the open/in-progress set (plus completed size). */
  counts() {
    const today = this.clock.todayIso();
    const tomorrow = this.clock.offsetDays(1);
    const soonEnd = this.clock.offsetDays(Math.max(1, this.settings.soonDays));
    const c = {
      total: 0,
      overdue: 0,
      today: 0,
      tomorrow: 0,
      soon: 0,
      inbox: 0,
      inprogress: 0,
      completed: 0,
      flagged: 0,
    };
    const seen = new Set<string>();
    for (const ids of [this.byStatus.get("open"), this.byStatus.get("inProgress")]) {
      if (!ids) continue;
      for (const id of ids) {
        if (seen.has(id)) continue;
        seen.add(id);
        const t = this.tasks.get(id);
        if (!t) continue;
        c.total++;
        const due = t.meta.due;
        if (due && due < today) c.overdue++;
        if (due === today) c.today++;
        if (due === tomorrow) c.tomorrow++;
        if (due && due > today && due <= soonEnd) c.soon++;
        if (t.tags.length === 0) c.inbox++;
        if (t.status === "inProgress") c.inprogress++;
        if (t.priority > 0 && t.priority <= 2) c.flagged++;
      }
    }
    c.completed = this.byStatus.get("done")?.size ?? 0;
    return c;
  }
}
