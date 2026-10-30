/**
 * Home maxim (2026-10-29): every book pack is in the pool, the pick holds still for the hour, leans toward
 * today's top line when a tag matches, steps on Next, and never shows a skipped maxim. The Skip marker sits
 * in both category exclusion lists so the nightly merge cannot delete it and recall never reads it.
 */
import { readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { CONSOLIDATION_EXCLUDE_CATEGORIES, RECALL_EXCLUDE_CATEGORIES } from "@/lib/brain/categories";
import { MAXIM_PACKS, MAXIM_POOL } from "@/lib/wisdom/maxim-pool";
import { MAXIM_SKIP_CATEGORY, buildMaximPool, etHourKey, pickMaxim, tagsForText, type MaximPack } from "@/lib/wisdom/maxims";

const ROOT = path.resolve(__dirname, "../..");
const at = (iso: string) => new Date(iso);

const FIXTURE: MaximPack[] = [
  {
    pack: "a",
    entries: [
      { text: "Call the customer back the same day.", source: "A", ref: "1", tags: ["customers", "timing"] },
      { text: "Sleep before a big decision.", source: "A", ref: "2", tags: ["health", "decisions"] },
      { text: "Price for the work, not the clock.", source: "A", ref: "3", tags: ["money"] },
    ],
  },
  { pack: "b", entries: [{ text: "Hire slow.", source: "B", ref: "1", tags: ["hiring"] }] },
];
const pool = buildMaximPool(FIXTURE);
const none = new Set<string>();

describe("the pool: every book pack, counted", () => {
  it("has each pack at its count, and 566 maxims in all", () => {
    const counts = Object.fromEntries(MAXIM_PACKS.map((p) => [p.pack, p.entries.length]));
    expect(counts).toEqual({ "greene-maxims": 153, "gracian-maxims": 300, "naval-maxims": 41, "munger-maxims": 41, "bezos-maxims": 31 });
    expect(MAXIM_POOL).toHaveLength(566);
  });

  it("imports every file in data/wisdom/maxims (a new pack file must join the pool)", () => {
    const files = readdirSync(path.join(ROOT, "data/wisdom/maxims")).filter((f) => f.endsWith(".json"));
    expect(files.map((f) => f.replace(/\.json$/, "")).sort()).toEqual(MAXIM_PACKS.map((p) => p.pack).sort());
  });

  it("ids are unique across packs, and every maxim carries text and a source to show", () => {
    expect(new Set(MAXIM_POOL.map((m) => m.id)).size).toBe(MAXIM_POOL.length);
    expect(MAXIM_POOL.every((m) => m.text.trim().length > 0 && m.source.trim().length > 0)).toBe(true);
  });
});

describe("the pick", () => {
  it("holds still within an ET hour and steps with Next", () => {
    const a = pickMaxim({ pool, skipped: none, at: at("2026-10-29T21:05:00-04:00") })!;
    const b = pickMaxim({ pool, skipped: none, at: at("2026-10-29T21:55:00-04:00") })!;
    expect(b.maxim.id).toBe(a.maxim.id);
    const next = pickMaxim({ pool, skipped: none, at: at("2026-10-29T21:05:00-04:00"), step: 1 })!;
    expect(next.maxim.id).not.toBe(a.maxim.id);
    expect(next.total).toBe(4);
  });

  it("keys on the ET date-hour, not UTC", () => {
    expect(etHourKey(at("2026-10-30T01:30:00Z"))).toBe("2026-10-29T21");
  });

  it("leans toward today's top line when a tag matches, and names the matched topic", () => {
    const p = pickMaxim({ pool, skipped: none, context: "Send the Smith estimate follow-up", at: at("2026-10-29T21:00:00-04:00") })!;
    expect(p.maxim.tags).toContain("customers");
    expect(p.total).toBe(1);
    expect(p.reason).toBe("for today: customers");
  });

  it("falls back to the plain rotation, with no reason, when nothing matches", () => {
    const p = pickMaxim({ pool, skipped: none, context: "Water the plants", at: at("2026-10-29T21:00:00-04:00") })!;
    expect(p.total).toBe(4);
    expect(p.reason).toBeNull();
  });

  it("never shows a skipped maxim, and has nothing to show when all are skipped", () => {
    const skipped = new Set(["a:1"]);
    for (let step = 0; step < 6; step++) {
      expect(pickMaxim({ pool, skipped, at: at("2026-10-29T21:00:00-04:00"), step })!.maxim.id).not.toBe("a:1");
    }
    expect(pickMaxim({ pool, skipped: new Set(pool.map((m) => m.id)), at: new Date() })).toBeNull();
  });

  it("reads tags from whole words only", () => {
    expect([...tagsForText("Approve the refund for the angry customer")].sort()).toEqual(["conflict", "customers", "decisions"]);
    expect(tagsForText("repricing").size).toBe(0);
  });
});

describe("the Skip marker is a control row, not a belief", () => {
  it("sits in both the consolidation and the recall exclusion lists", () => {
    expect(CONSOLIDATION_EXCLUDE_CATEGORIES).toContain(MAXIM_SKIP_CATEGORY);
    expect(RECALL_EXCLUDE_CATEGORIES).toContain(MAXIM_SKIP_CATEGORY);
  });
});
