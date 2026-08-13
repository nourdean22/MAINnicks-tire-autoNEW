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
  // NT-003: the keyword collector reads published inventory keywords.
  socialContentInventory: { __name: "social_content_inventory", status: {}, interactiveDmKeyword: {} },
}));
vi.mock("drizzle-orm", () => ({ eq: () => ({}), and: () => ({}), isNotNull: () => ({}), desc: () => ({}), sql: () => ({}) }));

import { collectActiveCampaignKeywords, draftCommentReply, matchCampaignKeyword, runReelCommentResponder } from "./services/commentResponder";
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
        const rows =
          table?.__name === "reel_jobs" ? reels :
          table?.__name === "social_content_inventory" ? [] : kv;
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

// ── NT-003 · campaign-keyword comment loop ──────────────────────────────────
// The published creative asks viewers to comment/DM a keyword; there is no DM
// path, so the matcher + prompt steer are what turn that CTA into a working
// public hand-off. False-positive cases are the load-bearing assertions
// (the repo's rule-over-fires lesson): "potholes" must NOT match POTHOLE.
describe("matchCampaignKeyword", () => {
  const kws = ["POTHOLE", "TIRES", "TIRESAFE"];

  it("matches the exact token through punctuation, quotes, and case", () => {
    expect(matchCampaignKeyword('Ok "POTHOLE"!', kws)).toBe("POTHOLE");
    expect(matchCampaignKeyword("pothole", kws)).toBe("POTHOLE");
    expect(matchCampaignKeyword("sent: pothole.", kws)).toBe("POTHOLE");
  });

  it("does NOT match inflected or embedded forms (false-positive guard)", () => {
    expect(matchCampaignKeyword("so many potholes here", kws)).toBeNull();
    expect(matchCampaignKeyword("expothole", kws)).toBeNull();
  });

  it("prefers the longest keyword so TIRESAFE never reads as TIRES", () => {
    expect(matchCampaignKeyword("TIRESAFE please", kws)).toBe("TIRESAFE");
  });

  it("returns null on empty inputs", () => {
    expect(matchCampaignKeyword("", kws)).toBeNull();
    expect(matchCampaignKeyword("hello", [])).toBeNull();
    expect(matchCampaignKeyword("hello", ["", "  "])).toBeNull();
  });
});

describe("collectActiveCampaignKeywords", () => {
  const inventoryDb = (rows: Array<{ keyword: string | null }>) => ({
    select: () => ({
      from: () => {
        const b: Record<string, unknown> = {};
        b.where = () => b;
        b.limit = () => Promise.resolve(rows);
        return b;
      },
    }),
  });

  it("merges reel-payload keywords with published inventory keywords", async () => {
    const jobs = [
      { payload: JSON.stringify({ campaignKeyword: "POTHOLE" }) },
      { payload: "{not json" }, // unparseable → contributes nothing, never throws
      { payload: JSON.stringify({}) },
    ];
    const got = await collectActiveCampaignKeywords(inventoryDb([{ keyword: "SURVIVE" }, { keyword: null }]), jobs);
    expect(got.sort()).toEqual(["POTHOLE", "SURVIVE"]);
  });

  it("degrades to payload-only when the inventory read throws (run must continue)", async () => {
    const throwingDb = { select: () => { throw new Error("table missing"); } };
    const got = await collectActiveCampaignKeywords(throwingDb, [
      { payload: JSON.stringify({ campaignKeyword: "COST" }) },
    ]);
    expect(got).toEqual(["COST"]);
  });
});

describe("draftCommentReply keyword steer (NT-003)", () => {
  it("injects the no-DM hand-off instruction with the real phone line", async () => {
    mockLLM(JSON.stringify({ replyText: "Check your options - call or text us at the shop line.", classifiedTone: "promo" }));
    await draftCommentReply("POTHOLE", undefined, { campaignKeyword: "POTHOLE" });
    const call = (invokeLLM as unknown as ReturnType<typeof vi.fn>).mock.calls.at(-1)?.[0] as {
      messages: Array<{ content: string }>;
    };
    const prompt = call.messages[0].content;
    expect(prompt).toContain('campaign keyword "POTHOLE"');
    expect(prompt).toContain("NO DM automation");
    expect(prompt).toContain("(216) 862-0005");
  });

  it("adds NO steer without a keyword (generic path unchanged)", async () => {
    mockLLM(JSON.stringify({ replyText: "Thanks for stopping by!", classifiedTone: "warm" }));
    await draftCommentReply("nice reel");
    const call = (invokeLLM as unknown as ReturnType<typeof vi.fn>).mock.calls.at(-1)?.[0] as {
      messages: Array<{ content: string }>;
    };
    expect(call.messages[0].content).not.toContain("campaign keyword");
  });
});
