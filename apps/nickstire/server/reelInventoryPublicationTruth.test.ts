import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  markReelInventoryPublished,
  reconcilePublishedReelInventoryTruth,
} from "./services/reelInventoryLink";

function updatedDb() {
  let patch: Record<string, unknown> | null = null;
  const d = {
    update: () => ({
      set: (p: Record<string, unknown>) => {
        patch = p;
        return { where: async () => [{ affectedRows: 1 }] };
      },
    }),
    insert: () => ({ values: async () => { throw new Error("insert should not run"); } }),
  };
  return { d: d as any, getPatch: () => patch };
}

function pagedRepairDb(
  pages: Array<Array<{
    id: number;
    briefId: string;
    payload: string;
    mp4Url: string;
    caption: string;
    publicationScheduledAt: Date;
    updatedAt: Date;
  }>>,
  failUpdateCalls = new Set<number>(),
) {
  let pageCall = 0;
  let updateCall = 0;
  const d: any = {
    select: () => ({
      from: () => ({
        leftJoin: () => ({
          where: () => ({
            orderBy: () => ({
              limit: async () => pages[pageCall++] ?? [],
            }),
          }),
        }),
      }),
    }),
    update: () => ({
      set: () => ({
        where: async () => {
          updateCall += 1;
          if (failUpdateCalls.has(updateCall)) throw new Error("poison row");
          return [{ affectedRows: 1 }];
        },
      }),
    }),
    insert: () => ({ values: async () => undefined }),
  };
  return { d, getPageCalls: () => pageCall, getUpdateCalls: () => updateCall };
}

const liveJob = (id: number) => ({
  id,
  briefId: `autopost-${id}`,
  payload: JSON.stringify({ topic: `topic-${id}` }),
  mp4Url: `https://cdn.example/${id}.mp4`,
  caption: `caption-${id}`,
  publicationScheduledAt: new Date(`2026-09-${String(20 + id).padStart(2, "0")}T13:00:00.000Z`),
  updatedAt: new Date(`2026-09-${String(20 + id).padStart(2, "0")}T13:01:00.000Z`),
});

describe("confirmed Reel publication mirrors into universal inventory", () => {
  it("marks an existing inventory row published without inventing a second row", async () => {
    const { d, getPatch } = updatedDb();
    const publishedAt = new Date("2026-09-27T15:00:00.000Z");

    const outcome = await markReelInventoryPublished(d, {
      briefId: "autopost-2026-09-27",
      publishedAt,
      mp4Url: "https://cdn.example/reel.mp4",
      caption: "caption",
      brief: { topic: "road-trip check" },
    });

    expect(outcome).toBe("updated");
    expect(getPatch()).toMatchObject({
      status: "published",
      publishedAt,
      errorMessage: null,
      assetPaths: ["https://cdn.example/reel.mp4"],
    });
  });

  it("pages through the whole mismatched backlog instead of rereading only the newest batch", async () => {
    const { d, getPageCalls } = pagedRepairDb([
      [liveJob(1), liveJob(2)],
      [liveJob(3)],
    ]);

    const result = await reconcilePublishedReelInventoryTruth(d, 2);
    expect(result).toEqual({ examined: 3, repaired: 3, created: 0, failed: 0 });
    expect(getPageCalls()).toBe(2);
  });

  it("isolates one poisoned historical row and still repairs later live Reels", async () => {
    const { d, getUpdateCalls } = pagedRepairDb([
      [liveJob(1), liveJob(2), liveJob(3)],
      [],
    ], new Set([1]));

    const result = await reconcilePublishedReelInventoryTruth(d, 3);
    expect(result).toEqual({ examined: 3, repaired: 2, created: 0, failed: 1 });
    expect(getUpdateCalls()).toBe(3);
  });
});

describe("authoritative publish paths keep the mirror wired", () => {
  const root = path.resolve(__dirname);

  it("ordinary autonomous Reel publish records a durable attempt before best-effort run observability", () => {
    const src = fs.readFileSync(path.join(root, "cron/jobs/dailyReelPost.ts"), "utf8");
    const claim = src.indexOf('status: "publishing"');
    const attempt = src.indexOf("const attemptId = await recordPublishAttempt", claim);
    const runAdvance = src.indexOf("advanceContentRunByReelJobId", attempt);
    expect(claim).toBeGreaterThan(0);
    expect(attempt).toBeGreaterThan(claim);
    expect(runAdvance).toBeGreaterThan(attempt);
  });

  it("ordinary autonomous Reel publish mirrors confirmed-live truth without reopening the external publish", () => {
    const src = fs.readFileSync(path.join(root, "cron/jobs/dailyReelPost.ts"), "utf8");
    const posted = src.indexOf('status: "posted"');
    const mirror = src.indexOf("markReelInventoryPublished");
    const failSoftReceipt = src.indexOf("self-heal will retry", mirror);
    const downstreamAdvance = src.indexOf("advanceContentRunByReelJobId", mirror);

    expect(mirror).toBeGreaterThan(posted);
    expect(failSoftReceipt).toBeGreaterThan(mirror);
    expect(downstreamAdvance).toBeGreaterThan(failSoftReceipt);
  });

  it("ambiguous→confirmed reconciliation preserves original dispatch time and closes the content run", () => {
    const src = fs.readFileSync(path.join(root, "services/publishReconciler.ts"), "utf8");
    expect(src).toContain("markReelInventoryPublishedByJobId(d, args.jobId);");
    expect(src).not.toContain("markReelInventoryPublishedByJobId(d, args.jobId, new Date())");
    expect(src).toContain("OPERATIONAL_STATE.published");
    expect(src).toContain("Ambiguous Instagram publish reconciled as live");
    expect(src).toContain("OPERATIONAL_STATE.failed");
    expect(src).toContain("released for retry");
  });

  it("metric sync self-heals historical split-brain before selecting published rows", () => {
    const src = fs.readFileSync(path.join(root, "services/contentManufacturing.ts"), "utf8");
    const repair = src.indexOf("reconcilePublishedReelInventoryTruth");
    const publishedSelect = src.indexOf('eq(socialContentInventory.status, "published")', repair);
    expect(repair).toBeGreaterThan(0);
    expect(publishedSelect).toBeGreaterThan(repair);
  });

  it("never falls back to caption matching once a durable Reel media id exists", () => {
    const src = fs.readFileSync(path.join(root, "services/contentManufacturing.ts"), "utf8");
    expect(src).toContain("const matchingPost = exactReelPostId");
    expect(src).toContain("? exactReelPost");
    expect(src).toContain(": analyticsPosts.find");
    expect(src).not.toContain("exactReelPost ?? analyticsPosts.find");
  });
});
