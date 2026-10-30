/**
 * Home maxim (2026-10-29): every book pack is in the pool and every entry is showable, the pick holds still for
 * the ET hour, leans toward today's top line when a tag matches (tags only, read on the client), steps and
 * wraps on Next, and never shows a skipped maxim. The Skip marker sits in both category exclusion lists so
 * the nightly merge cannot delete it and recall never reads it.
 */
import { readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { CONSOLIDATION_EXCLUDE_CATEGORIES, RECALL_EXCLUDE_CATEGORIES } from "@/lib/brain/categories";
import { MAXIM_PACKS, MAXIM_POOL } from "@/lib/wisdom/maxim-pool";
import {
  MAXIM_SKIP_CATEGORY,
  MAXIM_TAGS,
  buildMaximPool,
  etHourKey,
  pickMaxim,
  tagsForText,
  type MaximPack,
  type MaximTag,
} from "@/lib/wisdom/maxims";

const ROOT = path.resolve(__dirname, "../..");
const at = (iso: string) => new Date(iso);
const tagsOf = (line: string): MaximTag[] => [...tagsForText(line)];

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
const NINE_PM = at("2026-10-29T21:00:00-04:00");

describe("the pool: every book pack, every entry showable", () => {
  it("imports every file in data/wisdom/maxims (a new pack file must join the pool)", () => {
    const files = readdirSync(path.join(ROOT, "data/wisdom/maxims")).filter((f) => f.endsWith(".json"));
    expect(files.map((f) => f.replace(/\.json$/, "")).sort()).toEqual(MAXIM_PACKS.map((p) => p.pack).sort());
    expect(MAXIM_PACKS.every((p) => p.entries.length > 0)).toBe(true);
  });

  it("every entry has text, a source, a ref and at least one tag, and every tag is on the fixed list", () => {
    const bad = MAXIM_POOL.filter(
      (m) =>
        !m.text.trim() ||
        !m.source.trim() ||
        !m.ref.trim() ||
        m.tags.length === 0 ||
        m.tags.some((t) => !(MAXIM_TAGS as readonly string[]).includes(t)),
    );
    expect(bad.map((m) => m.id)).toEqual([]);
  });

  it("ids are unique across packs", () => {
    expect(new Set(MAXIM_POOL.map((m) => m.id)).size).toBe(MAXIM_POOL.length);
  });
});

describe("the hour key", () => {
  it("is the ET date-hour, not UTC", () => {
    expect(etHourKey(at("2026-10-30T01:30:00Z"))).toBe("2026-10-29T21");
    expect(etHourKey(at("2026-10-30T04:00:00Z"))).toBe("2026-10-30T00");
  });

  it("turns over on the hour: 21:59 and 22:00 ET are different keys", () => {
    expect(etHourKey(at("2026-10-29T21:59:59-04:00"))).toBe("2026-10-29T21");
    expect(etHourKey(at("2026-10-29T22:00:00-04:00"))).toBe("2026-10-29T22");
  });
});

describe("the pick", () => {
  it("holds still within an ET hour", () => {
    const a = pickMaxim({ pool, skipped: none, at: at("2026-10-29T21:05:00-04:00") })!;
    const b = pickMaxim({ pool, skipped: none, at: at("2026-10-29T21:55:00-04:00") })!;
    expect(b.maxim.id).toBe(a.maxim.id);
  });

  it("Next steps, wraps past the end, and a bad step clamps to the start", () => {
    const pick = (step: number) => pickMaxim({ pool, skipped: none, at: NINE_PM, step })!;
    expect(pick(1).maxim.id).not.toBe(pick(0).maxim.id);
    expect(pick(1).total).toBe(4);
    expect(pick(4).maxim.id).toBe(pick(0).maxim.id);
    expect(pick(-3).maxim.id).toBe(pick(0).maxim.id);
    expect(pick(1.9).maxim.id).toBe(pick(1).maxim.id);
  });

  it("leans toward today's top line when a tag matches, and names the matched topic (the tag, worded by each surface)", () => {
    const p = pickMaxim({ pool, skipped: none, tags: tagsOf("Send the Smith estimate follow-up"), at: NINE_PM })!;
    expect(p.maxim.tags).toContain("customers");
    expect(p.total).toBe(1);
    expect(p.topic).toBe("customers");
  });

  it("falls back to the plain rotation, with no reason, when nothing matches", () => {
    const p = pickMaxim({ pool, skipped: none, tags: tagsOf("Water the plants"), at: NINE_PM })!;
    expect(p.total).toBe(4);
    expect(p.topic).toBeNull();
  });

  it("the four fixed lead headlines in operator-brief.ts: only the decisions one fits a tag, the rest rotate", () => {
    const fits = (headline: string) => pickMaxim({ pool: MAXIM_POOL, skipped: none, tags: tagsOf(headline), at: NINE_PM })!.topic;
    expect(fits("Decisions are blocking the system")).toBe("decisions");
    expect(fits("Finish what's in motion")).toBeNull();
    expect(fits("Resume the open loop")).toBeNull();
    expect(fits("Inbox needs triage")).toBeNull();
  });

  it("never shows a skipped maxim, and has nothing to show when all are skipped", () => {
    const skipped = new Set(["a:1"]);
    for (let step = 0; step < 6; step++) {
      expect(pickMaxim({ pool, skipped, at: NINE_PM, step })!.maxim.id).not.toBe("a:1");
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
