// Task identity: how a task line maps to a stable id in the index. Pure — no
// Obsidian runtime, no crypto (content hashing uses a deterministic FNV-1a).
//
// Two-part identity: a task either carries an explicit block id (`^abc123`, the
// canonical stable anchor) or falls back to a content fingerprint of
// (path + status + normalized body). The physical position (path + line) is the
// "location" — it drifts and is re-resolved at write time, and is NOT part of
// the stable id. Eager block-id stamping and sidecar migration are layered on
// in the services phase.

/** FNV-1a 32-bit, deterministic and dependency-free. Hex string (8 chars). */
export function fnv1a(str: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

/**
 * Content hash of a task. Stable across line shifts (no line number involved),
 * changes only when the path, status, or normalized body text changes. Used as
 * the block-id-less fingerprint and as the write-time fallback locator.
 */
export function taskContentHash(filePath: string, text: string, statusChar: string): string {
  return fnv1a(`${filePath}\u0000${statusChar}\u0000${text}`);
}

/**
 * Stable id for a task: `path#^blockId` when a block id exists, otherwise a
 * content fingerprint `path#<hash>`. Never line-based — the line is location,
 * not identity.
 */
export function stableIdFor(
  filePath: string,
  text: string,
  statusChar: string,
  blockId?: string
): string {
  return blockId
    ? `${filePath}#^${blockId}`
    : `${filePath}#${taskContentHash(filePath, text, statusChar)}`;
}
