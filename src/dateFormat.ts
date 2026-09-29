// Date-format helpers. Dates are stored on disk as wikilinks ([[DD-MM-YYYY]]),
// which Obsidian resolves to the matching daily note for free, but compared and
// sorted internally as canonical ISO (YYYY-MM-DD). This module bridges the two.

export const WIKILINK_DMY = "\\[\\[\\d{2}-\\d{2}-\\d{4}\\]\\]";

const RE_ISO = /^\d{4}-\d{2}-\d{2}$/;
const RE_DMY = /^(\d{2})-(\d{2})-(\d{4})$/;

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Normalize a date token to ISO (YYYY-MM-DD). Accepts ISO, DD-MM-YYYY, and a
 * wikilink-wrapped variant of either. Returns undefined when unrecognized.
 */
export function toIso(token: string | null | undefined): string | undefined {
  if (!token) return undefined;
  const t = token.trim();
  const stripped = t.replace(/^\[\[|\]\]$/g, "").trim();
  if (RE_ISO.test(stripped)) return stripped;
  const m = RE_DMY.exec(stripped);
  if (m) {
    const [, dd, mm, yyyy] = m;
    return `${yyyy}-${mm}-${dd}`;
  }
  return undefined;
}

/** ISO (YYYY-MM-DD) -> DD-MM-YYYY (no wikilink). */
export function fromIso(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${d}-${m}-${y}`;
}

/** Find a date after an optional prefix (emoji), accepting wikilink or bare ISO. */
export function findDateAfter(text: string, prefix?: string): string | undefined {
  if (!text) return undefined;
  const wikilinkRe = prefix
    ? new RegExp(`${escapeRegex(prefix)}\\s*\\[\\[(\\d{2}-\\d{2}-\\d{4})\\]\\]`)
    : /\[\[(\d{2}-\d{2}-\d{4})\]\]/;
  const wm = text.match(wikilinkRe);
  if (wm) return toIso(wm[1]);
  const isoRe = prefix
    ? new RegExp(`${escapeRegex(prefix)}\\s*(\\d{4}-\\d{2}-\\d{2})`)
    : /(\d{4}-\d{2}-\d{2})/;
  const im = text.match(isoRe);
  if (im) return toIso(im[1]);
  return undefined;
}

/** ISO -> [[DD-MM-YYYY]]. */
export function wikilink(iso: string): string {
  return `[[${fromIso(iso)}]]`;
}

/** `${prefix} [[DD-MM-YYYY]]`. */
export function wikilinkAfter(prefix: string, iso: string): string {
  return `${prefix} ${wikilink(iso)}`;
}

/** Strip a date (wikilink or bare ISO) that follows a prefix, plus the prefix. */
export function stripDateAfter(line: string, prefix: string): string {
  const esc = escapeRegex(prefix);
  let out = line.replace(new RegExp(`\\s*${esc}\\s*\\[\\[\\d{2}-\\d{2}-\\d{4}\\]\\]`, "g"), "");
  out = out.replace(new RegExp(`\\s*${esc}\\s*\\d{4}-\\d{2}-\\d{2}`, "g"), "");
  out = out.replace(new RegExp(`\\s*${esc}`, "g"), "");
  return out.trimEnd();
}
