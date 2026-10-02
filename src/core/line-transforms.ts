// Pure line transforms: rewrite a task line for a status/priority/date/tag
// change. No Obsidian runtime — these operate on raw strings and are the
// "how to change the line" logic that TaskWriter (src/writer.ts) applies via
// vault.process.

import { TaskItem } from "./models";
import { statusFromChar } from "./status-registry";
import { wikilink, wikilinkAfter, stripDateAfter, localISODate } from "./date";
import {
  DV_KEYS,
  NUM_TO_DV_PRIORITY,
  TaskFormat,
  hasDataviewField,
  stripDvField,
} from "./metadata-codec";

export const EMOJI_DUE = "📅";
export const EMOJI_START = "🛫";
const EMOJI_DONE = "✅";
const EMOJI_CANCELLED = "❌";
// Tasks-plugin priority signifiers, highest first. Index 0 => level 1.
const PRIORITY_EMOJI_HIGH = "⏫";
const PRIORITY_EMOJI_LOW = "⏬";
const PRIORITY_EMOJI = ["🔺", PRIORITY_EMOJI_HIGH, "🔼", "↔️", "🔽", PRIORITY_EMOJI_LOW];
const ALL_PRIORITY_EMOJI = ["🔺", PRIORITY_EMOJI_HIGH, "🔼", "↔️", "🔽", PRIORITY_EMOJI_LOW];
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
  return localISODate(new Date());
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
export function findLine(lines: string[], task: TaskItem): number {
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
