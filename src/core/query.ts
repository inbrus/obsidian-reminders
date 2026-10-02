// Query engine: pure filter/sort/group over TaskItem[]. No Obsidian runtime.
// Extracted from store.ts (filterByQuery) and view.ts (sortTasksBy/groupTasks),
// preserving behavior byte-for-byte (including the legacy UTC week-boundary in
// dueBucket, deferred to a later phase).

import { TaskItem, SortKey, GroupKey } from "./models";
import { localISODate } from "./date";
import { ALT_CHECKBOX_ICONS } from "./status-registry";

/** Free-text query: each whitespace-separated term must appear (case-insensitive). */
export function filterByQuery(tasks: TaskItem[], query: string): TaskItem[] {
  const q = query.trim().toLowerCase();
  if (!q) return tasks;
  const terms = q.split(/\s+/);
  return tasks.filter((t) => {
    const hay = [t.text, t.rawText, t.tags.join(" "), t.links.join(" "), t.bucketFile]
      .join(" ")
      .toLowerCase();
    return terms.every((term) => hay.includes(term));
  });
}

export function sortTasksBy(tasks: TaskItem[], key: SortKey, dir: "asc" | "desc" = "asc"): TaskItem[] {
  const byPrio = (a: TaskItem, b: TaskItem) => (a.priority || 99) - (b.priority || 99);
  const byText = (a: TaskItem, b: TaskItem) => a.text.localeCompare(b.text);
  const byDue = (a: TaskItem, b: TaskItem) => {
    const da = a.meta.due || "9999-99-99";
    const db = b.meta.due || "9999-99-99";
    return da === db ? 0 : da < db ? -1 : 1;
  };
  const byStart = (a: TaskItem, b: TaskItem) => {
    const da = a.meta.start || "9999-99-99";
    const db = b.meta.start || "9999-99-99";
    return da === db ? 0 : da < db ? -1 : 1;
  };
  const byCreated = (a: TaskItem, b: TaskItem) => {
    // Undated tasks sort last in ascending order (oldest-first puts the most
    // aged tasks at the top).
    const da = a.meta.created || "9999-99-99";
    const db = b.meta.created || "9999-99-99";
    return da === db ? 0 : da < db ? -1 : 1;
  };
  const byMtime = (a: TaskItem, b: TaskItem) => (a.mtime || 0) - (b.mtime || 0);
  const byCtime = (a: TaskItem, b: TaskItem) => (a.ctime || 0) - (b.ctime || 0);
  const byRef = (a: TaskItem, b: TaskItem) => refKey(a).localeCompare(refKey(b));

  const mult = dir === "desc" ? -1 : 1;
  return tasks.slice().sort((a, b) => {
    let c = 0;
    switch (key) {
      case "due":
        c = byDue(a, b) || byPrio(a, b) || byText(a, b);
        break;
      case "start":
        c = byStart(a, b) || byPrio(a, b) || byText(a, b);
        break;
      case "created":
        c = byCreated(a, b) || byPrio(a, b) || byText(a, b);
        break;
      case "mtime":
        c = byMtime(a, b) || byPrio(a, b) || byText(a, b);
        break;
      case "ctime":
        c = byCtime(a, b) || byPrio(a, b) || byText(a, b);
        break;
      case "reference":
        c = byRef(a, b) || byPrio(a, b) || byDue(a, b) || byText(a, b);
        break;
      case "title":
        c = byText(a, b);
        break;
      case "priority":
      default:
        c = byPrio(a, b) || byDue(a, b) || byText(a, b);
        break;
    }
    return c * mult;
  });
}

function refKey(t: TaskItem): string {
  return `${t.bucketRoot}: ${t.bucketFile}`;
}

// Group tasks (already sorted) into ordered buckets. The "none" equivalent
// (no priority / no due date) always sorts to the bottom.
export function groupTasks(
  tasks: TaskItem[],
  key: GroupKey
): { label: string; sort: number; tasks: TaskItem[] }[] {
  const groups = new Map<string, { label: string; sort: number; tasks: TaskItem[] }>();
  const push = (id: string, label: string, sort: number, t: TaskItem) => {
    let g = groups.get(id);
    if (!g) {
      g = { label, sort, tasks: [] };
      groups.set(id, g);
    }
    g.tasks.push(t);
  };

  for (const t of tasks) {
    if (key === "priority") {
      const p = t.priority;
      if (p === 0) push("z-none", "No priority", 999, t);
      else if (p >= 1 && p <= 3) push("p" + p, "P" + p, p, t);
      else push("p-low", "Low", 4, t);
    } else if (key === "due") {
      const bucket = dueBucket(t.meta.due);
      push(bucket.id, bucket.label, bucket.sort, t);
    } else if (key === "mtime" || key === "ctime") {
      const ms = key === "mtime" ? t.mtime : t.ctime;
      const b = timeBucket(ms);
      push(b.id, b.label, b.sort, t);
    } else if (key === "type") {
      const def = ALT_CHECKBOX_ICONS[t.statusChar];
      if (def) {
        const order = Object.keys(ALT_CHECKBOX_ICONS).indexOf(t.statusChar);
        push("type:" + t.statusChar, def.label, order, t);
      } else {
        push("type:unspecified", "Unspecified", 999, t);
      }
    } else {
      // reference
      const rk = refKey(t);
      push("ref:" + rk, rk, 0, t);
    }
  }

  const arr = Array.from(groups.values());
  arr.sort((a, b) => a.sort - b.sort || a.label.localeCompare(b.label));
  return arr;
}

function dueBucket(due?: string): { id: string; label: string; sort: number } {
  if (!due) return { id: "z-none", label: "No due date", sort: 999 };
  const today = localISODate(new Date());
  if (due < today) return { id: "overdue", label: "Overdue", sort: 0 };
  if (due === today) return { id: "today", label: "Today", sort: 1 };
  const week = new Date();
  week.setDate(week.getDate() + 7);
  const weekStr = week.toISOString().slice(0, 10);
  if (due <= weekStr) return { id: "week", label: "Next 7 days", sort: 2 };
  return { id: "later", label: "Later", sort: 3 };
}

function timeBucket(ms: number): { id: string; label: string; sort: number } {
  if (!ms) return { id: "z-none", label: "Unknown", sort: 999 };
  const d = new Date(ms);
  const now = new Date();
  const dayStart = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diffDays = Math.floor((dayStart(now) - dayStart(d)) / 864e5);
  if (diffDays <= 0) return { id: "today", label: "Today", sort: 0 };
  if (diffDays === 1) return { id: "yesterday", label: "Yesterday", sort: 1 };
  if (diffDays <= 7) return { id: "week", label: "This week", sort: 2 };
  if (diffDays <= 30) return { id: "month", label: "This month", sort: 3 };
  return { id: "older", label: "Older", sort: 4 };
}
