/**
 * NEW-05 (audit round 3) - an event organised by someone else is third-party
 * text: its title and description were written by the organizer. The ingest
 * used to file every event as source "calendar_cron", which the trust
 * classifier reads as SYSTEM_DERIVED (first-party, action-authorizing).
 * Events the connected account did not organise now carry "calendar:external".
 *
 * 2026-10-30 · the cron reads every connected account and calendar through
 * lib/calendar/day-events, so "own" means the account the event came FROM, and
 * a connected calendar that holds nothing is reported instead of filed green.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  intake: vi.fn(async (..._a: unknown[]) => ({ outcome: "committed" })),
  read: vi.fn(async (..._a: unknown[]) => ({}) as Record<string, unknown>),
  accounts: vi.fn(async () => [{ accountKey: "primary", integrationName: "google_oauth", email: "nour@example.com" as string | null }]),
  audit: vi.fn(async (..._a: unknown[]) => ({})),
}));

vi.mock("@/lib/utils/http", () => ({
  cronHandler: (fn: (req: Request, ctx: unknown) => Promise<unknown>) => fn,
}));
vi.mock("@/lib/prisma", () => ({
  // W2: the run also reads its stored copies to remove events gone from Google (none here).
  prisma: { auditEvent: { create: h.audit }, brainMemory: { findMany: async () => [], updateMany: async () => ({ count: 0 }) } },
}));
vi.mock("@/lib/brain/external-memory-intake", () => ({ intakeExternalMemory: h.intake }));
vi.mock("@/lib/services/google-oauth", () => ({ CALENDAR_ACCOUNT_KEY: "personal", listConfiguredAccounts: h.accounts }));
vi.mock("@/lib/calendar/day-events", () => ({ readCalendarWindow: h.read }));

import { GET } from "@/app/api/cron/ingest-calendar/route";

const SOON = new Date(Date.now() + 86_400_000).toISOString();
const ev = (id: string, organizer?: string, accountKey = "primary") => ({
  id, title: `Meeting ${id}`, start: SOON, end: null, allDay: false, accountKey, organizer,
});
const ok = (events: unknown[]) => ({ state: "ok", events, sources: { accounts: 1, calendars: 2 }, failedAccounts: [] });
const run = () => GET(new Request("http://x/api/cron/ingest-calendar"), {} as never) as Promise<Record<string, unknown>>;
const sourceFor = (id: string) =>
  (h.intake.mock.calls.map((c) => c[0] as { key: string; source: string }).find((c) => c.key === `calendar_${id}`))?.source;

beforeEach(() => {
  vi.clearAllMocks();
  h.accounts.mockResolvedValue([{ accountKey: "primary", integrationName: "google_oauth", email: "nour@example.com" }]);
});

describe("ingest-calendar - organizer decides the source", () => {
  it("an event organised by someone else is filed as calendar:external", async () => {
    h.read.mockResolvedValueOnce(ok([ev("a", "stranger@vendor.example")]));
    await run();
    expect(sourceFor("a")).toBe("calendar:external");
  });

  it("CONTROL - the connected account's own event stays calendar_cron (case-insensitive)", async () => {
    h.read.mockResolvedValueOnce(ok([ev("b", "Nour@Example.com")]));
    await run();
    expect(sourceFor("b")).toBe("calendar_cron");
  });

  it("fails closed: with no connected-account email, an organised event is external", async () => {
    h.accounts.mockResolvedValueOnce([{ accountKey: "primary", integrationName: "google_oauth", email: null }]);
    h.read.mockResolvedValueOnce(ok([ev("c", "nour@example.com")]));
    await run();
    expect(sourceFor("c")).toBe("calendar:external");
  });

  it("own means the account the event came from: the shop account's address does not vouch for a personal-calendar event", async () => {
    h.accounts.mockResolvedValueOnce([
      { accountKey: "primary", integrationName: "google_oauth", email: "shop@example.com" },
      { accountKey: "personal", integrationName: "google_oauth_personal", email: "nour@example.com" },
    ]);
    h.read.mockResolvedValueOnce(ok([ev("d", "shop@example.com", "personal"), ev("e", "nour@example.com", "personal")]));
    await run();
    expect(sourceFor("d")).toBe("calendar:external");
    expect(sourceFor("e")).toBe("calendar_cron");
  });
});

describe("ingest-calendar - honest states", () => {
  it("a connected calendar with 0 events in the whole window is reported, not filed as a quiet success", async () => {
    h.read.mockResolvedValueOnce(ok([]));
    const out = await run();
    expect(out.emptyWindow).toBe(true);
    expect(String(out.warning)).toMatch(/0 events/);
    const detail = h.audit.mock.calls.map((c) => (c[0] as { data: { detail: string } }).data.detail).join("\n");
    expect(detail).toMatch(/0 events across 2 calendars/);
  });

  it("not connected and expired skip with a re-grant hint", async () => {
    h.read.mockResolvedValueOnce({ state: "not_connected" });
    expect(await run()).toMatchObject({ skipped: true, reason: "google_oauth_not_configured" });
    h.read.mockResolvedValueOnce({ state: "expired", accounts: ["primary"] });
    expect(await run()).toMatchObject({ skipped: true, reason: "google_oauth_expired" });
  });

  it("a failed read throws so the run is recorded as failed", async () => {
    h.read.mockResolvedValueOnce({ state: "read_failed", reason: "every account read failed (primary)" });
    await expect(run()).rejects.toThrow(/every account read failed/);
  });
});
