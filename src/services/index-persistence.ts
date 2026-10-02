// IndexPersistence: serialize/restore the index cache to a standalone file in
// the plugin directory (not data.json). The cache is a fast path only — markdown
// stays the single source of truth; any mtime mismatch forces a re-read.

import { IStorage } from "../ports/storage";
import { TaskItem } from "../core/models";

export const INDEX_SCHEMA_VERSION = 1;

/** Per-file cache: the file's mtime plus the tasks parsed from it. */
export interface FileCache {
  mtime: number;
  tasks: TaskItem[];
}

export interface IndexSnapshot {
  schemaVersion: number;
  files: Record<string, FileCache>;
  builtAt: number;
}

export class IndexPersistence {
  constructor(private storage: IStorage, private cachePath: string) {}

  /** Load a valid snapshot, or null if missing/corrupt/wrong schema version. */
  async load(): Promise<IndexSnapshot | null> {
    const raw = await this.storage.read(this.cachePath);
    if (raw === null) return null;
    try {
      const s = JSON.parse(raw) as IndexSnapshot;
      if (!s || s.schemaVersion !== INDEX_SCHEMA_VERSION || typeof s.files !== "object") {
        return null;
      }
      return s;
    } catch {
      return null;
    }
  }

  async save(snapshot: IndexSnapshot): Promise<void> {
    await this.storage.write(this.cachePath, JSON.stringify(snapshot));
  }

  async clear(): Promise<void> {
    await this.storage.remove(this.cachePath);
  }
}
