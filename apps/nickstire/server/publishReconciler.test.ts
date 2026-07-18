/**
 * reconcileAttempt — deciding whether a publish that vanished actually went live.
 *
 * The cost of being wrong is ASYMMETRIC and that shapes every rule here:
 *   - say "published" when it is not  -> the reel is silently dropped
 *   - say "not published" when it IS  -> the retry double-posts to a real audience
 * So a confident answer requires real evidence, ambiguity goes to the operator,
 * and "I could not check" is never allowed to look like "not published".
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

let mediaResult: { ok: true; posts: any[] } | { ok: false; error: string };
vi.mock("./services/metaSocial", () => ({ fetchInstagramMedia: async () => mediaResult }));

import { reconcileAttempt } from "./services/publishReconciler";

const ATTEMPT = new Date("2026-07-18T12:00:00.000Z");
const post = (over: Partial<Record<string, unknown>> = {}) => ({
  id: "ig_1", link: "https://instagram.com/reel/abc", caption: "Your brakes are on a diet",
  posted: "2026-07-18T12:05:00.000Z", ...over,
});

beforeEach(() => { mediaResult = { ok: true, posts: [] }; });

describe("confident match", () => {
  it("resolves PUBLISHED when the caption matches inside the window", async () => {
    mediaResult = { ok: true, posts: [post()] };
    const r = await reconcileAttempt({ attemptId: "a", attemptedAt: ATTEMPT, expectedCaption: "Your brakes are on a diet" });
    expect(r.status).toBe("resolved_published");
    expect(r).toMatchObject({ igPostId: "ig_1" });
  });

  it("tolerates whitespace and case differences Meta introduces", async () => {
    mediaResult = { ok: true, posts: [post({ caption: "your   BRAKES are on a  diet" })] };
    const r = await reconcileAttempt({ attemptId: "a", attemptedAt: ATTEMPT, expectedCaption: "Your brakes are on a diet" });
    expect(r.status).toBe("resolved_published");
  });

  it("matches on the caption HEAD when a CTA was appended after publishing", async () => {
    mediaResult = { ok: true, posts: [post({ caption: "Once the pad gets this thin you are one drive from metal on metal — DM BRAKES for a free check" })] };
    const r = await reconcileAttempt({
      attemptId: "a", attemptedAt: ATTEMPT,
      expectedCaption: "Once the pad gets this thin you are one drive from metal on metal",
    });
    expect(r.status).toBe("resolved_published");
  });
});

describe("not published", () => {
  it("resolves NOT PUBLISHED when the account shows nothing in the window", async () => {
    mediaResult = { ok: true, posts: [] };
    const r = await reconcileAttempt({ attemptId: "a", attemptedAt: ATTEMPT, expectedCaption: "anything" });
    expect(r.status).toBe("resolved_not_published");
  });

  it("ignores a post from BEFORE the attempt — it cannot be this attempt", async () => {
    mediaResult = { ok: true, posts: [post({ posted: "2026-07-18T11:00:00.000Z" })] };
    const r = await reconcileAttempt({ attemptId: "a", attemptedAt: ATTEMPT, expectedCaption: "Your brakes are on a diet" });
    expect(r.status).toBe("resolved_not_published");
  });

  it("ignores a post far outside the settle window", async () => {
    mediaResult = { ok: true, posts: [post({ posted: "2026-07-18T18:00:00.000Z" })] };
    const r = await reconcileAttempt({ attemptId: "a", attemptedAt: ATTEMPT, expectedCaption: "Your brakes are on a diet" });
    expect(r.status).toBe("resolved_not_published");
  });
});

describe("escalate to the operator", () => {
  it("NEVER auto-resolves two caption matches — that is a possible double-post", async () => {
    mediaResult = { ok: true, posts: [post({ id: "ig_1" }), post({ id: "ig_2", posted: "2026-07-18T12:07:00.000Z" })] };
    const r = await reconcileAttempt({ attemptId: "a", attemptedAt: ATTEMPT, expectedCaption: "Your brakes are on a diet" });
    expect(r.status).toBe("needs_operator");
    expect(r).toMatchObject({ detail: expect.stringMatching(/may have run twice/i) });
  });

  it("asks the operator when a post is in the window but the caption differs", async () => {
    mediaResult = { ok: true, posts: [post({ caption: "A completely different post" })] };
    const r = await reconcileAttempt({ attemptId: "a", attemptedAt: ATTEMPT, expectedCaption: "Your brakes are on a diet" });
    expect(r.status).toBe("needs_operator");
    expect((r as any).candidates).toHaveLength(1);
  });

  it("with NO recorded caption, timing alone is never confident", async () => {
    mediaResult = { ok: true, posts: [post()] };
    const r = await reconcileAttempt({ attemptId: "a", attemptedAt: ATTEMPT, expectedCaption: null });
    expect(r.status).toBe("needs_operator");
    expect((r as any).candidates[0].confident).toBe(false);
    expect((r as any).candidates[0].reasoning).toMatch(/timing evidence only/i);
  });
});

describe("cannot check", () => {
  it("a Meta read failure is NEVER reported as not-published", async () => {
    // The whole point: silence from Meta must not authorise a retry that
    // double-posts. It has to be visibly distinct from a real negative.
    mediaResult = { ok: false, error: "token expired" };
    const r = await reconcileAttempt({ attemptId: "a", attemptedAt: ATTEMPT, expectedCaption: "x" });
    expect(r.status).toBe("cannot_check");
    expect(r.status).not.toBe("resolved_not_published");
    expect(r.detail).toMatch(/token expired/);
  });

  it("skips posts with an unparseable timestamp rather than guessing", async () => {
    mediaResult = { ok: true, posts: [post({ posted: "not-a-date" })] };
    const r = await reconcileAttempt({ attemptId: "a", attemptedAt: ATTEMPT, expectedCaption: "Your brakes are on a diet" });
    expect(r.status).toBe("resolved_not_published");
  });
});
