import { Plugin, WorkspaceLeaf, TFile, TAbstractFile, Menu, Editor, MarkdownView, MarkdownFileInfo, MarkdownPostProcessorContext, normalizePath, Notice, setIcon } from "obsidian";
import { ObsidianRemindersSettings, DEFAULT_SETTINGS, ObsidianRemindersSettingTab } from "./settings";
import { TaskStore } from "./store";
import { TaskWriter } from "./services/writer";
import {
  isTaskLine,
  applyPriorityToLine,
  applyDueToLine,
  toggleTagInLine,
  ensureBlockIdInLine,
  formatForLine,
} from "./core/line-transforms";
import { parseLine, NAV_SECTIONS } from "./parser";
import { SidecarService } from "./services/sidecar";
import { VaultScanner } from "./services/scanner";
import { ObsidianVaultAdapter } from "./infra/obsidian-vault-adapter";
import { ObsidianClock } from "./infra/obsidian-clock";
import { getTasksPluginFormat } from "./tasksInterop";
import { RemindersView, VIEW_TYPE_REMINDERS, ViewDeps } from "./view";
import { RemindersNavView, VIEW_TYPE_REMINDERS_NAV } from "./navView";
import { UiStateStore } from "./services/selection";
import { EventBus } from "./services/event-bus";
import { promptDate } from "./ui";
import { RemindersContextView, VIEW_TYPE_REMINDERS_CONTEXT } from "./contextView";
import { noteIconLivePreview } from "./livePreview";
import { maybeShowChangelog, openChangelog } from "./changelog";
import { buildMenu, priorityActions } from "./editor/menu";
import { ObsidianStorage } from "./infra/obsidian-storage";
import { IndexPersistence } from "./services/index-persistence";
import { IdentityMigration, RepairReport } from "./services/identity-migration";

export default class ObsidianReminders extends Plugin {
  settings!: ObsidianRemindersSettings;
  store!: TaskStore;
  writer!: TaskWriter;
  state!: UiStateStore;
  bus!: EventBus;
  private sidecar!: SidecarService;
  private refreshTimer: number | null = null;
  private pendingPaths = new Set<string>();
  private pendingRemoves = new Set<string>();
  private lastScopeKey = "";
  private persistence!: IndexPersistence;
  private migration!: IdentityMigration;

  async onload(): Promise<void> {
    await this.loadSettings();

    // Composition root: build the container bottom-up. The adapter is the single
    // point of contact with Obsidian's vault; services depend on ports only.
    const adapter = new ObsidianVaultAdapter(this.app);
    const clock = new ObsidianClock();
    this.persistence = new IndexPersistence(
      new ObsidianStorage(this.app),
      normalizePath(`${this.manifest.dir}/index.cache.json`)
    );
    this.migration = new IdentityMigration(adapter, this.settings);
    this.sidecar = new SidecarService(adapter, clock, this.settings);
    const scanner = new VaultScanner(adapter, this.sidecar, this.settings);
    this.store = new TaskStore(scanner, adapter, clock, this.settings);
    this.writer = new TaskWriter(
      adapter,
      this.sidecar,
      this.settings,
      () => getTasksPluginFormat(this.app)
    );
    this.bus = new EventBus();
    this.state = new UiStateStore(this.bus);

    const deps: ViewDeps = {
      store: this.store,
      writer: this.writer,
      settings: this.settings,
      state: this.state,
      bus: this.bus,
      reindex: () => this.reindex(),
      reindexFile: async (path: string) => this.reindexFile(path),
      openList: () => this.openList(),
      getNote: (path: string) => adapter.getNote(path),
    };

    this.registerView(
      VIEW_TYPE_REMINDERS,
      (leaf: WorkspaceLeaf) => new RemindersView(leaf, deps)
    );

    this.registerView(
      VIEW_TYPE_REMINDERS_NAV,
      (leaf: WorkspaceLeaf) => new RemindersNavView(leaf, deps)
    );

    this.registerView(
      VIEW_TYPE_REMINDERS_CONTEXT,
      (leaf: WorkspaceLeaf) => new RemindersContextView(leaf, deps)
    );

    this.addCommand({
      id: "open",
      name: "Open panel",
      callback: () => this.activateView(),
    });

    this.addCommand({
      id: "open-context",
      name: "Open context sidebar",
      callback: () => this.activateContextView(),
    });

    this.addCommand({
      id: "reindex",
      name: "Reindex tasks",
      callback: () => this.reindex(),
    });

    this.addCommand({
      id: "repair-identities",
      name: "Repair identities (dry-run)",
      callback: async () => {
        const report = await this.migration.repairIdentities(true);
        new Notice(this.formatRepairReport(report));
        await this.reindex();
      },
    });

    this.addCommand({
      id: "repair-identities-write",
      name: "Repair identities",
      callback: async () => {
        const report = await this.migration.repairIdentities(false);
        new Notice(this.formatRepairReport(report));
        await this.reindex();
      },
    });

    this.addCommand({
      id: "whats-new",
      name: "Show what's new",
      callback: () => openChangelog(this),
    });

    this.addSettingTab(new ObsidianRemindersSettingTab(this.app, this));

    // In reading view, replace the raw block-id on a task that has a detail note
    // with a small clickable note icon (matching the plugin views' 📝 chip).
    this.registerMarkdownPostProcessor((el, ctx) => this.decorateTaskNotes(el, ctx));

    // Same idea in Live Preview: hide the raw `^tg…` id and show a 📝 note icon.
    this.registerEditorExtension([
      noteIconLivePreview(
        (blockId) => this.hasSidecar(blockId),
        (blockId) => this.openSidecarById(blockId)
      ),
    ]);

    // Keep the index fresh as the vault changes (debounced, per-file).
    this.registerEvent(
      this.app.vault.on("modify", (f: TAbstractFile) => {
        if (adapter.isMarkdownFile(f)) this.scheduleApplyFile(f.path);
      })
    );
    this.registerEvent(
      this.app.vault.on("create", (f: TAbstractFile) => {
        if (adapter.isMarkdownFile(f)) this.scheduleApplyFile(f.path);
      })
    );
    this.registerEvent(
      this.app.vault.on("delete", (f: TAbstractFile) => {
        if (adapter.isMarkdownFile(f)) this.scheduleRemoveFile(f.path);
      })
    );
    this.registerEvent(
      this.app.vault.on("rename", (f: TAbstractFile, oldPath: string) => {
        if (adapter.isMarkdownFile(f)) {
          this.scheduleRemoveFile(oldPath);
          this.scheduleApplyFile(f.path);
        }
      })
    );

    // Keep the context sidebar pointed at the active file. When one of our own
    // views is focused (nav/list), clear the sidebar instead of leaving the
    // previous page's tasks stranded (a plugin view isn't a note, so nothing
    // would otherwise refresh it).
    this.registerEvent(
      this.app.workspace.on("active-leaf-change", (leaf) => this.onActiveLeafChange(leaf))
    );
    this.registerEvent(
      this.app.workspace.on("file-open", () => this.updateContextViews())
    );

    // Native right-click menu on any task line across the vault (continuity).
    this.registerEvent(
      this.app.workspace.on("editor-menu", (menu: Menu, editor: Editor, info: MarkdownView | MarkdownFileInfo) => {
        const file = info?.file;
        if (!file) return;
        const line = editor.getCursor().line;
        const text = editor.getLine(line);
        if (!isTaskLine(text)) return;
        this.addTaskMenuItems(menu, editor, line, file.path);
      })
    );

    this.app.workspace.onLayoutReady(async () => {
      const cache = await this.persistence.load();
      await this.store.rebuild(cache ?? undefined);
      await this.persistence.save(this.store.buildSnapshot());
      // Dock the nav in the left sidebar so its tab icon sits at the top next
      // to Files/Search (no ribbon icon).
      await this.ensureNav();
      if (this.settings.enableContextSidebar) await this.activateContextView();
      if (this.settings.startupView !== "disabled") {
        // Land on the chosen list regardless of any restored in-memory selection.
        const v = this.settings.startupView;
        this.state.selection =
          v === "today"
            ? { type: "today" }
            : v === "flagged"
            ? { type: "flagged" }
            : { type: "all" };
        await this.activateView();
      }
      this.bus.emit("index:updated", { full: true });
      void maybeShowChangelog(this);
    });
  }

  /** Ensure the nav view exists in the left sidebar (without stealing focus). */
  private async ensureNav(): Promise<void> {
    const { workspace } = this.app;
    if (workspace.getLeavesOfType(VIEW_TYPE_REMINDERS_NAV).length > 0) return;
    const nav = workspace.getLeftLeaf(false);
    if (nav) await nav.setViewState({ type: VIEW_TYPE_REMINDERS_NAV });
  }

  onunload(): void {
    if (this.refreshTimer !== null) window.clearTimeout(this.refreshTimer);
  }

  /** Does a detail (sidecar) note exist for this block id? */
  private hasSidecar(blockId: string): boolean {
    return this.sidecar.findByBlockId(blockId) !== undefined;
  }

  /** Open the detail note for a block id (used by the inline note icons). */
  private openSidecarById(blockId: string): void {
    const path = this.sidecar.findByBlockId(blockId);
    if (path) void this.writer.openPath(path);
  }

  /**
   * Reading-view decoration: for each rendered task that carries a block id whose
   * detail note exists, append a clickable note icon linking to that sidecar.
   */
  private decorateTaskNotes(el: HTMLElement, ctx: MarkdownPostProcessorContext): void {
    const taskLis = Array.from(el.querySelectorAll<HTMLElement>("li.task-list-item"));
    if (taskLis.length === 0) return;

    // Authoritative block-id map: source line -> block id, for task list items.
    const cache = this.app.metadataCache.getCache(ctx.sourcePath);
    const blockIdByLine = new Map<number, string>();
    for (const it of cache?.listItems ?? []) {
      if (it.task != null && it.id) blockIdByLine.set(it.position.start.line, it.id);
    }
    if (blockIdByLine.size === 0) return;

    const info = ctx.getSectionInfo(el);
    const base = info ? info.lineStart : 0;

    // Ordered task lines within this section (for order-based fallback).
    const sectionTaskLines = Array.from(blockIdByLine.keys())
      .filter((ln) => !info || (ln >= info.lineStart && ln <= info.lineEnd))
      .sort((a, b) => a - b);

    taskLis.forEach((li, idx) => {
      // Resolve this row's source line. Prefer the checkbox's data-line (which may
      // be absolute or section-relative); fall back to order within the section.
      const cb = li.querySelector<HTMLElement>("input.task-list-item-checkbox, input[type=checkbox]");
      const raw = cb?.getAttribute("data-line") ?? li.getAttribute("data-line");
      let blockId: string | undefined;
      if (raw != null && raw !== "") {
        const rel = parseInt(raw, 10);
        if (!Number.isNaN(rel)) {
          blockId = blockIdByLine.get(rel + base) ?? blockIdByLine.get(rel);
        }
      }
      if (!blockId) blockId = blockIdByLine.get(sectionTaskLines[idx]);
      if (!blockId) return;
      const bid = blockId;

      if (!this.hasSidecar(bid)) return;
      if (li.querySelector(".tg-inline-note")) return;

      const icon = createSpan({ cls: "tg-inline-note" });
      setIcon(icon, "sticky-note");
      icon.setAttr("aria-label", "Open task note");
      icon.onClickEvent((e) => {
        e.preventDefault();
        e.stopPropagation();
        this.openSidecarById(bid);
      });

      // Place the icon right after the task text (before any nested list).
      const nested = li.querySelector(":scope > ul, :scope > ol");
      if (nested) li.insertBefore(icon, nested);
      else li.appendChild(icon);
    });
  }

  async activateView(): Promise<void> {
    const { workspace } = this.app;

    // Nav lives in the left dock.
    await this.ensureNav();
    const nav = workspace.getLeavesOfType(VIEW_TYPE_REMINDERS_NAV)[0] ?? null;

    // List lives in the center.
    await this.openList();
    this.bus.emit("index:updated", { full: true });
    if (nav) await workspace.revealLeaf(nav);
  }

  /** Ensure a center list leaf exists and reveal it. */
  async openList(): Promise<void> {
    const { workspace } = this.app;
    let leaf: WorkspaceLeaf | null =
      workspace.getLeavesOfType(VIEW_TYPE_REMINDERS)[0] ?? null;
    if (!leaf) {
      leaf = workspace.getLeaf(true);
      await leaf.setViewState({ type: VIEW_TYPE_REMINDERS, active: true });
    }
    await workspace.revealLeaf(leaf);
  }

  async activateContextView(): Promise<void> {
    const { workspace } = this.app;
    let leaf: WorkspaceLeaf | null =
      workspace.getLeavesOfType(VIEW_TYPE_REMINDERS_CONTEXT)[0] ?? null;
    if (!leaf) {
      leaf = workspace.getRightLeaf(false);
      if (!leaf) return;
      await leaf.setViewState({ type: VIEW_TYPE_REMINDERS_CONTEXT, active: true });
    }
    this.updateContextViews();
    await workspace.revealLeaf(leaf);
  }

  private onActiveLeafChange(leaf: WorkspaceLeaf | null): void {
    const type = leaf?.view?.getViewType();
    // Focusing the plugin's own nav/list view: blank the context sidebar.
    if (type === VIEW_TYPE_REMINDERS || type === VIEW_TYPE_REMINDERS_NAV) {
      this.setContextFile(null);
      return;
    }
    // Focusing the context view itself: leave it on the current file.
    if (type === VIEW_TYPE_REMINDERS_CONTEXT) return;
    this.updateContextViews();
  }

  private updateContextViews(): void {
    this.setContextFile(this.app.workspace.getActiveFile());
  }

  private setContextFile(file: TFile | null): void {
    this.bus.emit("file:changed", { path: file?.path ?? null });
  }

  private scheduleApplyFile(path: string): void {
    this.pendingRemoves.delete(path);
    this.pendingPaths.add(path);
    this.armRefresh();
  }

  private scheduleRemoveFile(path: string): void {
    this.pendingPaths.delete(path);
    this.pendingRemoves.add(path);
    this.armRefresh();
  }

  private armRefresh(): void {
    if (this.refreshTimer !== null) window.clearTimeout(this.refreshTimer);
    this.refreshTimer = window.setTimeout(() => {
      this.refreshTimer = null;
      void this.flushPending();
    }, 600);
  }

  private async flushPending(): Promise<void> {
    const removes = Array.from(this.pendingRemoves);
    const applies = Array.from(this.pendingPaths);
    this.pendingRemoves.clear();
    this.pendingPaths.clear();
    for (const p of removes) this.store.removeFile(p);
    for (const p of applies) await this.store.applyFile(p);
    this.bus.emit("index:updated", { full: false });
  }

  async reindex(): Promise<void> {
    await this.store.rebuild();
    await this.persistence.save(this.store.buildSnapshot());
    this.bus.emit("index:updated", { full: true });
  }

  private formatRepairReport(r: RepairReport): string {
    const mode = r.dryRun ? "dry-run" : "applied";
    return (
      `Repair (${mode}): ${r.checked} sidecars checked — ` +
      `${r.healthy} healthy, ${r.backfilled.length} backfilled, ` +
      `${r.orphans.length} orphaned, ${r.schemaMigrated} schema-stamped`
    );
  }

  /** Rescan just one file, merging its tasks into the store, then refresh. */
  async reindexFile(path: string): Promise<void> {
    await this.store.applyFile(path);
    this.bus.emit("index:updated", { full: false });
  }

  private addTaskMenuItems(
    menu: Menu,
    editor: Editor,
    lineNo: number,
    filePath: string
  ): void {
    const get = () => editor.getLine(lineNo);
    const set = (l: string) => editor.setLine(lineNo, l);

    const currentPrio = () => {
      const cur = parseLine(get(), filePath, lineNo, this.settings)?.priority ?? 0;
      return cur >= 1 && cur <= 3 ? cur : cur > 3 ? 3 : 0;
    };
    const setPrio = async (lvl: number) => {
      const def = await this.writer.resolveDefaultFormat();
      set(applyPriorityToLine(get(), lvl, this.settings.priorityTags, formatForLine(get(), def)));
    };

    buildMenu(menu, [
      { separator: true },
      {
        title: "Reminders: Priority",
        icon: "flag",
        submenu: priorityActions(currentPrio(), (lvl) => void setPrio(lvl)),
      },
      {
        title: "Reminders: Set due date…",
        icon: "calendar",
        onClick: async () => {
          const d = await promptDate(this.app, "Due date");
          if (d !== undefined) {
            const def = await this.writer.resolveDefaultFormat();
            set(applyDueToLine(get(), d, formatForLine(get(), def)));
          }
        },
      },
      {
        title: "Reminders: Toggle #today",
        icon: "star",
        onClick: () => set(toggleTagInLine(get(), "today")),
      },
      {
        title: "Reminders: Open detail note",
        icon: "sticky-note",
        onClick: async () => {
          const parsed = parseLine(get(), filePath, lineNo, this.settings);
          const title = parsed?.text || get();
          const { line: stamped, blockId } = ensureBlockIdInLine(get());
          if (stamped !== get()) set(stamped);
          const path = await this.writer.ensureSidecarFor(blockId, title, filePath, parsed ?? undefined);
          await this.writer.openPath(path);
        },
      },
      {
        title: "Reminders: Reveal in task list",
        icon: "check-check",
        onClick: async () => {
          await this.activateView();
          for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_REMINDERS)) {
            const v = leaf.view;
            if (v instanceof RemindersView) v.revealTask(filePath);
          }
          this.bus.emit("index:updated", { full: true });
        },
      },
    ]);
  }

  async loadSettings(): Promise<void> {
    const data = (await this.loadData()) as Partial<ObsidianRemindersSettings> | null;
    this.settings = Object.assign({}, DEFAULT_SETTINGS, data ?? {});
    if (typeof this.settings.navShowCounts !== "object" || this.settings.navShowCounts === null)
      this.settings.navShowCounts = { ...DEFAULT_SETTINGS.navShowCounts };
    for (const def of NAV_SECTIONS) {
      if (!this.settings.navOrder.includes(def.id))
        this.settings.navOrder.push(def.id);
      if (!(def.id in this.settings.navShowCounts))
        this.settings.navShowCounts[def.id] = true;
    }
    this.lastScopeKey = this.scopeKey();
  }

  /** Settings keys whose change can alter the set of indexed files. */
  private scopeKey(): string {
    return JSON.stringify([
      this.settings.bucketRoots,
      this.settings.inboxRoots,
      this.settings.ignorePaths,
    ]);
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
    this.bus.emit("settings:changed", undefined);
    const key = this.scopeKey();
    if (key !== this.lastScopeKey) {
      this.lastScopeKey = key;
      await this.reindex();
    }
  }
}
