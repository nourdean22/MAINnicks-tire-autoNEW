/**
 * runScheduledPosts — exactly-once claiming and honest terminal states.
 *
 * Confirmed defects this encodes:
 *  - No claim between SELECT pending and the irreversible Meta call, so two
 *    runners could publish the same row.
 *  - Any single platform success wrote status "posted", so a Facebook success
 *    alongside an Instagram failure was recorded as a clean publish. The
 *    immediate-publish route already recorded published_partial; the scheduler
 *    silently disagreed with it.
 *  - A throw mid-publish was recorded as plain "failed", although the call may
 *    have reached Meta before dying.
 *
 * Also guarded: every status value must fit scheduled_posts.status varchar(16)
 * under STRICT_TRANS_TABLES, where an over-length write is REJECTED, not
 * truncated — "published_partial" (17) would have thrown inside the failure
 * handler and wedged the row in "publishing".
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

interface Row { id: number; status: string; platforms: string[]; caption: string; scheduledAt: Date; imageUrl: null; imageUrls: null; videoUrl: null }

let rows: Row[] = [];
let publishImpl: () => Promise<{ results: Array<{ platform: string; success: boolean; error?: string }>; igPostId?: string }>;
/** Simulates a competing runner winning the CAS. */
let stealClaim = false;

vi.mock("./services/socialPublish", () => ({ publishToSocial: async () => publishImpl() }));

vi.mock("./lib/db-helper", () => ({
  db: async () => ({
    select: () => ({ from: () => ({ where: () => ({ limit: async () => rows.filter((r) => r.status === "pending") }) }) }),
    update: () => ({
      set: (vals: Record<string, unknown>) => ({
        where: async () => {
          // The claim update carries only { status: "publishing" }; model the race
          // by letting a competitor take the row first.
          const isClaim = vals.status === "publishing";
          if (isClaim && stealClaim) return [{ affectedRows: 0 }];
          const target = rows.find((r) => (isClaim ? r.status === "pending" : true));
          if (!target) return [{ affectedRows: 0 }];
          Object.assign(target, vals);
          return [{ affectedRows: 1 }];
        },
      }),
    }),
  }),
}));

import { runScheduledPosts } from "./services/scheduledPosts";

const row = (): Row => ({ id: 1, status: "pending", platforms: ["instagram", "facebook"], caption: "c", scheduledAt: new Date(0), imageUrl: null, imageUrls: null, videoUrl: null });
const ok = (p: string) => ({ platform: p, success: true });
const bad = (p: string) => ({ platform: p, success: false, error: "boom" });

beforeEach(() => {
  rows = [row()];
  stealClaim = false;
  publishImpl = async () => ({ results: [ok("instagram"), ok("facebook")], igPostId: "ig_1" });
});

describe("runScheduledPosts — claiming", () => {
  it("claims pending -> publishing BEFORE the external call", async () => {
    let statusAtPublish = "";
    publishImpl = async () => {
      statusAtPublish = rows[0].status;
      return { results: [ok("instagram")], igPostId: "ig_1" };
    };
    await runScheduledPosts();
    expect(statusAtPublish).toBe("publishing");
  });

  it("skips a row another runner already claimed — never double-publishes", async () => {
    stealClaim = true;
    let published = false;
    publishImpl = async () => { published = true; return { results: [ok("instagram")] }; };
    const res = await runScheduledPosts();
    expect(published).toBe(false);
    expect(res.details).toMatch(/1 claimed-elsewhere/);
  });
});

describe("runScheduledPosts — terminal states", () => {
  it("records a full success as posted", async () => {
    await runScheduledPosts();
    expect(rows[0].status).toBe("posted");
  });

  it("records a MIXED result as partial, not posted — the missing platform stays visible", async () => {
    publishImpl = async () => ({ results: [ok("facebook"), bad("instagram")], igPostId: undefined });
    const res = await runScheduledPosts();
    expect(rows[0].status).toBe("partial");
    expect(rows[0]).toMatchObject({ error: expect.stringContaining("instagram") });
    expect(res.details).toMatch(/1 partial/);
  });

  it("records an all-platforms failure as failed", async () => {
    publishImpl = async () => ({ results: [bad("instagram"), bad("facebook")] });
    await runScheduledPosts();
    expect(rows[0].status).toBe("failed");
  });

  it("parks a THROW as ambiguous — not failed, and never back to pending", async () => {
    publishImpl = async () => { throw new Error("socket hang up"); };
    await runScheduledPosts();
    expect(rows[0].status).toBe("ambiguous");
    expect(rows[0]).toMatchObject({ error: expect.stringContaining("may be LIVE") });
    // Returning it to "pending" would invite a duplicate of a post that may be live.
    expect(rows[0].status).not.toBe("pending");
  });
});

describe("runScheduledPosts — column-width invariant", () => {
  it("every terminal status fits varchar(16)", async () => {
    const seen: string[] = [];
    for (const impl of [
      async () => ({ results: [ok("instagram")], igPostId: "x" }),
      async () => ({ results: [ok("facebook"), bad("instagram")] }),
      async () => ({ results: [bad("instagram")] }),
      async () => { throw new Error("x"); },
    ]) {
      rows = [row()];
      publishImpl = impl as typeof publishImpl;
      await runScheduledPosts();
      seen.push(rows[0].status);
    }
    expect(seen).toEqual(["posted", "partial", "failed", "ambiguous"]);
    for (const s of [...seen, "publishing", "pending"]) expect(s.length).toBeLessThanOrEqual(16);
  });
});
