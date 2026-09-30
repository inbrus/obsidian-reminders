import { describe, it, expect } from "vitest";
import { sidecarFrontmatter } from "../src/sidecar";

describe("sidecarFrontmatter — no personal paths", () => {
  const base = {
    blockId: "abc123",
    date: "30-09-2026",
    sourceLink: "Projects/My Note#^abc123",
    title: "My task",
    priorityHex: "#e5484d",
    tags: ["followup"],
    statusDone: false,
  };

  it("links back to the source task", () => {
    const body = sidecarFrontmatter(base);
    expect(body).toContain("source-task: \"[[Projects/My Note#^abc123|Source →]]\"");
  });

  it("records block identity, priority, tags and status", () => {
    const body = sidecarFrontmatter(base);
    expect(body).toContain("blockId: abc123");
    expect(body).toContain('priority-task: "#e5484d"');
    expect(body).toContain('  - "#followup"');
    expect(body).toContain("status-task: false");
  });

  it("contains no hardcoded personal vault paths", () => {
    const body = sidecarFrontmatter(base);
    expect(body).not.toContain("Folders/Pages");
    expect(body).not.toContain("Taskgregator");
    expect(body).not.toContain("[[Task]]");
  });

  it("omits priority-task when there is no priority", () => {
    const body = sidecarFrontmatter({ ...base, priorityHex: "" });
    expect(body).not.toContain("priority-task:");
  });
});
