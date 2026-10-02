// Byte-identity tests for the pure line transforms: the on-disk format is a
// stability contract (Tasks-plugin interop). These assert exact byte output and
// idempotency — re-applying a write must never duplicate or reorder signifiers.

import { describe, it, expect } from "vitest";
import {
  applyDueToLine,
  applyStartToLine,
  applyPriorityToLine,
  applyStatusToLine,
  toggleTagInLine,
  appendSignifier,
  ensureBlockIdInLine,
  blockIdOf,
} from "../src/core/line-transforms";

describe("line transforms — byte-identity", () => {
  it("writes a due date byte-exactly", () => {
    expect(applyDueToLine("- [ ] Ship it", "2026-10-02")).toBe(
      "- [ ] Ship it 📅 [[02-10-2026]]"
    );
  });

  it("writes a start date byte-exactly", () => {
    expect(applyStartToLine("- [ ] Ship it", "2026-10-02")).toBe(
      "- [ ] Ship it 🛫 [[02-10-2026]]"
    );
  });

  it("writes priority levels byte-exactly", () => {
    expect(applyPriorityToLine("- [ ] Ship it", 1, ["p1", "p2", "p3"])).toBe(
      "- [ ] Ship it 🔺"
    );
    expect(applyPriorityToLine("- [ ] Ship it", 2, ["p1", "p2", "p3"])).toBe(
      "- [ ] Ship it ⏫"
    );
  });

  it("toggles a tag byte-exactly (off → on)", () => {
    expect(toggleTagInLine("- [ ] Ship it", "today")).toBe("- [ ] Ship it #today");
  });

  it("keeps a trailing block id last when appending a signifier", () => {
    expect(appendSignifier("- [ ] Ship it ^tg1", "📅 [[02-10-2026]]")).toBe(
      "- [ ] Ship it 📅 [[02-10-2026]] ^tg1"
    );
    expect(applyDueToLine("- [ ] Ship it ^tg1", "2026-10-02")).toBe(
      "- [ ] Ship it 📅 [[02-10-2026]] ^tg1"
    );
  });

  it("is idempotent for due dates", () => {
    const once = applyDueToLine("- [ ] Ship it", "2026-10-02");
    expect(applyDueToLine(once, "2026-10-02")).toBe(once);
  });

  it("is idempotent for priorities", () => {
    const once = applyPriorityToLine("- [ ] Ship it", 2, ["p1", "p2", "p3"]);
    expect(applyPriorityToLine(once, 2, ["p1", "p2", "p3"])).toBe(once);
  });

  it("is idempotent for tags (toggle on then off restores the byte-exact line)", () => {
    const original = "- [ ] Ship it";
    const on = toggleTagInLine(original, "today");
    expect(toggleTagInLine(on, "today")).toBe(original);
  });

  it("stamps a block id once and never re-stamps", () => {
    const { line, blockId } = ensureBlockIdInLine("- [ ] Ship it");
    expect(line).toBe(`- [ ] Ship it ^${blockId}`);
    expect(blockIdOf(line)).toBe(blockId);
    const again = ensureBlockIdInLine(line);
    expect(again.line).toBe(line);
    expect(again.blockId).toBe(blockId);
  });

  it("status toggle clears stale completion dates across formats", () => {
    const done = applyStatusToLine("- [ ] Ship it", "x");
    expect(done).toMatch(/✅ \[\[\d{2}-\d{2}-\d{4}\]\]$/);
    // Un-complete: the ✅ date must be gone, not duplicated.
    const reopened = applyStatusToLine(done, " ");
    expect(reopened).toBe("- [ ] Ship it");
  });
});
