import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { sliceBlock } from "./testUtils/sourceBlock";

const ROUTER = readFileSync(path.join(__dirname, "routers", "instagramAdmin.ts"), "utf8");
const QUEUE = readFileSync(path.join(__dirname, "..", "client", "src", "pages", "admin", "instagram", "ReelQueue.tsx"), "utf8");

describe("Trial Reel operator wiring", () => {
  it("exposes MANUAL graduation only at the admin publish boundary", () => {
    const block = sliceBlock(
      ROUTER,
      "publishPost: dbAdminProcedure",
      "schedulePost / listScheduled / cancelScheduled were DELETED",
      { label: "instagramAdmin.publishPost" },
    );
    expect(block).toContain('graduationStrategy: z.literal("MANUAL")');
    expect(block).toContain("Trial Reels are Instagram-only");
    expect(block).toContain('draft.contentType !== "reel"');
    expect(block).toContain("persistTrialPublishReceipt");
    expect(block).not.toContain("SS_PERFORMANCE");
  });

  it("offers a separate explicit Trial action without changing normal Publish", () => {
    expect(QUEUE).toContain("Publish as Trial");
    expect(QUEUE).toContain('trialReel: { graduationStrategy: "MANUAL" }');
    expect(QUEUE).toContain("Yes — publish now");
    expect(QUEUE).toContain("Graduation stays manual");
  });
});
