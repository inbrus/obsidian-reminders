// The single point of contact with Obsidian's vault API. Every `instanceof
// TFile`/`TFolder`, every `vault.*` and `metadataCache.*` call lives here —
// nowhere else in src/ touches those types. Services and core depend only on
// the ports (IVaultAdapter, ILinkResolver), so they are testable with fakes.

import { App, TFile, TFolder, TAbstractFile, normalizePath } from "obsidian";
import { IVaultAdapter, VaultFileMeta } from "../ports/vault-adapter";
import { ILinkResolver } from "../ports/link-resolver";

export class ObsidianVaultAdapter implements IVaultAdapter, ILinkResolver {
  constructor(private app: App) {}

  /** True if the abstract file is a markdown note (single instanceof gate). */
  isMarkdownFile(f: TAbstractFile): boolean {
    return f instanceof TFile && f.extension === "md";
  }

  /** Resolve a vault path to its note, or null. (instanceof gate; used by presentation.) */
  getNote(path: string): TFile | null {
    const f = this.app.vault.getAbstractFileByPath(path);
    return f instanceof TFile ? f : null;
  }

  async scopedFiles(
    bucketRoots: string[],
    inboxRoots: string[]
  ): Promise<VaultFileMeta[]> {
    const roots = new Set<string>([...bucketRoots, ...inboxRoots]);
    const seen = new Set<string>();
    const out: VaultFileMeta[] = [];

    const walk = (folder: TFolder) => {
      for (const child of folder.children) {
        if (child instanceof TFolder) {
          walk(child);
        } else if (child instanceof TFile && child.extension === "md") {
          if (!seen.has(child.path)) {
            seen.add(child.path);
            out.push({
              path: child.path,
              mtime: child.stat?.mtime ?? 0,
              ctime: child.stat?.ctime ?? 0,
            });
          }
        }
      }
    };

    for (const root of roots) {
      const dir = this.app.vault.getAbstractFileByPath(root.replace(/\/$/, ""));
      if (dir instanceof TFolder) {
        walk(dir);
      } else if (dir instanceof TFile && dir.extension === "md" && !seen.has(dir.path)) {
        seen.add(dir.path);
        out.push({
          path: dir.path,
          mtime: dir.stat?.mtime ?? 0,
          ctime: dir.stat?.ctime ?? 0,
        });
      }
    }
    return out;
  }

  async read(path: string): Promise<string> {
    const file = this.app.vault.getAbstractFileByPath(path);
    if (file instanceof TFile) return await this.app.vault.cachedRead(file);
    return "";
  }

  exists(path: string): boolean {
    return this.app.vault.getAbstractFileByPath(path) != null;
  }

  async process(
    path: string,
    transform: (content: string) => string
  ): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) return;
    await this.app.vault.process(file, transform);
  }

  async create(path: string, content: string): Promise<void> {
    await this.app.vault.create(path, content);
  }

  async createFolder(path: string): Promise<void> {
    await this.app.vault.createFolder(path);
  }

  listFolder(folder: string): string[] {
    const dir = this.app.vault.getAbstractFileByPath(normalizePath(folder));
    if (!(dir instanceof TFolder)) return [];
    return dir.children
      .filter((c): c is TFile => c instanceof TFile)
      .map((f) => f.name);
  }

  async openFile(path: string): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(path);
    if (file instanceof TFile) {
      await this.app.workspace.getLeaf(true).openFile(file);
    }
  }

  resolve(link: string, fromPath: string): string | undefined {
    const dest = this.app.metadataCache.getFirstLinkpathDest(link, fromPath);
    return dest ? dest.path : undefined;
  }
}
