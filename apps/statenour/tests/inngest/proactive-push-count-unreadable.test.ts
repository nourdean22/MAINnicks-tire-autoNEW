/**
 * proactive-push cron · a nudge that could not read either approval count must fail the RUN (2026-10-31).
 *
 * checkAndNudgeApprovals now returns { reason: "approval_count_unreadable" } instead of throwing, so the
 * hourly reminders step still runs. But the only reader of that reason was a log.info line, so a day-long
 * database outage ended every run green: no nudge and no onFailure alert (before, the throw fired it).
 * The handler now throws AFTER the reminders step when the nudge reason says both counts were unreadable,
 * so the existing failure alert and cron-log path carry it.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  fireSlotForCurrentHour: vi.fn(),
  checkAndNudgeApprovals: vi.fn(),
  fireDueReminders: vi.fn(),
}));

vi.mock("@/lib/inngest/client", () => ({
  getInngest: () => ({ createFunction: (_cfg: unknown, handler: unknown) => ({ handler }) }),
}));
vi.mock("@/lib/inngest/on-failure", () => ({ onInngestFailure: vi.fn() }));
vi.mock("@/lib/brain/proactive-pushes", () => h);
vi.mock("@/lib/logger", () => ({
  logger: { withSurface: () => ({ info: () => {}, warn: () => {}, error: () => {} }) },
}));

import { proactivePushCron } from "@/lib/inngest/functions/proactive-push";

type Handler = (ctx: { step: { run: <T>(name: string, fn: () => Promise<T>) => Promise<T> } }) => Promise<unknown>;
const handler = (proactivePushCron as unknown as { handler: Handler }).handler;
const ran: string[] = [];
const step = {
  run: async <T,>(name: string, fn: () => Promise<T>) => {
    ran.push(name);
    return fn();
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  ran.length = 0;
  h.fireSlotForCurrentHour.mockResolvedValue({ kind: "skip", skipped: true, reason: "overnight_hour_3" });
  h.fireDueReminders.mockResolvedValue({ fired: 0, reason: "none_due" });
});

describe("proactive-push cron · unreadable approval counts", () => {
  it("both counts unreadable: the reminders step still runs, then the run fails so the failure alert fires", async () => {
    h.checkAndNudgeApprovals.mockResolvedValue({ kind: "skip", skipped: true, reason: "approval_count_unreadable" });
    await expect(handler({ step })).rejects.toThrow(/approval_count_unreadable/);
    expect(h.fireDueReminders).toHaveBeenCalledTimes(1);
    expect(ran).toEqual(["fire-push", "check-nudges", "fire-due-reminders"]);
  });

  it("CONTROL: a zero queue (no_pending_actions) is a normal green run", async () => {
    h.checkAndNudgeApprovals.mockResolvedValue({ kind: "skip", skipped: true, reason: "no_pending_actions" });
    await expect(handler({ step })).resolves.toMatchObject({ nudge: { reason: "no_pending_actions" } });
  });

  it("CONTROL: a sent nudge, and a partial read that sent, are normal green runs", async () => {
    h.checkAndNudgeApprovals.mockResolvedValue({ kind: "live", slot: "approvals_nudge_partial", fired: true, reason: "sent" });
    await expect(handler({ step })).resolves.toMatchObject({ nudge: { fired: true } });
  });
});
