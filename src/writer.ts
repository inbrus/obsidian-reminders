import { App, TFile, normalizePath } from "obsidian";
import { TaskItem } from "./types";
import { TaskgregatorSettings } from "./settings";
import { statusFromChar } from "./parser";
import { wikilink, wikilinkAfter, stripDateAfter } from "./dateFormat";
import {
  sidecarPathFor,
  findSidecarFile,
  cleanTitleForFile,
  stripTagsFromTitle,
  toDDMMYYYY,
  yamlEscape,
} from "./sidecar";
import {
  DV_KEYS,
  NUM_TO_DV_PRIORITY,
  TaskFormat,
  hasDataviewField,
  stripDvField,
} from "./dataview";
import { getTasksPluginFormat } from "./tasksInterop";

export const EMOJI_DUE = "📅";
export const EMOJI_START = "🛫";
const EMOJI_DONE = "✅";
const EMOJI_CANCELLED = "❌";
// Tasks-plugin priority signifiers, highest first. Index 0 => level 1.
const PRIORITY_EMOJI_HIGH = "⏫";
const PRIORITY_EMOJI_LOW = "⏬";
const PRIORITY_EMOJI = ["🔺", PRIORITY_EMOJI_HIGH, "🔼"];
const ALL_PRIORITY_EMOJI = ["🔺", PRIORITY_EMOJI_HIGH, "🔼", "🔽", PRIORITY_EMOJI_LOW];
// Emoji signifiers used to detect whether a line already uses the emoji format.
const DETECT_EMOJI = ["📅", "🛫", "⏳", "➕", "✅", "❌", "🔁", ...ALL_PRIORITY_EMOJI];
const CHECKBOX_RE = /^(\s*[-*+]\s+\[)(.)(\])/;

/**
 * Decide which format to use when editing a specific line. A line that already
 * carries emoji signifiers stays emoji; a line that already carries Dataview
 * fields stays Dataview; a line with no recognized metadata uses `fallback`
 * (the user's configured / Tasks-plugin default). This keeps every existing
 * line in its original style and never mixes the two.
 */
export function formatForLine(line: string, fallback: TaskFormat): TaskFormat {
  if (DETECT_EMOJI.some((e) => line.includes(e))) return "emoji";
  if (hasDataviewField(line)) return "dataview";
  return fallback;
}

/** Append/replace a Dataview date field, preserving a trailing block id. */
function setDvDateField(line: string, key: string, date: string | null): string {
  const stripped = stripDvField(line, key);
  if (!date) return stripped;
  return appendSignifier(stripped, `[${key}:: ${wikilink(date)}]`);
}

export function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

export function isTaskLine(line: string): boolean {
  return CHECKBOX_RE.test(line);
}

export function generateBlockId(): string {
  return "tg" + Date.now().toString(36) + Math.floor(Math.random() * 1296).toString(36);
}

export function blockIdOf(line: string): string | undefined {
  const m = line.match(/\s\^([A-Za-z0-9-]+)\s*$/);
  return m ? m[1] : undefined;
}

/** Append a signifier before a trailing block id, keeping ^id last. */
export function appendSignifier(line: string, sig: string): string {
  const m = line.match(/^(.*?)(\s\^[A-Za-z0-9-]+)\s*$/);
  if (m) {
    return `${m[1].trimEnd()} ${sig}${m[2]}`;
  }
  return `${line.trimEnd()} ${sig}`;
}

function setDateSignifier(line: string, emoji: string, date: string | null): string {
  const stripped = stripDateAfter(line, emoji);
  if (!date) return stripped;
  return appendSignifier(stripped, wikilinkAfter(emoji, date));
}

// --- Pure line transforms (usable on raw strings, editor lines, or via vault) ---

export function applyStatusToLine(
  line: string,
  statusChar: string,
  format: TaskFormat = "emoji"
): string {
  let out = line.replace(CHECKBOX_RE, `$1${statusChar}$3`);
  const status = statusFromChar(statusChar);
  // Clear any existing done/cancelled dates in BOTH formats, then re-add in the
  // target format so a status change never leaves a stale/duplicate date.
  out = stripDateAfter(out, EMOJI_DONE);
  out = stripDateAfter(out, EMOJI_CANCELLED);
  out = stripDvField(out, DV_KEYS.completion);
  out = stripDvField(out, DV_KEYS.cancelled);
  if (status === "done") {
    out =
      format === "dataview"
        ? appendSignifier(out, `[${DV_KEYS.completion}:: ${wikilink(todayStr())}]`)
        : appendSignifier(out, `${EMOJI_DONE} ${wikilink(todayStr())}`);
  }
  if (status === "cancelled") {
    out =
      format === "dataview"
        ? appendSignifier(out, `[${DV_KEYS.cancelled}:: ${wikilink(todayStr())}]`)
        : appendSignifier(out, `${EMOJI_CANCELLED} ${wikilink(todayStr())}`);
  }
  return out;
}

export function applyPriorityToLine(
  line: string,
  priority: number,
  priorityTags: string[],
  format: TaskFormat = "emoji"
): string {
  let out = line;
  for (const tag of priorityTags) {
    out = out.replace(new RegExp(`(?:^|\\s)#${tag}\\b`, "g"), "");
  }
  // Clear priority in both formats before re-applying.
  for (const em of ALL_PRIORITY_EMOJI) out = out.split(em).join("");
  out = stripDvField(out, DV_KEYS.priority);
  out = out.replace(/\s{2,}/g, " ").trimEnd();
  if (priority < 1) return out;
  if (format === "dataview") {
    const word = NUM_TO_DV_PRIORITY[priority];
    if (word) out = appendSignifier(out, `[${DV_KEYS.priority}:: ${word}]`);
  } else if (priority <= PRIORITY_EMOJI.length) {
    out = appendSignifier(out, PRIORITY_EMOJI[priority - 1]);
  }
  return out;
}

export function applyDueToLine(
  line: string,
  date: string | null,
  format: TaskFormat = "emoji"
): string {
  return format === "dataview"
    ? setDvDateField(line, DV_KEYS.due, date)
    : setDateSignifier(line, EMOJI_DUE, date);
}

export function applyStartToLine(
  line: string,
  date: string | null,
  format: TaskFormat = "emoji"
): string {
  return format === "dataview"
    ? setDvDateField(line, DV_KEYS.start, date)
    : setDateSignifier(line, EMOJI_START, date);
}

export function toggleTagInLine(line: string, tag: string): string {
  const bare = tag.replace(/^#/, "");
  const re = new RegExp(`(?:^|\\s)#${bare}\\b`);
  if (re.test(line)) {
    return line.replace(re, "").replace(/\s{2,}/g, " ").trimEnd();
  }
  return appendSignifier(line, `#${bare}`);
}

export function ensureBlockIdInLine(line: string): { line: string; blockId: string } {
  const existing = blockIdOf(line);
  if (existing) return { line, blockId: existing };
  const id = generateBlockId();
  return { line: line.trimEnd() + " ^" + id, blockId: id };
}

/** Locate the exact line index for a task, resilient to small shifts. */
function findLine(lines: string[], task: TaskItem): number {
  if (task.blockId) {
    const needle = "^" + task.blockId;
    const idx = lines.findIndex((l) => l.trimEnd().endsWith(needle));
    if (idx >= 0) return idx;
  }
  if (lines[task.line] === task.rawText) return task.line;
  const byRaw = lines.findIndex((l) => l === task.rawText);
  if (byRaw >= 0) return byRaw;
  const bodyIdx = lines.findIndex((l) => l.includes(task.text) && /\[.\]/.test(l));
  return bodyIdx;
}

export class TaskWriter {
  app: App;
  settings: TaskgregatorSettings;

  constructor(app: App, settings: TaskgregatorSettings) {
    this.app = app;
    this.settings = settings;
  }

  private async editLine(
    task: TaskItem,
    transform: (line: string) => string
  ): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(task.filePath);
    if (!(file instanceof TFile)) return;
    await this.app.vault.process(file, (data) => {
      const lines = data.split("\n");
      const idx = findLine(lines, task);
      if (idx < 0) return data;
      lines[idx] = transform(lines[idx]);
      return lines.join("\n");
    });
  }

  /**
   * Resolve the fallback format for lines that carry no metadata yet, from the
   * user's `taskFormat` setting. "auto" defers to the Tasks plugin's configured
   * format when available, otherwise emoji (Taskgregator's historical default).
   */
  async resolveDefaultFormat(): Promise<TaskFormat> {
    const pref = this.settings.taskFormat;
    if (pref === "emoji" || pref === "dataview") return pref;
    return (await getTasksPluginFormat(this.app)) ?? "emoji";
  }

  async setStatus(task: TaskItem, statusChar: string): Promise<void> {
    const def = await this.resolveDefaultFormat();
    await this.editLine(task, (line) =>
      applyStatusToLine(line, statusChar, formatForLine(line, def))
    );
  }

  async toggleDone(task: TaskItem): Promise<void> {
    const next = task.status === "done" ? " " : "x";
    await this.setStatus(task, next);
  }

  async setDue(task: TaskItem, date: string | null): Promise<void> {
    const def = await this.resolveDefaultFormat();
    await this.editLine(task, (line) =>
      applyDueToLine(line, date, formatForLine(line, def))
    );
  }

  async setStart(task: TaskItem, date: string | null): Promise<void> {
    const def = await this.resolveDefaultFormat();
    await this.editLine(task, (line) =>
      applyStartToLine(line, date, formatForLine(line, def))
    );
  }

  async setPriority(task: TaskItem, priority: number): Promise<void> {
    const def = await this.resolveDefaultFormat();
    await this.editLine(task, (line) =>
      applyPriorityToLine(line, priority, this.settings.priorityTags, formatForLine(line, def))
    );
  }

  async toggleTag(task: TaskItem, tag: string): Promise<void> {
    await this.editLine(task, (line) => toggleTagInLine(line, tag));
  }

  /** Replace the task's body text, preserving the checkbox and trailing suffix. */
  async setText(task: TaskItem, text: string): Promise<void> {
    await this.editLine(task, (line) => {
      const m = line.match(/^(\s*[-*+]\s+\[.\] \s?)(.*)$/);
      if (!m) return line;
      return m[1] + text + (task.suffix ? " " + task.suffix : "");
    });
  }

  /** Ensure the task line carries a block id; returns the block id. */
  async ensureBlockId(task: TaskItem): Promise<string> {
    if (task.blockId) return task.blockId;
    const id = generateBlockId();
    await this.editLine(task, (line) => {
      if (blockIdOf(line)) return line;
      return line.trimEnd() + " ^" + id;
    });
    task.blockId = id;
    task.hasBlockId = true;
    task.id = `${task.filePath}#^${id}`;
    return id;
  }

  /** Ensure a sidecar detail note exists and return its path. */
  async ensureSidecar(task: TaskItem): Promise<string> {
    const blockId = await this.ensureBlockId(task);
    const path = await this.ensureSidecarFor(blockId, task.text, task.filePath, task);
    task.sidecarPath = path;
    return path;
  }

  /** Create (if missing) a sidecar for a known block id + source, return its path. */
  async ensureSidecarFor(
    blockId: string,
    title: string,
    sourcePath: string,
    task?: TaskItem
  ): Promise<string> {
    const existing = findSidecarFile(this.app, this.settings, blockId);
    if (existing) return existing.path;
    const folder = normalizePath(this.settings.sidecarFolder);
    await this.ensureFolder(folder);
    const titleClean = stripTagsFromTitle(title, task?.tags);
    const fileName = cleanTitleForFile(title, task?.tags);
    const path = sidecarPathFor(this.settings, fileName, blockId);
    const link = `${sourcePath.replace(/\.md$/i, "")}#^${blockId}`;
    const date = toDDMMYYYY(todayStr());
    const priorityHex = ["", "#e5484d", "#f5a623", "#4c9aff"][task?.priority || 0] || "";
    const statusBool = task?.status === "done" ? "true" : "false";
    const tagsBlock = (task?.tags || []).map((t) => `  - "#${t}"`).join("\n");
    const body =
      `---\n` +
      `blockId: ${blockId}\n` +
      `related:\n` +
      `  - "[[Folders/Pages/Taskgregator|Taskgregator]]"\n` +
      `date: "[[${date}]]"\n` +
      `type: "[[Task]]"\n` +
      `task-project:\n` +
      `source-task: "[[${link}|Source →]]"\n` +
      `title-task: "${yamlEscape(titleClean)}"\n` +
      `priority-task:${priorityHex ? ` "${priorityHex}"` : ""}\n` +
      `tags:\n` +
      `${tagsBlock}\n` +
      `status-task: ${statusBool}\n` +
      `---\n\n` +
      `# ${titleClean}\n`;
    await this.app.vault.create(path, body);
    return path;
  }

  async openSidecar(task: TaskItem): Promise<void> {
    const path = await this.ensureSidecar(task);
    await this.openPath(path);
  }

  async openPath(path: string): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(path);
    if (file instanceof TFile) {
      await this.app.workspace.getLeaf(true).openFile(file);
    }
  }

  private async ensureFolder(folder: string): Promise<void> {
    const parts = folder.split("/");
    let cur = "";
    for (const p of parts) {
      cur = cur ? `${cur}/${p}` : p;
      if (!this.app.vault.getAbstractFileByPath(cur)) {
        try {
          await this.app.vault.createFolder(cur);
        } catch {
          // Already exists / race; ignore.
        }
      }
    }
  }
}
