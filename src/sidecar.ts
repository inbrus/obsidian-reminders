// Sidecar (per-task detail note) path helpers. Kept in their own module so both
// parser.ts and writer.ts can resolve existing sidecars without a circular import.

import { App, TFile, TFolder, normalizePath } from "obsidian";
import { TaskgregatorSettings } from "./settings";

/** Strip inline #tags from a title for use as a sidecar filename. */
export function stripTagsFromTitle(title: string, tags?: string[]): string {
  let out = title || "";
  for (const tag of tags || []) {
    const esc = tag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    out = out.replace(new RegExp(`#${esc}\\b`, "g"), "");
  }
  return out.replace(/\s+/g, " ").trim();
}

/** Sanitize a title into a filesystem-safe sidecar filename stem. */
export function cleanTitleForFile(title: string, tags?: string[]): string {
  let out = stripTagsFromTitle(title, tags);
  out = out.replace(/[\\/:*?"<>|#^]/g, " ").replace(/\s+/g, " ").trim();
  out = out.replace(/[. ]+$/g, "").replace(/^[. ]+/g, "");
  if (out.length > 180) out = out.slice(0, 180).replace(/[. ]+$/g, "");
  return out || "Untitled";
}

/** Sidecar detail-note path for a clean title + block id. */
export function sidecarPathFor(
  settings: TaskgregatorSettings,
  cleanTitle: string,
  blockId: string
): string {
  return normalizePath(
    `${normalizePath(settings.sidecarFolder)}/${cleanTitle} – Task ${blockId}.md`
  );
}

/**
 * Find an existing sidecar for a block id by its name suffix (` <blockId>.md`),
 * so it stays findable even if the task title (and thus filename) changed.
 */
export function findSidecarFile(
  app: App,
  settings: TaskgregatorSettings,
  blockId: string
): TFile | null {
  const folder = normalizePath(settings.sidecarFolder);
  const dir = app.vault.getAbstractFileByPath(folder);
  if (!(dir instanceof TFolder)) return null;
  const needle = ` ${blockId}.md`;
  for (const child of dir.children) {
    if (child instanceof TFile && child.name.endsWith(needle)) return child;
  }
  return null;
}

/** ISO YYYY-MM-DD -> DD-MM-YYYY. */
export function toDDMMYYYY(iso: string): string {
  const p = String(iso).split("-");
  if (p.length !== 3) return iso;
  return `${p[2]}-${p[1]}-${p[0]}`;
}

/** Escape a string for a YAML double-quoted scalar. */
export function yamlEscape(s: string): string {
  return String(s).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}
