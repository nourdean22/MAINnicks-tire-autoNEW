/**
 * Publish-integrity closure (2026-07-25) — gated external report, claims
 * verified against source, then fixed:
 *
 *  - MIXED-PLATFORM AMBIGUITY: "Facebook confirmed + Instagram dispatched but
 *    unanswered" was classified PARTIAL, whose operator instruction ("post the
 *    missing platform manually") is exactly the duplicate the ambiguous state
 *    exists to prevent. ANY ambiguous platform now parks the WHOLE operation.
 *  - RESOLUTION CLOSES EVERY RECORD: resolving an ambiguity touched only the
 *    inventory row, leaving scheduled_posts parked and the attempt ledger
 *    open — the Board said settled while the reconciler still nagged.
 *  - rejectDraft was every anti-pattern at once: {success:true} on DB outage,
 *    no status guard (could relabel a PUBLISHED row), unchecked update.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi, beforeEach } from "vitest";

type Op =
  | { kind: "update"; table: unknown; set: Record<string, unknown> }
  | { kind: "insert"; table: unknown; values: Record<string, unknown> };

const ops: Op[] = [];
const selectQueue: unknown[][] = [];
const updateResults: number[] = [];

function makeSelectChain(): Record<string, unknown> {
  const chain: Record<string, unknown> = {};
  for (const m of ["from", "where", "orderBy"]) chain[m] = () => chain;
  chain.limit = () => Promise.resolve(selectQueue.shift() ?? []);
  chain.then = (res: (v: unknown) => void) => res(selectQueue.shift() ?? []);
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
    values: (values: Record<string, unknown>) => { ops.push({ kind: "insert", table, values }); return Promise.resolve(); },
  }),
};

vi.mock("./lib/db-helper", () => ({
  db: async () => database,
  dbTyped: async () => database,
  requireDb: async () => database,
}));
vi.mock("./db", () => ({
  getDb: async () => database,
  getDbTyped: async () => database,
}));

const publishToSocialMock = vi.fn();
vi.mock("./services/socialPublish", () => ({
  publishToSocial: (...args: unknown[]) => publishToSocialMock(...args),
  captionClaimBlockers: () => [],
  assertPermanentPublicMediaUrl: () => {},
}));

const closeAttemptsMock = vi.fn(async () => 1);
vi.mock("./services/publishAttemptLedger", () => ({
  OUTCOME: { attempted: "attempted", confirmed: "confirmed", failed: "failed", ambiguous: "ambiguous" },
  recordPublishAttempt: vi.fn(async () => "pub_test"),
  recordPublishOutcome: vi.fn(async () => undefined),
  closeOpenAttemptsForScheduledPost: (...args: unknown[]) => closeAttemptsMock(...(args as [never])),
  findUnreconciledAttempts: vi.fn(async () => []),
}));

vi.mock("./services/igAutopost", () => ({ fetchRecentConceptKeys: async () => [] }));
vi.mock("./services/contentApprovals", () => ({
  verifyApprovalRecord: vi.fn(async () => ({ ok: true })),
  createApprovalRecord: vi.fn(async () => undefined),
  computeMediaHash: vi.fn(async () => "hash"),
}));

import { appRouter } from "./routers";
import { scheduledPosts, socialContentInventory } from "../drizzle/schema";
import { permissionForAdminProcedure } from "../shared/adminPermissions";
import type { TrpcContext } from "./_core/context";

function ctx(): TrpcContext {
  return {
    user: {
      id: 1, openId: "admin-user", email: "admin@nickstire.com", name: "Admin",
      loginMethod: "manus", role: "admin",
      createdAt: new Date(), updatedAt: new Date(), lastSignedIn: new Date(),
    },
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: { clearCookie: () => {} } as TrpcContext["res"],
  } as TrpcContext;
}
const admin = () => appRouter.createCaller(ctx());
const inventoryUpdates = () => ops.filter((o): o is Extract<Op, { kind: "update" }> => o.kind === "update" && o.table === socialContentInventory);
const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");

beforeEach(() => {
  ops.length = 0;
  selectQueue.length = 0;
  updateResults.length = 0;
  publishToSocialMock.mockReset();
  closeAttemptsMock.mockClear();
});

describe("ANY ambiguous platform parks the WHOLE publish (publishPost)", () => {
  const readyDraft = {
    id: "draft_mixed", version: 2, status: "ready", contentType: "post",
    hookText: "hook", assetPaths: ["https://cdn.example.com/a.jpg"], briefJson: "{}",
    topic: "manual: test", createdAt: new Date(),
  };

  it("Facebook confirmed + Instagram unanswered → status 'ambiguous', message forbids manual repost", async () => {
    selectQueue.push([readyDraft], []); // draft, approval lookup (manual/none)
    publishToSocialMock.mockResolvedValue({
      results: [
        { platform: "facebook", success: true, postId: "fb_1" },
        { platform: "instagram", success: false, ambiguous: true, error: "timeout after dispatch" },
      ],
      igPostId: undefined,
    });
    await expect(admin().instagramAdmin.publishPost({
      inventoryId: "draft_mixed", platforms: ["facebook", "instagram"], caption: "Fresh tires, straight answers.",
    })).rejects.toMatchObject({ message: expect.stringMatching(/MAY BE LIVE.*do NOT repost manually/i) });
    const park = inventoryUpdates().at(-1);
    expect(park?.set.status).toBe("ambiguous");
  });

  it("a definitive mixed failure (no ambiguity) still lands published_partial", async () => {
    selectQueue.push([readyDraft], []);
    publishToSocialMock.mockResolvedValue({
      results: [
        { platform: "facebook", success: true, postId: "fb_1" },
        { platform: "instagram", success: false, error: "invalid image" },
      ],
      igPostId: undefined,
    });
    await expect(admin().instagramAdmin.publishPost({
      inventoryId: "draft_mixed", platforms: ["facebook", "instagram"], caption: "Fresh tires, straight answers.",
    })).rejects.toMatchObject({ message: expect.stringMatching(/Partially published/) });
    expect(inventoryUpdates().at(-1)?.set.status).toBe("published_partial");
  });
});

describe("resolveAmbiguous settles EVERY record of the publish", () => {
  const makeDraftRow = () => {
    const draft = {
      version: "instagram-studio-v2", id: "ig_amb", source: { type: "manual_idea", detail: "x" },
      format: "post", objective: "walk_ins", topic: "Topic",
      caption: "A caption long enough to pass validation for this test case.",
      hashtags: [], headline: "Headline", subheadline: "Subheadline text", cta: "Stop by",
      artDirection: "dark graphite tire close-up", carouselSlides: [],
      imageUrls: ["https://cdn.example.com/a.jpg"], rationale: "r", conceptKey: "concept-key",
      quality: { version: "instagram-studio-v2", overall: 80, gate: "pass", dimensions: [], blockers: [], warnings: [], evaluatedAt: new Date().toISOString() },
      createdAt: new Date().toISOString(),
    };
    return { id: "ig_amb", version: 3, status: "ambiguous", briefJson: JSON.stringify(draft), scheduledAt: null, publishedAt: null, errorMessage: null };
  };

  it("'published' closes the parked scheduled_posts fire AND the open ledger attempts", async () => {
    selectQueue.push([makeDraftRow()]);   // loadInventoryDraft
    updateResults.push(1);                // inventory resolve CAS
    updateResults.push(1);                // linked fires update matched 1
    selectQueue.push([{ id: 42 }]);       // the fire rows
    await expect(admin().instagramStudio.resolveAmbiguous({ id: "ig_amb", decision: "published" }))
      .resolves.toEqual({ status: "published", attemptsClosed: 1 });
    const fireUpdate = ops.find((o): o is Extract<Op, { kind: "update" }> => o.kind === "update" && o.table === scheduledPosts);
    expect(fireUpdate?.set.status).toBe("posted");
    expect(closeAttemptsMock).toHaveBeenCalledWith(42, "confirmed", expect.any(String));
  });

  it("'not_published' cancels the fire and fails the attempts", async () => {
    selectQueue.push([makeDraftRow()]);
    updateResults.push(1, 1);
    selectQueue.push([{ id: 43 }]);
    await expect(admin().instagramStudio.resolveAmbiguous({ id: "ig_amb", decision: "not_published" }))
      .resolves.toEqual({ status: "ready", attemptsClosed: 1 });
    const fireUpdate = ops.find((o): o is Extract<Op, { kind: "update" }> => o.kind === "update" && o.table === scheduledPosts);
    expect(fireUpdate?.set.status).toBe("canceled");
    expect(closeAttemptsMock).toHaveBeenCalledWith(43, "failed", expect.any(String));
  });
});

describe("rejectDraft is finally inside the rules", () => {
  it("refuses to relabel a PUBLISHED row as rejected", async () => {
    selectQueue.push([{ status: "published", version: 4 }]);
    await expect(admin().instagramAdmin.rejectDraft({ id: "d1", reason: "nah" }))
      .rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(ops).toHaveLength(0);
  });

  it("reports a lost CAS as CONFLICT, not success", async () => {
    selectQueue.push([{ status: "needs_review", version: 4 }]);
    updateResults.push(0);
    await expect(admin().instagramAdmin.rejectDraft({ id: "d1", reason: "nah" }))
      .rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("a clean reject version-bumps like every other writer", async () => {
    selectQueue.push([{ status: "needs_review", version: 4 }]);
    updateResults.push(1);
    await expect(admin().instagramAdmin.rejectDraft({ id: "d1", reason: "nah" })).resolves.toEqual({ success: true });
    expect(inventoryUpdates()[0]?.set.version).toBe(5);
  });
});

describe("source pins for the rest of the closure", () => {
  it("the worker CLAIM (not just the select) requires the row to still be due — reschedule ownership", () => {
    const s = read("server/services/scheduledPosts.ts");
    expect(s).toMatch(/eq\(scheduledPosts\.status, STATUS\.pending\),\s*\n\s*lte\(scheduledPosts\.scheduledAt, new Date\(\)\)/);
  });

  it("the cron parks ANY ambiguous platform, successes or not", () => {
    expect(read("server/services/scheduledPosts.ts")).toMatch(/const dispatchAmbiguous = failures\.some\(\(r\) => r\.ambiguous\)/);
  });

  it("camera reads are a PERMISSION FAMILY: cameraFeed joined cameras behind settings.manage", () => {
    expect(permissionForAdminProcedure("nickActions.cameraFeed", "query")).toBe("settings.manage");
    expect(permissionForAdminProcedure("nickActions.cameras", "query")).toBe("settings.manage");
  });

  it("the reel confirm panel shows the SERVER-BUILT caption, and blocks the tap on an overlength refusal", () => {
    const q = read("client/src/pages/admin/instagram/ReelQueue.tsx");
    expect(q).toMatch(/draft\.publishCaption \?\? captionWithHashtags\(draft\)/);
    expect(q).toMatch(/draft\.publishCaptionError/);
    expect(read("server/routers/instagramAdmin.ts")).toMatch(/publishCaption: buildReelPublishCaption\(r\.briefJson, r\.hookText\)/);
  });

  it("the dialog lint covers the globalThis/self aliases", () => {
    expect(read("scripts/lint-source.mjs")).toMatch(/window\|globalThis\|self/);
  });
});

describe("draft durability + attribution (PR B)", () => {
  it("the content run is created BEFORE the draft persists, and runId rides inside briefJson", () => {
    const r = read("server/routers/instagramStudio.ts");
    expect(r.indexOf("const runId = await createContentRun")).toBeLessThan(r.indexOf('status: "draft"'));
    expect(r).toMatch(/briefJson: JSON\.stringify\(\{ \.\.\.draft, runId \}\)/);
  });

  it("list + board re-expose runId (draftSchema strips it) and saveDraft re-persists it", () => {
    const r = read("server/routers/instagramStudio.ts");
    expect(r.match(/runId: runIdFrom\(row\.briefJson\)/g)?.length).toBeGreaterThanOrEqual(2);
    expect(r).toMatch(/JSON\.stringify\(\{ \.\.\.input\.draft, runId: input\.runId \?\? null \}\)/);
  });

  it("autosave is SINGLE-FLIGHT: dirty edits queue behind the in-flight save with the server's returned version", () => {
    const s = read("client/src/pages/admin/instagram/StudioV2.tsx");
    expect(s).toMatch(/saveInFlight\.current\) \{ saveDirty\.current = true; return; \}/);
    expect(s).toMatch(/if \(saveDirty\.current\) \{ saveDirty\.current = false; flushAutosave\(\); \}/);
  });

  it("Today's all-clear requires EVERY source read (health + reel attention included)", () => {
    expect(read("client/src/pages/admin/instagram/Today.tsx")).toMatch(/\|\| health\.isError \|\| attention\.isError/);
  });

  it("Voice's tab badge counts PENDING work, never the selected roster filter", () => {
    const v = read("client/src/pages/admin/VoiceReceptionistSection.tsx");
    expect(v).toMatch(/pendingQueue!\.length/);
    expect(v).not.toMatch(/queueItems!\.length/);
  });
});
