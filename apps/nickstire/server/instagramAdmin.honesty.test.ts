import { mapInventoryStatusForQueue } from "./routers/instagramAdmin";
import { describe, expect, it, vi, beforeEach } from "vitest";

/**
 * Score-honesty regression tests. These pin the fixes for the fabrication
 * cluster: stageDraft's flat scoreOverall 80, getAllDrafts' `|| 80` read-side
 * fallback, and the silent `.slice(0, 2200)` on approved Reel captions.
 *
 * Unlike instagramAdmin.test.ts (whose Proxy mock resolves every query to []),
 * this file needs to CAPTURE insert values and FEED select results, so it uses
 * a purpose-built mock (complete mock of db-helper, per singleFork hygiene).
 */
const insertValues = vi.fn().mockResolvedValue(undefined);
const selectQueue: unknown[][] = [];

function makeSelectChain(): Record<string, unknown> {
  const chain: Record<string, unknown> = {};
  for (const m of ["from", "where", "orderBy"]) {
    chain[m] = () => chain;
  }
  chain.limit = () => Promise.resolve(selectQueue.shift() ?? []);
  // getAllDrafts awaits after .limit(); other shapes await the chain itself.
  chain.then = (resolve: (v: unknown) => void) => resolve(selectQueue.shift() ?? []);
  return chain;
}

// Mutable so the CAS tests below can simulate losing the publish claim.
const claimResult = { affectedRows: 1 };
const database = {
  insert: () => ({ values: insertValues }),
  select: () => makeSelectChain(),
  update: () => ({ set: () => ({ where: () => Promise.resolve([{ affectedRows: claimResult.affectedRows }, []]) }) }),
};

vi.mock("./lib/db-helper", () => ({
  db: async () => database,
  dbTyped: async () => database,
  requireDb: async () => database,
}));

import { appRouter } from "./routers";
import { buildReelPublishCaption, IG_CAPTION_MAX } from "./routers/instagramAdmin";
import type { TrpcContext } from "./_core/context";

function ctx(role: "admin" | "user" | null): TrpcContext {
  return {
    user:
      role === null
        ? null
        : {
            id: role === "admin" ? 1 : 2,
            openId: `${role}-user`,
            email: `${role}@nickstire.com`,
            name: `${role} User`,
            loginMethod: "manus",
            role,
            createdAt: new Date(),
            updatedAt: new Date(),
            lastSignedIn: new Date(),
          },
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: { clearCookie: () => {} } as TrpcContext["res"],
  };
}

const admin = () => appRouter.createCaller(ctx("admin"));

beforeEach(() => {
  insertValues.mockClear();
  selectQueue.length = 0;
  claimResult.affectedRows = 1;
});

describe("buildReelPublishCaption", () => {
  it("joins selectedCaption and hashtags", () => {
    const briefJson = JSON.stringify({ selectedCaption: "Winter tires matter.", hashtags: ["#cleveland", "#tires"] });
    expect(buildReelPublishCaption(briefJson, null)).toBe("Winter tires matter.\n\n#cleveland #tires");
  });

  it("falls back to hook text when the brief has no selectedCaption", () => {
    expect(buildReelPublishCaption("{}", "Hook line")).toBe("Hook line");
    expect(buildReelPublishCaption(null, "Hook line")).toBe("Hook line");
    expect(buildReelPublishCaption("not-json{", "Hook line")).toBe("Hook line");
  });

  it("REJECTS an overlength caption instead of silently truncating it", () => {
    const briefJson = JSON.stringify({
      selectedCaption: "x".repeat(IG_CAPTION_MAX),
      hashtags: ["#cleveland"],
    });
    // Previously this sliced to exactly 2200, cutting the hashtags without
    // anyone knowing — the approved text and the published text diverged.
    expect(() => buildReelPublishCaption(briefJson, null)).toThrowError(/2200/);
  });

  it("accepts a caption exactly at the limit", () => {
    const briefJson = JSON.stringify({ selectedCaption: "x".repeat(IG_CAPTION_MAX), hashtags: [] });
    expect(buildReelPublishCaption(briefJson, null)).toHaveLength(IG_CAPTION_MAX);
  });
});

describe("stageDraft honesty", () => {
  const cleanInput = {
    format: "single" as const,
    caption: "Check your tread depth before the first Cleveland snow.",
    imageUrl: "https://example.com/tread.jpg",
    sourceType: "manual",
  };

  it("stages manual drafts UNSCORED (scoreOverall 0), not with a fabricated 80", async () => {
    await admin().instagramAdmin.stageDraft(cleanInput);
    expect(insertValues).toHaveBeenCalledTimes(1);
    const row = insertValues.mock.calls[0][0];
    expect(row.scoreOverall).toBe(0);
    expect(row.status).toBe("ready");
  });

  it("blocks a banned claim at STAGE time, before any row is written", async () => {
    await expect(
      admin().instagramAdmin.stageDraft({
        ...cleanInput,
        caption: "Our brake repair is guaranteed to fix any car!",
      }),
    ).rejects.toThrow(/Claim-safety/);
    expect(insertValues).not.toHaveBeenCalled();
  });

  it("rejects an overlength caption at input validation", async () => {
    await expect(
      admin().instagramAdmin.stageDraft({ ...cleanInput, caption: "x".repeat(2201) }),
    ).rejects.toThrow();
    expect(insertValues).not.toHaveBeenCalled();
  });
});

describe("publishPost at-most-once claim (the #748 test gap)", () => {
  const readyDraft = {
    id: "draft_claim",
    version: 2,
    status: "ready",
    contentType: "post",
    hookText: "hook",
    assetPaths: ["mock://img"],
    briefJson: "{}",
    topic: "manual: test",
    createdAt: new Date(),
  };

  it("throws CONFLICT and never reaches Meta when the publishing claim is lost", async () => {
    // Draft select → ready row; approval lookup → none (manual row, warn path).
    selectQueue.push([readyDraft], []);
    claimResult.affectedRows = 0; // another request flipped the status first

    await expect(
      admin().instagramAdmin.publishPost({
        inventoryId: "draft_claim",
        platforms: ["instagram"],
        caption: "Fresh tires, straight answers.",
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });
});

describe("getAllDrafts score honesty", () => {
  const baseRow = {
    id: "draft_x",
    version: 1,
    status: "ready",
    contentType: "post",
    hookText: "hook",
    assetPaths: ["https://example.com/a.jpg"],
    briefJson: "{}",
    topic: "manual: test",
    createdAt: new Date(),
  };

  it("returns qualityScore null for unscored rows — no more || 80 fabrication", async () => {
    selectQueue.push([{ ...baseRow, scoreOverall: 0 }]);
    const drafts = await admin().instagramAdmin.getAllDrafts();
    expect(drafts).toHaveLength(1);
    expect(drafts[0].qualityScore).toBeNull();
  });

  it("passes real scores through unchanged", async () => {
    selectQueue.push([{ ...baseRow, scoreOverall: 87 }]);
    const drafts = await admin().instagramAdmin.getAllDrafts();
    expect(drafts[0].qualityScore).toEqual({ gate: "pass", overall: 87 });
  });
});

describe("mapInventoryStatusForQueue", () => {
  it("maps review_ready to needs_review so reel drafts get an Approve button", () => {
    expect(mapInventoryStatusForQueue("review_ready")).toBe("needs_review");
  });
  it("keeps the existing mappings and passes unknown statuses through", () => {
    expect(mapInventoryStatusForQueue("assets_ready")).toBe("ready");
    expect(mapInventoryStatusForQueue("pending")).toBe("needs_review");
    expect(mapInventoryStatusForQueue("approved")).toBe("ready");
    expect(mapInventoryStatusForQueue("generating")).toBe("needs_review");
    expect(mapInventoryStatusForQueue("published")).toBe("published");
  });
});
