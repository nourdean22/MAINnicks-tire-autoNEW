/**
 * W8b (audit C consistency) · `brain_dumps.date` is the ET day everywhere else (journal-ingest, journal-feed); the
 * knowledge-sync promoter keyed it by UTC, so a 9 pm ET chat landed on tomorrow's date. One helper, both callers.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { etDateKey, today } from "@/lib/utils/datetime";

describe("etDateKey", () => {
  it("a 9 pm ET instant (02:00Z next day) is still that ET day; noon ET is the same day in both", () => {
    expect(etDateKey(new Date("2026-11-03T02:00:00Z"))).toBe("2026-11-02");
    expect(etDateKey(new Date("2026-11-02T17:00:00Z"))).toBe("2026-11-02");
    // DST: 2026-07-01 is EDT (UTC-4): 03:59Z is still June 30 ET.
    expect(etDateKey(new Date("2026-07-01T03:59:00Z"))).toBe("2026-06-30");
  });
  it("today() is the same key for now", () => {
    expect(today()).toBe(etDateKey(new Date()));
  });
});

describe("knowledge-sync keys its promoted dumps by the ET day", () => {
  const src = readFileSync(fileURLToPath(new URL("../../lib/brain/knowledge-sync.ts", import.meta.url)), "utf8").replace(/\/\/.*$/gm, "");
  it("no UTC date slice remains; etDateKey is used for both the promoted dump and the wisdom summary", () => {
    expect(src).not.toMatch(/toISOString\(\)\.slice\(0,\s*10\)/);
    expect(src.match(/etDateKey\(msg\.createdAt\)/g)?.length).toBe(2);
  });
});
