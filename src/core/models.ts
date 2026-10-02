// Core data model for obsidian-reminders. Pure types — no Obsidian runtime.

export type TaskStatus = "open" | "done" | "cancelled" | "inProgress" | "forwarded";

export interface RawTaskMeta {
  due?: string; // YYYY-MM-DD
  start?: string; // 🛫 start-on
  scheduled?: string; // ⏳ scheduled
  created?: string; // ➕ created
  doneDate?: string; // ✅ completion date
  cancelledDate?: string; // ❌ cancelled date
  recurrence?: string; // 🔁 rule text
}

export interface TaskItem {
  id: string; // stable identity: `path#^blockId` when a block id exists, else a content fingerprint `path#<hash>`
  blockId?: string; // ^abc123 (without caret) if the source line has one
  hasBlockId: boolean;
  contentHash: string; // FNV-1a of (path + status + normalized body), for write-time fallback lookup
  filePath: string; // vault-relative path of the source file
  line: number; // 0-based line index in the source file (location, not identity)
  indent: number; // leading whitespace length (for parent/child nesting)
  statusChar: string; // the raw char inside [ ]
  status: TaskStatus;
  text: string; // display text with emoji/metadata/tags stripped
  textRaw: string; // body text before the first signifier (emoji/field), for inline edit
  suffix: string; // body text from the first signifier onward (signifiers + dates)
  rawText: string; // the full original line
  tags: string[]; // inline #tags (without the leading #)
  links: string[]; // wikilink targets referenced in the task (normalized, no path/ext)
  priority: number; // 0 = none, 1 = highest .. higher number = lower priority
  meta: RawTaskMeta;
  // File timestamps (ms epoch) for Modified/Created sort & group.
  mtime: number;
  ctime: number;
  // Derived context:
  bucketRoot: string; // "Projects" | "People" | "Areas" | "Dailies" | "Other"
  bucketFile: string; // basename of the source file, no extension
  sidecarPath?: string; // detail-note path if one exists
}

export interface TreeNode {
  key: string; // unique path key e.g. "Projects/Roadmap/Q1 Planning"
  label: string;
  kind: "root" | "folder" | "file" | "tag" | "smart";
  children: TreeNode[];
  taskIds: string[]; // tasks directly at this node
  count: number; // rolled-up open count including descendants
}

// --- UI selection / sort / group keys (shared by views, pure) ---

export type SortKey =
  | "priority"
  | "due"
  | "start"
  | "created"
  | "reference"
  | "title"
  | "mtime"
  | "ctime";

export type GroupKey =
  | "none"
  | "priority"
  | "due"
  | "reference"
  | "mtime"
  | "ctime"
  | "type";

export type Selection =
  | { type: "overdue" }
  | { type: "today" }
  | { type: "tomorrow" }
  | { type: "soon" }
  | { type: "inbox" }
  | { type: "all" }
  | { type: "flagged" }
  | { type: "inprogress" }
  | { type: "completed" }
  | { type: "tags" }
  | { type: "smart"; tag: string; label: string }
  | { type: "node"; key: string; label: string };

// --- Context sidebar model (pure types) ---

export type ContextScope = "all" | "page" | "section" | "reference";

// Due-date filter applied on top of the active scope in the context sidebar.
export type DueFilter = "all" | "overdue" | "today" | "soon";

export interface ContextResult {
  title: string;
  subtitle: string;
  isFolderNote: boolean;
  // Task lists per scope. "all" is the deduped union (page → section → refs).
  scopes: Record<ContextScope, TaskItem[]>;
  total: number;
}
