// Context-tree building and resolution, minus the Obsidian link cache. Pure —
// no Obsidian runtime. The vault/link-cache side (getFirstLinkpathDest) is
// injected by src/context.ts via a resolver callback.

import { TaskItem, TreeNode } from "./models";

/** The settings slice context-tree building needs. */
export interface ContextConfig {
  bucketRoots: string[];
  inboxRoots: string[];
}

/** Resolve a wikilink target to a vault path, or undefined. */
export type LinkResolver = (link: string, fromPath: string) => string | undefined;

/**
 * Build the context tree: bucketRoot -> nested folders -> file -> tasks, with
 * rolled-up (deduped) open counts at every level. Inbox roots and the
 * catch-all "Other" root collapse to a single flat node.
 */
export function buildContextTree(
  tasks: TaskItem[],
  config: ContextConfig,
  resolveLink?: LinkResolver
): TreeNode[] {
  const rootsOrder = config.bucketRoots.concat(config.inboxRoots, ["Other"]);
  const nodeMap = new Map<string, TreeNode>();
  const directIds = new Map<string, Set<string>>();

  const ensureNode = (key: string, label: string, kind: TreeNode["kind"]): TreeNode => {
    let n = nodeMap.get(key);
    if (!n) {
      n = { key, label, kind, children: [], taskIds: [], count: 0 };
      nodeMap.set(key, n);
      directIds.set(key, new Set());
    }
    return n;
  };

  const fileNodeFor = (filePath: string): TreeNode => {
    const parts = filePath.split("/");
    const root = parts.length > 1 ? parts[0] : "Other";
    const inBucket = config.bucketRoots.includes(root);
    const inInbox = config.inboxRoots.includes(root);
    const rootName = inBucket || inInbox ? root : "Other";
    const flat = inInbox || rootName === "Other";
    const rootNode = ensureNode(rootName, rootName, "root");
    if (flat) return rootNode;
    let parent = rootNode;
    let parentKey = rootName;
    for (let i = 1; i < parts.length - 1; i++) {
      const folderKey = `${parentKey}/${parts[i]}`;
      let node = nodeMap.get(folderKey);
      if (!node) {
        node = ensureNode(folderKey, parts[i], "folder");
        parent.children.push(node);
      }
      parent = node;
      parentKey = folderKey;
    }
    const base = parts[parts.length - 1].replace(/\.md$/i, "");
    const fileKey = `${parentKey}/${base}`;
    let fileNode = nodeMap.get(fileKey);
    if (!fileNode) {
      fileNode = ensureNode(fileKey, base, "file");
      parent.children.push(fileNode);
    }
    return fileNode;
  };

  // Pass 1: authored location.
  for (const t of tasks) {
    const node = fileNodeFor(t.filePath);
    directIds.get(node.key)!.add(t.id);
  }

  // Pass 2: cross-index by wikilink into the linked file's node.
  if (resolveLink) {
    for (const t of tasks) {
      for (const link of t.links) {
        const dest = resolveLink(link, t.filePath);
        if (!dest) continue;
        const parts = dest.split("/");
        if (parts.length < 2 || !config.bucketRoots.includes(parts[0])) continue;
        const node = fileNodeFor(dest);
        directIds.get(node.key)!.add(t.id);
      }
    }
  }

  // Roll up counts (deduped) and sort, bottom-up.
  const rollup = (node: TreeNode): Set<string> => {
    const set = new Set<string>(directIds.get(node.key) || []);
    node.taskIds = Array.from(directIds.get(node.key) || []);
    for (const c of node.children) {
      for (const id of rollup(c)) set.add(id);
    }
    node.children.sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
    node.count = set.size;
    return set;
  };

  const roots: TreeNode[] = [];
  for (const name of rootsOrder) {
    const r = nodeMap.get(name);
    if (!r) continue;
    rollup(r);
    roots.push(r);
  }
  return roots;
}
