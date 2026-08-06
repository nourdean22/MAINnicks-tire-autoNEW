/**
 * resetBrainState × the qualitative-identity cache · 2026-08-06
 *
 * `qualitative_identity` is one of the 12 BrainMemory categories
 * resetBrainState deletes, and buildQualitativeContextBlock caches that
 * row for 900s. Before the fix the reset dropped the ROW but not the
 * CACHE, which produced two separate failures:
 *
 *   1. /chat kept rendering the wiped identity for up to 15 minutes
 *   2. the next addManualEntry/removeEntry ran update() against a row
 *      that no longer existed → Prisma P2025
 *
 * These tests drive the real resetBrainState (not a stand-in) so the
 * wiring itself is what is under test.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { invalidate } from "@/lib/utils/cache";

const mocks = vi.hoisted(() => ({
  brainMemory: {
    findUnique: vi.fn(),
    findMany: vi.fn(),
    update: vi.fn(),
    upsert: vi.fn(),
    deleteMany: vi.fn(),
  },
  reflection: { findMany: vi.fn() },
  auditEvent: { create: vi.fn() },
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    brainMemory: mocks.brainMemory,
    reflection: mocks.reflection,
    auditEvent: mocks.auditEvent,
  },
}));

vi.mock("@/lib/utils/redis", () => ({
  redisGet: async () => null,
  redisSet: async () => false,
  redisDel: async () => false,
  redisDelPrefix: async () => 0,
}));

import { resetBrainState } from "@/lib/services/brain-domain";
import {
  addManualEntry,
  buildQualitativeContextBlock,
} from "@/lib/brain/qualitative-identity";

const CACHE_KEY = "qualitative_identity_current";

const SEEDED = JSON.stringify({
  values: [
    { text: "burn the boats", manual: true, evidence_ids: [], confidence: 1, updated_at: "2026-08-01T00:00:00.000Z" },
  ],
  fears: [],
  operating_style: [],
  rhythms: [],
  red_lines: [],
  computed_at: "2026-08-01T00:00:00.000Z",
});

describe("resetBrainState · qualitative-identity cache", () => {
  // null = the row does not exist (what a reset actually leaves behind).
  let stored: string | null = null;

  beforeEach(() => {
    stored = SEEDED;
    for (const fn of [
      mocks.brainMemory.findUnique,
      mocks.brainMemory.findMany,
      mocks.brainMemory.update,
      mocks.brainMemory.upsert,
      mocks.brainMemory.deleteMany,
      mocks.reflection.findMany,
      mocks.auditEvent.create,
    ]) {
      fn.mockReset();
    }

    mocks.brainMemory.findUnique.mockImplementation(async () =>
      stored === null ? null : { content: stored },
    );
    // The delete is what makes the cached object stale — model it.
    mocks.brainMemory.deleteMany.mockImplementation(async () => {
      stored = null;
      return { count: 12 };
    });
    mocks.brainMemory.update.mockImplementation(async ({ data }: { data: { content: string } }) => {
      if (stored === null) {
        const err = new Error(
          "An operation failed because it depends on one or more records that were required but not found.",
        );
        (err as Error & { code: string }).code = "P2025";
        throw err;
      }
      stored = data.content;
      return { id: "row" };
    });
    mocks.brainMemory.upsert.mockImplementation(
      async ({ where, create }: { where: { category_key: { key: string } }; create: { content: string } }) => {
        if (where.category_key.key === "current") stored = create.content;
        return { id: "row" };
      },
    );
    // Empty corpus — a recompute after a reset produces an empty identity.
    mocks.reflection.findMany.mockResolvedValue([]);
    mocks.brainMemory.findMany.mockResolvedValue([]);
    mocks.auditEvent.create.mockResolvedValue({ id: "audit" });

    invalidate(CACHE_KEY);
  });

  it("drops the cached identity — /chat stops rendering the wiped row", async () => {
    const before = await buildQualitativeContextBlock();
    expect(before).toContain("- burn the boats (pinned)");
    expect(mocks.brainMemory.findUnique).toHaveBeenCalledTimes(1);

    const result = await resetBrainState();
    expect(result.deleted).toBe(12);

    const after = await buildQualitativeContextBlock();

    // Without the invalidate in resetBrainState the L1 entry survives:
    // findUnique stays at 1 and the wiped identity keeps shipping in the
    // system prompt for the rest of the 900s TTL.
    expect(mocks.brainMemory.findUnique.mock.calls.length).toBeGreaterThan(1);
    expect(after).not.toContain("burn the boats");
  });

  it("lets the next addManualEntry rebuild the row instead of throwing P2025", async () => {
    await buildQualitativeContextBlock(); // seed the cache
    await resetBrainState();

    // With a live cache, loadQualitativeIdentity returns the stale object
    // and update() hits a row that is gone. With the invalidate, the
    // re-read misses, computeQualitativeIdentity re-upserts the row, and
    // the write lands.
    await expect(addManualEntry("values", "no agents on main")).resolves.toBeDefined();

    expect(mocks.brainMemory.upsert).toHaveBeenCalled(); // the row was rebuilt
    expect(stored).toContain("no agents on main");
  });
});
