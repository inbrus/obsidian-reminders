import { describe, it, expect } from "vitest";
import { statusFromChar, nextStatusChar, parseLine } from "../src/parser";
import { DEFAULT_SETTINGS } from "../src/settings";

describe("statusFromChar", () => {
  it("maps x/X to done", () => {
    expect(statusFromChar("x")).toBe("done");
    expect(statusFromChar("X")).toBe("done");
  });

  it("maps / to inProgress", () => {
    expect(statusFromChar("/")).toBe("inProgress");
  });

  it("maps - to cancelled", () => {
    expect(statusFromChar("-")).toBe("cancelled");
  });

  it("maps > to forwarded", () => {
    expect(statusFromChar(">")).toBe("forwarded");
  });

  it("maps anything else to open", () => {
    expect(statusFromChar(" ")).toBe("open");
    expect(statusFromChar("?")).toBe("open");
    expect(statusFromChar("!")).toBe("open");
  });
});

describe("nextStatusChar", () => {
  it("rotates through the canonical cycle [ ] -> [/] -> [x] -> [ ]", () => {
    expect(nextStatusChar(" ")).toBe("/");
    expect(nextStatusChar("/")).toBe("x");
    expect(nextStatusChar("x")).toBe(" ");
    expect(nextStatusChar("X")).toBe(" ");
  });
});

describe("parseLine — golden fixtures from README", () => {
  const s = DEFAULT_SETTINGS;

  it("parses an open task", () => {
    const t = parseLine("- [ ] Open task", "Projects/A.md", 0, s)!;
    expect(t.status).toBe("open");
    expect(t.text).toBe("Open task");
  });

  it("parses an in-progress task", () => {
    const t = parseLine("- [/] In progress", "Projects/A.md", 0, s)!;
    expect(t.status).toBe("inProgress");
    expect(t.text).toBe("In progress");
  });

  it("parses a done task with emoji completion date", () => {
    const t = parseLine("- [x] Done ✅ 2026-06-30", "Projects/A.md", 0, s)!;
    expect(t.status).toBe("done");
    expect(t.meta.doneDate).toBe("2026-06-30");
    expect(t.text).toBe("Done");
  });

  it("parses a cancelled task with emoji cancelled date", () => {
    const t = parseLine("- [-] Cancelled ❌ 2026-06-30", "Projects/A.md", 0, s)!;
    expect(t.status).toBe("cancelled");
    expect(t.meta.cancelledDate).toBe("2026-06-30");
    expect(t.text).toBe("Cancelled");
  });

  it("parses emoji metadata (due, start, priority, tag)", () => {
    const t = parseLine(
      "- [ ] With metadata 📅 2026-07-01 🛫 2026-06-25 🔼 #followup",
      "Projects/A.md",
      0,
      s
    )!;
    expect(t.meta.due).toBe("2026-07-01");
    expect(t.meta.start).toBe("2026-06-25");
    expect(t.priority).toBe(3);
    expect(t.tags).toContain("followup");
    expect(t.text).toBe("With metadata #followup");
  });

  it("parses wikilinks", () => {
    const t = parseLine(
      "- [ ] Linked to a person [[People/Alex]] and a project [[Projects/Website Redesign]]",
      "Projects/A.md",
      0,
      s
    )!;
    expect(t.links).toEqual(["People/Alex", "Projects/Website Redesign"]);
  });

  it("parses dataview metadata (due, start, priority, tag)", () => {
    const t = parseLine(
      "- [ ] With dataview metadata [due:: 2026-07-01] [start:: 2026-06-25] [priority:: medium] #followup",
      "Projects/A.md",
      0,
      s
    )!;
    expect(t.meta.due).toBe("2026-07-01");
    expect(t.meta.start).toBe("2026-06-25");
    expect(t.priority).toBe(3);
    expect(t.tags).toContain("followup");
  });

  it("parses dataview completion date", () => {
    const t = parseLine("- [x] Done [completion:: 2026-06-30]", "Projects/A.md", 0, s)!;
    expect(t.status).toBe("done");
    expect(t.meta.doneDate).toBe("2026-06-30");
  });

  it("extracts a trailing block id", () => {
    const t = parseLine("- [ ] Task with block ^abc123", "Projects/A.md", 3, s)!;
    expect(t.blockId).toBe("abc123");
    expect(t.hasBlockId).toBe(true);
    expect(t.id).toBe("Projects/A.md#^abc123");
  });
});

describe("parseLine — priority scale 1..6", () => {
  const s = DEFAULT_SETTINGS;

  it.each([
    ["🔺", 1],
    ["⏫", 2],
    ["🔼", 3],
    ["↔️", 4],
    ["🔽", 5],
    ["⏬", 6],
  ])("maps priority emoji %s to level %i", (emoji, level) => {
    const t = parseLine(`- [ ] Task ${emoji}`, "Projects/A.md", 0, s)!;
    expect(t.priority).toBe(level);
  });
});
