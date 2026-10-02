// TaskWriter: applies pure line transforms (core/line-transforms.ts) through
// the vault adapter, and delegates sidecar I/O to SidecarService. This is the
// "thin writer" — it holds no formatting logic, only the vault.process plumbing.

import { IVaultAdapter } from "../ports/vault-adapter";
import { TaskItem } from "../core/models";
import { ObsidianRemindersSettings } from "../settings";
import {
  applyStatusToLine,
  applyPriorityToLine,
  applyDueToLine,
  applyStartToLine,
  toggleTagInLine,
  formatForLine,
  generateBlockId,
  blockIdOf,
  findLine,
} from "../core/line-transforms";
import { TaskFormat } from "../core/metadata-codec";
import { parseLine } from "../core/parser";
import { SidecarService } from "./sidecar";

/** Provider for the Tasks plugin's configured format (auto-resolution). */
export type TasksFormatProvider = () => Promise<TaskFormat | null>;

export class TaskWriter {
  constructor(
    private adapter: IVaultAdapter,
    private sidecar: SidecarService,
    private settings: ObsidianRemindersSettings,
    private getTasksFormat: TasksFormatProvider
  ) {}

  private async editLine(
    task: TaskItem,
    transform: (line: string) => string
  ): Promise<void> {
    await this.adapter.process(task.filePath, (data) => {
      const lines = data.split("\n");
      const idx = findLine(lines, task, (line) =>
        parseLine(line, task.filePath, 0, this.settings)?.contentHash
      );
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
    return (await this.getTasksFormat()) ?? "emoji";
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
    const path = await this.sidecar.ensureSidecarFor(blockId, task.text, task.filePath, task);
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
    return this.sidecar.ensureSidecarFor(blockId, title, sourcePath, task);
  }

  async openSidecar(task: TaskItem): Promise<void> {
    const path = await this.ensureSidecar(task);
    await this.openPath(path);
  }

  async openPath(path: string): Promise<void> {
    await this.adapter.openFile(path);
  }
}
