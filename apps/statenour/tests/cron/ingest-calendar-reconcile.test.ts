/**
 * Calendar r2 W2 (2026-10-31): the daily ingest keeps the brain's copy of his calendar in step
 * with Google. An edited event is re-filed under the same key; an event that is gone from a
 * COMPLETE read of the window is soft-deleted. A partial read deletes nothing (an unreadable
 * calendar is not an empty one), and rows from another account are never touched.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  intake: vi.fn(async (..._a: unknown[]) => ({ outcome: "stored" })),
  read: vi.fn(async (..._a: unknown[]) => ({}) as Record<string, unknown>),
  accounts: vi.fn(async () => [{ accountKey: "personal", integrationName: "google_oauth_personal", email: "owner@example.com" as string | null }]),
  audit: vi.fn(async (..._a: unknown[]) => ({})),
  stored: vi.fn(async (..._a: unknown[]) => [] as Array<{ id: string; key: string; metadata: unknown }>),
  softDelete: vi.fn(async (..._a: unknown[]) => ({ count: 0 })),
}));

vi.mock("@/lib/utils/http", () => ({ cronHandler: (fn: (req: Request, ctx: unknown) => Promise<unknown>) => fn }));
vi.mock("@/lib/prisma", () => ({
  prisma: { auditEvent: { create: h.audit }, brainMemory: { findMany: h.stored, updateMany: h.softDelete } },
}));
vi.mock("@/lib/brain/external-memory-intake", () => ({ intakeExternalMemory: h.intake }));
vi.mock("@/lib/services/google-oauth", () => ({ CALENDAR_ACCOUNT_KEY: "personal", listConfiguredAccounts: h.accounts }));
vi.mock("@/lib/calendar/day-events", () => ({ readCalendarWindow: h.read }));

import { GET } from "@/app/api/cron/ingest-calendar/route";

const inDays = (d: number) => new Date(Date.now() + d * 86_400_000).toISOString();
const ev = (id: string, title = `Meeting ${id}`) => ({ id, title, start: inDays(1), end: null, allDay: false, accountKey: "personal" });
const ok = (events: unknown[], failedAccounts: string[] = []) => ({ state: "ok", events, sources: { accounts: 1, calendars: 1 }, failedAccounts });
const row = (eventId: string, over: Record<string, unknown> = {}) => ({
  id: `m-${eventId}`, key: `calendar_${eventId}`, metadata: { eventId, start: inDays(2), accountKey: "personal", ...over },
});
const run = () => GET(new Request("http://x/api/cron/ingest-calendar"), {} as never) as Promise<Record<string, unknown>>;
const deletedIds = () => h.softDelete.mock.calls.flatMap((c) => ((c[0] as { where: { id: { in: string[] } } }).where.id.in));

beforeEach(() => {
  vi.clearAllMocks();
  // mockReset drains a Once queue a test left unconsumed (clearAllMocks does not).
  h.read.mockReset();
  h.stored.mockReset().mockResolvedValue([]);
  h.softDelete.mockImplementation(async (a: unknown) => ({ count: (a as { where: { id: { in: string[] } } }).where.id.in.length }));
});

describe("ingest-calendar · keeps the stored copy in step with Google", () => {
  it("an event deleted in Google is soft-deleted from the brain", async () => {
    h.stored.mockResolvedValueOnce([row("kept"), row("gone")]);
    h.read.mockResolvedValueOnce(ok([ev("kept")]));
    const out = await run();
    expect(deletedIds()).toEqual(["m-gone"]);
    expect(out.removed).toBe(1);
    // The soft delete only touches rows that are still live.
    expect((h.softDelete.mock.calls[0][0] as { where: { deletedAt: unknown } }).where.deletedAt).toBeNull();
    expect((h.softDelete.mock.calls[0][0] as { data: { deletedAt: unknown } }).data.deletedAt).toBeInstanceOf(Date);
  });

  it("an event edited in Google is re-filed under the same key with its new title", async () => {
    h.stored.mockResolvedValueOnce([row("x")]);
    h.read.mockResolvedValueOnce(ok([ev("x", "Moved meeting")]));
    await run();
    const filed = h.intake.mock.calls.map((c) => c[0] as { key: string; content: string });
    expect(filed.find((f) => f.key === "calendar_x")?.content).toContain("Moved meeting");
    expect(deletedIds()).toEqual([]);
  });

  it("a partial read deletes nothing: an unreadable calendar is not an empty one", async () => {
    h.stored.mockResolvedValueOnce([row("gone")]);
    h.read.mockResolvedValueOnce(ok([], ["personal"]));
    const out = await run();
    expect(h.softDelete).not.toHaveBeenCalled();
    expect(out.removed).toBe(0);
  });

  it("never touches a stored event from another account or outside the window just read", async () => {
    h.stored.mockResolvedValueOnce([
      row("shop", { accountKey: "primary" }),
      row("old", { start: inDays(-30) }),
      row("far", { start: inDays(60) }),
      row("nokey", { accountKey: undefined }),
    ]);
    h.read.mockResolvedValueOnce(ok([ev("other")]));
    await run();
    expect(h.softDelete).not.toHaveBeenCalled();
  });

  it("an event still in Google but now skipped by the ingest filter keeps its stored copy", async () => {
    h.stored.mockResolvedValueOnce([row("l")]);
    h.read.mockResolvedValueOnce(ok([ev("l", "Lunch")]));
    await run();
    expect(h.softDelete).not.toHaveBeenCalled();
  });

  it("a failed read of the stored copies is a failed run, not a silent skip of the cleanup", async () => {
    h.stored.mockRejectedValueOnce(new Error("db down"));
    h.read.mockResolvedValueOnce(ok([ev("a")]));
    await expect(run()).rejects.toThrow(/db down/);
  });
});
