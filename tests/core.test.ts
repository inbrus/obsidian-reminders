// Phase 1 core tests. These import ONLY from src/core/ and build a plain
// ParserConfig inline — no DEFAULT_SETTINGS, no obsidian-stub — proving the core
// is testable without the Obsidian runtime.
import { describe, it, expect } from "vitest";
import { parseLine, deriveBucket, nodeKeyForFile, ParserConfig } from "../src/core/parser";
import { statusFromChar, nextStatusChar } from "../src/core/status-registry";
import { applyStatusToLine, applyPriorityToLine, toggleTagInLine, ensureBlockIdInLine } from "../src/core/line-transforms";
import { sortTasksBy, groupTasks, filterByQuery } from "../src/core/query";
import { stableIdFor, taskContentHash } from "../src/core/identity";
import { TaskItem } from "../src/core/models";

const cfg: ParserConfig = {
  priorityTags: ["p1", "p2", "p3"],
  bucketRoots: ["Projects", "People", "Areas"],
  inboxRoots: ["Dailies"],
  ignorePaths: ["Archive/", "Templates/"],
};

function task(partial: Partial<TaskItem>): TaskItem {
  return {
    id: "x",
    hasBlockId: false,
    contentHash: "",
    filePath: "Projects/A.md",
    line: 0,
    indent: 0,
    statusChar: " ",
    status: "open",
    text: "",
    textRaw: "",
    suffix: "",
    rawText: "",
    tags: [],
    links: [],
    priority: 0,
    meta: {},
    mtime: 0,
    ctime: 0,
    bucketRoot: "Projects",
    bucketFile: "A",
    ...partial,
  };
}

describe("core/parser — pure, no obsidian", () => {
  it("parses a task with emoji metadata", () => {
    const t = parseLine("- [ ] Ship it 📅 2026-07-01 🔺 #today", "Projects/A.md", 0, cfg)!;
    expect(t.meta.due).toBe("2026-07-01");
    expect(t.priority).toBe(1);
    expect(t.tags).toContain("today");
  });

  it("deriveBucket maps unknown roots to Other", () => {
    expect(deriveBucket("Misc/x.md", cfg).bucketRoot).toBe("Other");
    expect(deriveBucket("Projects/x.md", cfg).bucketRoot).toBe("Projects");
  });

  it("nodeKeyForFile flattens inbox roots", () => {
    const k = nodeKeyForFile("Dailies/2026-07-07.md", cfg);
    expect(k.flat).toBe(true);
    expect(k.fileKey).toBe("Dailies");
  });
});

describe("core/status-registry", () => {
  it("statusFromChar covers all five statuses", () => {
    expect(statusFromChar("x")).toBe("done");
    expect(statusFromChar("/")).toBe("inProgress");
    expect(statusFromChar("-")).toBe("cancelled");
    expect(statusFromChar(">")).toBe("forwarded");
    expect(statusFromChar(" ")).toBe("open");
  });
  it("nextStatusChar rotates", () => {
    expect(nextStatusChar(" ")).toBe("/");
    expect(nextStatusChar("/")).toBe("x");
    expect(nextStatusChar("x")).toBe(" ");
  });
});

describe("core/line-transforms", () => {
  it("applyStatusToLine stamps completion date as a wikilink", () => {
    const out = applyStatusToLine("- [ ] Do thing", "x", "emoji");
    expect(out).toMatch(/^- \[x\] Do thing ✅ \[\[\d{2}-\d{2}-\d{4}\]\]$/);
  });
  it("applyPriorityToLine sets emoji priority", () => {
    expect(applyPriorityToLine("- [ ] Task", 2, cfg.priorityTags, "emoji")).toContain("⏫");
  });
  it("toggleTagInLine adds then removes", () => {
    const added = toggleTagInLine("- [ ] Task", "today");
    expect(added).toContain("#today");
    expect(toggleTagInLine(added, "today")).not.toContain("#today");
  });
  it("ensureBlockIdInLine is idempotent", () => {
    const first = ensureBlockIdInLine("- [ ] Task");
    expect(first.blockId).toBeTruthy();
    const second = ensureBlockIdInLine(first.line);
    expect(second.blockId).toBe(first.blockId);
  });
});

describe("core/query", () => {
  const tasks = [
    task({ id: "1", text: "Alpha", priority: 2, meta: { due: "2026-07-01" } }),
    task({ id: "2", text: "Beta", priority: 1, meta: {} }),
    task({ id: "3", text: "Gamma", priority: 0, meta: { due: "2026-06-01" } }),
  ];
  it("sorts by priority", () => {
    const ids = sortTasksBy(tasks, "priority", "asc").map((t) => t.id);
    expect(ids[0]).toBe("2"); // prio 1 first
  });
  it("groups by priority", () => {
    const groups = groupTasks(tasks, "priority");
    const labels = groups.map((g) => g.label);
    expect(labels).toContain("P1");
    expect(labels).toContain("No priority");
  });
  it("filters by query terms", () => {
    expect(filterByQuery(tasks, "alpha").length).toBe(1);
    expect(filterByQuery(tasks, "alpha beta").length).toBe(0);
  });
});

describe("core/identity", () => {
  it("block id takes precedence over content fingerprint", () => {
    expect(stableIdFor("P/x.md", "Do thing", " ", "abc")).toBe("P/x.md#^abc");
    expect(stableIdFor("P/x.md", "Do thing", " ")).toBe(
      `P/x.md#${taskContentHash("P/x.md", "Do thing", " ")}`
    );
  });
  it("content hash is line-independent and body-sensitive", () => {
    expect(taskContentHash("P/x.md", "Do thing", " ")).toBe(
      taskContentHash("P/x.md", "Do thing", " ")
    );
    expect(taskContentHash("P/x.md", "Do thing", " ")).not.toBe(
      taskContentHash("P/x.md", "Other", " ")
    );
  });
});
