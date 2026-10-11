/**
 * GET /api/oauth/google-data/status (audit 07-X4 + 08-F3, 2026-10-10).
 *
 *  - Owner-gated in the route itself (apiHandler auth "owner"); it relied on
 *    the proxy session gate alone.
 *  - Reads every Google account: a dead non-primary account is reported with
 *    its own re-grant link.
 *  - A failed status read is "unknown", never "missing" + "Set up Google
 *    OAuth" (which sent the operator to re-grant a working token).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ status: vi.fn() }));
vi.mock("@/lib/services/google-oauth", () => ({ getGoogleOauthAccountsStatus: h.status }));
vi.mock("@/lib/prisma", () => ({ prisma: {}, resetQueryCount: vi.fn(), getQueryCount: vi.fn(() => 0) }));

import { GET } from "@/app/api/oauth/google-data/status/route";
import { requireSession } from "@/lib/auth-guard";
import { ServiceError } from "@/lib/utils/service-error";

const get = async () => {
  const res = (await GET(new Request("https://x.test/api/oauth/google-data/status"), undefined as never)) as Response;
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
};

const base = { lastSyncAt: null, consecutiveFailures: 0, email: null };

beforeEach(() => {
  h.status.mockReset();
});

describe("GET /api/oauth/google-data/status", () => {
  it("no session: 401 and the status is never read", async () => {
    vi.mocked(requireSession).mockRejectedValueOnce(new ServiceError("Unauthorized", 401));
    const { status } = await get();
    expect(status).toBe(401);
    expect(h.status).not.toHaveBeenCalled();
  });

  it("a dead personal account: expired, with that account's re-grant link", async () => {
    h.status.mockResolvedValue({
      ...base,
      state: "expired",
      consecutiveFailures: 2,
      reason: "personal: Refresh failed 2x in a row",
      accounts: [{ key: "primary", state: "healthy" }, { key: "personal", state: "expired" }],
    });
    const { status, body } = await get();
    expect(status).toBe(200);
    expect(body.state).toBe("expired");
    expect(body.ctaHref).toBe("/api/oauth/google-data/start?account=personal");
    expect(body.accounts).toEqual([{ key: "primary", state: "healthy" }, { key: "personal", state: "expired" }]);
  });

  it("stale points at the real crons page, not a retired redirect", async () => {
    h.status.mockResolvedValue({ ...base, state: "stale", reason: "no sync in 9d", accounts: [{ key: "primary", state: "stale" }] });
    expect((await get()).body.ctaHref).toBe("/system/crons");
  });

  it("a failed status read is unknown, never 'missing' with a set-up CTA", async () => {
    h.status.mockResolvedValue({ ...base, state: "missing", reason: "Integration table unreadable", probeFailed: true, accounts: [] });
    const { body } = await get();
    expect(body.state).toBe("unknown");
    expect(body.ctaHref).toBeNull();
  });

  it("CONTROL: a genuinely unconfigured primary keeps the set-up CTA", async () => {
    h.status.mockResolvedValue({ ...base, state: "missing", reason: "not configured", accounts: [{ key: "primary", state: "missing" }] });
    const { body } = await get();
    expect(body.state).toBe("missing");
    expect(body.ctaHref).toBe("/api/oauth/google-data/start");
  });
});
