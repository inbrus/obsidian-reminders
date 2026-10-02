// ObsidianStorage: raw read/write through the vault adapter (filesystem), used
// for files in the plugin's own .obsidian/plugins/<id>/ directory — outside the
// markdown vault tree. The single implementation of IStorage.

import { App, normalizePath } from "obsidian";
import { IStorage } from "../ports/storage";

export class ObsidianStorage implements IStorage {
  constructor(private app: App) {}

  async read(path: string): Promise<string | null> {
    const p = normalizePath(path);
    if (await this.app.vault.adapter.exists(p)) {
      return await this.app.vault.adapter.read(p);
    }
    return null;
  }

  async write(path: string, data: string): Promise<void> {
    await this.app.vault.adapter.write(normalizePath(path), data);
  }

  async remove(path: string): Promise<void> {
    const p = normalizePath(path);
    if (await this.app.vault.adapter.exists(p)) {
      await this.app.vault.adapter.remove(p);
    }
  }
}
