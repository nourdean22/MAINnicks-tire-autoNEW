/**
 * Q-39 · every rule is driven through draftReviewReminders, the one export with
 * a runtime caller (cron/jobs/reviewReminderDrafts.ts). The fake database hands
 * back, in order: the candidate rows (ages as the SQL computes them), the
 * requests for those phones, and the idempotency keys already drafted.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  isEnabled: vi.fn<(key: string) => Promise<boolean>>(),
  getDbTyped: vi.fn<() => Promise<any>>(),
  getReviewSettings: vi.fn(),
  resolveContactExperiment: vi.fn(),
  loadSuppressionIndex: vi.fn(),
  sendSms: vi.fn(),
  selectResponses: [] as unknown[][],
  inserted: [] as Record<string, unknown>[],
}));

vi.mock("./featureFlags", () => ({ isEnabled: h.isEnabled }));
vi.mock("../db", () => ({ getDbTyped: h.getDbTyped, getReviewSettings: h.getReviewSettings }));
vi.mock("./contactExperiment", () => ({ resolveContactExperiment: h.resolveContactExperiment }));
vi.mock("../sms", () => ({
  loadSuppressionIndex: h.loadSuppressionIndex,
  sendSms: h.sendSms,
  withOptOut: (body: string) => (/\breply stop\b/i.test(body) ? body : `${body}\n\nReply STOP to opt out.`),
}));
vi.mock("../lib/logger", () => ({
  createLogger: () => ({ error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() }),
}));

/** Every select chain resolves to the next queued response, whichever method ends it. */
function fakeDb() {
  const chain = (): any => {
    const c: any = {};
    for (const m of ["from", "where", "orderBy", "limit"]) c[m] = vi.fn(() => c);
    c.then = (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) =>
      Promise.resolve(h.selectResponses.shift() ?? []).then(res, rej);
    return c;
  };
  return {
    select: vi.fn(() => chain()),
    insert: vi.fn(() => ({
      values: vi.fn(async (v: Record<string, unknown>) => { h.inserted.push(v); }),
    })),
  };
}

import { draftReviewReminders } from "./reviewReminder";

const NOW = new Date("2026-09-30T15:00:00Z");
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 24 * 60 * 60 * 1000);
const hoursSince = (d: Date | null) => (d ? Math.floor((NOW.getTime() - d.getTime()) / 3_600_000) : null);

interface Row {
  id: number;
  bookingId: number;
  customerName: string;
  phone: string;
  status: string;
  sentAt: Date | null;
  clickedAt: Date | null;
  createdAt: Date;
  trackingToken: string;
}

function req(over: Partial<Row> = {}): Row {
  return {
    id: 1,
    bookingId: 10,
    customerName: "Dana Smith",
    phone: "2165550101",
    status: "sent",
    sentAt: daysAgo(13),
    clickedAt: null,
    createdAt: daysAgo(14),
    trackingToken: "tok1",
    ...over,
  };
}

/** Queue one run's three reads. `phoneRows` defaults to the candidates themselves. */
function queueRun(rows: Row[], opts: { phoneRows?: Array<{ id: number; phone: string; createdAt: Date }>; drafted?: string[] } = {}) {
  h.selectResponses.push(
    rows.map((r) => ({ ...r, ageHours: hoursSince(r.createdAt), sentAgeHours: hoursSince(r.sentAt) })),
    opts.phoneRows ?? rows.map((r) => ({ id: r.id, phone: r.phone, createdAt: r.createdAt })),
    (opts.drafted ?? []).map((key) => ({ key })),
  );
}

const draftedIds = () => h.inserted.map((r) => r.sourceId);

beforeEach(() => {
  vi.clearAllMocks();
  h.selectResponses.length = 0;
  h.inserted.length = 0;
  h.isEnabled.mockResolvedValue(true);
  h.getDbTyped.mockResolvedValue(fakeDb());
  h.getReviewSettings.mockResolvedValue({ enabled: 1 });
  h.loadSuppressionIndex.mockResolvedValue({ ok: true, phones: new Set(), carrierBlocked: new Set(), voiceOnly: new Set(), stale: false });
  h.resolveContactExperiment.mockResolvedValue({
    eligible: true, armed: true, measurable: true, laneKey: "review_reminder",
    experimentId: "contact:review_reminder:v1", armId: "treatment", reason: "durable_assignment_created",
  });
});

describe("who gets a day-13 reminder", () => {
  it("a sent, unclicked request inside the day-13 window gets one draft", async () => {
    queueRun([req()]);
    expect(await draftReviewReminders()).toEqual({ drafted: 1, heldOut: 0, skipped: 0 });
    expect(draftedIds()).toEqual(["1"]);
  });

  it("clicked, held-out, failed and never-sent requests get none", async () => {
    queueRun([
      req({ id: 1, clickedAt: daysAgo(12), status: "clicked" }),
      req({ id: 2, status: "heldout", sentAt: null, phone: "2165550102" }),
      req({ id: 3, status: "failed", phone: "2165550103" }),
      req({ id: 4, status: "sent", sentAt: null, phone: "2165550104" }),
    ]);
    expect(await draftReviewReminders()).toMatchObject({ drafted: 0, skipped: 4 });
    expect(h.inserted).toEqual([]);
  });

  it("never early and never stale: day 12 is too young, day 21 is past the window", async () => {
    queueRun([
      req({ id: 1, createdAt: daysAgo(12), sentAt: daysAgo(11) }),
      req({ id: 2, createdAt: daysAgo(21), sentAt: daysAgo(20), phone: "2165550102" }),
      req({ id: 3, createdAt: daysAgo(19.9), sentAt: daysAgo(19), phone: "2165550103" }),
    ]);
    await draftReviewReminders();
    expect(draftedIds()).toEqual(["3"]);
  });

  it("never within a week of the original text, whatever the send delay was", async () => {
    // Created 14 days ago but only texted 3 days ago (the queue sat held).
    queueRun([req({ sentAt: daysAgo(3) })]);
    await draftReviewReminders();
    expect(h.inserted).toEqual([]);
  });

  it("a NEWER request for the same phone (a repeat visit) takes over; the old visit gets none", async () => {
    queueRun([req()], {
      phoneRows: [
        { id: 1, phone: "2165550101", createdAt: daysAgo(14) },
        { id: 9, phone: "2165550101", createdAt: daysAgo(2) },
      ],
    });
    await draftReviewReminders();
    expect(h.inserted).toEqual([]);
  });

  it("a request that already has a reminder draft gets no second one", async () => {
    queueRun([req()], { drafted: ["review_reminder:1"] });
    await draftReviewReminders();
    expect(h.inserted).toEqual([]);
  });

  it("at most one per phone per run (oldest first), and at most 20 drafts a run", async () => {
    // No newer-request rows supplied, so the per-phone dedupe is what keeps it to one.
    queueRun([req({ id: 2, createdAt: daysAgo(15) }), req({ id: 1, createdAt: daysAgo(14) })], { phoneRows: [] });
    await draftReviewReminders();
    expect(draftedIds()).toEqual(["2"]);

    h.inserted.length = 0;
    queueRun(Array.from({ length: 30 }, (_, i) => req({ id: i + 1, phone: `21655502${String(i).padStart(2, "0")}` })));
    await draftReviewReminders();
    expect(h.inserted).toHaveLength(20);
  });
});

describe("the draft itself", () => {
  it("is a drafted row for the Human Review Queue, and nothing is sent", async () => {
    queueRun([req()]);
    await draftReviewReminders();
    expect(h.sendSms).not.toHaveBeenCalled();
    expect(h.resolveContactExperiment).toHaveBeenCalledWith("+12165550101", "review_reminder");
    expect(h.inserted[0]).toMatchObject({
      eventType: "review_reminder",
      variantKey: "review_reminder",
      customerPhone: "+12165550101",
      status: "drafted",
      requiresHumanApproval: true,
      shouldAutoSend: false,
      sourceTable: "review_requests",
      sourceId: "1",
      relatedBookingId: 10,
      experimentId: "contact:review_reminder:v1",
      idempotencyKey: "review_reminder:1",
    });
  });

  it("carries the ORIGINAL tracking link, the first name and the STOP footer", async () => {
    queueRun([req()]);
    await draftReviewReminders();
    const body = String(h.inserted[0].messageBody);
    expect(body).toMatch(/^Hi Dana, /);
    expect(body).toContain("/api/review-click/tok1");
    expect(body).toMatch(/Reply STOP to opt out\.$/);
  });

  it("does not greet a placeholder name", async () => {
    queueRun([req({ customerName: "Customer" })]);
    await draftReviewReminders();
    expect(String(h.inserted[0].messageBody)).toMatch(/^Hi, one last note/);
  });
});

describe("gates · drafts only, measured or nothing", () => {
  it("does nothing, and reads nothing, while its own flag is off", async () => {
    h.isEnabled.mockImplementation(async (k) => k !== "review_reminder_drafts");
    const r = await draftReviewReminders();
    expect(r).toMatchObject({ drafted: 0, reason: expect.stringMatching(/review_reminder_drafts off/) });
    expect(h.getDbTyped).not.toHaveBeenCalled();
  });

  it("does nothing without the holdout master: the lane exists only as a measured experiment", async () => {
    h.isEnabled.mockImplementation(async (k) => k !== "contact_holdouts_enabled");
    expect((await draftReviewReminders()).reason).toMatch(/contact_holdouts_enabled off/);
    expect(h.getDbTyped).not.toHaveBeenCalled();
  });

  it("does nothing when review requests are disabled in settings", async () => {
    h.getReviewSettings.mockResolvedValue({ enabled: 0 });
    expect((await draftReviewReminders()).reason).toMatch(/disabled in settings/);
  });

  it("control → no draft; the durable assignment is the record", async () => {
    queueRun([req()]);
    h.resolveContactExperiment.mockResolvedValue({
      eligible: true, armed: true, measurable: true, laneKey: "review_reminder",
      experimentId: "contact:review_reminder:v1", armId: "control", reason: "durable_assignment_created",
    });
    expect(await draftReviewReminders()).toEqual({ drafted: 0, heldOut: 1, skipped: 0 });
    expect(h.inserted).toEqual([]);
  });

  it("no durable arm → no draft (an unmeasured reminder is contact nobody can evaluate)", async () => {
    queueRun([req()]);
    h.resolveContactExperiment.mockResolvedValue({
      eligible: true, armed: true, measurable: false, laneKey: "review_reminder",
      experimentId: "contact:review_reminder:v1", armId: "treatment", reason: "db_unavailable_send_normally",
    });
    expect(await draftReviewReminders()).toEqual({ drafted: 0, heldOut: 0, skipped: 1 });
    expect(h.inserted).toEqual([]);
  });

  it("an opted-out phone gets no draft and is never even assigned an arm", async () => {
    queueRun([req()]);
    h.loadSuppressionIndex.mockResolvedValue({ ok: true, phones: new Set(["2165550101"]), carrierBlocked: new Set(), voiceOnly: new Set(), stale: false });
    expect(await draftReviewReminders()).toEqual({ drafted: 0, heldOut: 0, skipped: 1 });
    expect(h.resolveContactExperiment).not.toHaveBeenCalled();
    expect(h.inserted).toEqual([]);
  });

  it("an unreadable opt-out list is unknown, never 'nobody opted out': throws, drafts nothing", async () => {
    queueRun([req()]);
    h.loadSuppressionIndex.mockResolvedValue({ ok: false, reason: "database unavailable" });
    await expect(draftReviewReminders()).rejects.toThrow(/Opt-out list unavailable/);
    expect(h.inserted).toEqual([]);
  });

  it("an unreadable database throws rather than reporting an empty queue", async () => {
    h.getDbTyped.mockResolvedValue(null);
    await expect(draftReviewReminders()).rejects.toThrow(/unknown, not empty/);
  });
});
