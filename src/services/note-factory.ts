// NoteFactory: create/find typed project/task/subtask notes. Depends on the
// vault adapter + clock + settings, plus an optional template expander
// (Templater integration, injected from main.ts so the service stays
// Obsidian-free). Pure filename/YAML building lives in core/note-template.ts.

import { IVaultAdapter } from "../ports/vault-adapter";
import { IClock } from "../ports/clock";
import { ObsidianRemindersSettings } from "../settings";
import { TaskItem } from "../core/models";
import { cleanTitleForFile, normalizePath, toDDMMYYYY } from "../core/sidecar";
import {
  NoteKind,
  NOTE_KINDS,
  noteFilename,
  noteFrontmatter,
  noteTemplateVars,
  substituteNoteVars,
  NoteVars,
} from "../core/note-template";

/** Expands a template string against a target path (Templater); injected. */
export type TemplateExpander = (content: string, targetPath: string) => Promise<string>;

export class NoteFactory {
  constructor(
    private adapter: IVaultAdapter,
    private clock: IClock,
    private settings: ObsidianRemindersSettings,
    private expander?: TemplateExpander
  ) {}

  private folderFor(kind: NoteKind): string {
    const f =
      kind === "project"
        ? this.settings.projectFolder
        : kind === "task"
          ? this.settings.taskFolder
          : this.settings.subtaskFolder;
    return normalizePath(f);
  }

  private templateFor(kind: NoteKind): string {
    const t =
      kind === "project"
        ? this.settings.projectTemplate
        : kind === "task"
          ? this.settings.taskTemplate
          : this.settings.subtaskTemplate;
    return (t || "").trim();
  }

  /** Path of an existing typed note for a block id, or undefined. With `kind`,
   * only that kind's folder is searched (a todo can carry a project, a task and
   * a subtask note side by side). Without it, all typed folders plus the legacy
   * sidecar folder are searched (inline icon / identity migration). */
  findByBlockId(blockId: string, kind?: NoteKind): string | undefined {
    const needle = ` ${blockId}.md`;
    const kinds = kind ? [kind] : [...NOTE_KINDS];
    for (const k of kinds) {
      const folder = this.folderFor(k);
      const match = this.adapter.listFolder(folder).find((n) => n.endsWith(needle));
      if (match) return `${folder}/${match}`;
    }
    if (!kind) {
      const sidecarFolder = normalizePath(this.settings.sidecarFolder);
      const match = this.adapter
        .listFolder(sidecarFolder)
        .find((n) => n.endsWith(needle));
      if (match) return `${sidecarFolder}/${match}`;
    }
    return undefined;
  }

  /** Create (if missing) a typed note for a known block id + source; return its path. */
  async createNote(
    kind: NoteKind,
    blockId: string,
    title: string,
    sourcePath: string,
    task?: TaskItem
  ): Promise<string> {
    const existing = this.findByBlockId(blockId, kind);
    if (existing) return existing;

    const folder = this.folderFor(kind);
    await this.ensureFolder(folder);

    const cleanTitle = cleanTitleForFile(title, task?.tags);
    const fileName = noteFilename(kind, cleanTitle, blockId);
    const path = `${folder}/${fileName}`;

    const vars: NoteVars = {
      type: kind,
      title: cleanTitle,
      related: await this.relatedFor(kind, sourcePath, blockId),
      date: toDDMMYYYY(this.clock.todayIso()),
      dueDate: task?.meta?.due ? toDDMMYYYY(task.meta.due) : "",
      prio: 3,
      status: "backlog",
    };

    const templatePath = this.templateFor(kind);
    let content: string;
    if (templatePath) {
      const tpl = await this.adapter.read(templatePath);
      content = substituteNoteVars(tpl, noteTemplateVars(vars));
    } else {
      content = noteFrontmatter(vars);
    }

    await this.adapter.create(path, content);

    if (templatePath && this.expander) {
      const expanded = await this.expander(content, path);
      if (expanded !== content) await this.adapter.process(path, () => expanded);
    }

    return path;
  }

  /** Parent link: subtask → source todo, task → enclosing project, project → empty. */
  private async relatedFor(
    kind: NoteKind,
    sourcePath: string,
    blockId: string
  ): Promise<string> {
    const base = sourcePath.replace(/\.md$/i, "");
    if (kind === "subtask") return `[[${base}#^${blockId}]]`;
    if (kind === "project") return "";
    // task: parent is the enclosing project note (frontmatter `type: project`).
    if (await this.isProjectNote(sourcePath)) return `[[${base}]]`;
    return "";
  }

  /** True when the note's frontmatter declares `type: project`. */
  private async isProjectNote(path: string): Promise<boolean> {
    const content = await this.adapter.read(path);
    const m = content.match(/^---\s*\n([\s\S]*?)\n---/);
    if (!m) return false;
    return /^type:\s*project\s*$/m.test(m[1]);
  }

  private async ensureFolder(folder: string): Promise<void> {
    const parts = folder.split("/");
    let cur = "";
    for (const p of parts) {
      cur = cur ? `${cur}/${p}` : p;
      if (!this.adapter.exists(cur)) {
        try {
          await this.adapter.createFolder(cur);
        } catch {
          // already exists / race; ignore
        }
      }
    }
  }
}
