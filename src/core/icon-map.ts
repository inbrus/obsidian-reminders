// Emoji → Lucide icon mapping for UI rendering. Emoji remain the on-disk format
// (Tasks-plugin interop); the UI renders Lucide icons via setIcon instead of the
// raw emoji glyph. Pure — no Obsidian runtime.

export const EMOJI_TO_ICON: Record<string, string> = {
  "📅": "calendar",
  "🛫": "plane",
  "⏳": "hourglass",
  "➕": "plus",
  "✅": "check-check",
  "❌": "ban",
  "🔁": "repeat",
  "🌱": "sprout",
  "📝": "sticky-note",
};

/** Lucide icon for a metadata emoji, with a safe fallback. */
export function iconForEmoji(emoji: string, fallback = "circle"): string {
  return EMOJI_TO_ICON[emoji] ?? fallback;
}
