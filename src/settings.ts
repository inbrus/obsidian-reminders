import {
  App,
  PluginSettingTab,
  Setting,
  SettingDefinitionItem,
  SettingPage,
} from "obsidian";
import type Taskgregator from "./main";
import { NAV_SECTIONS } from "./parser";

export type StartupView = "disabled" | "today" | "all" | "flagged";

// How Taskgregator writes task metadata. "auto" defers to the Tasks plugin's
// configured format (falling back to emoji when Tasks isn't installed/readable).
export type TaskFormatSetting = "auto" | "emoji" | "dataview";

export interface SmartList {
  name: string;
  tag: string; // tag without leading '#'
  icon?: string;
}

export interface TaskgregatorSettings {
  // Folders whose files become top-level context buckets.
  bucketRoots: string[];
  // Glob-ish path prefixes to ignore entirely.
  ignorePaths: string[];
  // Treat these bucket roots as "inbox" style (group all tasks flat, not per-file).
  inboxRoots: string[];
  // Priority tags in order of importance (highest first).
  priorityTags: string[];
  // Cross-cutting smart lists driven by tags.
  smartLists: SmartList[];
  // Folder for per-task detail notes (sidecars).
  sidecarFolder: string;
  // Date format used when writing dates (Tasks-plugin default is YYYY-MM-DD).
  dateFormat: string;
  // Emoji signifiers (Tasks-plugin compatible).
  useEmojiMetadata: boolean;
  // Auto-open the context sidebar (follows the active file) on startup.
  enableContextSidebar: boolean;
  // Which list the main Taskgregator panel opens to on startup ("disabled" = don't auto-open).
  startupView: StartupView;
  // "Soon" smart-list window in days (tasks due within the next N days).
  soonDays: number;
  // "Aging" smart-list threshold in days: still-open tasks created this many
  // days ago or older are surfaced as aging.
  agingDays: number;
  // Metadata format written to task lines. "auto" follows the Tasks plugin.
  // Reading is always dual-format; this only affects lines with no existing
  // metadata (existing emoji/dataview lines keep their own format).
  taskFormat: TaskFormatSetting;
  // Pop the changelog in a modal the first time the plugin loads after an update.
  showChangelogOnUpdate: boolean;
  // Last plugin version whose changelog was shown (internal; not user-facing).
  lastSeenVersion: string;
  // Navigation section ordering (ids from NAV_SECTIONS).
  navOrder: string[];
  // Navigation section ids the user hid.
  navHidden: string[];
  // Per-section count visibility (id -> show count).
  navShowCounts: Record<string, boolean>;
}

export const DEFAULT_SETTINGS: TaskgregatorSettings = {
  bucketRoots: ["Projects", "People", "Areas"],
  ignorePaths: ["Archive/", "Templates/"],
  inboxRoots: ["Dailies"],
  priorityTags: ["p1", "p2", "p3"],
  smartLists: [
    { name: "Today", tag: "today", icon: "star" },
    { name: "Follow-up", tag: "followup", icon: "reply" },
    { name: "Snippet Ideas", tag: "snippetIdea", icon: "lightbulb" },
    { name: "Someday", tag: "someday", icon: "clock" },
  ],
  sidecarFolder: "Taskgregator/tasksData",
  dateFormat: "YYYY-MM-DD",
  useEmojiMetadata: true,
  enableContextSidebar: true,
  startupView: "disabled",
  soonDays: 7,
  agingDays: 14,
  taskFormat: "auto",
  showChangelogOnUpdate: true,
  lastSeenVersion: "",
  navOrder: ["today", "tomorrow", "soon", "inbox", "flagged", "all", "inprogress", "completed"],
  navHidden: [],
  navShowCounts: {
    today: true,
    tomorrow: true,
    soon: true,
    inbox: true,
    flagged: true,
    all: true,
    inprogress: true,
    completed: true,
  },
};

/** Imperative sub-page: reorder, show/hide, and toggle counts for nav sections. */
class NavSectionsPage extends SettingPage {
  plugin: Taskgregator;

  constructor(plugin: Taskgregator) {
    super();
    this.plugin = plugin;
    this.title = "Navigation sections";
  }

  display(): void {
    const el = this.containerEl;
    el.empty();
    const order = this.plugin.settings.navOrder;
    for (let i = 0; i < order.length; i++) {
      const id = order[i];
      const def = NAV_SECTIONS.find((d) => d.id === id);
      const label = def ? def.label : id;
      const hidden = this.plugin.settings.navHidden.includes(id);
      const showCount = this.plugin.settings.navShowCounts[id] !== false;
      const row = new Setting(el).setName(label);
      row.addToggle((tg) =>
        tg
          .setValue(!hidden)
          .setTooltip("Show section")
          .onChange(async (v) => {
            const h = this.plugin.settings.navHidden;
            const hIdx = h.indexOf(id);
            if (v && hIdx >= 0) h.splice(hIdx, 1);
            if (!v && hIdx < 0) h.push(id);
            await this.plugin.saveSettings();
          })
      );
      row.addToggle((tg) =>
        tg
          .setValue(showCount)
          .setTooltip("Show count")
          .onChange(async (v) => {
            this.plugin.settings.navShowCounts[id] = v;
            await this.plugin.saveSettings();
          })
      );
      row.addExtraButton((b) =>
        b
          .setIcon("chevron-up")
          .setTooltip("Move up")
          .onClick(async () => {
            if (i === 0) return;
            const arr = this.plugin.settings.navOrder;
            const tmp = arr[i - 1];
            arr[i - 1] = arr[i];
            arr[i] = tmp;
            await this.plugin.saveSettings();
            this.display();
          })
      );
      row.addExtraButton((b) =>
        b
          .setIcon("chevron-down")
          .setTooltip("Move down")
          .onClick(async () => {
            if (i === order.length - 1) return;
            const arr = this.plugin.settings.navOrder;
            const tmp = arr[i + 1];
            arr[i + 1] = arr[i];
            arr[i] = tmp;
            await this.plugin.saveSettings();
            this.display();
          })
      );
    }
  }
}

export class TaskgregatorSettingTab extends PluginSettingTab {
  plugin: Taskgregator;

  constructor(app: App, plugin: Taskgregator) {
    super(app, plugin);
    this.plugin = plugin;
  }

  /**
   * Declarative definitions so the settings are indexed by Obsidian's settings
   * search on 1.13.0+. Rendering is still handled by display() below (which
   * keeps compatibility with older app versions). The array/CSV-backed values
   * are translated by getControlValue/setControlValue.
   */
  getSettingDefinitions(): SettingDefinitionItem[] {
    return [
      {
        name: "Bucket roots",
        desc: "Comma-separated top-level folders whose files become context buckets.",
        control: { type: "text", key: "bucketRoots" },
      },
      {
        name: "Inbox roots",
        desc: "Folders treated as a flat inbox (tasks grouped together, not per file). e.g. Dailies.",
        control: { type: "text", key: "inboxRoots" },
      },
      {
        name: "Ignore paths",
        desc: "Comma-separated path prefixes to exclude from indexing.",
        control: { type: "text", key: "ignorePaths" },
      },
      {
        name: "Priority tags",
        desc: "Highest-first, comma-separated (without #). e.g. p1, p2, p3.",
        control: { type: "text", key: "priorityTags" },
      },
      {
        name: "Smart lists",
        desc: "Cross-cutting tag lists. Format: Name:tag, comma-separated.",
        control: { type: "textarea", key: "smartLists" },
      },
      {
        name: "Detail-note folder",
        desc: "Where per-task detail notes (sidecars) are stored.",
        control: { type: "text", key: "sidecarFolder" },
      },
      {
        name: "Soon window (days)",
        desc: "Soon list shows tasks due within this many days (default 7).",
        control: { type: "text", key: "soonDays" },
      },
      {
        name: "Aging threshold (days)",
        desc: "Aging list shows still-open tasks created this many days ago or older (default 14).",
        control: { type: "text", key: "agingDays" },
      },
      {
        type: "page",
        name: "Navigation sections",
        desc: "Choose which lists appear in the side panel and their order.",
        page: () => new NavSectionsPage(this.plugin),
      },
      {
        name: "Context sidebar",
        desc: "Auto-open the file-context task panel in the right sidebar on startup.",
        control: { type: "toggle", key: "enableContextSidebar" },
      },
      {
        name: "Show changelog on update",
        desc: "Show the changelog automatically the first time the plugin loads after an update.",
        control: { type: "toggle", key: "showChangelogOnUpdate" },
      },
      {
        name: "Load Taskgregator on startup",
        desc: "Open the main Taskgregator panel to a list automatically when Obsidian starts.",
        control: {
          type: "dropdown",
          key: "startupView",
          options: { disabled: "Disabled", today: "Today", all: "All", flagged: "Flagged" },
        },
      },
      {
        name: "Task metadata format",
        desc: "How new dates/priority are written. Auto follows the Tasks plugin (emoji if not installed). Reading always supports both.",
        control: {
          type: "dropdown",
          key: "taskFormat",
          options: { auto: "Auto (follow Tasks plugin)", emoji: "Emoji (Tasks)", dataview: "Dataview" },
        },
      },
      {
        name: "Reindex now",
        desc: "Rescan the vault for tasks.",
        action: (el) => {
          const btn = el.createEl("button", { text: "Reindex" });
          btn.addEventListener("click", () => void this.plugin.reindex());
        },
      },
    ];
  }

  getControlValue(key: string): unknown {
    const s = this.plugin.settings;
    switch (key) {
      case "bucketRoots":
        return s.bucketRoots.join(", ");
      case "inboxRoots":
        return s.inboxRoots.join(", ");
      case "ignorePaths":
        return s.ignorePaths.join(", ");
      case "priorityTags":
        return s.priorityTags.join(", ");
      case "smartLists":
        return s.smartLists.map((x) => `${x.name}:${x.tag}`).join(", ");
      case "sidecarFolder":
        return s.sidecarFolder;
      case "soonDays":
        return String(s.soonDays);
      case "agingDays":
        return String(s.agingDays);
      case "enableContextSidebar":
        return s.enableContextSidebar;
      case "showChangelogOnUpdate":
        return s.showChangelogOnUpdate;
      case "startupView":
        return s.startupView;
      case "taskFormat":
        return s.taskFormat;
      default:
        return undefined;
    }
  }

  async setControlValue(key: string, value: unknown): Promise<void> {
    const s = this.plugin.settings;
    switch (key) {
      case "bucketRoots":
        s.bucketRoots = splitList(String(value));
        break;
      case "inboxRoots":
        s.inboxRoots = splitList(String(value));
        break;
      case "ignorePaths":
        s.ignorePaths = splitList(String(value));
        break;
      case "priorityTags":
        s.priorityTags = splitList(String(value)).map((x) => x.replace(/^#/, ""));
        break;
      case "smartLists":
        s.smartLists = parseSmartLists(String(value));
        break;
      case "sidecarFolder":
        s.sidecarFolder = String(value).trim().replace(/\/$/, "");
        break;
      case "soonDays":
        s.soonDays = clampDays(value);
        break;
      case "agingDays":
        s.agingDays = clampDays(value, 14);
        break;
      case "enableContextSidebar":
        s.enableContextSidebar = Boolean(value);
        break;
      case "showChangelogOnUpdate":
        s.showChangelogOnUpdate = Boolean(value);
        break;
      case "startupView":
        s.startupView = normalizeStartupView(value);
        break;
      case "taskFormat":
        s.taskFormat = normalizeTaskFormat(value);
        break;
      default:
        return;
    }
    await this.plugin.saveSettings();
  }
}

function normalizeStartupView(value: unknown): StartupView {
  const v = String(value);
  return v === "today" || v === "all" || v === "flagged" ? v : "disabled";
}

function normalizeTaskFormat(value: unknown): TaskFormatSetting {
  const v = String(value);
  return v === "emoji" || v === "dataview" ? v : "auto";
}

function clampDays(value: unknown, fallback = 7): number {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n) || n < 1) return fallback;
  return Math.min(n, 365);
}

function splitList(v: string): string[] {
  return v
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function parseSmartLists(v: string): SmartList[] {
  return splitList(v)
    .map((pair) => {
      const [name, tag] = pair.split(":");
      return { name: (name || "").trim(), tag: (tag || "").trim().replace(/^#/, "") };
    })
    .filter((s) => s.name && s.tag);
}
