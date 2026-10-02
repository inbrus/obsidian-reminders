// Port: raw file storage under the vault (for the plugin's own directory). The
// persistent index cache lives here, NOT in data.json — Obsidian reads data.json
// whole on every saveData, so a large index there degrades, especially on mobile.

export interface IStorage {
  /** Read raw text at a vault-relative path, or null if missing. */
  read(path: string): Promise<string | null>;
  /** Write raw text at a vault-relative path (creating parents as needed). */
  write(path: string, data: string): Promise<void>;
  /** Remove a file if it exists. */
  remove(path: string): Promise<void>;
}
