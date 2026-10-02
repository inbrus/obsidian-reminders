// Port: vault file access. The core and services depend on this interface only;
// infra/obsidian-vault-adapter.ts is the single implementation and the only
// layer that touches TFile/TFolder. Every consumer goes through here so the
// plugin's behavior can be exercised in tests with a fake adapter.

/** Minimal per-file metadata the index needs (no Obsidian types). */
export interface VaultFileMeta {
  path: string;
  mtime: number;
  ctime: number;
}

export interface IVaultAdapter {
  /** Markdown files under the configured bucket/inbox roots (deduped, non-recursive in name only — the adapter walks). */
  scopedFiles(bucketRoots: string[], inboxRoots: string[]): Promise<VaultFileMeta[]>;
  /** Stat a single file (mtime/ctime), or null if missing or not a note. */
  stat(path: string): Promise<VaultFileMeta | null>;
  /** Read a file's full text. Empty string if missing. */
  read(path: string): Promise<string>;
  /** True if a file or folder exists at `path`. */
  exists(path: string): boolean;
  /** Atomically transform a file's content (vault.process semantics). */
  process(path: string, transform: (content: string) => string): Promise<void>;
  /** Create a file at `path` (parents must exist). */
  create(path: string, content: string): Promise<void>;
  /** Create a folder at `path`, recursively. */
  createFolder(path: string): Promise<void>;
  /** Basenames of files directly inside a folder (non-recursive). */
  listFolder(folder: string): string[];
  /** Open a file in a new leaf. */
  openFile(path: string): Promise<void>;
}
