import { App, Component, MarkdownRenderer, Modal, normalizePath, requestUrl } from "obsidian";
import type Taskgregator from "./main";

// GitHub repo the plugin is published from. Community installs ship only
// main.js/manifest.json/styles.css, so CHANGELOG.md and its screenshots aren't
// present locally; we fetch/point at the raw files on `main` as a fallback.
const REPO = "philpalmieri/obsidian-taskgregator";
const RAW_BASE = `https://raw.githubusercontent.com/${REPO}/main`;

/**
 * "What's New" modal. Renders the current version's section from CHANGELOG.md,
 * read from the local plugin folder when available (dev / cloned installs) and
 * fetched from GitHub raw otherwise (community installs). Screenshots use
 * absolute GitHub raw URLs in the changelog, so they load either way.
 */
export class ChangelogModal extends Modal {
  private plugin: Taskgregator;
  private version: string;
  private body: Component = new Component();

  constructor(app: App, plugin: Taskgregator, version: string) {
    super(app);
    this.plugin = plugin;
    this.version = version;
  }

  async onOpen(): Promise<void> {
    this.modalEl.addClass("tg-changelog-modal");
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h2", { text: `What's new in Taskgregator ${this.version}` });

    const md = await this.loadSection();
    const target = contentEl.createDiv({ cls: "tg-changelog-body markdown-rendered" });
    this.body.load();
    await MarkdownRenderer.render(this.app, md, target, this.pluginDir(), this.body);

    const footer = contentEl.createDiv({ cls: "tg-changelog-footer" });
    const ok = footer.createEl("button", { text: "Got it", cls: "mod-cta" });
    ok.onclick = () => this.close();
  }

  onClose(): void {
    this.body.unload();
    this.contentEl.empty();
  }

  private pluginDir(): string {
    return this.plugin.manifest.dir ?? normalizePath(`.obsidian/plugins/${this.plugin.manifest.id}`);
  }

  /** Load CHANGELOG.md and slice out the current version's section. */
  private async loadSection(): Promise<string> {
    const full = await this.loadChangelogText();
    if (!full) {
      return `Couldn't load the changelog. See it on [GitHub](https://github.com/${REPO}/blob/main/CHANGELOG.md).`;
    }
    const section = extractVersionSection(full, this.version) ?? full;
    return this.absolutizeImages(section);
  }

  /**
   * Prefer the local CHANGELOG.md (present in dev / cloned installs); fall back
   * to GitHub raw for community installs, where only the built artifacts ship.
   */
  private async loadChangelogText(): Promise<string | null> {
    const path = normalizePath(`${this.pluginDir()}/CHANGELOG.md`);
    try {
      if (await this.app.vault.adapter.exists(path)) {
        return await this.app.vault.adapter.read(path);
      }
    } catch {
      /* fall through to the remote copy */
    }
    try {
      const res = await requestUrl({ url: `${RAW_BASE}/CHANGELOG.md` });
      if (res.status === 200) return res.text;
    } catch {
      /* offline or rate-limited: handled by the caller */
    }
    return null;
  }

  /**
   * Safety net for any relative image target: resolve it to an absolute GitHub
   * raw URL so it loads for community installs (where local assets are absent).
   * Absolute sources (http/https/data/app) are left untouched.
   */
  private absolutizeImages(md: string): string {
    return md.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (whole, alt: string, target: string) => {
      const src = target.trim();
      if (/^(https?:|data:|app:)/i.test(src)) return whole;
      return `![${alt}](${RAW_BASE}/${src.replace(/^\/+/, "")})`;
    });
  }
}

/** Extract the `## <version>` section (up to the next `## `) from a changelog. */
export function extractVersionSection(changelog: string, version: string): string | null {
  const lines = changelog.split("\n");
  const esc = version.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const start = new RegExp(`^##\\s+v?${esc}\\b`);
  let from = -1;
  for (let i = 0; i < lines.length; i++) {
    if (start.test(lines[i])) {
      from = i;
      break;
    }
  }
  if (from === -1) return null;
  let to = lines.length;
  for (let i = from + 1; i < lines.length; i++) {
    if (/^##\s+/.test(lines[i])) {
      to = i;
      break;
    }
  }
  return lines.slice(from, to).join("\n").trim();
}

/**
 * Show the changelog once per version bump. Compares the stored lastSeenVersion
 * against the running manifest version; on a mismatch (and when the toggle is
 * on) it opens the modal, then records the new version so it won't repeat.
 * Always records the version even when the modal is suppressed, so toggling the
 * setting on later doesn't retroactively pop an old changelog.
 */
export async function maybeShowChangelog(plugin: Taskgregator): Promise<void> {
  const current = plugin.manifest.version;
  const seen = plugin.settings.lastSeenVersion;
  if (seen === current) return;

  const shouldShow = plugin.settings.showChangelogOnUpdate;
  plugin.settings.lastSeenVersion = current;
  await plugin.saveData(plugin.settings);

  if (shouldShow) new ChangelogModal(plugin.app, plugin, current).open();
}

/** Command-triggered manual open (ignores the seen-version gate). */
export function openChangelog(plugin: Taskgregator): void {
  new ChangelogModal(plugin.app, plugin, plugin.manifest.version).open();
}
