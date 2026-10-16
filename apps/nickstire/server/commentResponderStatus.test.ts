/**
 * instagramAdmin.commentResponderStatus (contract commentResponderStatus v1)
 * never renders a failed read as a zero (job 2026-10-16-comment-responder-controls).
 *
 *  - a failed history read -> { available: false, reason } (never an empty list)
 *  - a failed flag read    -> paused: null (UNKNOWN, never "not paused")
 *  - an absent flag row    -> paused: false (what isEnabled, and so the lane, reads)
 *  - an unparseable context_json -> nulls on that row, never a throw
 *
 * The fake database hands each select() chain the result at its creation
 * index: 0 = the flag read, then 1..3 = lastRun, recentReplies, counts7d.
 */
import { afterEach, describe, expect, it } from "vitest";
import { readCommentResponderStatus } from "./routers/instagramAdmin";

type Result = unknown[] | Error;

function fakeDb(results: Result[]) {
  let next = 0;
  const chainFor = (r: Result): unknown =>
    new Proxy(function () {}, {
      get(_t, prop) {
        if (prop === "then") {
          return (resolve: (v: unknown) => void, reject: (e: unknown) => void) =>
            r instanceof Error ? reject(r) : resolve(r);
        }
        return () => chainFor(r);
      },
    });
  return {
    select: () => {
      const r = results[next++];
      if (r === undefined) throw new Error(`unexpected select #${next}`);
      return chainFor(r);
    },
  } as unknown as Parameters<typeof readCommentResponderStatus>[0];
}

const NOW = new Date("2026-10-16T16:00:00Z");
const lastRun = { startedAt: new Date("2026-10-16T15:45:00Z"), status: "success", details: "live: 3 reels scanned, 0 drafted, 0 posted, 0 claim-blocked" };
const occurredAt = new Date("2026-10-16T15:46:00Z");
const auditRows = [
  {
    id: "aud_1", occurredAt, decision: "POSTED",
    contextJson: JSON.stringify({ mediaId: "m1", commentId: "c1", replyId: "r1", tone: "warm", replyText: "Thanks!", error: null }),
  },
  { id: "aud_2", occurredAt, decision: "FAILED", contextJson: "{not json" },
  { id: "aud_3", occurredAt, decision: "DRY_RUN", contextJson: null },
];
// COUNT(*) can arrive as a string from the driver; the reader must coerce it.
const counts = [
  { decision: "POSTED", n: "4" },
  { decision: "FAILED", n: 1 },
  { decision: "DRY_RUN", n: 2 },
];

const ENV_KEYS = ["REEL_COMMENT_RESPONDER_ENABLED", "REEL_COMMENT_RESPONDER_LIVE"] as const;
const saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe("readCommentResponderStatus", () => {
  it("returns the v1 contract on a good read", async () => {
    process.env.REEL_COMMENT_RESPONDER_ENABLED = "true";
    process.env.REEL_COMMENT_RESPONDER_LIVE = "true";
    const s = await readCommentResponderStatus(
      fakeDb([[{ key: "reel_comment_responder_paused", value: true }], [lastRun], auditRows, counts]),
      NOW,
    );
    expect(s).toEqual({
      available: true,
      enabled: true,
      live: true,
      paused: true,
      lastRun,
      recentReplies: [
        { id: "aud_1", occurredAt, decision: "POSTED", mediaId: "m1", commentId: "c1", replyId: "r1", tone: "warm", replyText: "Thanks!", error: null },
        { id: "aud_2", occurredAt, decision: "FAILED", mediaId: null, commentId: null, replyId: null, tone: null, replyText: null, error: null },
        { id: "aud_3", occurredAt, decision: "DRY_RUN", mediaId: null, commentId: null, replyId: null, tone: null, replyText: null, error: null },
      ],
      counts7d: { posted: 4, failed: 1, dryRun: 2 },
    });
  });

  it("enabled and live are exact 'true' reads; an absent flag row is not paused", async () => {
    process.env.REEL_COMMENT_RESPONDER_ENABLED = "1";
    delete process.env.REEL_COMMENT_RESPONDER_LIVE;
    const s = await readCommentResponderStatus(fakeDb([[], [], [], []]), NOW);
    expect(s).toEqual({
      available: true, enabled: false, live: false, paused: false, lastRun: null, recentReplies: [],
      counts7d: { posted: 0, failed: 0, dryRun: 0 },
    });
  });

  it("a failed flag read is UNKNOWN (null), never 'not paused', and history still renders", async () => {
    const s = await readCommentResponderStatus(fakeDb([new Error("flag read boom"), [lastRun], auditRows, counts]), NOW);
    expect(s).toMatchObject({ available: true, paused: null, lastRun });
  });

  it("a failed history read is available:false with a reason, never an empty list", async () => {
    const s = await readCommentResponderStatus(fakeDb([[], [lastRun], new Error("audit read boom"), counts]), NOW);
    expect(s.available).toBe(false);
    expect(s).not.toHaveProperty("recentReplies");
    expect((s as { reason: string }).reason).toMatch(/audit read boom/);
  });

  it("no database is available:false", async () => {
    const s = await readCommentResponderStatus(null, NOW);
    expect(s).toEqual({ available: false, reason: expect.stringMatching(/database/i) });
  });
});
