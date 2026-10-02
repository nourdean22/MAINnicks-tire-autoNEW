/**
 * tests/home/waiting-summary.test.ts · 2026-10-02 · full-circle Lane B
 *
 * Who is waiting on whom, from the rows that exist. Pinned: a failed read makes
 * the buckets it feeds UNKNOWN (count null), never empty; a shop handler's
 * `{ error: "No DB" }` inside a 200 is a failed read; ownership follows the
 * source (an approval is the operator's, a task handed to Nick is the system's,
 * a task waiting on a person is theirs, a promise to someone else is the
 * operator's, a promise to self is not "waiting"); the operator's bucket puts
 * the hard deadline first; stale shop answers are named.
 */
import { describe, expect, it } from "vitest";

import {
  BRIDGE_STALE_MS,
  composeWaitingSummary,
  normalizeBridgeRead,
  type WaitingInput,
} from "@/lib/home/waiting-summary";

const now = new Date("2026-10-02T12:00:00Z");
const ago = (min: number) => new Date(now.getTime() - min * 60_000);

const clean: WaitingInput = {
  now,
  todayYmd: "2026-10-02",
  tasks: [],
  approvalRequests: [],
  pendingActions: [],
  commitments: [],
  actionAttempts: [],
  bridge: {
    callbacks: { ok: true, rows: [], timestamp: ago(1).toISOString() },
    urgentLeads: { ok: true, rows: [], timestamp: ago(1).toISOString() },
  },
};

describe("composeWaitingSummary · unknown is not zero", () => {
  it("a clean read is three empty buckets with counts of 0 and nothing failed", () => {
    const s = composeWaitingSummary(clean);
    expect(s.me).toEqual({ items: [], count: 0 });
    expect(s.others).toEqual({ items: [], count: 0 });
    expect(s.system).toEqual({ items: [], count: 0 });
    expect(s.failedSources).toEqual([]);
    expect(s.staleSources).toEqual([]);
    expect(s.partial).toBe(false);
    expect(s.measuredAt).toBe(now.toISOString());
  });

  it("a failed tasks read makes others AND system unknown, and leaves me countable", () => {
    const s = composeWaitingSummary({ ...clean, tasks: null });
    expect(s.others.count).toBeNull();
    expect(s.system.count).toBeNull();
    expect(s.me.count).toBe(0);
    expect(s.failedSources).toEqual(["tasks"]);
    expect(s.partial).toBe(true);
  });

  it("a failed approvals, commitments or bridge read makes me unknown", () => {
    expect(composeWaitingSummary({ ...clean, approvalRequests: null }).me.count).toBeNull();
    expect(composeWaitingSummary({ ...clean, pendingActions: null }).failedSources).toEqual(["approvals"]);
    expect(composeWaitingSummary({ ...clean, commitments: null }).me.count).toBeNull();
    const s = composeWaitingSummary({ ...clean, bridge: null });
    expect(s.me.count).toBeNull();
    expect(s.failedSources).toEqual(["nickstire bridge"]);
  });

  it("the shop's { error: 'No DB' } inside a 200 is a failed read, not an empty queue", () => {
    const s = composeWaitingSummary({
      ...clean,
      bridge: {
        callbacks: { ok: false, error: "No DB" },
        urgentLeads: { ok: true, rows: [], timestamp: ago(1).toISOString() },
      },
    });
    expect(s.me.count).toBeNull();
    expect(s.failedSources).toEqual(["nickstire callbacks_pending (No DB)"]);
  });
});

describe("composeWaitingSummary · ownership follows the source", () => {
  it("approvals and attempts parked on approval are the operator's; an executing attempt is the system's", () => {
    const s = composeWaitingSummary({
      ...clean,
      approvalRequests: [
        { id: "r1", actionType: "send_sms", reason: "customer asked", createdAt: ago(90), expiresAt: new Date(now.getTime() + 3_600_000) },
      ],
      pendingActions: [
        { id: "a1", ruleName: "review-reply", actionType: "publish", createdAt: ago(30), expired: false },
        { id: "a2", ruleName: "review-reply", actionType: "publish", createdAt: ago(9_000), expired: true },
      ],
      actionAttempts: [
        { id: "t1", tool: "railway.deploy_alert", operationKey: "k1", state: "WAITING_APPROVAL", reason: null, startedAt: ago(10) },
        { id: "t2", tool: "firecrawl-scrape", operationKey: "k2", state: "EXECUTING", reason: null, startedAt: ago(5) },
      ],
    });
    expect(s.me.count).toBe(3);
    expect(s.me.items.map((i) => i.key)).toEqual(["request:r1", "action:a1", "attempt:t1"]);
    expect(s.me.items[0]).toMatchObject({ who: "you", deadline: new Date(now.getTime() + 3_600_000).toISOString(), href: "/system/actions", source: "approval_requests r1", ageMin: 90 });
    expect(s.system.count).toBe(1);
    expect(s.system.items[0]).toMatchObject({ owner: "system", who: "firecrawl-scrape", subject: "firecrawl-scrape is executing", source: "action_attempts t2" });
  });

  it("a task handed to Nick waits on the system; a task waiting on a person waits on others; closed tasks never count", () => {
    const s = composeWaitingSummary({
      ...clean,
      tasks: [
        { id: "k1", title: "Draft the supplier email", status: "WAITING", waitingOn: "Nick", updatedAt: ago(120), dueDate: null },
        { id: "k2", title: "Quote from Dania", status: "WAITING", waitingOn: "Dania", updatedAt: ago(2_880), dueDate: new Date("2026-09-30T12:00:00Z") },
        { id: "k3", title: "Done thing", status: "DONE", waitingOn: "Sam", updatedAt: ago(5), dueDate: null },
        { id: "k4", title: "Blank waitingOn", status: "READY", waitingOn: "  ", updatedAt: ago(5), dueDate: null },
      ],
    });
    expect(s.system.items.map((i) => i.key)).toEqual(["task:k1"]);
    expect(s.system.items[0]).toMatchObject({ who: "Nick", nextAction: "check Nick's desk on /missions", source: "tasks k1 · since its last update", ageMin: 120 });
    expect(s.others.items.map((i) => i.key)).toEqual(["task:k2"]);
    expect(s.others.items[0]).toMatchObject({ who: "Dania", deadline: "2026-09-30", consequence: "due 2026-09-30, already past", nextAction: "nudge Dania, or unblock it yourself" });
    expect(s.me.count).toBe(0);
  });

  it("a proposed commitment and a promise owed to someone are the operator's; a promise to self is not 'waiting'", () => {
    const s = composeWaitingSummary({
      ...clean,
      commitments: [
        { id: 1, description: "Send Sam the brake estimate", toWhom: "Sam", deadline: "2026-09-30", status: "active", dateMade: "2026-09-28" },
        { id: 2, description: "Gym four times", toWhom: "self", deadline: "2026-10-05", status: "active", dateMade: "2026-10-01" },
        { id: 3, description: "Sponsor the league", toWhom: "Coach Lee", deadline: null, status: "proposed", dateMade: "2026-10-02" },
        { id: 4, description: "Old one", toWhom: "Sam", deadline: "2026-09-01", status: "verified", dateMade: "2026-08-01" },
      ],
    });
    expect(s.me.count).toBe(2);
    const sam = s.me.items.find((i) => i.key === "commitment:1");
    expect(sam).toMatchObject({ subject: "promise to Sam: Send Sam the brake estimate", deadline: "2026-09-30", consequence: "overdue since 2026-09-30", nextAction: "deliver or renegotiate with Sam", source: "commitments #1" });
    const lee = s.me.items.find((i) => i.key === "commitment:3");
    expect(lee).toMatchObject({ subject: "accept or decline: Sponsor the league", consequence: "proposed to Coach Lee", nextAction: "accept, renegotiate or decline" });
  });

  it("a customer callback and an urgent lead are the operator's, with the phone as the next action and the shop row as the source", () => {
    const s = composeWaitingSummary({
      ...clean,
      bridge: {
        callbacks: {
          ok: true,
          timestamp: ago(2).toISOString(),
          rows: [{ id: 17, name: "Sam Okafor", phone: "216-555-0101", reason: "estimate on the 2015 Civic", createdAt: ago(130).toISOString() }],
        },
        urgentLeads: {
          ok: true,
          timestamp: ago(2).toISOString(),
          rows: [{ id: 42, name: "Priya", phone: null, urgencyScore: 5, urgencyReason: "flat tire, stranded", createdAt: ago(20).toISOString() }],
        },
      },
    });
    expect(s.me.count).toBe(2);
    expect(s.me.items.find((i) => i.key === "callback:17")).toMatchObject({ subject: "call back Sam Okafor", consequence: "estimate on the 2015 Civic", nextAction: "call 216-555-0101", source: "nickstire callback_requests 17", ageMin: 130 });
    expect(s.me.items.find((i) => i.key === "lead:42")).toMatchObject({ subject: "urgent lead · Priya (urgency 5)", consequence: "flat tire, stranded", nextAction: "follow up from the shop admin", source: "nickstire leads 42" });
  });
});

describe("composeWaitingSummary · ordering and staleness", () => {
  it("the operator's bucket puts the hard deadline first, then the oldest; others go oldest first", () => {
    const s = composeWaitingSummary({
      ...clean,
      approvalRequests: [
        { id: "late", actionType: "x", reason: "", createdAt: ago(5), expiresAt: new Date("2026-10-03T00:00:00Z") },
        { id: "soon", actionType: "y", reason: "", createdAt: ago(1), expiresAt: new Date("2026-10-02T13:00:00Z") },
      ],
      pendingActions: [{ id: "nodate-old", ruleName: "r", actionType: "z", createdAt: ago(600), expired: false }],
      tasks: [
        { id: "n", title: "new", status: "WAITING", waitingOn: "A", updatedAt: ago(1), dueDate: null },
        { id: "o", title: "old", status: "WAITING", waitingOn: "B", updatedAt: ago(1_000), dueDate: null },
      ],
    });
    expect(s.me.items.map((i) => i.key)).toEqual(["request:soon", "request:late", "action:nodate-old"]);
    expect(s.others.items.map((i) => i.key)).toEqual(["task:o", "task:n"]);
  });

  it("a shop answer older than the staleness window is named, and still counted", () => {
    const old = new Date(now.getTime() - BRIDGE_STALE_MS - 60_000).toISOString();
    const s = composeWaitingSummary({
      ...clean,
      bridge: {
        callbacks: { ok: true, rows: [{ id: 1, name: "A", phone: "1", reason: null, createdAt: null }], timestamp: old },
        urgentLeads: { ok: true, rows: [], timestamp: ago(1).toISOString() },
      },
    });
    expect(s.staleSources).toEqual(["nickstire callbacks_pending"]);
    expect(s.me.count).toBe(1);
    expect(s.me.items[0]).toMatchObject({ since: null, ageMin: null, consequence: "customer asked for a call" });
  });
});

describe("normalizeBridgeRead", () => {
  it("rows + timestamp when the shop answered", () => {
    expect(normalizeBridgeRead({ data: { pending: [{ id: 1 }], count: 1 }, query: "callbacks_pending", timestamp: "2026-10-02T11:59:00Z" }, "pending")).toEqual({
      ok: true,
      rows: [{ id: 1 }],
      timestamp: "2026-10-02T11:59:00Z",
    });
  });

  it("every failure shape is a failed read with its reason", () => {
    expect(normalizeBridgeRead({ error: "HTTP 500: boom" }, "pending")).toEqual({ ok: false, error: "HTTP 500: boom" });
    expect(normalizeBridgeRead({ data: { error: "No DB" } }, "pending")).toEqual({ ok: false, error: "No DB" });
    expect(normalizeBridgeRead({ data: { count: 0 } }, "pending")).toEqual({ ok: false, error: "no pending array" });
    expect(normalizeBridgeRead(undefined, "pending")).toEqual({ ok: false, error: "no answer" });
    expect(normalizeBridgeRead({ data: null }, "pending")).toEqual({ ok: false, error: "no data" });
  });
});
