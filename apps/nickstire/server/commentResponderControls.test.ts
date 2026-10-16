/**
 * Reel comment responder controls (job 2026-10-16-comment-responder-controls).
 *
 * runReelCommentResponder posts PUBLIC Instagram replies, unattended, from the
 * cron and the Meta webhook. Three gates now sit before any DB or Graph read,
 * in this order:
 *   1. REEL_COMMENT_RESPONDER_ENABLED must be exactly "true" (the cron's
 *      requiresEnv is truthy, the webhook was exact; the service now agrees).
 *   2. reel_comment_responder_paused (inverted flag) TRUE stops the lane.
 *   3. A live run asks the autonomy kill switch once; instagram blocked forces
 *      the run to dry-run.
 * And every reply attempt leaves one autonomy_audit_events row via
 * recordAuditEvent (POSTED | FAILED | DRY_RUN), carrying our reply, never the
 * customer's comment text.
 *
 * "Reached the DB" is observed as getDb being called; "reached the Graph" as
 * getMediaComments being called. The Graph client is mocked in every test.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  paused: false,
  blocked: [] as string[],
  isEnabled: vi.fn(),
  killSwitch: vi.fn(),
  recordAuditEvent: vi.fn(async () => undefined),
  getActivePolicy: vi.fn(async () => ({ version: 7 })),
}));

vi.mock("./_core/llm", () => ({ invokeLLM: vi.fn() }));
vi.mock("./db", () => ({ getDb: vi.fn() }));
vi.mock("./services/metaSocial", () => ({ getMediaComments: vi.fn(), replyToComment: vi.fn() }));
vi.mock("./services/featureFlags", () => ({ isEnabled: h.isEnabled }));
vi.mock("./services/socialPublish", () => ({ killSwitchBlockedPlatforms: h.killSwitch }));
vi.mock("./services/autonomyControl", () => ({
  recordAuditEvent: h.recordAuditEvent,
  getActivePolicy: h.getActivePolicy,
}));
vi.mock("../drizzle/schema", () => ({
  reelJobs: { __name: "reel_jobs" },
  shopSettings: { __name: "shop_settings" },
  socialContentInventory: { __name: "social_content_inventory", status: {}, interactiveDmKeyword: {} },
}));
vi.mock("drizzle-orm", () => ({ eq: () => ({}), and: () => ({}), isNotNull: () => ({}), desc: () => ({}), sql: () => ({}) }));

import { runReelCommentResponder } from "./services/commentResponder";
import { invokeLLM } from "./_core/llm";
import { getDb } from "./db";
import { getMediaComments, replyToComment } from "./services/metaSocial";

const fn = (f: unknown) => f as ReturnType<typeof vi.fn>;
const CUSTOMER_TEXT = "do you fix flats on a Sunday?";
const OUR_REPLY = "We sure do, swing by and we will take a look.";

function makeDb() {
  return {
    select: () => ({
      from: (table: { __name?: string }) => {
        const rows = table?.__name === "reel_jobs" ? [{ id: 1, igPostId: "media_1", status: "posted" }] : [];
        const b: Record<string, unknown> = {};
        b.where = () => b;
        b.orderBy = () => b;
        b.limit = () => Promise.resolve(rows);
        return b;
      },
    }),
    update: () => ({ set: () => ({ where: () => Promise.resolve() }) }),
    insert: () => ({ values: () => Promise.resolve() }),
  };
}

const ENV_KEYS = ["REEL_COMMENT_RESPONDER_ENABLED", "REEL_COMMENT_RESPONDER_LIVE"] as const;
const saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));

beforeEach(() => {
  vi.clearAllMocks();
  h.paused = false;
  h.blocked = [];
  h.isEnabled.mockReset();
  h.isEnabled.mockImplementation(async (key: string) => (key === "reel_comment_responder_paused" ? h.paused : false));
  h.killSwitch.mockReset();
  h.killSwitch.mockImplementation(async () => h.blocked);
  h.getActivePolicy.mockReset();
  h.getActivePolicy.mockImplementation(async () => ({ version: 7 }));
  process.env.REEL_COMMENT_RESPONDER_ENABLED = "true";
  process.env.REEL_COMMENT_RESPONDER_LIVE = "true";
  fn(getDb).mockResolvedValue(makeDb());
  fn(getMediaComments).mockResolvedValue({
    ok: true,
    comments: [{ id: "c1", text: CUSTOMER_TEXT, username: "fan", timestamp: "2026-10-16T10:00:00+0000", likeCount: 0, replyCount: 0, replied: false }],
  });
  fn(replyToComment).mockResolvedValue({ success: true, replyId: "r1" });
  fn(invokeLLM).mockResolvedValue({
    choices: [{ message: { content: JSON.stringify({ replyText: OUR_REPLY, classifiedTone: "warm" }) } }],
  });
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe("gate 1: REEL_COMMENT_RESPONDER_ENABLED must be exactly \"true\"", () => {
  it.each([[undefined], ["1"], ["TRUE"], ["false"]])("ENABLED=%s skips before any DB or Graph read", async (value) => {
    if (value === undefined) delete process.env.REEL_COMMENT_RESPONDER_ENABLED;
    else process.env.REEL_COMMENT_RESPONDER_ENABLED = value;
    const r = await runReelCommentResponder();
    expect(r).toEqual({ recordsProcessed: 0, details: "Skip — REEL_COMMENT_RESPONDER_ENABLED is not \"true\"" });
    expect(getDb).not.toHaveBeenCalled();
    expect(getMediaComments).not.toHaveBeenCalled();
    expect(replyToComment).not.toHaveBeenCalled();
    expect(h.isEnabled).not.toHaveBeenCalled();
  });
});

describe("gate 2: reel_comment_responder_paused", () => {
  it("paused skips before any DB or Graph read, and drafts nothing", async () => {
    h.paused = true;
    const r = await runReelCommentResponder();
    expect(r).toEqual({ recordsProcessed: 0, details: "Skip — paused by reel_comment_responder_paused" });
    expect(h.isEnabled).toHaveBeenCalledWith("reel_comment_responder_paused");
    expect(getDb).not.toHaveBeenCalled();
    expect(getMediaComments).not.toHaveBeenCalled();
    expect(invokeLLM).not.toHaveBeenCalled();
    expect(h.killSwitch).not.toHaveBeenCalled();
  });

  it("control: not paused and live, the run posts the reply", async () => {
    const r = await runReelCommentResponder();
    expect(replyToComment).toHaveBeenCalledTimes(1);
    expect(r.details).toMatch(/^live: 1 reels scanned, 1 drafted, 1 posted/);
  });
});

describe("gate 3: the autonomy kill switch forces a dry run", () => {
  it("instagram blocked: drafts, posts nothing, says so first in details", async () => {
    h.blocked = ["instagram"];
    const r = await runReelCommentResponder();
    expect(h.killSwitch).toHaveBeenCalledTimes(1);
    expect(h.killSwitch).toHaveBeenCalledWith(["instagram"], { source: "reel-comment-responder" }, "automated");
    expect(replyToComment).not.toHaveBeenCalled();
    expect(r.recordsProcessed).toBe(0);
    expect(r.details.startsWith("kill switch: replies drafted, not posted")).toBe(true);
    expect(r.details).toMatch(/1 drafted, 0 posted/);
  });

  it("the switch is asked before the DB read", async () => {
    h.killSwitch.mockImplementation(async () => {
      expect(getDb).not.toHaveBeenCalled();
      return [];
    });
    await runReelCommentResponder();
    expect(h.killSwitch).toHaveBeenCalledTimes(1);
  });

  it("a dry run (LIVE unset) never asks the switch", async () => {
    delete process.env.REEL_COMMENT_RESPONDER_LIVE;
    const r = await runReelCommentResponder();
    expect(h.killSwitch).not.toHaveBeenCalled();
    expect(r.details).toMatch(/^dry-run/);
  });
});

describe("audit: every reply attempt writes one autonomy_audit_events row", () => {
  const auditCalls = () => fn(h.recordAuditEvent).mock.calls.map((c) => c[0] as Record<string, unknown>);

  it("a live success is POSTED with ids, tone and our reply, never the customer's text", async () => {
    await runReelCommentResponder();
    expect(auditCalls()).toEqual([
      {
        actionType: "comment_reply",
        decision: "POSTED",
        reasoningCodes: ["warm", "posted"],
        policyVersion: 7,
        context: { mediaId: "media_1", commentId: "c1", replyId: "r1", tone: "warm", replyText: OUR_REPLY, error: null },
      },
    ]);
    expect(JSON.stringify(auditCalls())).not.toContain(CUSTOMER_TEXT);
  });

  it("a live failure is FAILED with the error", async () => {
    fn(replyToComment).mockResolvedValue({ success: false, error: "403 token expired" });
    await runReelCommentResponder();
    expect(auditCalls()).toHaveLength(1);
    expect(auditCalls()[0]).toMatchObject({
      actionType: "comment_reply",
      decision: "FAILED",
      reasoningCodes: ["warm", "reply_failed"],
      context: { mediaId: "media_1", commentId: "c1", replyId: null, error: "403 token expired" },
    });
  });

  it("a dry run is DRY_RUN with no replyId", async () => {
    delete process.env.REEL_COMMENT_RESPONDER_LIVE;
    await runReelCommentResponder();
    expect(auditCalls()).toHaveLength(1);
    expect(auditCalls()[0]).toMatchObject({ actionType: "comment_reply", decision: "DRY_RUN" });
    expect(auditCalls()[0].context).toEqual({ mediaId: "media_1", commentId: "c1", tone: "warm", replyText: OUR_REPLY, error: null });
  });

  it("a kill-switch dry run is DRY_RUN and names the switch", async () => {
    h.blocked = ["instagram"];
    await runReelCommentResponder();
    expect(auditCalls()).toHaveLength(1);
    expect(auditCalls()[0]).toMatchObject({ decision: "DRY_RUN" });
    expect(auditCalls()[0].reasoningCodes).toContain("kill_switch");
  });

  it("an unreadable policy version records 0 and says so", async () => {
    h.getActivePolicy.mockRejectedValue(new Error("policy boom"));
    await runReelCommentResponder();
    expect(auditCalls()[0]).toMatchObject({ decision: "POSTED", policyVersion: 0 });
    expect(auditCalls()[0].reasoningCodes).toContain("policy_version_unread");
  });

  it("a skipped run (paused) writes no audit row", async () => {
    h.paused = true;
    await runReelCommentResponder();
    expect(h.recordAuditEvent).not.toHaveBeenCalled();
  });
});
