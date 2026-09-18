/**
 * enqueueLedgerEmbed must not resurrect a note that was deleted while it embedded.
 *
 * THE RACE (review on #2432). record-interaction.ts:201 fires this
 * fire-and-forget: `void (async () => { await enqueueLedgerEmbed(...) })()`.
 * `getEmbedding` is a network round-trip to a provider — SECONDS. Delete the
 * ledger row in that window and the old code still wrote the embedding
 * afterwards, by which time deleteLedgerRow's tombstone had already run. The
 * deleted note stayed searchable with no row behind it.
 *
 * A delete that loses a race to a writer it never knew about is not a delete.
 *
 * ⚠ WHAT THIS DOES *NOT* CLAIM. Neon is READ COMMITTED, so re-checking inside
 * the write transaction narrows the window from the provider call to one
 * statement boundary — it does not close it to zero. Full closure needs a row
 * lock on a hot fire-and-forget path. The residual is bounded and SELF-HEALING:
 * an embedding that wins that sub-millisecond race is marked `row_absent` by the
 * nightly lib/db/embedding-shadow sweep and stops surfacing in recall. These
 * tests pin the narrowing and the ordering, not an absolute guarantee.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const m = vi.hoisted(() => ({
  getEmbedding: vi.fn(),
  transaction: vi.fn(),
  txLedgerFindUnique: vi.fn(),
  txEmbedFindFirst: vi.fn(),
  txEmbedCreate: vi.fn(),
  txEmbedUpdate: vi.fn(),
}));

vi.mock("@/lib/ai/provider", () => ({ getEmbedding: m.getEmbedding }));
vi.mock("@/lib/prisma", () => ({
  prisma: { $transaction: m.transaction },
}));

import { enqueueLedgerEmbed } from "@/lib/brain/people-embed-hook";

const tx = {
  relationshipLedger: { findUnique: m.txLedgerFindUnique },
  vectorEmbedding: {
    findFirst: m.txEmbedFindFirst,
    create: m.txEmbedCreate,
    update: m.txEmbedUpdate,
  },
};

const NOTE = "a note long enough to clear the twenty character floor";

beforeEach(() => {
  for (const fn of Object.values(m)) fn.mockReset();
  m.transaction.mockImplementation(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx));
  m.getEmbedding.mockResolvedValue([0.1, 0.2, 0.3]);
  m.txEmbedFindFirst.mockResolvedValue(null);
  m.txEmbedCreate.mockResolvedValue({ id: "v1" });
  m.txEmbedUpdate.mockResolvedValue({ id: "v1" });
});

describe("enqueueLedgerEmbed · deleted-while-embedding", () => {
  it("writes NOTHING when the ledger row vanished during the embedding call", async () => {
    m.txLedgerFindUnique.mockResolvedValue(null); // deleted while we embedded

    await enqueueLedgerEmbed("L1", NOTE);

    expect(m.getEmbedding, "the embedding call still happened").toHaveBeenCalled();
    expect(m.txEmbedCreate, "must not resurrect a deleted note").not.toHaveBeenCalled();
    expect(m.txEmbedUpdate).not.toHaveBeenCalled();
  });

  it("CANARY — a live ledger row still gets its embedding, so the above is not vacuous", async () => {
    m.txLedgerFindUnique.mockResolvedValue({ id: "L1" });

    await enqueueLedgerEmbed("L1", NOTE);

    expect(m.txEmbedCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ sourceType: "relationship_ledger", sourceId: "L1" }),
      }),
    );
  });

  it("re-checks AFTER embedding, not before — checking first is what made it racy", async () => {
    const order: string[] = [];
    m.getEmbedding.mockImplementation(async () => {
      order.push("embed");
      return [0.1];
    });
    m.txLedgerFindUnique.mockImplementation(async () => {
      order.push("recheck");
      return { id: "L1" };
    });

    await enqueueLedgerEmbed("L1", NOTE);

    // A check before the slow call proves nothing: the row can die during it.
    expect(order).toEqual(["embed", "recheck"]);
  });

  it("the re-check and the write share ONE transaction", async () => {
    m.txLedgerFindUnique.mockResolvedValue({ id: "L1" });

    await enqueueLedgerEmbed("L1", NOTE);

    // A check outside the write's transaction is just a second place to be
    // stale — it would narrow nothing.
    expect(m.transaction).toHaveBeenCalledTimes(1);
  });

  it("still short-circuits before any DB work when the note is too short", async () => {
    await enqueueLedgerEmbed("L1", "too short");
    expect(m.getEmbedding).not.toHaveBeenCalled();
    expect(m.transaction).not.toHaveBeenCalled();
  });

  it("writes nothing when the provider returns no vector", async () => {
    m.getEmbedding.mockResolvedValue([]);
    await enqueueLedgerEmbed("L1", NOTE);
    expect(m.transaction).not.toHaveBeenCalled();
  });
});
