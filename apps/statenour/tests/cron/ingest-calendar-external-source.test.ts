/**
 * NEW-05 (audit round 3) - an event organised by someone else is third-party
 * text: its title and description were written by the organizer. The ingest
 * used to file every event as source "calendar_cron", which the trust
 * classifier reads as SYSTEM_DERIVED (first-party, action-authorizing).
 * Events the connected account did not organise now carry "calendar:external".
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  intake: vi.fn(async (..._a: unknown[]) => ({ outcome: "committed" })),
  listEvents: vi.fn(async (..._a: unknown[]) => [] as unknown[]),
  oauth: vi.fn(async () => ({ state: "healthy", email: "nour@example.com" }) as Record<string, unknown>),
}));

vi.mock("@/lib/utils/http", () => ({
  cronHandler: (fn: (req: Request, ctx: unknown) => Promise<unknown>) => fn,
}));
vi.mock("@/lib/prisma", () => ({
  prisma: { auditEvent: { create: vi.fn(async () => ({})) } },
}));
vi.mock("@/lib/brain/external-memory-intake", () => ({ intakeExternalMemory: h.intake }));
vi.mock("@/lib/services/google-oauth", () => ({ getGoogleOauthStatus: h.oauth }));
vi.mock("@/lib/services/calendar-api", () => ({
  listEvents: h.listEvents,
  CalendarApiError: class extends Error {},
}));

import { GET } from "@/app/api/cron/ingest-calendar/route";

const SOON = new Date(Date.now() + 86_400_000).toISOString();
const ev = (id: string, organizer?: string) => ({ id, summary: `Meeting ${id}`, start: SOON, organizer });
const run = () => GET(new Request("http://x/api/cron/ingest-calendar"), {} as never);
const sourceFor = (id: string) =>
  (h.intake.mock.calls.map((c) => c[0] as { key: string; source: string }).find((c) => c.key === `calendar_${id}`))?.source;

beforeEach(() => {
  vi.clearAllMocks();
  h.oauth.mockResolvedValue({ state: "healthy", email: "nour@example.com" });
});

describe("ingest-calendar - organizer decides the source", () => {
  it("an event organised by someone else is filed as calendar:external", async () => {
    h.listEvents.mockResolvedValueOnce([ev("a", "stranger@vendor.example")]);
    await run();
    expect(sourceFor("a")).toBe("calendar:external");
  });

  it("CONTROL - the connected account's own event stays calendar_cron (case-insensitive)", async () => {
    h.listEvents.mockResolvedValueOnce([ev("b", "Nour@Example.com")]);
    await run();
    expect(sourceFor("b")).toBe("calendar_cron");
  });

  it("fails closed: with no connected-account email, an organised event is external", async () => {
    h.oauth.mockResolvedValueOnce({ state: "healthy", email: null });
    h.listEvents.mockResolvedValueOnce([ev("c", "nour@example.com")]);
    await run();
    expect(sourceFor("c")).toBe("calendar:external");
  });
});
