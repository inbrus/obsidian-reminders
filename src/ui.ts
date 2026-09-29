import { App, Menu, Modal, setIcon } from "obsidian";
import { TaskItem } from "./types";
import { TaskWriter } from "./writer";
import { ALT_CHECKBOX_ICONS, nextStatusChar } from "./parser";
import { toIso, fromIso } from "./dateFormat";

/**
 * Shared task-row rendering used by both the full Taskgregator hub view and the
 * context sidebar. Kept UI-framework-free (just DOM) so either host can call it.
 */
export interface TaskRowCtx {
  app: App;
  writer: TaskWriter;
  reindexFile: (path: string) => Promise<void>;
  rerender: () => void;
  // Age (in days) at/above which the created-age chip turns "aged" (warning
  // color) instead of the neutral grey. Mirrors the Aging smart list threshold.
  agingDays: number;
  // Navigate to the in-plugin list for an inline #tag (host wires this to the
  // shared selection). Omitted callers fall back to Obsidian global search.
  onTagClick?: (tag: string) => void;
}

export function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Whole days between a YYYY-MM-DD date and today (0 if today, negative future). */
export function daysSince(date: string): number | undefined {
  const then = Date.parse(date + "T00:00:00");
  if (Number.isNaN(then)) return undefined;
  const now = Date.parse(todayStr() + "T00:00:00");
  return Math.round((now - then) / 86400000);
}

/** Human age label: "Today", "1 Day", "5 Days". */
export function formatAge(days: number): string {
  if (days <= 0) return "Today";
  return `${days} ${days === 1 ? "Day" : "Days"}`;
}

export function jumpToSource(app: App, task: TaskItem): void {
  const link = task.blockId ? `${task.filePath}#^${task.blockId}` : task.filePath;
  void app.workspace.openLinkText(link, "", false);
}

export function renderTaskRow(parent: HTMLElement, task: TaskItem, ctx: TaskRowCtx): void {
  const row = parent.createDiv({
    cls: "tg-task" + (task.priority > 0 ? " has-prio p" + task.priority : ""),
  });

  // Checkbox.
  const cb = row.createDiv({ cls: "tg-check" });
  cb.setAttr("data-status", task.statusChar);
  cb.style.touchAction = "manipulation";
  const alt = ALT_CHECKBOX_ICONS[task.statusChar];
  if (alt) {
    setIcon(cb, alt.icon);
    cb.addClass("is-alt");
  } else if (task.status === "done") {
    cb.addClass("is-done");
  } else if (task.status === "inProgress") {
    cb.addClass("is-doing");
  }
  cb.onclick = async () => {
    await ctx.writer.setStatus(task, nextStatusChar(task.statusChar));
    await ctx.reindexFile(task.filePath);
    ctx.rerender();
  };
  cb.oncontextmenu = (e) => {
    e.preventDefault();
    e.stopPropagation();
    taskMenu(e, task, ctx);
  };
  cb.addEventListener("auxclick", (e) => {
    if (e.button === 1) {
      e.preventDefault();
      e.stopPropagation();
      taskMenu(e, task, ctx);
    }
  });
  let lpTimer: number | null = null;
  const cancelLp = () => {
    if (lpTimer) {
      clearTimeout(lpTimer);
      lpTimer = null;
    }
  };
  cb.addEventListener("pointerdown", (e) => {
    if (e.pointerType === "mouse") return;
    lpTimer = window.setTimeout(() => {
      lpTimer = null;
      taskMenu(e, task, ctx);
    }, 500);
  });
  cb.addEventListener("pointerup", cancelLp);
  cb.addEventListener("pointermove", cancelLp);
  cb.addEventListener("pointercancel", cancelLp);

  // Body.
  const body = row.createDiv({ cls: "tg-task-body" });
  const textEl = body.createDiv({ cls: "tg-task-text" });
  if (task.status === "done" || task.status === "cancelled") textEl.addClass("is-struck");
  renderTextWithLinks(ctx.app, textEl, task.text, task.links, ctx.onTagClick);
  textEl.onclick = (e) => {
    if (textEl.querySelector(".tg-inline-edit")) return;
    const tgt = e.target as HTMLElement | null;
    if (tgt && tgt.closest && (tgt.closest("a") || tgt.closest(".tg-tag"))) return;
    startInlineEdit(textEl, task, ctx);
  };

  // Meta row: context, dates, tags.
  const meta = body.createDiv({ cls: "tg-task-meta" });
  if (task.meta.created) {
    const days = daysSince(task.meta.created);
    if (days !== undefined) {
      const age = meta.createSpan({ cls: "tg-chip tg-age" });
      if (days >= Math.max(1, ctx.agingDays)) age.addClass("is-aged");
      age.setText("🌱 " + formatAge(days));
      age.setAttr("aria-label", "Created " + task.meta.created);
    }
  }
  const ctxChip = meta.createSpan({ cls: "tg-chip tg-ctx" });
  ctxChip.setText(`${task.bucketRoot}: ${task.bucketFile}`);
  ctxChip.onclick = () => jumpToSource(ctx.app, task);
  if (task.meta.due) {
    const cls = task.meta.due < todayStr() ? "is-overdue" : "";
    renderDateChip(ctx.app, meta, task.meta.due, "📅", cls);
  }
  if (task.meta.start) renderDateChip(ctx.app, meta, task.meta.start, "🛫");
  for (const tag of task.tags) meta.createSpan({ cls: "tg-chip tg-tag", text: "#" + tag });
  if (task.sidecarPath) {
    const note = meta.createSpan({ cls: "tg-chip tg-note", text: "📝" });
    note.setAttr("aria-label", "Open detail note");
    note.onclick = (ev) => {
      ev.stopPropagation();
      void ctx.writer.openPath(task.sidecarPath as string);
    };
  }

  // Priority indicator (solid circle, colored by level).
  const flag = row.createDiv({ cls: "tg-prio p" + task.priority });
  flag.setAttr("aria-label", "Cycle priority");
  flag.onclick = async () => {
    const cur = task.priority >= 1 && task.priority <= 3 ? task.priority : task.priority > 3 ? 3 : 0;
    const next = (cur + 1) % 4;
    await ctx.writer.setPriority(task, next);
    await ctx.reindexFile(task.filePath);
    ctx.rerender();
  };

  // Actions menu (also available via right-click on the row).
  const more = row.createDiv({ cls: "tg-more" });
  setIcon(more, "more-horizontal");
  more.onclick = (e) => taskMenu(e, task, ctx);
  row.oncontextmenu = (e) => {
    e.preventDefault();
    taskMenu(e, task, ctx);
  };
}

function taskMenu(e: MouseEvent, task: TaskItem, ctx: TaskRowCtx): void {
  const menu = new Menu();

  // Priority: submenu if the platform supports it, else flat P1..P3 + None.
  menu.addItem((item) => {
    item.setTitle("Priority").setIcon("flag");
    const levels: Array<[string, number]> = [
      ["None", 0],
      ["P1 (high)", 1],
      ["P2 (medium)", 2],
      ["P3 (low)", 3],
    ];
    const setPrio = async (lvl: number) => {
      await ctx.writer.setPriority(task, lvl);
      await ctx.reindexFile(task.filePath);
      ctx.rerender();
    };
    const sub = (item as unknown as { setSubmenu?: () => Menu }).setSubmenu?.();
    if (sub) {
      for (const [label, lvl] of levels) {
        sub.addItem((s) =>
          s.setTitle(label).setChecked(task.priority === lvl).onClick(() => void setPrio(lvl))
        );
      }
    } else {
      item.onClick(() => {
        const cur = task.priority >= 1 && task.priority <= 3 ? task.priority : task.priority > 3 ? 3 : 0;
        void setPrio((cur + 1) % 4);
      });
    }
  });

  menu.addSeparator();

  // Type: alternative checkbox statuses (Anything-style).
  menu.addItem((item) => {
    item.setTitle("Type").setIcon("tag");
    const setType = async (ch: string) => {
      await ctx.writer.setStatus(task, ch);
      await ctx.reindexFile(task.filePath);
      ctx.rerender();
    };
    const sub = (item as unknown as { setSubmenu?: () => Menu }).setSubmenu?.();
    if (sub) {
      for (const [ch, def] of Object.entries(ALT_CHECKBOX_ICONS)) {
        sub.addItem((s) =>
          s
            .setTitle(def.label)
            .setIcon(def.icon)
            .setChecked(task.statusChar === ch)
            .onClick(() => void setType(ch))
        );
      }
    } else {
      item.setDisabled(true);
      for (const [ch, def] of Object.entries(ALT_CHECKBOX_ICONS)) {
        menu.addItem((s) =>
          s
            .setTitle(def.label)
            .setIcon(def.icon)
            .setChecked(task.statusChar === ch)
            .onClick(() => void setType(ch))
        );
      }
    }
  });

  menu.addItem((i) =>
    i.setTitle("Set due date").setIcon("calendar").onClick(async () => {
      const d = await promptDate(ctx.app, "Due date", task.meta.due);
      if (d === undefined) return;
      const iso = d === null ? null : toIso(d) ?? d;
      await ctx.writer.setDue(task, iso);
      await ctx.reindexFile(task.filePath);
      ctx.rerender();
    })
  );
  menu.addItem((i) =>
    i.setTitle("Set start date").setIcon("plane").onClick(async () => {
      const d = await promptDate(ctx.app, "Start date", task.meta.start);
      if (d === undefined) return;
      const iso = d === null ? null : toIso(d) ?? d;
      await ctx.writer.setStart(task, iso);
      await ctx.reindexFile(task.filePath);
      ctx.rerender();
    })
  );
  menu.addItem((i) =>
    i
      .setTitle("Toggle #today")
      .setIcon("star")
      .setChecked(task.tags.includes("today"))
      .onClick(async () => {
        await ctx.writer.toggleTag(task, "today");
        await ctx.reindexFile(task.filePath);
        ctx.rerender();
      })
  );
  menu.addSeparator();
  menu.addItem((i) =>
    i.setTitle("Open detail note").setIcon("sticky-note").onClick(async () => {
      await ctx.writer.openSidecar(task);
      await ctx.reindexFile(task.filePath);
    })
  );
  menu.addItem((i) =>
    i.setTitle("Jump to source").setIcon("arrow-up-right").onClick(() => jumpToSource(ctx.app, task))
  );
  menu.addSeparator();
  menu.addItem((i) =>
    i.setTitle("Cancel task").setIcon("x").onClick(async () => {
      await ctx.writer.setStatus(task, "-");
      await ctx.reindexFile(task.filePath);
      ctx.rerender();
    })
  );
  menu.showAtMouseEvent(e);
}

export function renderTextWithLinks(
  app: App,
  el: HTMLElement,
  text: string,
  _links: string[],
  _onTagClick?: (tag: string) => void
): void {
  // Render [[wikilinks]], Markdown inline links, and inline markdown formatting
  // (==highlight==, **bold**, *italic*, ~~strike~~, `code`) as DOM; rest as plain
  // text. Inline #tags are consumed (matched) but not rendered here — they show
  // as chips in the meta row instead.
  const re =
    /\[\[([^\]]+?)\]\]|\[([^\]\n]+?)\]\(([^)\s]+)\)|(^|\s)#([A-Za-z][\w\-/]*)|==([^=\n]+?)==|\*\*([^*\n]+?)\*\*|\*([^*\n]+?)\*|~~([^~\n]+?)~~|`([^`\n]+?)`/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) el.appendText(text.slice(last, m.index));

    if (m[1] !== undefined) {
      renderWikilink(app, el, m[1]);
    } else if (m[2] !== undefined) {
      renderMarkdownLink(app, el, m[2], m[3]);
    } else if (m[6] !== undefined) {
      const span = el.createEl("mark", { text: m[6] });
      span.addClass("tg-highlight");
    } else if (m[7] !== undefined) {
      const span = el.createEl("strong", { text: m[7] });
      span.addClass("tg-bold");
    } else if (m[8] !== undefined) {
      const span = el.createEl("em", { text: m[8] });
      span.addClass("tg-italic");
    } else if (m[9] !== undefined) {
      const span = el.createEl("s", { text: m[9] });
      span.addClass("tg-strike");
    } else if (m[10] !== undefined) {
      const span = el.createEl("code", { text: m[10] });
      span.addClass("tg-code");
    }

    last = m.index + m[0].length;
  }
  if (last < text.length) el.appendText(text.slice(last));
}

function renderWikilink(app: App, el: HTMLElement, linkText: string): void {
  const target = linkText.split("|")[0];
  const label = linkText.split("|")[1] || (target.split("/").pop() as string);
  const a = el.createEl("a", { cls: "tg-link internal-link", text: label });
  a.onclick = (ev) => {
    ev.preventDefault();
    void app.workspace.openLinkText(target, "", false);
  };
}

function renderMarkdownLink(app: App, el: HTMLElement, label: string, target: string): void {
  const external = /^(https?:|mailto:|obsidian:)/i.test(target);
  const a = el.createEl("a", {
    cls: external ? "tg-link external-link" : "tg-link internal-link",
    text: label,
  });

  if (external) {
    a.setAttr("href", target);
    a.setAttr("target", "_blank");
    a.setAttr("rel", "noopener noreferrer");
    a.onclick = (ev) => {
      ev.preventDefault();
      window.open(target, "_blank", "noopener");
    };
    return;
  }

  a.onclick = (ev) => {
    ev.preventDefault();
    void app.workspace.openLinkText(target, "", false);
  };
}

/** Start an inline edit of the task text; Enter/blur commits, Escape cancels. */
function startInlineEdit(textEl: HTMLElement, task: TaskItem, ctx: TaskRowCtx): void {
  const original = task.text;
  const restore = () => {
    textEl.empty();
    renderTextWithLinks(ctx.app, textEl, original, task.links, ctx.onTagClick);
  };
  textEl.empty();
  const input = textEl.createEl("input", { cls: "tg-inline-edit" });
  input.value = original;
  input.focus();
  input.select();
  let finished = false;
  const commit = async () => {
    if (finished) return;
    finished = true;
    const v = input.value;
    if (v === original) {
      restore();
      return;
    }
    await ctx.writer.setText(task, v);
    await ctx.reindexFile(task.filePath);
    ctx.rerender();
  };
  const cancel = () => {
    if (finished) return;
    finished = true;
    restore();
  };
  input.addEventListener("blur", () => {
    if (document.activeElement === input) return;
    void commit();
  });
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      void commit();
    } else if (e.key === "Escape") {
      e.preventDefault();
      cancel();
    }
  });
}

/** Render a date as a clickable wikilink chip (opens the matching daily note). */
function renderDateChip(
  app: App,
  parent: HTMLElement,
  iso: string,
  emoji: string,
  extraCls?: string
): void {
  const display = fromIso(iso);
  const target = display;
  const a = parent.createEl("a", {
    cls: "tg-link internal-link tg-date-link" + (extraCls ? " " + extraCls : ""),
    text: `${emoji} ${display}`,
  });
  a.onclick = (ev) => {
    ev.preventDefault();
    void app.workspace.openLinkText(target, "", false);
  };
}

class DateModal extends Modal {
  value: string;
  label: string;
  resolve: (v: string | null | undefined) => void;

  constructor(app: App, label: string, initial: string | undefined, resolve: (v: string | null | undefined) => void) {
    super(app);
    this.label = label;
    this.value = initial || "";
    this.resolve = resolve;
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("tg-date-modal");
    const title = contentEl.createEl("h3", { text: this.label });
    title.addClass("tg-date-modal-title");
    const help = contentEl.createDiv({ cls: "tg-date-modal-hint" });
    help.setText("Saved as [[DD-MM-YYYY]] wikilink.");
    const input = contentEl.createEl("input", { type: "date", cls: "tg-date-input" });
    input.value = this.value || "";
    input.focus();
    const btns = contentEl.createDiv({ cls: "tg-date-modal-btns" });
    const save = btns.createEl("button", { text: "Save", cls: "mod-cta tg-date-btn" });
    save.onclick = () => {
      this.resolve(input.value || null);
      this.close();
    };
    const clear = btns.createEl("button", { text: "Clear", cls: "tg-date-btn" });
    clear.onclick = () => {
      this.resolve(null);
      this.close();
    };
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        this.resolve(input.value || null);
        this.close();
      }
    });
  }

  onClose(): void {
    this.contentEl.empty();
  }
}

export function promptDate(app: App, label: string, initial?: string): Promise<string | null | undefined> {
  return new Promise((resolve) => {
    let settled = false;
    const modal = new DateModal(app, label, initial, (v) => {
      settled = true;
      resolve(v);
    });
    const origClose = modal.onClose.bind(modal);
    modal.onClose = () => {
      origClose();
      if (!settled) resolve(undefined);
    };
    modal.open();
  });
}
