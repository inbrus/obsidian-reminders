// IdentityMigration: reconcile sidecar detail notes with their source tasks and
// backfill missing block ids. Dry-run by default — the only non-reporting writes
// are (a) stamping `schemaVersion` and (b) appending a `^blockId` to a task line
// whose sidecar already exists. Neither touches markdown formatting otherwise.

import { IVaultAdapter } from "../ports/vault-adapter";
import { ObsidianRemindersSettings } from "../settings";
import { parseLine } from "../core/parser";
import { blockIdOf } from "../core/line-transforms";
import {
  normalizePath,
  parseSidecarFrontmatter,
  SIDECAR_SCHEMA_VERSION,
  stripTagsFromTitle,
  SidecarMeta,
} from "../core/sidecar";

export interface RepairReport {
  dryRun: boolean;
  checked: number;
  healthy: number;
  backfilled: string[]; // source paths where a ^blockId was (or would be) appended
  orphans: string[]; // sidecar paths whose source task could not be located
  schemaMigrated: number; // sidecars stamped with the current schemaVersion
}

export class IdentityMigration {
  constructor(
    private adapter: IVaultAdapter,
    private settings: ObsidianRemindersSettings
  ) {}

  async repairIdentities(dryRun = true): Promise<RepairReport> {
    const report: RepairReport = {
      dryRun,
      checked: 0,
      healthy: 0,
      backfilled: [],
      orphans: [],
      schemaMigrated: 0,
    };

    const folder = normalizePath(this.settings.sidecarFolder);
    const names = this.adapter.listFolder(folder);
    for (const name of names) {
      if (!name.endsWith(".md")) continue;
      const path = `${folder}/${name}`;
      const content = await this.adapter.read(path);
      const meta = parseSidecarFrontmatter(content);
      if (!meta) continue;
      report.checked++;

      // 1. Stamp the schema version when missing (safe, additive).
      if (!meta.schemaVersion) {
        report.schemaMigrated++;
        if (!dryRun) {
          await this.adapter.process(path, (c) => this.stampSchemaVersion(c));
        }
      }

      const sourcePath = `${meta.sourcePath}.md`;
      const source = await this.adapter.read(sourcePath);

      // 2. Healthy: the source note still carries this exact block id.
      if (source && source.includes("^" + meta.blockId)) {
        report.healthy++;
        continue;
      }

      // 3. Missing block id: locate the task by title and backfill it.
      if (source) {
        const idx = this.locateByTitle(source, meta);
        if (idx >= 0) {
          if (!dryRun) {
            await this.backfillBlockId(sourcePath, meta.blockId, idx);
          }
          report.backfilled.push(meta.sourcePath);
          continue;
        }
      }

      report.orphans.push(path);
    }

    return report;
  }

  /** Find the source task line by matching its cleaned title. */
  private locateByTitle(content: string, meta: SidecarMeta): number {
    const lines = content.split("\n");
    const sourcePath = `${meta.sourcePath}.md`;
    return lines.findIndex((l) => {
      const t = parseLine(l, sourcePath, 0, this.settings);
      return !!t && stripTagsFromTitle(t.text, t.tags) === meta.title;
    });
  }

  /** Insert `schemaVersion: N` right after the blockId line (or after ---). */
  private stampSchemaVersion(content: string): string {
    if (content.includes("schemaVersion:")) return content;
    const m = content.match(/^(blockId:.*)$/m);
    if (m) return content.replace(m[1], `${m[1]}\nschemaVersion: ${SIDECAR_SCHEMA_VERSION}`);
    return content.replace(
      /^(---\n)/,
      `$1schemaVersion: ${SIDECAR_SCHEMA_VERSION}\n`
    );
  }

  /** Append ` ^blockId` to the task line at `idx`, idempotently. */
  private async backfillBlockId(path: string, blockId: string, idx: number): Promise<void> {
    await this.adapter.process(path, (content) => {
      const lines = content.split("\n");
      if (idx < 0 || idx >= lines.length) return content;
      const line = lines[idx];
      if (blockIdOf(line)) return content;
      lines[idx] = line.trimEnd() + " ^" + blockId;
      return lines.join("\n");
    });
  }
}
