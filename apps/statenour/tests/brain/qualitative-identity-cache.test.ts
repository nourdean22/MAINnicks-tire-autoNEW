/**
 * qualitative-identity · cache + writer integrity · 2026-08-06
 *
 * buildQualitativeContextBlock fires on EVERY /chat turn (1417 of 1417
 * sampled turns over 30d) and reads one slowly-changing BrainMemory row,
 * so the round-trip was pure time-to-first-token cost. These tests pin:
 *
 *   1. a second call inside the TTL does not re-query
 *   2. addManualEntry() / removeEntry() invalidate, so the next call
 *      re-queries and renders what the ROW actually holds
 *   3. a FAILED write leaves no phantom behind — the writers never mutate
 *      the cached object in place
 *   4. computeQualitativeIdentity() classifies, persists, and invalidates
 *
 * On (2) — why the assertions look paranoid. An earlier version of the
 * invalidation test asserted only:
 *
 *     expect(after).toContain("- ship before it is ready (pinned)")
 *
 * That was theater. addManualEntry mutated the cached object in place, so
 * the string was in the rendered block whether or not invalidate() did
 * anything — the test passed against a no-op invalidate. Every
 * invalidation test below now also pins the query COUNT and compares
 * against the pre-write render, both of which a no-op invalidate fails.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { invalidate } from "@/lib/utils/cache";
import { BRAIN_CATEGORIES } from "@/lib/brain/categories";

const mocks = vi.hoisted(() => ({
  brainMemory: {
    findUnique: vi.fn(),
    findMany: vi.fn(),
    update: vi.fn(),
    upsert: vi.fn(),
  },
  reflection: { findMany: vi.fn() },
}));

vi.mock("@/lib/prisma", () => ({
  prisma: { brainMemory: mocks.brainMemory, reflection: mocks.reflection },
}));

// L2 is a no-op here so the assertions measure the L1 mechanism only:
// invalidate() fires redisDel WITHOUT awaiting it, so a live Redis would
// race the "did re-query" assertion.
vi.mock("@/lib/utils/redis", () => ({
  redisGet: async () => null,
  redisSet: async () => false,
  redisDel: async () => false,
  redisDelPrefix: async () => 0,
}));

// Imported AFTER vi.mock so the module picks up the mocked deps.
import {
  addManualEntry,
  removeEntry,
  computeQualitativeIdentity,
  buildQualitativeContextBlock,
} from "@/lib/brain/qualitative-identity";

// Mirrors CACHE_KEY in lib/brain/qualitative-identity.ts — same
// documentation-as-code convention as tests/lib/cache.test.ts. Renaming
// the key there without updating it here breaks the invalidation test.
const CACHE_KEY = "qualitative_identity_current";

const BASE_IDENTITY = {
  values: [
    { text: "speed over politeness", manual: false, evidence_ids: [], confidence: 0.9, updated_at: "2026-08-01T00:00:00.000Z" },
  ],
  fears: [],
  operating_style: [],
  rhythms: [],
  red_lines: [],
  computed_at: "2026-08-01T00:00:00.000Z",
};

describe("qualitative-identity · context-block cache", () => {
  // Stands in for the single BrainMemory row, so a re-query after an
  // invalidation reads what the write actually persisted.
  let stored = "";

  beforeEach(() => {
    stored = JSON.stringify(BASE_IDENTITY);
    mocks.brainMemory.findUnique.mockReset();
    mocks.brainMemory.update.mockReset();
    mocks.brainMemory.upsert.mockReset();
    mocks.reflection.findMany.mockReset();
    mocks.brainMemory.findMany.mockReset();
    mocks.brainMemory.findUnique.mockImplementation(async () => ({ content: stored }));
    mocks.brainMemory.update.mockImplementation(async ({ data }: { data: { content: string } }) => {
      stored = data.content;
      return { id: "row" };
    });
    // The L1 store is module-level and shared across tests in this file.
    invalidate(CACHE_KEY);
  });

  it("two calls inside the TTL run exactly ONE query and render identically", async () => {
    const first = await buildQualitativeContextBlock();
    const second = await buildQualitativeContextBlock();

    expect(mocks.brainMemory.findUnique).toHaveBeenCalledTimes(1);
    expect(second).toBe(first);
    expect(first).toContain("- speed over politeness");
    // The row is present, so loadQualitativeIdentity must NEVER fall
    // through to computeQualitativeIdentity. upsert is that path's only
    // fingerprint — if it fired, this file is measuring the wrong thing.
    expect(mocks.brainMemory.upsert).not.toHaveBeenCalled();
  });

  it("addManualEntry() invalidates — the next call re-queries and renders the NEW row", async () => {
    const before = await buildQualitativeContextBlock();
    expect(mocks.brainMemory.findUnique).toHaveBeenCalledTimes(1);
    expect(before).not.toContain("ship before it is ready");

    await addManualEntry("values", "ship before it is ready");
    expect(mocks.brainMemory.update).toHaveBeenCalledTimes(1);
    // Pin the PRODUCER: the entry has to be in what was persisted, not
    // merely in some in-memory object the writer handed back.
    expect(stored).toContain("ship before it is ready");

    const after = await buildQualitativeContextBlock();

    // A no-op invalidate() fails all three of these: the count stays at
    // 1, `after` is byte-identical to `before`, and the new entry never
    // appears — because the writer no longer edits the cached object.
    expect(mocks.brainMemory.findUnique).toHaveBeenCalledTimes(2);
    expect(after).not.toBe(before);
    expect(after).toContain("- ship before it is ready (pinned)");
  });

  it("a FAILED addManualEntry write leaves no phantom entry in the prompt", async () => {
    const before = await buildQualitativeContextBlock();
    mocks.brainMemory.update.mockRejectedValueOnce(new Error("P2025: record not found"));

    await expect(addManualEntry("values", "phantom pin")).rejects.toThrow("P2025");

    const after = await buildQualitativeContextBlock();

    // In-place mutation puts "phantom pin" in the cached object BEFORE
    // the write, so a rejected write would leave it in the prompt for
    // 900s and duplicate it on the operator's retry.
    expect(after).not.toContain("phantom pin");
    expect(after).toBe(before);
    expect(stored).not.toContain("phantom pin");
  });

  it("removeEntry() invalidates — the next call re-queries and the entry is gone", async () => {
    const before = await buildQualitativeContextBlock();
    expect(before).toContain("- speed over politeness");
    expect(mocks.brainMemory.findUnique).toHaveBeenCalledTimes(1);

    await removeEntry("values", "speed over politeness");
    expect(stored).not.toContain("speed over politeness");

    const after = await buildQualitativeContextBlock();

    expect(mocks.brainMemory.findUnique).toHaveBeenCalledTimes(2);
    expect(after).not.toContain("speed over politeness");
    expect(after).not.toBe(before);
  });

  it("a FAILED removeEntry write leaves the entry in the prompt", async () => {
    const before = await buildQualitativeContextBlock();
    mocks.brainMemory.update.mockRejectedValueOnce(new Error("P2025: record not found"));

    await expect(removeEntry("values", "speed over politeness")).rejects.toThrow("P2025");

    const after = await buildQualitativeContextBlock();

    // The row still holds it, so the prompt must too. Assigning to
    // current[bucket] would have dropped it from the cached object and
    // desynced the prompt from the DB for a full TTL.
    expect(stored).toContain("speed over politeness");
    expect(after).toContain("- speed over politeness");
    expect(after).toBe(before);
  });
});

describe("qualitative-identity · computeQualitativeIdentity", () => {
  let stored: string | null = null;

  const REFLECTIONS = [
    { id: "r1", insight: "I value speed over politeness when reviewing work.", category: "preference", confidence: 0.9, createdAt: new Date() },
    { id: "r2", insight: "I hate being blind to what the system is actually doing.", category: "preference", confidence: 0.8, createdAt: new Date() },
    { id: "r3", insight: "I never let an agent push straight to main.", category: "decision", confidence: 0.95, createdAt: new Date() },
  ];
  const IMPORTANCE = [
    { id: "m1", content: JSON.stringify({ excerpt: "My approach is batch the work and cut the meetings." }), createdAt: new Date() },
  ];

  beforeEach(() => {
    stored = null;
    mocks.brainMemory.findUnique.mockReset();
    mocks.brainMemory.findMany.mockReset();
    mocks.brainMemory.upsert.mockReset();
    mocks.brainMemory.update.mockReset();
    mocks.reflection.findMany.mockReset();

    mocks.brainMemory.findUnique.mockImplementation(async () =>
      stored === null ? null : { content: stored },
    );
    mocks.reflection.findMany.mockResolvedValue(REFLECTIONS);
    mocks.brainMemory.findMany.mockImplementation(
      async ({ where }: { where: { category: string } }) =>
        where.category === BRAIN_CATEGORIES.CHAT_IMPORTANCE ? IMPORTANCE : [],
    );
    // Only key="current" feeds the read path; the history row is written
    // too and is asserted separately.
    mocks.brainMemory.upsert.mockImplementation(
      async ({ where, create }: { where: { category_key: { key: string } }; create: { content: string } }) => {
        if (where.category_key.key === "current") stored = create.content;
        return { id: "row" };
      },
    );
    invalidate(CACHE_KEY);
  });

  it("buckets reflections + chat_importance by marker and persists current + history", async () => {
    const identity = await computeQualitativeIdentity();

    expect(identity.values.map((e) => e.text)).toContain(
      "i value speed over politeness when reviewing work",
    );
    expect(identity.fears.map((e) => e.text)).toContain(
      "i hate being blind to what the system is actually doing",
    );
    // red_lines is checked BEFORE values/fears in classifyText, so "I
    // never ..." must land here and nowhere else.
    expect(identity.red_lines.map((e) => e.text)).toContain(
      "i never let an agent push straight to main",
    );
    expect(identity.values.map((e) => e.text)).not.toContain(
      "i never let an agent push straight to main",
    );
    expect(identity.operating_style.map((e) => e.text)).toContain(
      "my approach is batch the work and cut the meetings",
    );

    // Both rows written: key="current" and key="history:YYYY-MM-DD".
    expect(mocks.brainMemory.upsert).toHaveBeenCalledTimes(2);
    const keys = mocks.brainMemory.upsert.mock.calls.map(
      (c) => (c[0] as { where: { category_key: { key: string } } }).where.category_key.key,
    );
    expect(keys).toContain("current");
    expect(keys.some((k) => k.startsWith("history:"))).toBe(true);
  });

  it("a recompute invalidates — the next context block renders the NEW identity", async () => {
    stored = JSON.stringify(BASE_IDENTITY);
    const before = await buildQualitativeContextBlock();
    expect(before).toContain("- speed over politeness");
    expect(mocks.brainMemory.findUnique).toHaveBeenCalledTimes(1);

    await computeQualitativeIdentity();

    const after = await buildQualitativeContextBlock();

    // Without the invalidate() at the end of computeQualitativeIdentity,
    // the nightly recompute would be invisible to /chat for 900s: the
    // count would stay at 1 and `after` would equal `before`.
    expect(mocks.brainMemory.findUnique.mock.calls.length).toBeGreaterThan(1);
    expect(after).not.toBe(before);
    expect(after).toContain("- i never let an agent push straight to main");
  });

  it("manual entries from the previous snapshot survive the recompute", async () => {
    stored = JSON.stringify({
      ...BASE_IDENTITY,
      values: [
        { text: "burn the boats", manual: true, evidence_ids: [], confidence: 1, updated_at: "2026-08-01T00:00:00.000Z" },
      ],
    });

    const identity = await computeQualitativeIdentity();

    expect(identity.values[0].text).toBe("burn the boats");
    expect(identity.values[0].manual).toBe(true);
    // ...and the freshly computed one is still there behind it.
    expect(identity.values.map((e) => e.text)).toContain(
      "i value speed over politeness when reviewing work",
    );
  });
});
