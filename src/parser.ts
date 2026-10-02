// Vault scanning (Obsidian-specific) + re-exports of the pure parser/status
// registry from core/. The pure line→TaskItem logic lives in src/core/parser.ts
// (no Obsidian runtime); this module keeps only the TFile/TFolder tree walk.

import { App, TFile, TFolder } from "obsidian";
import { TaskItem } from "./types";
import { TaskgregatorSettings } from "./settings";
import { findSidecarFile } from "./sidecar";
import { parseLine, isIgnored } from "./core/parser";

// Pure parsing + status surface, re-exported so existing call sites
// (`import ... from "./parser"`) keep working unchanged.
export * from "./core/parser";
export * from "./core/status-registry";

/**
 * Scan for tasks. To limit vault access to only what the plugin needs, this
 * walks the folders the user configured as bucket/inbox roots instead of
 * enumerating every file in the vault. Files outside those roots are never read.
 */
export async function scanVault(
  app: App,
  settings: TaskgregatorSettings
): Promise<TaskItem[]> {
  const files = collectScopedFiles(app, settings);
  const out: TaskItem[] = [];
  for (const file of files) {
    if (isIgnored(file.path, settings)) continue;
    const tasks = await scanFile(app, file, settings);
    out.push(...tasks);
  }
  return out;
}

/** Gather markdown files under the configured bucket/inbox roots only. */
function collectScopedFiles(app: App, settings: TaskgregatorSettings): TFile[] {
  const roots = new Set<string>([...settings.bucketRoots, ...settings.inboxRoots]);
  const seen = new Set<string>();
  const out: TFile[] = [];

  const walk = (folder: TFolder) => {
    for (const child of folder.children) {
      if (child instanceof TFolder) {
        walk(child);
      } else if (child instanceof TFile && child.extension === "md") {
        if (!seen.has(child.path)) {
          seen.add(child.path);
          out.push(child);
        }
      }
    }
  };

  for (const root of roots) {
    const dir = app.vault.getAbstractFileByPath(root.replace(/\/$/, ""));
    if (dir instanceof TFolder) walk(dir);
    else if (dir instanceof TFile && dir.extension === "md" && !seen.has(dir.path)) {
      seen.add(dir.path);
      out.push(dir);
    }
  }
  return out;
}

/** Scan a single file for tasks. */
export async function scanFile(
  app: App,
  file: TFile,
  settings: TaskgregatorSettings
): Promise<TaskItem[]> {
  if (isIgnored(file.path, settings)) return [];
  const content = await app.vault.cachedRead(file);
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
    const task = parseLine(lines[i], file.path, i, settings);
    if (task) {
      task.mtime = file.stat?.mtime ?? 0;
      task.ctime = file.stat?.ctime ?? 0;
      if (task.blockId) {
        const sf = findSidecarFile(app, settings, task.blockId);
        if (sf) task.sidecarPath = sf.path;
      }
      out.push(task);
    }
  }
  return out;
}
