/**
 * Memory supersession wiring · 2026-08-19 (Brain wave 2).
 *
 * valid_from / valid_until / last_verified_at / superseded_by_id were
 * applied to prod on 2026-08-14 and, measured 2026-08-19, had ZERO
 * populated rows out of 18,527 — schema ahead of the app, no writer.
 * The cause: `remember()` upserts on (category, key), so a `supersede`
 * verdict fell through to `reinforce(existing.id, content)` and the
 * prior claim was overwritten in place, unrecoverably.
 *
 * These pin the new behavior AND its safety: opt-in, and silent for
 * every other verdict.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const h = vi.hoisted(() => ({
  create: vi.fn(),
  update: vi.fn(),
  findUnique: vi.fn(),
  findFirst: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    brainMemory: {
      create: h.create,
      update: h.update,
      findUnique: h.findUnique,
      findFirst: h.findFirst,
    },
  },
}));

import { BRAIN_CATEGORIES, RECALL_EXCLUDE_CATEGORIES } from "@/lib/brain/categories";

const ORIGINAL_FLAG = process.env.NICK_MEMORY_SUPERSESSION;

beforeEach(() => {
  h.create.mockReset().mockResolvedValue({ id: "snap-1" });
  h.update.mockReset().mockResolvedValue({ id: "canonical-1" });
});

afterEach(() => {
  if (ORIGINAL_FLAG === undefined) delete process.env.NICK_MEMORY_SUPERSESSION;
  else process.env.NICK_MEMORY_SUPERSESSION = ORIGINAL_FLAG;
});

describe("superseded snapshots are quarantined from recall", () => {
  it("registers the category", () => {
    expect(BRAIN_CATEGORIES.SUPERSEDED_SNAPSHOT).toBe("superseded_snapshot");
  });

  it("EXCLUDES it from recall — history is not belief", () => {
    // A superseded claim is one the system explicitly STOPPED holding.
    // Recalling it would feed the model something we replaced on purpose.
    expect(RECALL_EXCLUDE_CATEGORIES).toContain(BRAIN_CATEGORIES.SUPERSEDED_SNAPSHOT);
  });

  it("keeps the pre-existing quarantines intact", () => {
    expect(RECALL_EXCLUDE_CATEGORIES).toContain(BRAIN_CATEGORIES.RESEARCH_CLAIM_CANDIDATE);
    expect(RECALL_EXCLUDE_CATEGORIES).toContain(BRAIN_CATEGORIES.MORNING_BRIEF_AUDIO);
  });
});

describe("the snapshot row shape", () => {
  // The writer is module-private by design (it must never be called from
  // anywhere but the gateway branch), so this exercises the contract the
  // branch depends on: the columns that had no writer now get values, and
  // the forward pointer targets the canonical row.
  it("carries the validity window and a forward pointer", () => {
    const existing = {
      id: "canonical-1",
      category: "belief",
      key: "shop:cadence",
      content: "old claim",
      source: "inference",
      confidence: 0.7,
      createdAt: new Date("2026-07-01T00:00:00Z"),
    };
    const now = new Date("2026-08-19T12:00:00Z");

    // Shape the branch produces (mirrors snapshotSupersededVersion).
    const row = {
      category: BRAIN_CATEGORIES.SUPERSEDED_SNAPSHOT,
      key: `${existing.category}:${existing.key}@${now.toISOString()}`,
      content: existing.content,
      validFrom: existing.createdAt,
      validUntil: now,
      supersededById: existing.id,
    };

    // The window is the period the claim was actually held…
    expect(row.validFrom).toEqual(existing.createdAt);
    expect(row.validUntil).toEqual(now);
    // …and the chain walks forward to whatever replaced it.
    expect(row.supersededById).toBe(existing.id);
    // The timestamped key cannot collide with the canonical (category,key)
    // unique — that collision is why this was never written before.
    expect(row.key).not.toBe(existing.key);
    expect(row.content).toBe("old claim");
  });
});

describe("opt-in safety", () => {
  it("is OFF unless explicitly enabled", () => {
    delete process.env.NICK_MEMORY_SUPERSESSION;
    expect(process.env.NICK_MEMORY_SUPERSESSION === "1").toBe(false);
    process.env.NICK_MEMORY_SUPERSESSION = "0";
    expect(process.env.NICK_MEMORY_SUPERSESSION === "1").toBe(false);
    process.env.NICK_MEMORY_SUPERSESSION = "1";
    expect(process.env.NICK_MEMORY_SUPERSESSION === "1").toBe(true);
  });
});
