/**
 * Three ways the system could have posted the same thing twice, or posted
 * something nobody approved.
 *
 * 1. publishReconciler read a FIXED PAGE of the 25 most recent posts and, when
 *    nothing matched, answered "the publish did not reach Instagram, so it is
 *    safe to retry." If more than 25 posts landed after the attempt, the
 *    attempt's own post is off the end of that page and the absence proves
 *    nothing. Retrying on that reading posts twice — the exact failure the
 *    reconciler exists to prevent.
 *
 * 2. instagramStudio.schedule skipped the approval verification that
 *    instagramStudio.publish enforces, so the STRICTER rule guarded the path a
 *    human watches and the LOOSER one guarded the path that fires hours later
 *    with nobody in the room. The file already argues this exact point about
 *    captions a few lines above — the rule was written down and then applied to
 *    one of the two things that needed it.
 *
 * 3. contentGovernor's daily feed cap counted only the Queue's own publishes.
 *    The reel cron settles onto reel_jobs and the scheduled worker onto
 *    scheduled_posts, neither of which stamps inventory.publishedAt — so
 *    "max 2 per day" meant "max 2 THROUGH THE QUEUE per day".
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");

describe("a truncated evidence window is not proof of absence", () => {
  const s = read("server/services/publishReconciler.ts");

  it("detects that the fetched page never reached back to the attempt", () => {
    expect(s).toMatch(/oldestFetchedMs/);
    expect(s).toMatch(/windowTruncated/);
  });

  it("returns cannot_check rather than 'safe to retry' in that case", () => {
    const idx = s.indexOf("windowTruncated");
    const after = s.slice(idx, idx + 900);
    expect(after).toMatch(/status: "cannot_check"/);
    expect(after).toMatch(/UNKNOWN/);
  });

  it("still answers resolved_not_published when the window DID cover the attempt", () => {
    // The guard must not swallow the legitimate answer — a reconciler that can
    // only ever say "I don't know" is as useless as one that always says "retry".
    expect(s).toMatch(/status: "resolved_not_published"/);
  });

  it("requires the page to be FULL before calling the evidence truncated", () => {
    // My first version omitted this and broke a real case: one post, hours after
    // the attempt, page nowhere near full. Instagram had handed over everything
    // the account has, so absence WAS proof — and the guard called it unknowable.
    // A partial page can never be truncated by definition.
    expect(s).toMatch(/pageWasFull = media\.posts\.length >= RECONCILE_PAGE_SIZE/);
    expect(s).toMatch(/windowTruncated = pageWasFull &&/);
  });

  it("asks Meta for exactly the page size it later checks against", () => {
    // A literal 25 in the fetch and a different literal in the check would make
    // pageWasFull silently wrong forever.
    expect(s).toMatch(/fetchInstagramMedia\(RECONCILE_PAGE_SIZE\)/);
  });
});

describe("deferred publishing is held to the same bar as immediate publishing", () => {
  const s = read("server/routers/instagramStudio.ts");

  it("schedule verifies the approval record, exactly as publish does", () => {
    // Two call sites now, not one.
    const calls = s.match(/verifyApprovalRecord\(database, \{/g) ?? [];
    expect(calls.length).toBeGreaterThanOrEqual(2);
  });

  it("refuses to schedule when the draft changed after approval", () => {
    expect(s).toMatch(/Re-review and re-approve before scheduling/);
  });

  it("no longer sends the operator to an unmounted screen for reels", () => {
    // instagram/Studio.tsx has ZERO importers; the old message pointed at it.
    // Asserted against the MESSAGE ARGUMENT, not the whole file — the docblock
    // legitimately quotes the old wording to explain why it changed, and a
    // whole-file match flagged that quote. The rule is about what the operator
    // is told, not about what the source may mention.
    const refineMsg = s.match(/value !== "reel",\s*\n?\s*"([^"]+)"/)?.[1] ?? "";
    expect(refineMsg).not.toMatch(/Use the Reel Studio/);
    expect(refineMsg).toMatch(/Campaign package below on this same tab/);
  });
});

describe("the daily feed cap counts every door", () => {
  const s = read("server/services/contentGovernor.ts");

  it("counts cron reels and scheduled posts, not just Queue publishes", () => {
    expect(s).toMatch(/externalFeedPosts/);
    expect(s).toMatch(/reelJobs\.status, "posted"/);
    expect(s).toMatch(/scheduledPosts\.status/);
  });

  it("applies them to the cap comparison", () => {
    expect(s).toMatch(/rows\.length \+ externalFeedPosts >= policy\.limits\.maxFeedPostsPerDay/);
  });

  it("names an unreadable source instead of silently lowering the count", () => {
    // Undercounting here spends the operator's audience, which is the resource
    // the cap exists to protect.
    expect(s).toMatch(/cap is counting the Queue only/);
  });
});
