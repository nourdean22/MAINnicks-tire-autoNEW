import { describe, it, expect } from "vitest";
import { checkReviewReply } from "@shared/reviewReplyQa";
import { MANIFEST, runDailyReelPost } from "./dailyReelPost";

describe("dailyReelPost", () => {
  it("covers reels 5-30 in order (26 reels)", () => {
    expect(MANIFEST.length).toBe(26);
    expect(MANIFEST[0].reel).toBe(5);
    expect(MANIFEST.at(-1)!.reel).toBe(30);
    expect(MANIFEST.map((m) => m.reel)).toEqual(Array.from({ length: 26 }, (_, i) => i + 5));
  });

  it("every caption passes the reel claim-safety gate (zero blockers, incl. no-price)", () => {
    // publishToSocial gates reels on checkReviewReply(...).filter(block). A blocked
    // caption would refuse the post and stall the queue — so all 26 must be clean.
    for (const { reel, caption } of MANIFEST) {
      const blockers = checkReviewReply(caption).filter((f) => f.severity === "block");
      expect(blockers, `reel${reel} blocked: ${JSON.stringify(blockers)}`).toEqual([]);
    }
  });

  it("is a hard no-op when REEL_AUTOPOST_ENABLED is not 'true'", async () => {
    const prev = process.env.REEL_AUTOPOST_ENABLED;
    delete process.env.REEL_AUTOPOST_ENABLED;
    const r = await runDailyReelPost();
    expect(r.recordsProcessed).toBe(0);
    expect(r.details).toContain("disabled");
    if (prev !== undefined) process.env.REEL_AUTOPOST_ENABLED = prev;
  });
});
