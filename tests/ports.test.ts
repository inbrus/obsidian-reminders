// Phase 2 ports tests. The whole stateful stack — SidecarService, TaskWriter,
// TaskStore, VaultScanner — is exercised against a fake IVaultAdapter/IClock/
// ILinkResolver, proving the services depend on ports, not on Obsidian's vault.
// (settings.ts is pulled in only for the ObsidianRemindersSettings type; it is stubbed
// via the obsidian alias in vitest.config.ts, same as the existing parser tests.)
import { describe, it, expect, beforeEach } from "vitest";
import { IVaultAdapter, VaultFileMeta } from "../src/ports/vault-adapter";
import { IClock } from "../src/ports/clock";
import { ILinkResolver } from "../src/ports/link-resolver";
import { localISODate } from "../src/core/date";
import { parseLine } from "../src/core/parser";
import { ObsidianRemindersSettings, DEFAULT_SETTINGS } from "../src/settings";
import { SidecarService } from "../src/services/sidecar";
import { TaskWriter } from "../src/services/writer";
import { VaultScanner } from "../src/services/scanner";
import { TaskStore } from "../src/store";
import { IStorage } from "../src/ports/storage";
import { IndexPersistence, IndexSnapshot, INDEX_SCHEMA_VERSION } from "../src/services/index-persistence";
import { IdentityMigration } from "../src/services/identity-migration";
import { parseSidecarFrontmatter, sidecarFrontmatter, SIDECAR_SCHEMA_VERSION } from "../src/core/sidecar";

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

class FakeAdapter implements IVaultAdapter, ILinkResolver {
  files = new Map<string, string>();
  folders = new Set<string>();
  stats = new Map<string, VaultFileMeta>();
  links: Record<string, string> = {};
  opened: string | undefined;
  scope: VaultFileMeta[] = [];

  async scopedFiles(): Promise<VaultFileMeta[]> {
    return this.scope;
  }
  async stat(path: string): Promise<VaultFileMeta | null> {
    if (this.stats.has(path)) return this.stats.get(path)!;
    const meta = this.scope.find((f) => f.path === path);
    if (meta) return meta;
    if (this.files.has(path)) return { path, mtime: 1, ctime: 1 };
    return null;
  }
  async read(path: string): Promise<string> {
    return this.files.get(path) ?? "";
  }
  exists(path: string): boolean {
    return this.files.has(path) || this.folders.has(path);
  }
  async process(path: string, transform: (c: string) => string): Promise<void> {
    const cur = this.files.get(path) ?? "";
    this.files.set(path, transform(cur));
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
  async openFile(path: string): Promise<void> {
    this.opened = path;
  }
  resolve(link: string, _fromPath: string): string | undefined {
    return this.links[link];
  }
}

class FakeStorage implements IStorage {
  files = new Map<string, string>();
  async read(path: string): Promise<string | null> {
    return this.files.has(path) ? this.files.get(path)! : null;
  }
  async write(path: string, data: string): Promise<void> {
    this.files.set(path, data);
  }
  async remove(path: string): Promise<void> {
    this.files.delete(path);
  }
}

const SETTINGS: ObsidianRemindersSettings = {
  ...DEFAULT_SETTINGS,
  sidecarFolder: "Notes/Tasks",
};

describe("SidecarService over IVaultAdapter", () => {
  let adapter: FakeAdapter;
  let clock: FakeClock;
  let sidecar: SidecarService;

  beforeEach(() => {
    adapter = new FakeAdapter();
    clock = new FakeClock("2026-09-30");
    sidecar = new SidecarService(adapter, clock, SETTINGS);
  });

  it("creates a sidecar with block identity and links back to source", async () => {
    const task = parseLine("- [ ] Ship it 🔺 #today", "Projects/A.md", 0, SETTINGS)!;
    const path = await sidecar.ensureSidecarFor("tg1", task.text, task.filePath, task);

    expect(path).toContain("tg1");
    const body = adapter.files.get(path)!;
    expect(body).toContain("blockId: tg1");
    expect(body).toContain('source-task: "[[Projects/A#^tg1|Source →]]"');
    expect(body).toContain('priority-task: "#e5484d"');
    expect(body).toContain('  - "#today"');
  });

  it("finds an existing sidecar by block id across title changes", async () => {
    await sidecar.ensureSidecarFor("tg2", "Old title", "Projects/A.md");
    const found = sidecar.findByBlockId("tg2");
    expect(found).toBeTruthy();
    expect(found).toContain("tg2");
  });
});

describe("TaskWriter over IVaultAdapter", () => {
  it("writes priority through adapter.process, preserving on-disk format", async () => {
    const adapter = new FakeAdapter();
    const clock = new FakeClock("2026-09-30");
    const sidecar = new SidecarService(adapter, clock, SETTINGS);
    const writer = new TaskWriter(adapter, sidecar, SETTINGS, async () => null);

    const task = parseLine("- [ ] Do the thing", "Projects/A.md", 0, SETTINGS)!;
    adapter.files.set(task.filePath, "- [ ] Do the thing");

    await writer.setPriority(task, 2);
    expect(adapter.files.get(task.filePath)).toContain("⏫");
  });
});

describe("TaskStore over ports (end-to-end without Obsidian)", () => {
  it("indexes and slices 'today' via the injected clock", async () => {
    const adapter = new FakeAdapter();
    const clock = new FakeClock("2026-09-30");
    const sidecar = new SidecarService(adapter, clock, SETTINGS);
    const scanner = new VaultScanner(adapter, sidecar, SETTINGS);
    const store = new TaskStore(scanner, adapter, clock, SETTINGS);

    adapter.scope = [{ path: "Projects/A.md", mtime: 1, ctime: 1 }];
    adapter.files.set(
      "Projects/A.md",
      ["- [ ] Due today 📅 2026-09-30", "- [ ] Due tomorrow 📅 2026-10-01", "- [ ] No date"].join("\n")
    );

    await store.rebuild();

    expect(store.dueToday().map((t) => t.text)).toEqual(["Due today"]);
    expect(store.dueTomorrow().map((t) => t.text)).toEqual(["Due tomorrow"]);
    expect(store.visible()).toHaveLength(3);
  });

  it("resolves context-tree links through the injected link resolver", async () => {
    const adapter = new FakeAdapter();
    const clock = new FakeClock("2026-09-30");
    const sidecar = new SidecarService(adapter, clock, SETTINGS);
    const scanner = new VaultScanner(adapter, sidecar, SETTINGS);
    const store = new TaskStore(scanner, adapter, clock, SETTINGS);

    adapter.scope = [{ path: "Projects/A.md", mtime: 1, ctime: 1 }];
    adapter.files.set("Projects/A.md", "- [ ] Links to [[Person]]");
    adapter.links["Person"] = "People/Person.md";

    await store.rebuild();
    const tree = store.buildContextTree();
    expect(tree.map((r) => r.label)).toContain("Projects");
  });
});

describe("TaskStore incremental index (applyFile/removeFile)", () => {
  function setup(files: Record<string, string>) {
    const adapter = new FakeAdapter();
    const clock = new FakeClock("2026-09-30");
    const sidecar = new SidecarService(adapter, clock, SETTINGS);
    const scanner = new VaultScanner(adapter, sidecar, SETTINGS);
    const store = new TaskStore(scanner, adapter, clock, SETTINGS);
    adapter.scope = Object.keys(files).map((path) => ({ path, mtime: 1, ctime: 1 }));
    for (const [path, content] of Object.entries(files)) adapter.files.set(path, content);
    return { adapter, store };
  }

  it("applyFile updates only the touched file's tasks", async () => {
    const { adapter, store } = setup({
      "Projects/A.md": "- [ ] Alpha",
      "Projects/B.md": "- [ ] Beta",
    });
    await store.rebuild();
    expect(store.visible().map((t) => t.text).sort()).toEqual(["Alpha", "Beta"]);

    adapter.files.set("Projects/A.md", "- [ ] Alpha edited\n- [ ] New task");
    adapter.stats.set("Projects/A.md", { path: "Projects/A.md", mtime: 2, ctime: 1 });
    await store.applyFile("Projects/A.md");

    expect(store.visible().map((t) => t.text).sort()).toEqual([
      "Alpha edited",
      "Beta",
      "New task",
    ]);
  });

  it("removeFile drops a file's tasks without touching others", async () => {
    const { store } = setup({
      "Projects/A.md": "- [ ] Alpha",
      "Projects/B.md": "- [ ] Beta",
    });
    await store.rebuild();
    store.removeFile("Projects/A.md");
    expect(store.visible().map((t) => t.text)).toEqual(["Beta"]);
  });

  it("indexes tasks by block id for stable lookup", async () => {
    const { store } = setup({ "Projects/A.md": "- [ ] Alpha ^block123" });
    await store.rebuild();
    expect(store.byBlockId("block123")?.text).toBe("Alpha");
    expect(store.byBlockId("nope")).toBeUndefined();
  });
});

describe("IndexPersistence over IStorage", () => {
  it("round-trips a snapshot and rejects a wrong schema version", async () => {
    const storage = new FakeStorage();
    const p = new IndexPersistence(storage, "cache.json");
    expect(await p.load()).toBeNull();

    const snapshot: IndexSnapshot = {
      schemaVersion: INDEX_SCHEMA_VERSION,
      files: { "Projects/A.md": { mtime: 5, tasks: [] } },
      builtAt: 1,
    };
    await p.save(snapshot);
    expect((await p.load())?.files["Projects/A.md"].mtime).toBe(5);

    storage.files.set("cache.json", JSON.stringify({ schemaVersion: 999, files: {}, builtAt: 1 }));
    expect(await p.load()).toBeNull();
  });

  it("rebuild restores unchanged files from cache and re-reads changed ones", async () => {
    const adapter = new FakeAdapter();
    const clock = new FakeClock("2026-09-30");
    const sidecar = new SidecarService(adapter, clock, SETTINGS);
    const scanner = new VaultScanner(adapter, sidecar, SETTINGS);
    const store = new TaskStore(scanner, adapter, clock, SETTINGS);

    adapter.scope = [
      { path: "Projects/A.md", mtime: 1, ctime: 1 },
      { path: "Projects/B.md", mtime: 1, ctime: 1 },
    ];
    adapter.files.set("Projects/A.md", "- [ ] Alpha");
    adapter.files.set("Projects/B.md", "- [ ] Beta");
    await store.rebuild();
    const snapshot = store.buildSnapshot();

    // B.md changed on disk: mtime bump + new content.
    adapter.files.set("Projects/B.md", "- [ ] Beta v2");
    adapter.scope = [
      { path: "Projects/A.md", mtime: 1, ctime: 1 },
      { path: "Projects/B.md", mtime: 9, ctime: 1 },
    ];

    // Rebuild with the stale snapshot: A.md restored from cache (mtime match),
    // B.md re-read (mtime mismatch).
    await store.rebuild(snapshot);

    expect(store.visible().map((t) => t.text).sort()).toEqual(["Alpha", "Beta v2"]);
  });
});

describe("IdentityMigration", () => {
  function sidecar(blockId: string, title: string, sourcePath: string): string {
    return sidecarFrontmatter({
      blockId,
      date: "30-09-2026",
      sourceLink: `${sourcePath}#^${blockId}`,
      title,
      priorityHex: "",
      tags: [],
      statusDone: false,
    });
  }

  it("parseSidecarFrontmatter reads blockId/source/schema", () => {
    const meta = parseSidecarFrontmatter(sidecar("tg1", "Ship it", "Projects/A"));
    expect(meta?.blockId).toBe("tg1");
    expect(meta?.sourcePath).toBe("Projects/A");
    expect(meta?.schemaVersion).toBe(SIDECAR_SCHEMA_VERSION);
  });

  it("dry-run reports backfill and orphans without writing", async () => {
    const adapter = new FakeAdapter();
    const migration = new IdentityMigration(adapter, SETTINGS);

    adapter.files.set("Projects/A.md", "- [ ] Ship it");
    adapter.files.set("Notes/Tasks/Ship it – Task tg1.md", sidecar("tg1", "Ship it", "Projects/A"));
    // Orphan: source note missing entirely.
    adapter.files.set("Notes/Tasks/Gone – Task tg2.md", sidecar("tg2", "Gone", "Projects/Gone"));

    const report = await migration.repairIdentities(true);
    expect(report.checked).toBe(2);
    expect(report.backfilled).toContain("Projects/A");
    expect(report.orphans).toContain("Notes/Tasks/Gone – Task tg2.md");
    // dry-run: no writes.
    expect(adapter.files.get("Projects/A.md")).toBe("- [ ] Ship it");
  });

  it("write mode appends the missing block id", async () => {
    const adapter = new FakeAdapter();
    const migration = new IdentityMigration(adapter, SETTINGS);
    adapter.files.set("Projects/A.md", "- [ ] Ship it");
    adapter.files.set("Notes/Tasks/Ship it – Task tg1.md", sidecar("tg1", "Ship it", "Projects/A"));

    await migration.repairIdentities(false);
    expect(adapter.files.get("Projects/A.md")).toBe("- [ ] Ship it ^tg1");
  });

  it("healthy sidecar needs no repair", async () => {
    const adapter = new FakeAdapter();
    const migration = new IdentityMigration(adapter, SETTINGS);
    adapter.files.set("Projects/A.md", "- [ ] Ship it ^tg1");
    adapter.files.set("Notes/Tasks/Ship it – Task tg1.md", sidecar("tg1", "Ship it", "Projects/A"));

    const report = await migration.repairIdentities(true);
    expect(report.healthy).toBe(1);
    expect(report.backfilled).toHaveLength(0);
    expect(report.orphans).toHaveLength(0);
  });
});
