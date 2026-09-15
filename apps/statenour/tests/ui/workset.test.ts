/**
 * Workset rules · 2026-09-15.
 *
 * Horizons expire as a pure function of `now`, the shelf is capped at 7 with
 * the OLDEST falling off, re-pinning replaces and moves to the front, and a
 * corrupt stored row is dropped alone instead of emptying the shelf.
 */
import { describe, expect, it } from "vitest";
import {
  addEntry,
  describeExpiry,
  expiryFor,
  hasEntry,
  isExpired,
  parseWorkset,
  pruneExpired,
  removeEntry,
  serializeWorkset,
  WORKSET_CAP,
  type WorksetEntry,
} from "@/lib/ui/workset";

const NOW = new Date("2026-09-16T15:30:00"); // a Wednesday, local time

function entry(id: string, pinnedAt = 0, expiresAt: number | null = null): WorksetEntry {
  return { ref: { kind: "task", id }, label: `task ${id}`, horizon: "until-resolved", pinnedAt, expiresAt };
}

describe("expiryFor", () => {
  it("session = +8h · today = next local midnight · until-resolved = never", () => {
    expect(expiryFor("session", NOW)).toBe(NOW.getTime() + 8 * 3_600_000);
    const midnight = new Date(NOW);
    midnight.setHours(24, 0, 0, 0);
    expect(expiryFor("today", NOW)).toBe(midnight.getTime());
    expect(expiryFor("until-resolved", NOW)).toBeNull();
  });

  it("week = the NEXT Monday at 06:00 local (never today, even on a Monday)", () => {
    const wed = expiryFor("week", NOW)!;
    const d = new Date(wed);
    expect(d.getDay()).toBe(1);
    expect(d.getHours()).toBe(6);
    expect(wed).toBeGreaterThan(NOW.getTime());
    expect((wed - NOW.getTime()) / 86_400_000).toBeLessThan(7);

    const monday = new Date("2026-09-14T10:00:00");
    const next = new Date(expiryFor("week", monday)!);
    expect(next.getDay()).toBe(1);
    expect((next.getTime() - monday.getTime()) / 86_400_000).toBeGreaterThan(6);
  });
});

describe("prune / add / remove", () => {
  it("prunes expired entries and keeps until-resolved ones", () => {
    const list = [entry("a", 0, NOW.getTime() - 1), entry("b", 0, NOW.getTime() + 1), entry("c")];
    expect(pruneExpired(list, NOW.getTime()).map((e) => e.ref.id)).toEqual(["b", "c"]);
    expect(isExpired(entry("a", 0, NOW.getTime()), NOW.getTime())).toBe(true);
  });

  it("re-pinning the same ref replaces it and moves it to the front", () => {
    const list = [entry("a", 1), entry("b", 2)];
    const next = addEntry(list, { ...entry("b", 3), label: "renamed" });
    expect(next.map((e) => e.ref.id)).toEqual(["b", "a"]);
    expect(next[0]!.label).toBe("renamed");
  });

  it("caps at WORKSET_CAP, dropping the oldest", () => {
    let list: WorksetEntry[] = [];
    for (let i = 0; i < WORKSET_CAP + 2; i++) list = addEntry(list, entry(`e${i}`, i));
    expect(list).toHaveLength(WORKSET_CAP);
    expect(list[0]!.ref.id).toBe(`e${WORKSET_CAP + 1}`);
    expect(hasEntry(list, { kind: "task", id: "e0" })).toBe(false);
  });

  it("removeEntry / hasEntry match by kind and id", () => {
    const list = [entry("a"), entry("b")];
    expect(removeEntry(list, { kind: "task", id: "a" }).map((e) => e.ref.id)).toEqual(["b"]);
    expect(hasEntry(list, { kind: "memory", id: "a" })).toBe(false);
  });
});

describe("parseWorkset / serializeWorkset", () => {
  it("round-trips", () => {
    const list = [entry("a", 5, null), { ...entry("b", 6, 99), horizon: "today" as const }];
    expect(parseWorkset(serializeWorkset(list))).toEqual(list);
  });

  it("drops a corrupt row alone: unknown kind, missing label, a timed horizon without expiry, bad JSON", () => {
    const raw = JSON.stringify([
      { ref: "widget:1", label: "x", horizon: "today", pinnedAt: 1, expiresAt: 2 },
      { ref: "task:ok", horizon: "today", pinnedAt: 1, expiresAt: 2 },
      { ref: "task:noexp", label: "x", horizon: "today", pinnedAt: 1, expiresAt: null },
      { ref: "task:good", label: "good", horizon: "week", pinnedAt: 1, expiresAt: 2 },
    ]);
    expect(parseWorkset(raw).map((e) => e.ref.id)).toEqual(["good"]);
    expect(parseWorkset("{not json")).toEqual([]);
    expect(parseWorkset(null)).toEqual([]);
    expect(parseWorkset({ nope: true })).toEqual([]);
  });
});

describe("describeExpiry", () => {
  it("speaks in hours, days, or 'until resolved'", () => {
    expect(describeExpiry(entry("a"), NOW.getTime())).toBe("until resolved");
    expect(describeExpiry(entry("a", 0, NOW.getTime() + 3 * 3_600_000), NOW.getTime())).toBe("expires in 3h");
    expect(describeExpiry(entry("a", 0, NOW.getTime() + 3 * 86_400_000), NOW.getTime())).toBe("expires in 3d");
    expect(describeExpiry(entry("a", 0, NOW.getTime() - 1), NOW.getTime())).toBe("expired");
  });
});
