/**
 * Human-review draft closure (2026-10-02)
 *
 * WHAT WAS WRONG. A `drafted` sms_orchestrations row with
 * requires_human_approval=1 never closed on its own: 366 open in production,
 * the oldest from 2026-06-24. actionHumanReview had no status guard (a closed
 * or months-old draft could be sent verbatim), its UPDATEs were unconditional
 * by id, and closing a conversation's SLA obligation left its drafts behind.
 *
 * WHAT THIS PINS.
 *   1. reconcileStaleHumanReviewDrafts — each closure rule through a fake
 *      executor that renders the real queries (decision is module-private; the
 *      candidates below cover every branch), every UPDATE is a CAS on 'drafted'.
 *   2. actionHumanReview — closed rows and stale verbatim sends are refused
 *      before any send; the send is claimed (CAS) BEFORE sendSms; a lost claim
 *      sends nothing; the obligation closes after a real human action only.
 *   3. resolveHumanPendingForConversation — also cancels the conversation's
 *      drafts, and a failure there never throws.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import type { SQL } from "drizzle-orm";
import type { TrpcContext } from "../_core/context";

const h = vi.hoisted(() => ({
  row: null as Record<string, unknown> | null,
  updates: [] as Array<{ set: Record<string, unknown>; where: unknown }>,
  affected: [] as number[],
  executed: [] as string[],
  executeThrowsOn: null as RegExp | null,
  sendSms: vi.fn(),
  resolveHumanPending: vi.fn(),
}));

vi.mock("../sms", () => ({ sendSms: (...a: unknown[]) => h.sendSms(...a) }));

vi.mock("../services/smsResponseJobs", () => ({
  resolveHumanPendingForConversation: (...a: unknown[]) => h.resolveHumanPending(...a),
}));

vi.mock("../db", () => ({
  // router path: drizzle query-builder shape
  getDbTyped: async () => ({
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => (h.row ? [h.row] : []),
          orderBy: () => ({ limit: async () => [] }),
        }),
      }),
    }),
    update: () => ({
      set: (set: Record<string, unknown>) => ({
        where: async (where: unknown) => {
          h.updates.push({ set, where });
          return [{ affectedRows: h.affected.length ? h.affected.shift() : 1 }, []];
        },
      }),
    }),
  }),
  // service path: raw execute
  getDb: async () => ({
    execute: async (q: unknown) => {
      const text = render(q).text;
      if (/FROM users/.test(text)) return [[{ adminRole: "owner", mfaEnabled: 0 }], []]; // the RBAC middleware's role read
      h.executed.push(text);
      if (h.executeThrowsOn?.test(text)) throw new Error("ER_LOCK_WAIT_TIMEOUT");
      return [{ affectedRows: 2 }, []];
    },
  }),
}));

import { reconcileStaleHumanReviewDrafts, STALE_DRAFT_MAX_AGE_DAYS } from "../cron/jobs/orchestrationStatusReconcile";
import { appRouter } from "../routers";

const stripComments = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

/** Render a drizzle `sql` template the way the driver would: text with `?` and the bound values. */
function render(q: unknown): { text: string; params: unknown[] } {
  const params: unknown[] = [];
  const walk = (node: unknown): string => {
    if (node && typeof node === "object" && Array.isArray((node as { queryChunks?: unknown[] }).queryChunks)) {
      return (node as { queryChunks: unknown[] }).queryChunks.map(walk).join("");
    }
    if (node && typeof node === "object" && Array.isArray((node as { value?: unknown }).value)) {
      return (node as { value: string[] }).value.join("");
    }
    params.push(node);
    return "?";
  };
  return { text: walk(q).replace(/\s+/g, " ").trim(), params };
}

const dialect = new MySqlDialect();
const whereOf = (w: unknown) => dialect.sqlToQuery(w as SQL);

// ─── 1. the reconciler ──────────────────────────────────────────────────────

function fakeExecutor(candidates: unknown[], opts: { affected?: number[]; throwOnSelect?: boolean } = {}) {
  const issued: Array<{ text: string; params: unknown[] }> = [];
  const affected = [...(opts.affected ?? [])];
  return {
    issued,
    db: {
      async execute(q: unknown) {
        const r = render(q);
        issued.push(r);
        if (r.text.startsWith("SELECT")) {
          if (opts.throwOnSelect) throw new Error("ER_NO_SUCH_TABLE");
          return [candidates, []];
        }
        return [{ affectedRows: affected.length ? affected.shift() : 1 }, []];
      },
    },
  };
}

const cand = (id: number, f: Partial<Record<"jobClosed" | "jobOpen" | "newerActivity" | "stale", 0 | 1>> = {}) =>
  ({ id, jobClosed: 0, jobOpen: 0, newerActivity: 0, stale: 0, ...f });

describe("reconcileStaleHumanReviewDrafts", () => {
  it("closes each draft by the first rule that holds, CAS-guarded on 'drafted', and leaves the rest open", async () => {
    const { db, issued } = fakeExecutor([
      cand(1, { jobClosed: 1, stale: 1 }), // obligation closed wins over age
      cand(2, { newerActivity: 1, stale: 1 }), // superseded wins over age
      cand(3, { stale: 1 }), // only age
      cand(4), // fresh, unlinked → untouched
      cand(5, { jobOpen: 1 }), // obligation still open, fresh → untouched
      cand(6, { jobClosed: 1, jobOpen: 1 }), // a still-open job keeps the draft
    ]);
    const out = await reconcileStaleHumanReviewDrafts(db, 7);
    expect(out.recordsProcessed).toBe(3);
    expect(out.details).toBe("drafts closed 3: obligation_closed 1 · superseded 1 · expired 1 · lost race 0 · left open 3 of 6 · max age 7d");

    const updates = issued.slice(1);
    expect(updates.map((u) => u.params)).toEqual([
      ["cancelled", "obligation_closed", 1],
      ["cancelled", "superseded_by_newer_activity", 2],
      ["expired", "stale_draft_expired", 3],
    ]);
    for (const u of updates) {
      expect(u.text).toBe(
        "UPDATE sms_orchestrations SET status = ?, status_reason = ?, updatedAt = NOW() WHERE id = ? AND status = 'drafted' AND requires_human_approval = 1",
      );
      expect(u.text).not.toMatch(/message_body/);
    }
  });

  it("reads only drafted human-approval rows, bounded, with the age and supersede signals in SQL", async () => {
    const { db, issued } = fakeExecutor([]);
    await reconcileStaleHumanReviewDrafts(db, 7);
    const select = issued[0];
    expect(select.text).toContain("WHERE o.status = 'drafted' AND o.requires_human_approval = 1");
    expect(select.text).toContain("m.conversationId = o.related_conversation_id AND m.createdAt > o.createdAt");
    expect(select.text).toContain("o.event_type = 'inbound_sms'");
    // Only the CUSTOMER texting again supersedes; an automated outbound (reminder) must not
    // close a draft that still answers an unanswered question.
    expect(select.text).toContain("m.createdAt > o.createdAt AND m.direction = 'inbound'");
    expect(select.text).not.toMatch(/m\.status <> 'failed'/);
    expect(select.text).toContain("j.orchestrationId = o.id");
    expect(select.params).toEqual([7, 500]);
    expect(STALE_DRAFT_MAX_AGE_DAYS).toBe(7);
  });

  it("a CAS that matches nothing (operator acted first) is counted as a lost race, not a closure", async () => {
    const { db } = fakeExecutor([cand(9, { stale: 1 })], { affected: [0] });
    const out = await reconcileStaleHumanReviewDrafts(db, 7);
    expect(out.recordsProcessed).toBe(0);
    expect(out.details).toContain("lost race 1");
  });

  it("no database → 0 with a reason; a failing query THROWS (cron-rethrow contract)", async () => {
    expect(await reconcileStaleHumanReviewDrafts(null)).toEqual({ recordsProcessed: 0, details: "No DB — no drafts reconciled" });
    const { db } = fakeExecutor([], { throwOnSelect: true });
    await expect(reconcileStaleHumanReviewDrafts(db, 7)).rejects.toThrow("ER_NO_SUCH_TABLE");
  });

  it("is wired: the orchestration-status-reconcile cron entry runs it (comment-stripped)", () => {
    const src = stripComments(readFileSync(resolve(__dirname, "../cron/scheduler.ts"), "utf8"));
    const at = src.indexOf('name: "orchestration-status-reconcile"');
    expect(at).toBeGreaterThan(0);
    expect(src.slice(at, at + 600)).toMatch(/await reconcileStaleHumanReviewDrafts\(\)/);
  });
});

// ─── 2. actionHumanReview ───────────────────────────────────────────────────

function adminCtx(): TrpcContext {
  return {
    user: {
      id: 1, openId: "admin-openid", name: "Admin", email: "admin@nickstire.com", loginMethod: "manus", role: "admin",
      loyaltyPoints: 0, loyaltyTier: "bronze", totalVisits: 0, totalSpent: 0,
      createdAt: new Date(), updatedAt: new Date(), lastSignedIn: new Date(),
    },
    req: { protocol: "https", headers: {} } as any,
    res: {} as any,
  } as TrpcContext;
}

const draft = (over: Record<string, unknown> = {}) => ({
  id: 77, status: "drafted", statusReason: "human_takeover_active", customerPhone: "+12165550123",
  messageBody: "Yes, we have 225/65R17 in stock.", providerUsed: "shop", variantKey: "nickgpt_v1",
  relatedConversationId: 501, createdAt: new Date(Date.now() - 60_000), isStale: 0, ...over,
});
const caller = () => appRouter.createCaller(adminCtx()).smsOrchestrator;

beforeEach(() => {
  h.row = null;
  h.updates.length = 0;
  h.affected.length = 0;
  h.executed.length = 0;
  h.executeThrowsOn = null;
  h.sendSms.mockReset().mockResolvedValue({ success: true });
  h.resolveHumanPending.mockReset().mockResolvedValue(1);
});

describe("actionHumanReview", () => {
  it("refuses a row that is already closed — no send, no write", async () => {
    h.row = draft({ status: "cancelled", statusReason: "obligation_closed" });
    await expect(caller().actionHumanReview({ id: 77, action: "send" }))
      .rejects.toMatchObject({ code: "CONFLICT", message: expect.stringContaining("already closed (cancelled: obligation_closed)") });
    expect(h.sendSms).not.toHaveBeenCalled();
    expect(h.updates).toHaveLength(0);
  });

  it("refuses a verbatim send of a draft older than the max age", async () => {
    h.row = draft({ isStale: 1 }); // the age is SQL-computed against STALE_DRAFT_MAX_AGE_DAYS
    await expect(caller().actionHumanReview({ id: 77, action: "send" }))
      .rejects.toMatchObject({ code: "CONFLICT", message: expect.stringContaining("edit it before sending") });
    expect(h.sendSms).not.toHaveBeenCalled();
    expect(h.updates).toHaveLength(0);
  });

  it("allows edit_and_send of a stale draft — the operator wrote fresh text", async () => {
    h.row = draft({ isStale: 1 });
    await expect(caller().actionHumanReview({ id: 77, action: "edit_and_send", editedMessage: "Still need tires?" }))
      .resolves.toEqual({ success: true });
    expect(h.sendSms).toHaveBeenCalledWith("+12165550123", "Still need tires?", expect.objectContaining({ humanInitiated: true }));
  });

  it("claims the row (CAS on the status read) BEFORE sending, then finalizes on the claim", async () => {
    h.row = draft();
    h.sendSms.mockImplementation(async () => {
      expect(h.updates).toHaveLength(1); // the claim is already written when the send runs
      return { success: true };
    });
    await caller().actionHumanReview({ id: 77, action: "send" });
    expect(h.updates[0].set).toEqual({ status: "sending", statusReason: "operator_send_claimed" });
    expect(whereOf(h.updates[0].where).params).toEqual([77, "drafted"]);
    expect(whereOf(h.updates[0].where).sql).toMatch(/`id` = \? and .*`status` = \?/);
    expect(h.updates[1].set).toMatchObject({ status: "sent", statusReason: "sent_by_operator" });
    expect(whereOf(h.updates[1].where).params).toEqual([77, "sending"]);
    expect(h.resolveHumanPending).toHaveBeenCalledWith(501, "human_replied");
  });

  it("a lost claim (another tap / admin / the reconciler got there first) sends NOTHING", async () => {
    h.row = draft();
    h.affected.push(0);
    await expect(caller().actionHumanReview({ id: 77, action: "send" })).rejects.toMatchObject({ code: "CONFLICT" });
    expect(h.sendSms).not.toHaveBeenCalled();
    expect(h.resolveHumanPending).not.toHaveBeenCalled();
  });

  it("a failed send does not close the obligation", async () => {
    h.row = draft();
    h.sendSms.mockResolvedValue({ success: false });
    await caller().actionHumanReview({ id: 77, action: "send" });
    expect(h.updates[1].set).toMatchObject({ status: "failed", statusReason: "transmission_failed" });
    expect(h.resolveHumanPending).not.toHaveBeenCalled();
  });

  it("resolve is a CAS and closes the obligation as no_reply_required", async () => {
    h.row = draft({ status: "received" });
    await caller().actionHumanReview({ id: 77, action: "resolve" });
    expect(h.updates).toHaveLength(1);
    expect(whereOf(h.updates[0].where).params).toEqual([77, "received"]);
    expect(h.resolveHumanPending).toHaveBeenCalledWith(501, "no_reply_required");
  });

  it("bad_suggestion rejects the wording but leaves the customer's obligation open", async () => {
    h.row = draft();
    await caller().actionHumanReview({ id: 77, action: "bad_suggestion" });
    expect(h.updates[0].set).toMatchObject({ status: "skipped", statusReason: "rejected_by_operator_bad_suggestion" });
    expect(h.resolveHumanPending).not.toHaveBeenCalled();
  });

  it("a resolution failure after a successful action is logged, never thrown", async () => {
    h.row = draft();
    h.resolveHumanPending.mockRejectedValue(new Error("db gone"));
    await expect(caller().actionHumanReview({ id: 77, action: "resolve" })).resolves.toEqual({ success: true });
  });
});

// ─── 3. resolveHumanPendingForConversation ──────────────────────────────────

describe("resolveHumanPendingForConversation closes the conversation's drafts", () => {
  const real = () => vi.importActual<typeof import("../services/smsResponseJobs")>("../services/smsResponseJobs");

  it("after the jobs, cancels drafted human-approval orchestrations for the conversation (CAS on 'drafted')", async () => {
    const { resolveHumanPendingForConversation } = await real();
    expect(await resolveHumanPendingForConversation(501, "human_replied")).toBe(2);
    expect(h.executed[0]).toMatch(/^UPDATE sms_response_jobs/);
    expect(h.executed[1]).toBe(
      "UPDATE sms_orchestrations SET status = 'cancelled', status_reason = 'obligation_closed', updatedAt = NOW() WHERE related_conversation_id = ? AND status = 'drafted' AND requires_human_approval = 1",
    );
  });

  it("a failing draft closure never throws — the job closure already happened", async () => {
    const { resolveHumanPendingForConversation } = await real();
    h.executeThrowsOn = /sms_orchestrations/;
    await expect(resolveHumanPendingForConversation(501, "no_reply_required")).resolves.toBe(2);
  });
});
