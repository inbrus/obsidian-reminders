// Context-sidebar computation. Resolves wikilinks through the store's injected
// link resolver (no direct App/metadataCache dependency). The pure types live
// in core/models.ts; the pure tree builder in core/context.ts.

import { TFile } from "obsidian";
import { TaskItem } from "./types";
import { TaskStore } from "./store";
import { ContextResult } from "./core/models";

export type { ContextScope, DueFilter, ContextResult } from "./core/models";

/**
 * A file is treated as a "folder note" when its basename matches its parent
 * folder's name (e.g. Dailies/2026/07/07.md, Projects/Foo/Foo.md). This mirrors
 * the Folder Notes plugin convention without coupling to it: any file that
 * "stands in" for its folder scopes to the whole folder subtree.
 */
export function isFolderNote(file: TFile): boolean {
  const parent = file.parent;
  if (!parent || !parent.name) return false;
  return parent.name === file.basename;
}

function resolvesInto(
  store: TaskStore,
  task: TaskItem,
  test: (destPath: string) => boolean
): boolean {
  for (const link of task.links) {
    const dest = store.resolveLink(link, task.filePath);
    if (dest && test(dest)) return true;
  }
  return false;
}

/**
 * Compute the task context for the active file, split into scopes:
 *
 * - page: open tasks authored on this exact file.
 * - section: for a folder note only, open tasks authored elsewhere in the folder
 *   subtree it stands in for (excluding the folder note itself). Empty for a
 *   regular page, which has no subtree of its own.
 * - reference: tasks authored elsewhere that link into the page (or, for a
 *   folder note, anywhere in its subtree).
 * - all: the deduped union, ordered page → section → reference.
 *
 * References are resolved through the store's link resolver, so aliases and
 * path-qualified links both resolve correctly.
 */
export function computeContext(
  store: TaskStore,
  file: TFile
): ContextResult {
  const visible = store.visible();
  const folderNote = isFolderNote(file);

  const page = visible.filter((t) => t.filePath === file.path);
  const pageSet = new Set(page.map((t) => t.id));

  // Subtree prefix: the folder a folder note stands in for. Only a folder note
  // expands to its folder; a regular page is scoped to itself.
  const folderPath = file.parent ? file.parent.path : "";
  const prefix = folderPath === "" ? "" : folderPath + "/";
  const inSubtree = (p: string) =>
    p === file.path || (prefix !== "" && p.startsWith(prefix));

  const section = folderNote
    ? visible.filter(
        (t) => !pageSet.has(t.id) && prefix !== "" && t.filePath.startsWith(prefix)
      )
    : [];

  // References resolve into the whole subtree for a folder note, else the page.
  const refTest = folderNote
    ? (p: string) => inSubtree(p)
    : (p: string) => p === file.path;
  const reference = visible.filter(
    (t) => !pageSet.has(t.id) && resolvesInto(store, t, refTest)
  );

  const all: TaskItem[] = [];
  const seen = new Set<string>();
  const add = (tasks: TaskItem[]) => {
    for (const t of tasks) {
      if (seen.has(t.id)) continue;
      seen.add(t.id);
      all.push(t);
    }
  };
  add(page);
  add(section);
  add(reference);

  return {
    title: folderNote && file.parent ? file.parent.name : file.basename,
    subtitle: folderNote ? folderPath : file.path,
    isFolderNote: folderNote,
    scopes: { all, page, section, reference },
    total: all.length,
  };
}
