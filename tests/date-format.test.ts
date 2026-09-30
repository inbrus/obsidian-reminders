import { describe, it, expect } from "vitest";
import { toIso, fromIso, findDateAfter, wikilink, localISODate } from "../src/dateFormat";

describe("toIso", () => {
  it("accepts ISO", () => {
    expect(toIso("2026-07-01")).toBe("2026-07-01");
  });
  it("accepts DD-MM-YYYY", () => {
    expect(toIso("01-07-2026")).toBe("2026-07-01");
  });
  it("accepts wikilink-wrapped", () => {
    expect(toIso("[[01-07-2026]]")).toBe("2026-07-01");
  });
  it("returns undefined for garbage", () => {
    expect(toIso("nope")).toBeUndefined();
  });
});

describe("fromIso / wikilink", () => {
  it("formats ISO to DD-MM-YYYY", () => {
    expect(fromIso("2026-07-01")).toBe("01-07-2026");
  });
  it("wraps in a wikilink", () => {
    expect(wikilink("2026-07-01")).toBe("[[01-07-2026]]");
  });
});

describe("findDateAfter", () => {
  it("finds a bare ISO after an emoji prefix", () => {
    expect(findDateAfter("📅 2026-07-01", "📅")).toBe("2026-07-01");
  });
  it("finds a wikilink date after an emoji prefix", () => {
    expect(findDateAfter("📅 [[01-07-2026]]", "📅")).toBe("2026-07-01");
  });
});

describe("localISODate — local calendar, not UTC", () => {
  it("uses local calendar components", () => {
    // Jan 15 2026 00:30 local. toISOString() would shift this by the UTC
    // offset (and can land on Jan 14); the local form must stay on Jan 15.
    const d = new Date(2026, 0, 15, 0, 30);
    expect(localISODate(d)).toBe("2026-01-15");
  });

  it("pads single-digit month and day", () => {
    const d = new Date(2026, 0, 5, 12, 0);
    expect(localISODate(d)).toBe("2026-01-05");
  });
});
