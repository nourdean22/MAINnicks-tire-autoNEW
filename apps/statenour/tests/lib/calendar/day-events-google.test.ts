import { afterEach, describe, expect, it, vi } from "vitest";

// The default (live) wiring of readCalendarWindow. Only the calendar-of-record slot is read: the
// legacy primary slot holds the shop's Google account, which is never Nour's calendar (2026-10-31
// SELECT: both rows held the shop account, the personal one dead since 06-29). The unit tests
// inject deps; this one does not, because the first typecheck caught the live account mapping
// returning `key` where `accountKey` was read.

const h = vi.hoisted(() => ({
  status: vi.fn(),
  configured: vi.fn(),
  token: vi.fn(async (k: string) => `tok-${k}`),
}));
vi.mock("@/lib/services/google-oauth", () => ({
  CALENDAR_ACCOUNT_KEY: "personal",
  getGoogleOauthAccountsStatus: h.status,
  listConfiguredAccounts: h.configured,
  getAccessToken: h.token,
}));

import { readCalendarWindow } from "@/lib/calendar/day-events";

afterEach(() => {
  vi.unstubAllGlobals();
  h.token.mockClear();
});

function stubGoogle() {
  const calls: Array<{ url: string; auth: string; method: string }> = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
    calls.push({ url, auth: (init.headers as Record<string, string>).Authorization, method: init.method ?? "GET" });
    const body = url.includes("/calendarList")
      ? { items: [{ id: "primary", primary: true }] }
      : { items: [{ id: `e-${calls.length}`, status: "confirmed", summary: "x", start: { dateTime: "2026-10-30T14:00:00Z" }, end: { dateTime: "2026-10-30T15:00:00Z" } }] };
    return new Response(JSON.stringify(body), { status: 200 });
  }));
  return calls;
}

const both = {
  probeFailed: false,
  accounts: [
    { key: "primary", state: "healthy" },
    { key: "personal", state: "stale" },
  ],
};

describe("readCalendarWindow · live Google wiring", () => {
  it("reads only the calendar-of-record account, GET only, never the shop's primary slot", async () => {
    h.status.mockResolvedValue(both);
    h.configured.mockResolvedValue([
      { accountKey: "primary", integrationName: "google_oauth", email: "shop@example.com" },
      { accountKey: "personal", integrationName: "google_oauth_personal", email: "owner@example.com" },
    ]);
    const calls = stubGoogle();

    const r = await readCalendarWindow(new Date("2026-10-30T04:00:00Z"), new Date("2026-10-31T04:00:00Z"));

    expect(r.state).toBe("ok");
    expect(new Set(h.token.mock.calls.map((c) => c[0]))).toEqual(new Set(["personal"]));
    expect(new Set(calls.map((c) => c.method))).toEqual(new Set(["GET"]));
    expect(calls.every((c) => c.auth === "Bearer tok-personal")).toBe(true);
    if (r.state === "ok") expect(r.sources).toEqual({ accounts: 1, calendars: 1 });
  });

  it("a record slot granted with the shop's account is not_connected (shop_account), and Google is never called", async () => {
    h.status.mockResolvedValue(both);
    h.configured.mockResolvedValue([
      { accountKey: "primary", integrationName: "google_oauth", email: "shop@example.com" },
      { accountKey: "personal", integrationName: "google_oauth_personal", email: "Shop@Example.com" },
    ]);
    const calls = stubGoogle();

    const r = await readCalendarWindow(new Date(), new Date(Date.now() + 86_400_000));

    expect(r).toEqual({ state: "not_connected", reason: "shop_account" });
    expect(calls).toHaveLength(0);
    // The dead copy is hidden from Gmail ingest; the calendar must ask for it or it cannot name it.
    expect(h.configured).toHaveBeenCalledWith({ includeDeadShopCopies: true });
  });

  it("only the shop's primary slot granted is not_connected, not the shop's events", async () => {
    h.status.mockResolvedValue({ probeFailed: false, accounts: [{ key: "primary", state: "healthy" }] });
    h.configured.mockResolvedValue([{ accountKey: "primary", integrationName: "google_oauth", email: "shop@example.com" }]);
    const calls = stubGoogle();

    const r = await readCalendarWindow(new Date(), new Date(Date.now() + 86_400_000));

    expect(r.state).toBe("not_connected");
    expect(calls).toHaveLength(0);
  });

  it("an expired record slot is expired, even while the shop slot is healthy", async () => {
    h.status.mockResolvedValue({ probeFailed: false, accounts: [{ key: "primary", state: "healthy" }, { key: "personal", state: "expired" }] });
    h.configured.mockResolvedValue([
      { accountKey: "primary", integrationName: "google_oauth", email: "shop@example.com" },
      { accountKey: "personal", integrationName: "google_oauth_personal", email: "owner@example.com" },
    ]);
    const r = await readCalendarWindow(new Date(), new Date(Date.now() + 86_400_000));
    expect(r).toEqual({ state: "expired", accounts: ["personal"] });
  });

  it("a 403 from Google is read_failed, not an empty day", async () => {
    h.status.mockResolvedValue(both);
    h.configured.mockResolvedValue([{ accountKey: "personal", integrationName: "google_oauth_personal", email: "owner@example.com" }]);
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 403 })));
    const r = await readCalendarWindow(new Date(), new Date(Date.now() + 86_400_000));
    expect(r.state).toBe("read_failed");
  });

  it("an unreadable integration table is read_failed, not not_connected", async () => {
    h.status.mockResolvedValue({ probeFailed: true, reason: "db down", accounts: [] });
    h.configured.mockResolvedValue([]);
    const r = await readCalendarWindow(new Date(), new Date(Date.now() + 86_400_000));
    expect(r.state).toBe("read_failed");
  });
});
