/**
 * ChangeSet primitive · the rules Home's ChangeLine carried inline, now pure
 * (2026-09-15, wave 3). Cursor read/write, the 7-day clamp, and the three
 * honesty rules of the sentence: a failed source is named, "no recorded
 * errors" only when measured, an empty set is silence.
 */
import { describe, expect, it } from "vitest";
import {
  CHANGE_CURSOR_MAX_WINDOW_MS,
  clampSince,
  cursorKey,
  describeChangeSet,
  readCursor,
  writeCursor,
  type ChangeSet,
} from "@/lib/ui/change-cursor";

function memStorage(initial: Record<string, string> = {}) {
  const m = new Map(Object.entries(initial));
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), map: m };
}

describe("cursor storage", () => {
  it("keeps Home's existing key spelling so the operator's cursor survives the refactor", () => {
    expect(cursorKey("hq")).toBe("nour:hq-last-visit");
    expect(cursorKey("brain")).toBe("nour:brain-last-visit");
  });

  it("reads a positive number, and 0 for missing / garbage / non-positive / no storage / a throwing store", () => {
    expect(readCursor(memStorage({ "nour:hq-last-visit": "1757900000000" }), "nour:hq-last-visit")).toBe(1757900000000);
    expect(readCursor(memStorage(), "nour:hq-last-visit")).toBe(0);
    expect(readCursor(memStorage({ k: "yesterday" }), "k")).toBe(0);
    expect(readCursor(memStorage({ k: "-5" }), "k")).toBe(0);
    expect(readCursor(null, "k")).toBe(0);
    expect(readCursor({ getItem: () => { throw new Error("blocked"); }, setItem: () => {} }, "k")).toBe(0);
  });

  it("writes best-effort; a throwing store is not an error", () => {
    const s = memStorage();
    writeCursor(s, "k", 42);
    expect(s.map.get("k")).toBe("42");
    expect(() => writeCursor({ getItem: () => null, setItem: () => { throw new Error("full"); } }, "k", 1)).not.toThrow();
  });
});

describe("clampSince", () => {
  it("passes a recent cursor through and clamps an old one to the window, saying so", () => {
    const now = 1_760_000_000_000;
    expect(clampSince(now - 3_600_000, now)).toEqual({ since: now - 3_600_000, clamped: false });
    expect(clampSince(now - 30 * 86_400_000, now)).toEqual({ since: now - CHANGE_CURSOR_MAX_WINDOW_MS, clamped: true });
  });
});

describe("describeChangeSet · the honesty rules", () => {
  const base: ChangeSet = { since: 0, clamped: false, parts: [], failedSources: [], errors: { measured: false, count: 0 } };

  it("nothing changed and nothing failed → silence, never '0 changes'", () => {
    expect(describeChangeSet(base)).toEqual([]);
    expect(describeChangeSet({ ...base, parts: [{ label: "closed", count: 0 }] })).toEqual([]);
  });

  it("'no recorded errors' is claimable only when the error read was MEASURED", () => {
    expect(describeChangeSet({ ...base, errors: { measured: false, count: 0 } })).toEqual([]);
    expect(describeChangeSet({ ...base, errors: { measured: true, count: 0 } })).toEqual(["no recorded errors"]);
    expect(describeChangeSet({ ...base, errors: { measured: true, count: 3 } })).toEqual(["3 errors logged"]);
  });

  it("a failed source is NAMED, after the counts", () => {
    expect(
      describeChangeSet({ ...base, parts: [{ label: "closed", count: 2 }, { label: "new tasks", count: 1 }], failedSources: ["memories", "approvals"] }),
    ).toEqual(["2 closed", "1 new tasks", "memories/approvals unread"]);
  });
});
