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

  it("self-heals only a Reel proven live by terminal status + durable IG id", async () => {
    const publishStarted = new Date("2026-09-26T13:00:00.000Z");
    const jobs = [{
      id: 42,
      briefId: "autopost-2026-09-26",
      payload: JSON.stringify({ topic: "tread depth" }),
      mp4Url: "https://cdn.example/live.mp4",
      caption: "LEGAL IS NOT SAFE",
      publicationScheduledAt: publishStarted,
      updatedAt: new Date("2026-09-26T13:01:00.000Z"),
    }];

    let selectCall = 0;
    let patch: Record<string, unknown> | null = null;
    const d: any = {
      select: () => {
        selectCall += 1;
        if (selectCall === 1) {
          return {
            from: () => ({
              where: () => ({
                orderBy: () => ({ limit: async () => jobs }),
              }),
            }),
          };
        }
        return {
          from: () => ({
            where: () => ({ limit: async () => [{ status: "review_ready", publishedAt: null }] }),
          }),
        };
      },
      update: () => ({
        set: (p: Record<string, unknown>) => {
          patch = p;
          return { where: async () => [{ affectedRows: 1 }] };
        },
      }),
      insert: () => ({ values: async () => undefined }),
    };

    const result = await reconcilePublishedReelInventoryTruth(d, 50);
    expect(result).toEqual({ examined: 1, repaired: 1, created: 0 });
    expect(patch).toMatchObject({ status: "published", publishedAt: publishStarted });
  });
});

describe("authoritative publish paths keep the mirror wired", () => {
  const root = path.resolve(__dirname);

  it("ordinary autonomous Reel publish mirrors confirmed-live truth without reopening the external publish", () => {
    const src = fs.readFileSync(path.join(root, "cron/jobs/dailyReelPost.ts"), "utf8");
    const posted = src.indexOf("status: \"posted\"");
    const mirror = src.indexOf("markReelInventoryPublished");
    const failSoftReceipt = src.indexOf("self-heal will retry", mirror);
    const downstreamAdvance = src.indexOf("advanceContentRunByReelJobId", mirror);

    expect(mirror).toBeGreaterThan(posted);
    expect(failSoftReceipt).toBeGreaterThan(mirror);
    expect(downstreamAdvance).toBeGreaterThan(failSoftReceipt);
  });

  it("ambiguous→confirmed reconciliation mirrors the same truth", () => {
    const src = fs.readFileSync(path.join(root, "services/publishReconciler.ts"), "utf8");
    expect(src).toContain("markReelInventoryPublishedByJobId");
  });

  it("metric sync self-heals historical split-brain before selecting published rows", () => {
    const src = fs.readFileSync(path.join(root, "services/contentManufacturing.ts"), "utf8");
    const repair = src.indexOf("reconcilePublishedReelInventoryTruth");
    const publishedSelect = src.indexOf('eq(socialContentInventory.status, "published")', repair);
    expect(repair).toBeGreaterThan(0);
    expect(publishedSelect).toBeGreaterThan(repair);
  });

  it("uses exact Reel media identity before legacy caption matching", () => {
    const src = fs.readFileSync(path.join(root, "services/contentManufacturing.ts"), "utf8");
    const exactMap = src.indexOf("reelPostIdByBrief");
    const exactLookup = src.indexOf("analyticsByPostId.get(exactReelPostId)");
    const captionFallback = src.indexOf("analyticsPosts.find", exactLookup);
    expect(exactMap).toBeGreaterThan(0);
    expect(exactLookup).toBeGreaterThan(exactMap);
    expect(captionFallback).toBeGreaterThan(exactLookup);
  });
});
