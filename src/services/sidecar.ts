// SidecarService: create/find/open per-task detail notes. Stateful; depends on
// the vault adapter + clock. Pure filename/YAML building lives in
// core/sidecar.ts. The block-id → path lookup stays a linear scan of the sidecar
// folder for now (a Map-based index arrives in the index phase).

import { IVaultAdapter } from "../ports/vault-adapter";
import { IClock } from "../ports/clock";
import { TaskgregatorSettings } from "../settings";
import { TaskItem } from "../core/models";
import {
  normalizePath,
  stripTagsFromTitle,
  cleanTitleForFile,
  sidecarPathFor,
  toDDMMYYYY,
  sidecarFrontmatter,
  yamlEscape,
} from "../core/sidecar";

export class SidecarService {
  constructor(
    private adapter: IVaultAdapter,
    private clock: IClock,
    private settings: TaskgregatorSettings
  ) {}

  /** Path of an existing sidecar for a block id, or undefined. */
  findByBlockId(blockId: string): string | undefined {
    const folder = normalizePath(this.settings.sidecarFolder);
    const needle = ` ${blockId}.md`;
    const names = this.adapter.listFolder(folder);
    const match = names.find((n) => n.endsWith(needle));
    return match ? `${folder}/${match}` : undefined;
  }

  /** Create (if missing) a sidecar for a known block id + source, return its path. */
  async ensureSidecarFor(
    blockId: string,
    title: string,
    sourcePath: string,
    task?: TaskItem
  ): Promise<string> {
    const existing = this.findByBlockId(blockId);
    if (existing) return existing;

    const folder = normalizePath(this.settings.sidecarFolder);
    await this.ensureFolder(folder);

    const titleClean = stripTagsFromTitle(title, task?.tags);
    const fileName = cleanTitleForFile(title, task?.tags);
    const path = sidecarPathFor(folder, fileName, blockId);
    const link = `${sourcePath.replace(/\.md$/i, "")}#^${blockId}`;
    const date = toDDMMYYYY(this.clock.todayIso());
    const priorityHex = ["", "#e5484d", "#f5a623", "#4c9aff"][task?.priority || 0] || "";
    const statusDone = task?.status === "done";
    const body = sidecarFrontmatter({
      blockId,
      date,
      sourceLink: link,
      title: yamlEscape(titleClean),
      priorityHex,
      tags: task?.tags || [],
      statusDone,
    });

    await this.adapter.create(path, body);
    return path;
  }

  private async ensureFolder(folder: string): Promise<void> {
    const parts = folder.split("/");
    let cur = "";
    for (const p of parts) {
      cur = cur ? `${cur}/${p}` : p;
      if (!this.adapter.exists(cur)) {
        try {
          await this.adapter.createFolder(cur);
        } catch {
          // Already exists / race; ignore.
        }
      }
    }
  }
}
