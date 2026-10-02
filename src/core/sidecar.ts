// Pure sidecar (per-task detail note) helpers. No Obsidian runtime — these
// build filenames and YAML from strings. The vault-bound side (finding files on
// disk, creating folders) lives in services/sidecar.ts via IVaultAdapter.

/** Normalize a vault path: backslashes → slashes, collapse duplicates, trim trailing slash. */
export function normalizePath(path: string): string {
  return path.replace(/\\/g, "/").replace(/\/+/g, "/").replace(/\/$/, "");
}

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
  sidecarFolder: string,
  cleanTitle: string,
  blockId: string
): string {
  return normalizePath(
    `${normalizePath(sidecarFolder)}/${cleanTitle} – Task ${blockId}.md`
  );
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

/**
 * YAML frontmatter + heading for a sidecar detail note. Pure function — no
 * vault access, no personal paths. The template ships user-neutral: it links
 * back to the source task and records block identity, priority, tags and
 * status, with no hardcoded vault-relative references.
 */
export function sidecarFrontmatter(params: {
  blockId: string;
  date: string; // DD-MM-YYYY
  sourceLink: string; // "path/to/note#^blockId"
  title: string; // already stripped of tags and yaml-escaped
  priorityHex: string; // "" or "#rrggbb"
  tags: string[]; // bare tag names (without '#')
  statusDone: boolean;
}): string {
  const tagsBlock = params.tags.map((t) => `  - "#${t}"`).join("\n");
  const priorityLine = params.priorityHex
    ? `priority-task: "${params.priorityHex}"\n`
    : "";
  return (
    `---\n` +
    `blockId: ${params.blockId}\n` +
    `schemaVersion: ${SIDECAR_SCHEMA_VERSION}\n` +
    `date: "[[${params.date}]]"\n` +
    `source-task: "[[${params.sourceLink}|Source →]]"\n` +
    `title-task: "${params.title}"\n` +
    priorityLine +
    `tags:\n` +
    `${tagsBlock}\n` +
    `status-task: ${params.statusDone ? "true" : "false"}\n` +
    `---\n\n` +
    `# ${params.title}\n`
  );
}

/** Current sidecar schema version. Bump on any change to the frontmatter shape. */
export const SIDECAR_SCHEMA_VERSION = 1;

/** Parsed sidecar frontmatter fields the identity migration cares about. */
export interface SidecarMeta {
  blockId: string;
  title: string;
  sourcePath: string; // vault path of the source note, without extension or block ref
  schemaVersion?: number;
}

/** Read a single `key: value` line from a YAML frontmatter block. */
function readYamlField(frontmatter: string, key: string): string | undefined {
  const m = frontmatter.match(new RegExp(`^${key}:\\s*(.*)$`, "m"));
  if (!m) return undefined;
  let v = m[1].trim();
  v = v.replace(/^"(.*)"$/, "$1").replace(/^'(.*)'$/, "$1");
  return v;
}

/** Extract the source note path from a `[[path#^id|alias]]` link. */
function extractSourcePath(sourceLink: string): string {
  const m = sourceLink.match(/\[\[([^#|\]]+)/);
  return m ? m[1] : "";
}

/**
 * Parse the frontmatter of a sidecar detail note. Returns null when the file
 * isn't a recognized sidecar (no `blockId:` / `source-task:` pair).
 */
export function parseSidecarFrontmatter(content: string): SidecarMeta | null {
  const m = content.match(/^---\n([\s\S]*?)\n---/);
  if (!m) return null;
  const blockId = readYamlField(m[1], "blockId");
  const source = readYamlField(m[1], "source-task");
  if (!blockId || !source) return null;
  const schemaRaw = readYamlField(m[1], "schemaVersion");
  return {
    blockId,
    title: readYamlField(m[1], "title-task") ?? "",
    sourcePath: extractSourcePath(source),
    schemaVersion: schemaRaw ? Number(schemaRaw) : undefined,
  };
}
