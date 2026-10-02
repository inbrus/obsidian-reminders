// TaskWriter: the Obsidian-side writer. Applies pure line transforms (from
// core/line-transforms.ts) through vault.process, and handles sidecar I/O.
// The pure transforms are re-exported here so existing call sites
// (`import ... from "./writer"`) keep working unchanged.

import { App, TFile, normalizePath } from "obsidian";
import { TaskItem } from "./types";
import { TaskgregatorSettings } from "./settings";
import {
  applyStatusToLine,
  applyPriorityToLine,
  applyDueToLine,
  applyStartToLine,
  toggleTagInLine,
  formatForLine,
  generateBlockId,
  blockIdOf,
  todayStr,
  findLine,
} from "./core/line-transforms";
import {
  sidecarPathFor,
  findSidecarFile,
  cleanTitleForFile,
  stripTagsFromTitle,
  toDDMMYYYY,
  sidecarFrontmatter,
  yamlEscape,
} from "./sidecar";
import { TaskFormat } from "./core/metadata-codec";
import { getTasksPluginFormat } from "./tasksInterop";

// Re-export the pure line transforms for backward-compatible imports.
export * from "./core/line-transforms";

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
   * format when available, otherwise emoji (the historical default).
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
    const statusDone = task?.status === "done";
    const body = sidecarFrontmatter({
      blockId,
      date,
      sourceLink: link,
      title: yamlEscape(titleClean),
      priorityHex,
      tags: task?.tags || [],
      statusDone,
    });
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
