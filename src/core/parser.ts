// Pure task-line parsing. No Obsidian runtime — parseLine takes a plain
// ParserConfig (priorityTags + bucket/inbox roots) instead of the full
// settings object, so this module can be unit-tested in isolation.
//
// Vault scanning (scanVault / scanFile) stays in src/parser.ts because it walks
// TFile/TFolder trees; only the pure line→TaskItem logic lives here.

import { RawTaskMeta, TaskItem } from "./models";
import { statusFromChar } from "./status-registry";
import { findDateAfter } from "./date";
import {
  DV_KEYS,
  readDvDate,
  readDvField,
  readDvPriority,
  stripDataviewFields,
} from "./metadata-codec";
import { taskIdFor } from "./identity";

const TASK_RE = /^(\s*)[-*+]\s+\[(.)\]\s?(.*)$/;

const EMOJI = {
  due: "📅",
  start: "🛫",
  scheduled: "⏳",
  created: "➕",
  done: "✅",
  cancelled: "❌",
  recurrence: "🔁",
};

const PRIORITY_EMOJI: Record<string, number> = {
  "🔺": 1, // highest
  "⏫": 2, // high
  "🔼": 3, // medium
  "↔️": 4, // normal
  "🔽": 5, // low
  "⏬": 6, // lowest
};

const DATE = "(\\d{4}-\\d{2}-\\d{2})";
const BLOCKID_RE = /\s\^([A-Za-z0-9-]+)\s*$/;
const WIKILINK_RE = /\[\[([^\]]+?)\]\]/g;
const TAG_RE = /(?:^|\s)#([A-Za-z][\w\-/]*)/g;

/** The settings slice parseLine / deriveBucket / nodeKeyForFile need. */
export interface ParserConfig {
  priorityTags: string[];
  bucketRoots: string[];
  inboxRoots: string[];
  ignorePaths: string[];
}

function normalizeLink(target: string): string {
  // Strip alias and heading/block refs, drop .md, keep the last path segment as name.
  let t = target.split("|")[0].split("#")[0].trim();
  t = t.replace(/\.md$/i, "");
  return t;
}

function dateAfter(text: string, emoji: string): string | undefined {
  return findDateAfter(text, emoji);
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Index of the first metadata signifier (emoji, priority glyph, or [field::). */
function firstSignifierIndex(body: string): number {
  let pos = -1;
  const test = (re: RegExp) => {
    const m = body.match(re);
    if (m && m.index !== undefined && (pos < 0 || m.index < pos)) pos = m.index;
  };
  for (const e of Object.values(EMOJI)) test(new RegExp(escapeRe(e)));
  for (const e of Object.keys(PRIORITY_EMOJI)) test(new RegExp(escapeRe(e)));
  test(/(?:^|\s)[a-zA-Z][\w-]*\s*::/);
  return pos;
}

/**
 * Parse a single markdown line into a TaskItem, or null if it is not a task.
 */
export function parseLine(
  raw: string,
  filePath: string,
  line: number,
  settings: ParserConfig
): TaskItem | null {
  const m = raw.match(TASK_RE);
  if (!m) return null;

  const indent = m[1].length;
  const statusChar = m[2];
  let body = m[3];

  const status = statusFromChar(statusChar);

  // Block id.
  let blockId: string | undefined;
  const bidMatch = raw.match(BLOCKID_RE);
  if (bidMatch) blockId = bidMatch[1];
  body = body.replace(BLOCKID_RE, "");

  // Metadata dates. Emoji signifiers take precedence; Dataview inline fields
  // ([due:: ...] / (due:: ...)) are read as a fallback so either format works.
  const meta: RawTaskMeta = {
    due: dateAfter(body, EMOJI.due) ?? readDvDate(body, DV_KEYS.due),
    start: dateAfter(body, EMOJI.start) ?? readDvDate(body, DV_KEYS.start),
    scheduled: dateAfter(body, EMOJI.scheduled) ?? readDvDate(body, DV_KEYS.scheduled),
    created: dateAfter(body, EMOJI.created) ?? readDvDate(body, DV_KEYS.created),
    doneDate: dateAfter(body, EMOJI.done) ?? readDvDate(body, DV_KEYS.completion),
    cancelledDate:
      dateAfter(body, EMOJI.cancelled) ?? readDvDate(body, DV_KEYS.cancelled),
  };
  const recMatch = body.match(new RegExp(EMOJI.recurrence + "\\s*([^📅🛫⏳➕✅❌🔺⏫🔼🔽⏬]+)", "u"));
  if (recMatch) meta.recurrence = recMatch[1].trim();
  else {
    const dvRepeat = readDvField(body, DV_KEYS.repeat);
    if (dvRepeat) meta.recurrence = dvRepeat;
  }

  // Tags.
  const tags: string[] = [];
  let tm: RegExpExecArray | null;
  TAG_RE.lastIndex = 0;
  while ((tm = TAG_RE.exec(body)) !== null) {
    tags.push(tm[1]);
  }

  // Priority: emoji first, then Dataview [priority:: ...], then priority tags.
  let priority = 0;
  for (const [em, p] of Object.entries(PRIORITY_EMOJI)) {
    if (body.includes(em)) {
      priority = p;
      break;
    }
  }
  if (priority === 0) priority = readDvPriority(body);
  if (priority === 0) {
    for (let i = 0; i < settings.priorityTags.length; i++) {
      if (tags.includes(settings.priorityTags[i])) {
        priority = i + 1;
        break;
      }
    }
  }

  // Links.
  const links: string[] = [];
  let lm: RegExpExecArray | null;
  WIKILINK_RE.lastIndex = 0;
  while ((lm = WIKILINK_RE.exec(body)) !== null) {
    links.push(normalizeLink(lm[1]));
  }

  // Clean display text: strip emoji metadata + trailing dates + priority glyphs + tags.
  let text = body;
  for (const emoji of Object.values(EMOJI)) {
    const esc = emoji.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    text = text.replace(new RegExp(esc + "\\s*\\[\\[\\d{2}-\\d{2}-\\d{4}\\]\\]", "g"), "");
    text = text.replace(new RegExp(esc + "\\s*" + DATE, "g"), "");
    text = text.replace(new RegExp(esc, "g"), "");
  }
  for (const em of Object.keys(PRIORITY_EMOJI)) text = text.split(em).join("");
  // Strip recognized Dataview task fields ([due:: ...] etc). Unrelated user
  // inline fields (e.g. [effort:: 3]) are intentionally left in place.
  text = stripDataviewFields(text);
  text = text.replace(/\s{2,}/g, " ").trim();

  // Body split for inline editing: text before the first signifier, plus the
  // signifier-and-dates suffix that must survive an inline text edit.
  const sigPos = firstSignifierIndex(body);
  const textRaw = (sigPos < 0 ? body : body.slice(0, sigPos)).trim();
  const suffix = sigPos < 0 ? "" : body.slice(sigPos).trimStart();

  // Bucket context from the path.
  const { bucketRoot, bucketFile } = deriveBucket(filePath, settings);

  const id = taskIdFor(filePath, line, blockId);

  return {
    id,
    blockId,
    hasBlockId: !!blockId,
    filePath,
    line,
    indent,
    statusChar,
    status,
    text,
    textRaw,
    suffix,
    rawText: raw,
    tags,
    links,
    priority,
    meta,
    mtime: 0,
    ctime: 0,
    bucketRoot,
    bucketFile,
  };
}

export function deriveBucket(
  filePath: string,
  settings: ParserConfig
): { bucketRoot: string; bucketFile: string } {
  const parts = filePath.split("/");
  const base = parts[parts.length - 1].replace(/\.md$/i, "");
  const root = parts.length > 1 ? parts[0] : "Other";
  const known = settings.bucketRoots.concat(settings.inboxRoots);
  return {
    bucketRoot: known.includes(root) ? root : "Other",
    bucketFile: base,
  };
}

/**
 * Resolve a file path to its context-tree placement.
 * `flat` roots (inbox folders, and the catch-all "Other") group tasks directly
 * on the root node; everything else nests one node per folder segment down to
 * the file. `fileKey` is the key of the node the task attaches to.
 */
export function nodeKeyForFile(
  filePath: string,
  settings: ParserConfig
): { rootName: string; flat: boolean; fileKey: string } {
  const parts = filePath.split("/");
  const root = parts.length > 1 ? parts[0] : "Other";
  const inBucket = settings.bucketRoots.includes(root);
  const inInbox = settings.inboxRoots.includes(root);
  const rootName = inBucket || inInbox ? root : "Other";
  const flat = inInbox || rootName === "Other";
  const fileKey = flat ? rootName : filePath.replace(/\.md$/i, "");
  return { rootName, flat, fileKey };
}

export function isIgnored(path: string, settings: ParserConfig): boolean {
  return settings.ignorePaths.some((p) => path.startsWith(p));
}
