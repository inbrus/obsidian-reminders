// Status registry: alternative checkbox statuses (Anything-style) and the
// status-char → TaskStatus mapping. Pure — no Obsidian runtime.

import type { TaskStatus } from "./models";

// Alternative checkbox statuses mapped to Lucide icons.
export const ALT_CHECKBOX_ICONS: Record<string, { label: string; icon: string }> = {
  "/": { label: "In progress", icon: "contrast" },
  "-": { label: "Cancelled", icon: "ban" },
  ">": { label: "Forwarded", icon: "send-horizontal" },
  "<": { label: "Scheduling", icon: "calendar" },
  "?": { label: "Question", icon: "circle-help" },
  "!": { label: "Important", icon: "triangle-alert" },
  "*": { label: "Star", icon: "star" },
  '"': { label: "Quote", icon: "quote" },
  l: { label: "Location", icon: "map-pin" },
  b: { label: "Bookmark", icon: "bookmark" },
  i: { label: "Info", icon: "info" },
  S: { label: "Savings", icon: "dollar-sign" },
  I: { label: "Idea", icon: "lightbulb" },
  p: { label: "Pros", icon: "thumbs-up" },
  c: { label: "Cons", icon: "thumbs-down" },
  f: { label: "Fire", icon: "flame" },
  k: { label: "Key", icon: "key-round" },
  w: { label: "Win", icon: "trophy" },
  u: { label: "Up", icon: "trending-up" },
  d: { label: "Down", icon: "trending-down" },
};

// Navigation sections (left-sidebar smart lists), in default display order.
export const NAV_SECTIONS: { id: string; label: string; icon: string }[] = [
  { id: "today", label: "Today", icon: "star" },
  { id: "tomorrow", label: "Tomorrow", icon: "sun" },
  { id: "soon", label: "Soon", icon: "calendar-clock" },
  { id: "inbox", label: "Inbox", icon: "inbox" },
  { id: "flagged", label: "Flagged", icon: "flag" },
  { id: "all", label: "All", icon: "inbox" },
  { id: "inprogress", label: "In Progress", icon: "circle-dot" },
  { id: "completed", label: "Completed", icon: "check-check" },
];

export function statusFromChar(c: string): TaskStatus {
  if (c === "x" || c === "X") return "done";
  if (c === "/") return "inProgress";
  if (c === "-") return "cancelled";
  if (c === ">") return "forwarded";
  return "open";
}

/** Rotate a checkbox through the canonical cycle: [ ] -> [/] -> [x] -> [ ]. */
export function nextStatusChar(c: string): string {
  if (c === "/") return "x";
  if (c === "x" || c === "X") return " ";
  return "/";
}
