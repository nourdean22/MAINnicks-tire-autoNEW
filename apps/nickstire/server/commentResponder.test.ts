import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock the LLM (so draftCommentReply is deterministic) but keep the REAL
// @shared/reviewReplyQa claim-safety detector + real sanitize — those are the
// load-bearing safety pieces and must run for real.
vi.mock("./_core/llm", () => ({ invokeLLM: vi.fn() }));
vi.mock("./db", () => ({ getDb: vi.fn() }));
vi.mock("./services/metaSocial", () => ({ getMediaComments: vi.fn(), replyToComment: vi.fn() }));
vi.mock("../drizzle/schema", () => ({
  reelJobs: { __name: "reel_jobs" },
  shopSettings: { __name: "shop_settings" },
}));
vi.mock("drizzle-orm", () => ({ eq: () => ({}), and: () => ({}), isNotNull: () => ({}), desc: () => ({}) }));

import { draftCommentReply, runReelCommentResponder } from "./services/commentResponder";
import { invokeLLM } from "./_core/llm";
import { getDb } from "./db";
import { getMediaComments, replyToComment } from "./services/metaSocial";

const mockLLM = (text: string) =>
  (invokeLLM as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
    choices: [{ message: { content: text } }],
  });

/** Fake drizzle db: select().from(table) returns reels or kv rows by table; writes no-op. */
function makeDb(reels: unknown[], kv: unknown[], writeSpy?: (op: string) => void) {
  return {
    select: () => ({
      from: (table: { __name?: string }) => {
        const rows = table?.__name === "reel_jobs" ? reels : kv;
        const b: Record<string, unknown> = {};
        b.where = () => b;
        b.orderBy = () => b;
        b.limit = () => Promise.resolve(rows);
        return b;
      },
    }),
    update: () => ({ set: () => ({ where: () => { writeSpy?.("update"); return Promise.resolve(); } }) }),
    insert: () => ({ values: () => { writeSpy?.("insert"); return Promise.resolve(); } }),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.REEL_COMMENT_RESPONDER_LIVE;
});
afterEach(() => {
  delete process.env.REEL_COMMENT_RESPONDER_LIVE;
});

describe("draftCommentReply — claim safety", () => {
  it("does not block a clean, helpful reply", async () => {
    mockLLM("Thanks for stopping by — swing by the shop and we'll take a look!");
    const { blocked, draft } = await draftCommentReply("do you do brakes?");
    expect(draft.length).toBeGreaterThan(0);
    expect(blocked).toBe(false);
  });

  it("blocks a reply that makes a price/guarantee claim", async () => {
    mockLLM("We guarantee the lowest price in town, only $50 — best deal anywhere!");
    const { blocked } = await draftCommentReply("how much for tires?");
    expect(blocked).toBe(true);
  });
});

describe("runReelCommentResponder — gating", () => {
  it("no-ops cleanly when the DB is unavailable", async () => {
    (getDb as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    const r = await runReelCommentResponder();
    expect(r.recordsProcessed).toBe(0);
    expect(replyToComment).not.toHaveBeenCalled();
  });

  it("DRY-RUN (default) drafts but NEVER posts", async () => {
    (getDb as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
      makeDb([{ id: 1, igPostId: "media_1", status: "posted" }], []),
    );
    (getMediaComments as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      comments: [{ id: "c1", text: "great tip!", username: "fan", timestamp: "2026-06-20T10:00:00+0000", likeCount: 0, replyCount: 0, replied: false }],
    });
    mockLLM("Appreciate it — come see us anytime!");
    const r = await runReelCommentResponder();
    expect(replyToComment).not.toHaveBeenCalled();
    expect(r.details).toMatch(/^dry-run/);
  });

  it("LIVE posts a clean reply to an un-answered comment", async () => {
    process.env.REEL_COMMENT_RESPONDER_LIVE = "true";
    (getDb as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
      makeDb([{ id: 1, igPostId: "media_1", status: "posted" }], []),
    );
    (getMediaComments as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      comments: [{ id: "c1", text: "do you fix flats?", username: "fan", timestamp: "2026-06-20T10:00:00+0000", likeCount: 0, replyCount: 0, replied: false }],
    });
    (replyToComment as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ success: true, replyId: "r1" });
    mockLLM("We sure do — swing by and we'll take a look!");
    const r = await runReelCommentResponder();
    expect(replyToComment).toHaveBeenCalledTimes(1);
    expect(r.recordsProcessed).toBe(1);
    expect(r.details).toMatch(/^live/);
  });

  it("LIVE skips an already-replied comment (dedup)", async () => {
    process.env.REEL_COMMENT_RESPONDER_LIVE = "true";
    (getDb as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
      makeDb([{ id: 1, igPostId: "media_1", status: "posted" }], []),
    );
    (getMediaComments as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      comments: [{ id: "c1", text: "thanks!", username: "fan", timestamp: "2026-06-20T10:00:00+0000", likeCount: 0, replyCount: 1, replied: true }],
    });
    mockLLM("You're welcome!");
    await runReelCommentResponder();
    expect(replyToComment).not.toHaveBeenCalled();
  });

  it("LIVE does NOT advance the watermark when a reply fails (so it retries next pulse)", async () => {
    process.env.REEL_COMMENT_RESPONDER_LIVE = "true";
    const writeSpy = vi.fn();
    (getDb as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
      makeDb([{ id: 1, igPostId: "media_1", status: "posted" }], [], writeSpy),
    );
    (getMediaComments as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      comments: [{ id: "c1", text: "do you fix flats?", username: "fan", timestamp: "2026-06-20T10:00:00+0000", likeCount: 0, replyCount: 0, replied: false }],
    });
    (replyToComment as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ success: false, error: "403 token expired" });
    mockLLM("We sure do — swing by and we'll take a look!");
    const r = await runReelCommentResponder();
    expect(replyToComment).toHaveBeenCalledTimes(1);
    expect(r.recordsProcessed).toBe(0);
    expect(writeSpy).not.toHaveBeenCalled(); // cursor frozen on failure -> comment retried, not dropped
  });
});
