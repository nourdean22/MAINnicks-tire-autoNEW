import { describe, expect, it, vi, beforeEach } from "vitest";
import { appRouter } from "../routers";
import type { TrpcContext } from "../_core/context";
import { TRPCError } from "@trpc/server";

const h = vi.hoisted(() => ({
  selectQueue: [] as any[],
  insertedRows: [] as any[],
  updatedRows: [] as any[],
  publishedCalls: [] as any[],
}));

// Mock the db module
vi.mock("../db", () => {
  const getTableName = (table: any) => {
    if (!table) return "unknown";
    const nameSym = Symbol.for("drizzle:Name");
    if (table[nameSym]) return table[nameSym];
    if (table.tableName) return table.tableName;
    return "unknown";
  };

  const dbMock = {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => {
            const next = h.selectQueue.shift();
            return next || [];
          }
        })
      })
    }),
    insert: (table: any) => ({
      values: async (row: any) => {
        h.insertedRows.push({ table: getTableName(table), ...row });
        return [{ insertId: 456 }];
      }
    }),
    update: (table: any) => ({
      set: (values: any) => ({
        where: async () => {
          h.updatedRows.push({ table: getTableName(table), ...values });
          return [{ affectedRows: 1 }];
        }
      })
    })
  };

  return {
    getDb: vi.fn(async () => dbMock),
    getDbTyped: vi.fn(async () => dbMock),
  };
});

// Mock socialPublish service
vi.mock("../services/socialPublish", () => {
  return {
    captionClaimBlockers: (caption: string) => {
      if (caption.toLowerCase().includes("guarantee") || caption.toLowerCase().includes("cheapest")) {
        return [{ rule: "Price Guarantee", match: "guarantee" }];
      }
      return [];
    },
    assertPermanentPublicMediaUrl: () => {},
    publishToSocial: async (input: any) => {
      h.publishedCalls.push(input);
      return {
        results: [{ platform: "instagram", success: true }],
        igPostId: "ig_post_123"
      };
    }
  };
});

function adminCtx(userId = 101): TrpcContext {
  return {
    user: {
      id: userId,
      openId: `admin-user-${userId}`,
      email: `admin-${userId}@nickstire.com`,
      name: `Admin User ${userId}`,
      loginMethod: "manus",
      role: "admin",
      createdAt: new Date(),
      updatedAt: new Date(),
      lastSignedIn: new Date(),
    },
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: { clearCookie: () => {} } as unknown as TrpcContext["res"],
  };
}

describe("Reel Approval & Publishing Integrity", () => {
  const caller = appRouter.createCaller(adminCtx());

  beforeEach(() => {
    h.selectQueue.length = 0;
    h.insertedRows.length = 0;
    h.updatedRows.length = 0;
    h.publishedCalls.length = 0;
  });

  it("blocked briefs cannot enqueue due to safety validation", async () => {
    const invalidBrief = {
      selectedCaption: "We guarantee this is the cheapest shop in Cleveland!",
      campaignKeyword: "educational",
      topic: "brakes",
      storyboardBeats: [{ beatNumber: 1, visual: "Rusting rotor", startSecond: 0, endSecond: 3, motion: "Slow pan", onScreenText: "Cheap Brakes!" }],
      hashtags: ["tires"],
      sourceType: "manual" as const,
      captionHooks: [],
      voiceoverScript: "",
      motionLens: "hyperreal_cinematic" as const,
      objectCharacter: "penny_test_inspector" as const,
      archetype: "satisfying_loop" as const,
      sourceNotes: [{ kind: "proof" as const, label: "Proof", supports: "Evidence" }],
      mechanicTruth: "Verified brake pads are 2mm.",
      concepts: [{
        id: "concept_1",
        loopIdea: "last frame hands back to the first",
        scores: { hook: 10, truth: 10, save: 10, local: 10, absurdity: 10, fit: 10 }
      }],
      winningConceptId: "concept_1",
    };
    
    // Safety check will fail in calculateReelQualityScore because of "guarantee"
    let caughtError: any;
    try {
      await caller.contentAdmin.enqueueReelJob({ brief: invalidBrief });
    } catch (e) {
      caughtError = e;
    }
    
    expect(caughtError).toBeInstanceOf(TRPCError);
    expect(caughtError.code).toBe("BAD_REQUEST");
    expect(caughtError.message).toContain("passing threshold");
  });

  it("stageDraft rejects Reel format drafts", async () => {
    let caughtError: any;
    try {
      await caller.instagramAdmin.stageDraft({
        format: "reel",
        caption: "Banned Reel",
        sourceType: "review",
      });
    } catch (e) {
      caughtError = e;
    }

    expect(caughtError).toBeInstanceOf(TRPCError);
    expect(caughtError.code).toBe("BAD_REQUEST");
    expect(caughtError.message).toContain("cannot be created via stageDraft");
  });

  it("fail closed when Gemini model requested but key is missing", async () => {
    const origKey = process.env.GEMINI_API_KEY;
    try {
      delete process.env.GEMINI_API_KEY;
      const { invokeLLM } = await import("../_core/llm");
      await expect(
        invokeLLM({
          model: "gemini-1.5-pro",
          messages: [{ role: "user", content: "hello" }],
        })
      ).rejects.toThrow(/GEMINI_API_KEY is missing/);
    } finally {
      process.env.GEMINI_API_KEY = origKey;
    }
  });

  it("fail closed when OpenAI model requested but key is missing", async () => {
    const origKey = process.env.OPENAI_API_KEY;
    try {
      delete process.env.OPENAI_API_KEY;
      const { invokeLLM } = await import("../_core/llm");
      await expect(
        invokeLLM({
          model: "gpt-4o",
          messages: [{ role: "user", content: "hello" }],
        })
      ).rejects.toThrow(/OPENAI_API_KEY is missing/);
    } finally {
      process.env.OPENAI_API_KEY = origKey;
    }
  });

  it("E2E pipeline: enqueue -> finalize -> approve -> publish", async () => {
    const validBrief = {
      selectedCaption: "This is a high quality reel about brake rotor rust.",
      campaignKeyword: "educational",
      topic: "brakes",
      storyboardBeats: [
        { beatNumber: 1, visual: "Rusting rotor close-up", startSecond: 0, endSecond: 4, motion: "Slow pan", onScreenText: "Rotor Rust" },
        { beatNumber: 2, visual: "New shiny rotor installation", startSecond: 4, endSecond: 8, motion: "Zoom in", onScreenText: "New Rotor" },
        { beatNumber: 3, visual: "Brake caliper alignment check", startSecond: 8, endSecond: 12, motion: "Track right", onScreenText: "Caliper Alignment" },
        { beatNumber: 4, visual: "Mechanic testing brakes", startSecond: 12, endSecond: 16, motion: "Tilt up", onScreenText: "Brake Test" }
      ],
      hashtags: ["brakes", "safety"],
      sourceType: "manual" as const,
      captionHooks: [],
      voiceoverScript: "",
      motionLens: "hyperreal_cinematic" as const,
      objectCharacter: "penny_test_inspector" as const,
      archetype: "satisfying_loop" as const,
      sourceNotes: [{ kind: "proof" as const, label: "Proof", supports: "Evidence" }],
      mechanicTruth: "Verified brake pads are 2mm.",
      concepts: [{
        id: "concept_1",
        loopIdea: "last frame hands back to the first",
        scores: { hook: 10, truth: 10, save: 10, local: 10, absurdity: 10, fit: 10 }
      }],
      winningConceptId: "concept_1",
    };

    // 1. Enqueue Reel Job (Single Inventory Record with generating status, version 1)
    const enqueueResult = await caller.contentAdmin.enqueueReelJob({ brief: validBrief });
    expect(enqueueResult).toBeDefined();
    expect(enqueueResult.inventoryId).toContain("draft_");
    expect(enqueueResult.jobId).toBe(456);

    console.log("INSERTED ROWS:", JSON.stringify(h.insertedRows));
    const insertedInventory = h.insertedRows.find(r => r.table === "social_content_inventory");
    expect(insertedInventory).toBeDefined();
    expect(insertedInventory.status).toBe("generating");
    expect(insertedInventory.version).toBe(1);

    // 2. Finalize Reel Draft (transitions status to review_ready)
    h.selectQueue.push([
      {
        id: enqueueResult.inventoryId,
        status: "generating",
        version: 1,
        briefJson: insertedInventory.briefJson
      }
    ]);

    const finalizeResult = await caller.instagramAdmin.finalizeReelDraft({
      id: enqueueResult.inventoryId,
      videoUrl: "mock://aws-s3-bucket/reels/video.mp4",
      brief: validBrief
    });
    expect(finalizeResult.success).toBe(true);

    const updatedToReviewReady = h.updatedRows.find(r => r.table === "social_content_inventory");
    expect(updatedToReviewReady).toBeDefined();
    expect(updatedToReviewReady.status).toBe("review_ready");
    expect(updatedToReviewReady.assetPaths).toContain("mock://aws-s3-bucket/reels/video.mp4");

    // 3. Approve Draft (runs media validation, checks version lock, records immutable approval, transitions status to ready, version 2)
    h.selectQueue.push([
      {
        id: enqueueResult.inventoryId,
        status: "review_ready",
        version: 1,
        briefJson: insertedInventory.briefJson,
        assetPaths: ["mock://aws-s3-bucket/reels/video.mp4"]
      }
    ]);

    const approveResult = await caller.instagramAdmin.approveDraft({
      id: enqueueResult.inventoryId,
      expectedVersion: 1
    });
    expect(approveResult.success).toBe(true);

    const updatedToReady = h.updatedRows.find(r => r.table === "social_content_inventory" && r.status === "ready");
    expect(updatedToReady).toBeDefined();
    expect(updatedToReady.version).toBe(2);

    const insertedApproval = h.insertedRows.find(r => r.table === "social_content_approvals");
    expect(insertedApproval).toBeDefined();
    expect(insertedApproval.inventoryId).toBe(enqueueResult.inventoryId);
    expect(insertedApproval.version).toBe(1);
    expect(insertedApproval.approvedBy).toBe(101);
    expect(insertedApproval.mediaHash).toBe("mocked_media_hash_32chars_long_hash");

    // 4. Publish Post (loads approved values directly from DB, ignores client inputs, matches hashes, calls publishToSocial, sets status to published)
    h.selectQueue.push(
      // First select in publishPost: load draft
      [
        {
          id: enqueueResult.inventoryId,
          contentType: "reel",
          status: "ready",
          version: 2,
          briefJson: insertedInventory.briefJson,
          assetPaths: ["mock://aws-s3-bucket/reels/video.mp4"]
        }
      ],
      // Second select in publishPost: load approval
      [
        {
          inventoryId: enqueueResult.inventoryId,
          version: 1,
          briefHash: insertedApproval.briefHash,
          mediaHash: insertedApproval.mediaHash,
          mediaUrl: "mock://aws-s3-bucket/reels/video.mp4"
        }
      ]
    );

    const publishResult = await caller.instagramAdmin.publishPost({
      inventoryId: enqueueResult.inventoryId,
      platforms: ["instagram"],
      caption: "Malicious Caption Trying to Bypass",
      videoUrl: "mock://malicious-url/video.mp4"
    });
    expect(publishResult.success).toBe(true);

    // Verify publishToSocial was called with the approved DB values, NOT the client's bypass values
    expect(h.publishedCalls).toHaveLength(1);
    expect(h.publishedCalls[0].caption).toContain("This is a high quality reel about brake rotor rust.");
    expect(h.publishedCalls[0].videoUrl).toBe("mock://aws-s3-bucket/reels/video.mp4");

    const updatedToPublished = h.updatedRows.find(r => r.table === "social_content_inventory" && r.status === "published");
    expect(updatedToPublished).toBeDefined();
  });
});
