// Tests for the typed note flow (New project/task/subtask) and its default
// frontmatter. Pure helpers + NoteFactory over a fake IVaultAdapter/IClock.

import { describe, it, expect } from "vitest";
import { IVaultAdapter, VaultFileMeta } from "../src/ports/vault-adapter";
import { IClock } from "../src/ports/clock";
import { ObsidianRemindersSettings, DEFAULT_SETTINGS } from "../src/settings";
import { parseLine } from "../src/core/parser";
import { localISODate } from "../src/core/date";
import { NoteFactory } from "../src/services/note-factory";
import {
  noteFrontmatter,
  noteFilename,
  noteTemplateVars,
  substituteNoteVars,
} from "../src/core/note-template";

class FakeClock implements IClock {
  constructor(private iso: string) {}
  now(): Date {
    return new Date(this.iso + "T12:00:00");
  }
  todayIso(): string {
    return this.iso;
  }
  offsetDays(n: number): string {
    const d = this.now();
    d.setDate(d.getDate() + n);
    return localISODate(d);
  }
}

class FakeAdapter implements IVaultAdapter {
  files = new Map<string, string>();
  folders = new Set<string>();

  async scopedFiles(): Promise<VaultFileMeta[]> {
    return [];
  }
  async stat(path: string): Promise<VaultFileMeta | null> {
    return this.files.has(path) ? { path, mtime: 1, ctime: 1 } : null;
  }
  async read(path: string): Promise<string> {
    return this.files.get(path) ?? "";
  }
  exists(path: string): boolean {
    return this.files.has(path) || this.folders.has(path);
  }
  async process(path: string, transform: (c: string) => string): Promise<void> {
    this.files.set(path, transform(this.files.get(path) ?? ""));
  }
  async create(path: string, content: string): Promise<void> {
    this.files.set(path, content);
  }
  async createFolder(path: string): Promise<void> {
    this.folders.add(path);
  }
  listFolder(folder: string): string[] {
    const prefix = folder.replace(/\/$/, "") + "/";
    return Array.from(this.files.keys())
      .filter((p) => p.startsWith(prefix))
      .map((p) => p.split("/").pop() as string);
  }
  async openFile(_path: string): Promise<void> {}
}

const SETTINGS: ObsidianRemindersSettings = {
  ...DEFAULT_SETTINGS,
  projectFolder: "Notes/Projects",
  taskFolder: "Notes/Tasks",
  subtaskFolder: "Notes/Subtasks",
};

describe("noteFrontmatter (built-in template)", () => {
  it("emits the six typed fields", () => {
    const body = noteFrontmatter({
      type: "task",
      title: "Ship it",
      related: "[[Projects/A#^tg1]]",
      date: "21-10-2026",
      dueDate: "22-10-2026",
      prio: 3,
      status: "backlog",
    });
    expect(body).toContain("type: task");
    expect(body).toContain('related: "[[Projects/A#^tg1]]"');
    expect(body).toContain('date: "[[21-10-2026]]"');
    expect(body).toContain("prio: 3");
    expect(body).toContain("status: backlog");
    expect(body).toContain('due-date: "[[22-10-2026]]"');
  });

  it("leaves related and due-date empty when absent", () => {
    const body = noteFrontmatter({
      type: "project",
      title: "Novel",
      related: "",
      date: "21-10-2026",
      dueDate: "",
      prio: 3,
      status: "backlog",
    });
    expect(body).toContain('related: ""');
    expect(body).toContain('due-date: ""');
  });
});

describe("noteFilename", () => {
  it("embeds the kind and block id", () => {
    expect(noteFilename("subtask", "Write draft", "tg9")).toBe(
      "Write draft – Subtask tg9.md"
    );
  });
});

describe("substituteNoteVars", () => {
  it("replaces known placeholders and keeps unknown ones", () => {
    const vars = noteTemplateVars({
      type: "task",
      title: "X",
      related: "",
      date: "21-10-2026",
      dueDate: "",
      prio: 3,
      status: "backlog",
    });
    const out = substituteNoteVars("type: {{type}}\ndate: [[{{date}}]]\n{{unknown}}", vars);
    expect(out).toContain("type: task");
    expect(out).toContain("[[21-10-2026]]");
    expect(out).toContain("{{unknown}}");
  });
});

describe("NoteFactory over IVaultAdapter", () => {
  function setup() {
    const adapter = new FakeAdapter();
    const clock = new FakeClock("2026-10-21");
    const factory = new NoteFactory(adapter, clock, SETTINGS);
    return { adapter, factory };
  }

  it("creates a task note with the built-in frontmatter in the task folder", async () => {
    const { adapter, factory } = setup();
    const task = parseLine("- [ ] Ship it 🔺 #today", "Projects/A.md", 0, SETTINGS)!;
    const path = await factory.createNote("task", "tg1", task.text, task.filePath, task);

    expect(path).toContain("Notes/Tasks/");
    expect(path).toContain("tg1");
    const body = adapter.files.get(path)!;
    expect(body).toContain("type: task");
    expect(body).toContain("status: backlog");
    expect(body).toContain('date: "[[21-10-2026]]"');
  });

  it("finds a note by block id across the three folders", async () => {
    const { factory } = setup();
    await factory.createNote("subtask", "tg2", "Nested", "Projects/A.md");
    expect(factory.findByBlockId("tg2")).toContain("Notes/Subtasks/");
  });

  it("subtask links to the source todo, project leaves related empty", async () => {
    const { adapter, factory } = setup();
    const sub = await factory.createNote("subtask", "tg3", "Child", "Projects/A.md");
    expect(adapter.files.get(sub)!).toContain('related: "[[Projects/A#^tg3]]"');

    const proj = await factory.createNote("project", "tg4", "Parent", "Projects/A.md");
    expect(adapter.files.get(proj)!).toContain('related: ""');
  });

  it("task links to the enclosing project note when the source is a project", async () => {
    const { adapter, factory } = setup();
    adapter.files.set("Projects/Roadmap.md", "---\ntype: project\n---\n- [ ] Ship it");
    const path = await factory.createNote("task", "tg5", "Ship it", "Projects/Roadmap.md");
    expect(adapter.files.get(path)!).toContain('related: "[[Projects/Roadmap]]"');
  });

  it("uses a configured template file with {{placeholder}} substitution", async () => {
    const adapter = new FakeAdapter();
    const clock = new FakeClock("2026-10-21");
    const s = { ...SETTINGS, taskTemplate: "Templates/task.md" };
    const factory = new NoteFactory(adapter, clock, s);
    adapter.files.set(
      "Templates/task.md",
      "---\ntype: {{type}}\ntitle: {{title}}\n---\n"
    );

    const path = await factory.createNote("task", "tg6", "Custom", "Projects/A.md");
    const body = adapter.files.get(path)!;
    expect(body).toContain("type: task");
    expect(body).toContain("title: Custom");
  });
});
