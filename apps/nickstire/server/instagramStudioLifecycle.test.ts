/**
 * Lifecycle-integrity regression tests for instagramStudio (Wave 1, 2026-07-24).
 *
 * Pins the fixes for the verified defect cluster:
 *  - reject left the pending scheduled_posts row live → the cron published
 *    content the operator explicitly rejected (the inventoryId link, 0096)
 *  - schedule had no at-most-once claim → double-tap = duplicate posts
 *  - stage's blind upsert yanked approved rows back to "pending"
 *  - update discarded its CAS result → lost edits reported as saved
 *  - a dispatched-but-unanswered media_publish was recorded as plain "failed",
 *    inviting the retry that duplicates a live post → parked "ambiguous"
 *
 * Purpose-built db mock (same approach as instagramAdmin.honesty.test.ts):
 * captures every update/insert with its target table and feeds per-call
 * affectedRows, because these tests are ABOUT write ordering and CAS honesty.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";

type Op =
  | { kind: "update"; table: unknown; set: Record<string, unknown> }
  | { kind: "insert"; table: unknown; values: Record<string, unknown>; upsert?: Record<string, unknown> };

const ops: Op[] = [];
const selectQueue: unknown[][] = [];
/** affectedRows per update call, consumed in order; default 1. */
const updateResults: number[] = [];
let insertError: Error | null = null;

function makeSelectChain(): Record<string, unknown> {
  const chain: Record<string, unknown> = {};
  for (const m of ["from", "where", "orderBy"]) chain[m] = () => chain;
  chain.limit = () => Promise.resolve(selectQueue.shift() ?? []);
  chain.then = (resolve: (v: unknown) => void) => resolve(selectQueue.shift() ?? []);
  return chain;
}

const database = {
  select: () => makeSelectChain(),
  update: (table: unknown) => ({
    set: (set: Record<string, unknown>) => ({
      where: () => {
        ops.push({ kind: "update", table, set });
        const affectedRows = updateResults.length ? (updateResults.shift() as number) : 1;
        return Promise.resolve([{ affectedRows }, []]);
      },
    }),
  }),
  insert: (table: unknown) => ({
    values: (values: Record<string, unknown>) => {
      const op: Op = { kind: "insert", table, values };
      const outcome = () => (insertError ? Promise.reject(insertError) : Promise.resolve());
      return {
        onDuplicateKeyUpdate: (u: { set: Record<string, unknown> }) => {
          op.upsert = u.set;
          ops.push(op);
          return outcome();
        },
        then: (res: (v: unknown) => void, rej: (e: unknown) => void) => {
          ops.push(op);
          return outcome().then(res, rej);
        },
      };
    },
  }),
};

vi.mock("./lib/db-helper", () => ({
  db: async () => database,
  dbTyped: async () => database,
  requireDb: async () => database,
}));

const publishToSocialMock = vi.fn();
vi.mock("./services/socialPublish", () => ({
  publishToSocial: (...args: unknown[]) => publishToSocialMock(...args),
  captionClaimBlockers: () => [],
  assertPermanentPublicMediaUrl: () => {},
}));

const verifyApprovalMock = vi.fn(async () => ({ ok: true as const }));
vi.mock("./services/contentApprovals", () => ({
  verifyApprovalRecord: (...args: unknown[]) => verifyApprovalMock(...(args as [never])),
  createApprovalRecord: vi.fn(async () => undefined),
  computeMediaHash: vi.fn(async () => "hash"),
}));

vi.mock("./services/igAutopost", () => ({
  fetchRecentConceptKeys: async () => [],
}));

import { appRouter } from "./routers";
import { computeStudioItemState } from "./routers/instagramStudio";
import { scheduledPosts, socialContentInventory } from "../drizzle/schema";
import { INSTAGRAM_STUDIO_VERSION } from "../shared/instagramStudio";
import type { TrpcContext } from "./_core/context";

function ctx(): TrpcContext {
  return {
    user: {
      id: 1,
      openId: "admin-user",
      email: "admin@nickstire.com",
      name: "Admin",
      loginMethod: "manus",
      role: "admin",
      createdAt: new Date(),
      updatedAt: new Date(),
      lastSignedIn: new Date(),
    },
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: { clearCookie: () => {} } as TrpcContext["res"],
  } as TrpcContext;
}
const admin = () => appRouter.createCaller(ctx());

function makeDraft(overrides: Record<string, unknown> = {}) {
  return {
    version: INSTAGRAM_STUDIO_VERSION,
    id: "ig_lifecycle_test",
    source: { type: "manual_idea", detail: "Winter tire checks before the first Cleveland snow." },
    format: "post",
    objective: "walk_ins",
    topic: "Winter tire readiness",
    caption: "Cold mornings expose weak tread. Swing by Nick's Tire for a free tread check before the first snow hits Euclid.",
    hashtags: ["clevelandtires"],
    headline: "Tread check before the snow",
    subheadline: "Free 5-minute inspection, no appointment needed",
    cta: "Stop by today",
    artDirection: "One close tire sidewall on dark graphite, yellow accent lighting.",
    carouselSlides: [],
    imageUrls: ["https://cdn.example.com/a.jpg", "https://cdn.example.com/b.jpg"],
    rationale: "Seasonal urgency drives walk-ins.",
    conceptKey: "winter-tread-check",
    quality: {
      version: INSTAGRAM_STUDIO_VERSION,
      overall: 82,
      gate: "pass",
      dimensions: [],
      blockers: [],
      warnings: [],
      evaluatedAt: new Date().toISOString(),
    },
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeRow(status: string, overrides: Record<string, unknown> = {}) {
  const draft = makeDraft();
  return {
    id: draft.id,
    version: 2,
    status,
    briefJson: JSON.stringify(draft),
    scheduledAt: null,
    publishedAt: null,
    errorMessage: null,
    ...overrides,
  };
}

const inventoryUpdates = () => ops.filter((o): o is Extract<Op, { kind: "update" }> => o.kind === "update" && o.table === socialContentInventory);
const scheduledUpdates = () => ops.filter((o): o is Extract<Op, { kind: "update" }> => o.kind === "update" && o.table === scheduledPosts);
const scheduledInserts = () => ops.filter((o): o is Extract<Op, { kind: "insert" }> => o.kind === "insert" && o.table === scheduledPosts);

beforeEach(() => {
  ops.length = 0;
  selectQueue.length = 0;
  updateResults.length = 0;
  insertError = null;
  publishToSocialMock.mockReset();
  verifyApprovalMock.mockClear();
});

describe("reject cancels the deferred publish it owns", () => {
  it("cancels the pending scheduled_posts row BEFORE flipping the inventory row", async () => {
    selectQueue.push([makeRow("scheduled")]);
    updateResults.push(1, 1); // cancel succeeds, reject CAS succeeds

    await expect(admin().instagramStudio.reject({ id: "ig_lifecycle_test", reason: "wrong offer" }))
      .resolves.toMatchObject({ status: "rejected" });

    // Order is the invariant: the cron must lose its row before the queue lies.
    expect(ops[0]).toMatchObject({ kind: "update", table: scheduledPosts });
    expect(scheduledUpdates()[0]?.set.status).toBe("canceled");
    const rejectWrite = inventoryUpdates()[0];
    expect(rejectWrite?.set.status).toBe("rejected");
    expect(rejectWrite?.set.version).toBe(3); // version protocol, like every other writer
  });

  it("CONFLICTs (and leaves the inventory row alone) when the cron already claimed the scheduled row", async () => {
    selectQueue.push([makeRow("scheduled")]);
    updateResults.push(0); // cancel matched nothing — the fire is executing

    await expect(admin().instagramStudio.reject({ id: "ig_lifecycle_test", reason: "wrong offer" }))
      .rejects.toMatchObject({ code: "CONFLICT" });
    expect(inventoryUpdates()).toHaveLength(0);
  });

  it("refuses to reject while a publish attempt is in flight", async () => {
    selectQueue.push([makeRow("publishing")]);
    await expect(admin().instagramStudio.reject({ id: "ig_lifecycle_test", reason: "wrong offer" }))
      .rejects.toMatchObject({ code: "CONFLICT" });
    expect(ops).toHaveLength(0);
  });

  it("reports a lost reject CAS as CONFLICT, not success", async () => {
    selectQueue.push([makeRow("pending")]);
    updateResults.push(0);
    await expect(admin().instagramStudio.reject({ id: "ig_lifecycle_test", reason: "wrong offer" }))
      .rejects.toMatchObject({ code: "CONFLICT" });
  });
});

describe("schedule claims at-most-once before inserting the deferred publish", () => {
  const futureIso = () => new Date(Date.now() + 3_600_000).toISOString();

  it("claims ready→scheduled FIRST, then inserts a scheduled_posts row carrying inventoryId", async () => {
    selectQueue.push([makeRow("ready")]);
    updateResults.push(1);

    await expect(admin().instagramStudio.schedule({ id: "ig_lifecycle_test", scheduledAt: futureIso() }))
      .resolves.toMatchObject({ status: "scheduled" });

    expect(ops[0]).toMatchObject({ kind: "update", table: socialContentInventory });
    expect((ops[0] as Extract<Op, { kind: "update" }>).set.status).toBe("scheduled");
    const insert = scheduledInserts()[0];
    expect(insert?.values.inventoryId).toBe("ig_lifecycle_test");
    expect(insert?.values.status).toBe("pending");
  });

  it("verifies approval with the FULL media set approve hashed (not a one-url subset)", async () => {
    selectQueue.push([makeRow("ready")]);
    updateResults.push(1);
    await admin().instagramStudio.schedule({ id: "ig_lifecycle_test", scheduledAt: futureIso() });
    const call = verifyApprovalMock.mock.calls[0] as unknown[];
    expect((call[1] as { mediaUrls: string[] }).mediaUrls).toHaveLength(2);
  });

  it("CONFLICTs on a lost claim and inserts NOTHING (the double-tap defect)", async () => {
    selectQueue.push([makeRow("ready")]);
    updateResults.push(0); // another request scheduled/published first

    await expect(admin().instagramStudio.schedule({ id: "ig_lifecycle_test", scheduledAt: futureIso() }))
      .rejects.toMatchObject({ code: "CONFLICT" });
    expect(scheduledInserts()).toHaveLength(0);
  });

  it("releases the claim when the scheduled_posts insert fails", async () => {
    selectQueue.push([makeRow("ready")]);
    updateResults.push(1, 1);
    insertError = new Error("insert exploded");

    await expect(admin().instagramStudio.schedule({ id: "ig_lifecycle_test", scheduledAt: futureIso() }))
      .rejects.toThrow("insert exploded");
    const release = inventoryUpdates()[1];
    expect(release?.set.status).toBe("ready");
  });
});

describe("update reports a lost CAS instead of a phantom save", () => {
  it("CONFLICTs when the version-scoped UPDATE matches zero rows", async () => {
    selectQueue.push([makeRow("pending")]);
    updateResults.push(0); // concurrent edit won

    await expect(admin().instagramStudio.update({
      id: "ig_lifecycle_test",
      expectedVersion: 2,
      draft: makeDraft() as never,
    })).rejects.toMatchObject({ code: "CONFLICT" });
  });
});

describe("stage refuses to overwrite rows past review", () => {
  it("CONFLICTs instead of yanking a ready (approved) row back to pending", async () => {
    selectQueue.push([{ status: "ready", version: 3 }]);
    await expect(admin().instagramStudio.stage(makeDraft() as never))
      .rejects.toMatchObject({ code: "CONFLICT" });
    expect(ops.filter((o) => o.kind === "insert")).toHaveLength(0);
  });

  it("overwrites a pending row and keeps it inside the version protocol", async () => {
    selectQueue.push([{ status: "pending", version: 2 }]);
    await expect(admin().instagramStudio.stage(makeDraft() as never)).resolves.toMatchObject({ status: "needs_review" });
    const insert = ops.find((o): o is Extract<Op, { kind: "insert" }> => o.kind === "insert");
    expect(insert?.upsert).toBeDefined();
    expect(insert?.upsert && "version" in insert.upsert).toBe(true);
  });
});

describe("saveDraft (Wave 5 autosave lane)", () => {
  it("refuses to touch a row that has left the draft lane", async () => {
    selectQueue.push([{ status: "pending" }]);
    await expect(admin().instagramStudio.saveDraft({ draft: makeDraft() as never, expectedVersion: 1 }))
      .rejects.toMatchObject({ code: "CONFLICT" });
    expect(ops).toHaveLength(0);
  });

  it("reports a lost autosave CAS as CONFLICT (another tab moved the draft on)", async () => {
    selectQueue.push([{ status: "draft" }]);
    updateResults.push(0);
    await expect(admin().instagramStudio.saveDraft({ draft: makeDraft() as never, expectedVersion: 3 }))
      .rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("bumps the version on a clean save", async () => {
    selectQueue.push([{ status: "draft" }]);
    updateResults.push(1);
    await expect(admin().instagramStudio.saveDraft({ draft: makeDraft() as never, expectedVersion: 3 }))
      .resolves.toEqual({ version: 4 });
  });

  it("creates the row at version 1 when nothing is persisted yet", async () => {
    selectQueue.push([]);
    await expect(admin().instagramStudio.saveDraft({ draft: makeDraft() as never, expectedVersion: 1 }))
      .resolves.toEqual({ version: 1 });
    const insert = ops.find((o): o is Extract<Op, { kind: "insert" }> => o.kind === "insert" && o.table === socialContentInventory);
    expect(insert?.values.status).toBe("draft");
  });
});

describe("stage graduates the autosave lane", () => {
  it("a row in status 'draft' is overwritable by stage (draft → pending)", async () => {
    selectQueue.push([{ status: "draft", version: 4 }]);
    await expect(admin().instagramStudio.stage(makeDraft() as never)).resolves.toMatchObject({ status: "needs_review" });
  });
});

describe("computeStudioItemState — lifecycle and health are separate questions (Wave 6)", () => {
  const now = new Date();
  it.each([
    [{ status: "pending", updatedAt: now }, true, "needs_review", "healthy"],
    [{ status: "ready", updatedAt: now }, false, "ready", "healthy"],
    [{ status: "scheduled", updatedAt: now }, true, "scheduled", "healthy"],
    // The calm-looking lie: "scheduled" with NO pending row to ever fire it.
    [{ status: "scheduled", updatedAt: now }, false, "scheduled", "stalled"],
    [{ status: "ambiguous", updatedAt: now }, false, "ambiguous", "ambiguous"],
    [{ status: "failed", updatedAt: now }, false, "failed", "attention"],
    // A publish claim takes seconds; 20 minutes in "publishing" is wedged.
    [{ status: "publishing", updatedAt: new Date(Date.now() - 20 * 60 * 1000) }, false, "publishing", "stalled"],
    [{ status: "publishing", updatedAt: now }, false, "publishing", "healthy"],
  ] as const)("%o + pendingSchedule=%s → %s/%s", (row, pending, lifecycle, health) => {
    expect(computeStudioItemState(row as { status: string; updatedAt: Date }, pending)).toEqual({ lifecycle, health });
  });
});

describe("cancelSchedule / reschedule (Wave 6 — possible only via inventoryId)", () => {
  it("cancels the pending row and returns the item to ready", async () => {
    selectQueue.push([makeRow("scheduled")]);
    updateResults.push(1, 1); // cancel row, inventory flip
    await expect(admin().instagramStudio.cancelSchedule({ id: "ig_lifecycle_test" }))
      .resolves.toEqual({ status: "ready" });
    expect(scheduledUpdates()[0]?.set.status).toBe("canceled");
    expect(inventoryUpdates()[0]?.set.status).toBe("ready");
  });

  it("CONFLICTs when the linked publish already fired — never re-arms a possibly-live post", async () => {
    selectQueue.push([makeRow("scheduled")]);
    updateResults.push(0); // nothing pending to cancel
    selectQueue.push([{ status: "posted" }]); // the linked row already fired
    await expect(admin().instagramStudio.cancelSchedule({ id: "ig_lifecycle_test" }))
      .rejects.toMatchObject({ code: "CONFLICT" });
    expect(inventoryUpdates()).toHaveLength(0);
  });

  it("RESCUES a stalled item (no linked row at all) back to ready", async () => {
    selectQueue.push([makeRow("scheduled")]);
    updateResults.push(0); // nothing pending
    selectQueue.push([]); // and no linked rows ever — the pre-0096 stall
    updateResults.push(1);
    await expect(admin().instagramStudio.cancelSchedule({ id: "ig_lifecycle_test" }))
      .resolves.toEqual({ status: "ready" });
  });

  it("reschedule moves only a still-pending row; a fired one CONFLICTs", async () => {
    selectQueue.push([makeRow("scheduled")]);
    updateResults.push(0);
    await expect(admin().instagramStudio.reschedule({ id: "ig_lifecycle_test", scheduledAt: new Date(Date.now() + 3_600_000).toISOString() }))
      .rejects.toMatchObject({ code: "CONFLICT" });
  });
});

describe("resolveAmbiguous — the operator tells the system what reality is", () => {
  it("'published' finalizes the item as live", async () => {
    selectQueue.push([makeRow("ambiguous")]);
    updateResults.push(1);
    await expect(admin().instagramStudio.resolveAmbiguous({ id: "ig_lifecycle_test", decision: "published" }))
      .resolves.toEqual({ status: "published" });
    expect(inventoryUpdates()[0]?.set.status).toBe("published");
  });

  it("'not_published' returns it to ready for a safe retry", async () => {
    selectQueue.push([makeRow("ambiguous")]);
    updateResults.push(1);
    await expect(admin().instagramStudio.resolveAmbiguous({ id: "ig_lifecycle_test", decision: "not_published" }))
      .resolves.toEqual({ status: "ready" });
    expect(inventoryUpdates()[0]?.set.status).toBe("ready");
  });

  it("refuses to resolve anything that is not actually ambiguous", async () => {
    selectQueue.push([makeRow("ready")]);
    await expect(admin().instagramStudio.resolveAmbiguous({ id: "ig_lifecycle_test", decision: "published" }))
      .rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});

describe("publish parks a dispatched-but-unanswered call as AMBIGUOUS", () => {
  it("sets status 'ambiguous' (never 'ready') when the media_publish dispatch got no answer", async () => {
    selectQueue.push([makeRow("ready")]);
    publishToSocialMock.mockResolvedValue({
      results: [{ platform: "instagram", success: false, ambiguous: true, error: "timeout after dispatch" }],
    });

    await expect(admin().instagramStudio.publish({ id: "ig_lifecycle_test" }))
      .rejects.toMatchObject({ code: "BAD_REQUEST", message: expect.stringMatching(/MAY BE LIVE/) });

    const park = inventoryUpdates().at(-1);
    expect(park?.set.status).toBe("ambiguous");
  });

  it("still resets a definitive Meta rejection to 'ready' for retry", async () => {
    selectQueue.push([makeRow("ready")]);
    publishToSocialMock.mockResolvedValue({
      results: [{ platform: "instagram", success: false, error: "invalid image" }],
    });

    await expect(admin().instagramStudio.publish({ id: "ig_lifecycle_test" }))
      .rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(inventoryUpdates().at(-1)?.set.status).toBe("ready");
  });

  it("parks a mid-publish THROW as ambiguous, mirroring the scheduled-posts cron", async () => {
    selectQueue.push([makeRow("ready")]);
    publishToSocialMock.mockRejectedValue(new Error("socket hang up"));

    await expect(admin().instagramStudio.publish({ id: "ig_lifecycle_test" })).rejects.toThrow("socket hang up");
    expect(inventoryUpdates().at(-1)?.set.status).toBe("ambiguous");
  });
});
