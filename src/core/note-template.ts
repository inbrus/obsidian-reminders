// Pure helpers for typed project/task/subtask notes (the "New project / task /
// subtask" flow). No Obsidian runtime. Each note carries a small typed
// frontmatter (type/related/date/prio/status/due-date) meant for Bases
// Kanban/View filtering and Better Properties (prio renders as a rating).

export type NoteKind = "project" | "task" | "subtask";

export const NOTE_KINDS: NoteKind[] = ["project", "task", "subtask"];

export const NOTE_STATUSES = ["backlog", "active", "done"] as const;
export type NoteStatus = (typeof NOTE_STATUSES)[number];

/** Human label for a kind (used in filenames and menu titles). */
export function noteKindLabel(kind: NoteKind): string {
  if (kind === "project") return "Project";
  if (kind === "task") return "Task";
  return "Subtask";
}

/** Icon name for a kind (used in menu items). */
export function noteKindIcon(kind: NoteKind): string {
  if (kind === "project") return "folder";
  if (kind === "task") return "check-square";
  return "corner-down-right";
}

/** Filename for a typed note: "<title> – <Kind> <blockId>.md". */
export function noteFilename(kind: NoteKind, cleanTitle: string, blockId: string): string {
  return `${cleanTitle} – ${noteKindLabel(kind)} ${blockId}.md`;
}

export interface NoteVars {
  type: NoteKind;
  title: string; // cleaned task title
  related: string; // wikilink to parent (or "" for project)
  date: string; // DD-MM-YYYY (today)
  dueDate: string; // DD-MM-YYYY or ""
  prio: number; // 1..5 rating
  status: NoteStatus;
}

/** Built-in frontmatter + heading for a typed note (the default template). */
export function noteFrontmatter(v: NoteVars): string {
  const related = v.related ? `related: "${v.related}"\n` : `related: ""\n`;
  const due = v.dueDate ? `due-date: "[[${v.dueDate}]]"\n` : `due-date: ""\n`;
  return (
    `---\n` +
    `type: ${v.type}\n` +
    related +
    `date: "[[${v.date}]]"\n` +
    `prio: ${v.prio}\n` +
    `status: ${v.status}\n` +
    due +
    `---\n\n` +
    `# ${v.title}\n`
  );
}

/** Placeholder map exposed to user templates via {{name}}. */
export function noteTemplateVars(v: NoteVars): Record<string, string> {
  return {
    title: v.title,
    type: v.type,
    related: v.related,
    date: v.date,
    "due-date": v.dueDate,
    prio: String(v.prio),
    status: v.status,
  };
}

/** Replace {{name}} placeholders in a template string (unknown ones stay as-is). */
export function substituteNoteVars(
  template: string,
  vars: Record<string, string>
): string {
  return template.replace(/\{\{\s*([\w-]+)\s*\}\}/g, (whole, name: string) =>
    name in vars ? vars[name] : whole
  );
}
