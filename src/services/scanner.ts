// VaultScanner: read all scoped markdown files through the adapter and turn
// them into TaskItems via the pure parser. Replaces the old scanVault/scanFile
// that lived in src/parser.ts and walked TFile/TFolder directly.

import { IVaultAdapter } from "../ports/vault-adapter";
import { TaskItem } from "../core/models";
import { TaskgregatorSettings } from "../settings";
import { parseLine, isIgnored } from "../core/parser";
import { SidecarService } from "./sidecar";

export class VaultScanner {
  constructor(
    private adapter: IVaultAdapter,
    private sidecar: SidecarService,
    private settings: TaskgregatorSettings
  ) {}

  async scan(): Promise<TaskItem[]> {
    const files = await this.adapter.scopedFiles(
      this.settings.bucketRoots,
      this.settings.inboxRoots
    );
    const out: TaskItem[] = [];
    for (const file of files) {
      if (isIgnored(file.path, this.settings)) continue;
      out.push(...(await this.scanFile(file.path, file.mtime, file.ctime)));
    }
    return out;
  }

  /** Scan a single file for tasks, given its stat times (no re-stat needed). */
  private async scanFile(
    path: string,
    mtime: number,
    ctime: number
  ): Promise<TaskItem[]> {
    if (isIgnored(path, this.settings)) return [];
    const content = await this.adapter.read(path);
    const lines = content.split("\n");
    const out: TaskItem[] = [];
    let inCode = false;
    for (let i = 0; i < lines.length; i++) {
      const trimmed = lines[i].trimStart();
      if (trimmed.startsWith("```")) {
        inCode = !inCode;
        continue;
      }
      if (inCode) continue;
      const task = parseLine(lines[i], path, i, this.settings);
      if (task) {
        task.mtime = mtime;
        task.ctime = ctime;
        if (task.blockId) {
          const sf = this.sidecar.findByBlockId(task.blockId);
          if (sf) task.sidecarPath = sf;
        }
        out.push(task);
      }
    }
    return out;
  }
}
