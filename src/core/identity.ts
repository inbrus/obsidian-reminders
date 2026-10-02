// Task identity: how a task line maps to a stable id in the index. Pure — no
// Obsidian runtime.
//
// Two-part identity lives here conceptually: a task either carries an explicit
// block id (`^abc123`, the canonical stable anchor) or falls back to a
// location-based id (`path:line`). The eager block-id stamping and sidecar
// migration logic is layered on in the services phase.

/** Stable id for a task: block id when present, else a synthetic `path:line`. */
export function taskIdFor(filePath: string, line: number, blockId?: string): string {
  return blockId ? `${filePath}#^${blockId}` : `${filePath}:${line}`;
}
