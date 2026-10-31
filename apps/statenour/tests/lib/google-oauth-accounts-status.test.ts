/**
 * 08-F3 (consumer half, audit 2026-10-10): Google health covers EVERY account.
 *
 * getGoogleOauthStatus reads only the primary `google_oauth` row, so a dead
 * `google_oauth_personal` (ingest-gmail iterates it every 30 min) read
 * healthy on the digest and the status route. And lastSyncAt was stamped by
 * a token REFRESH, so "no sync in 7d" could never fire while refreshes worked.
 *
 * getGoogleOauthAccountsStatus: the worst account wins, its key is in the
 * reason. A refresh no longer touches lastSyncAt (ingest-gmail stamps it).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Row = Record<string, unknown> & { name: string };

const { db } = vi.hoisted(() => ({ db: { rows: new Map<string, Row>(), failFindMany: false } }));

vi.mock("@/lib/prisma", () => {
  const integration = (rows: () => Map<string, Row>) => ({
    findMany: async () => {
      if (db.failFindMany) throw new Error("connection refused");
      return [...rows().values()].filter((r) => r.name === "google_oauth" || r.name.startsWith("google_oauth_"));
    },
    findUnique: async ({ where }: { where: { name: string } }) => {
      const r = rows().get(where.name);
      return r ? { ...r } : null;
    },
    update: async ({ where, data }: { where: { name: string }; data: Record<string, unknown> }) => {
      const row = rows().get(where.name)!;
      Object.assign(row, data);
      return { ...row };
    },
  });
  return {
    prisma: {
      integration: integration(() => db.rows),
      $transaction: async (cb: (tx: unknown) => Promise<unknown>) =>
        cb({ $executeRaw: async () => 0, integration: integration(() => db.rows) }),
    },
  };
});

import { getAccessToken, getGoogleOauthAccountsStatus, listConfiguredAccounts } from "@/lib/services/google-oauth";
import { googleOauthHighlight } from "@/lib/system/health-digest";

const HOUR = 3_600_000;

function seed(name: string, over: Partial<Row> = {}) {
  db.rows.set(name, {
    name,
    status: "healthy",
    consecutiveFailures: 0,
    lastSyncAt: new Date(Date.now() - HOUR),
    config: { refreshToken: "r", scopes: [], email: `${name}@example.com`, grantedAt: new Date().toISOString() },
    ...over,
  });
}

beforeEach(() => {
  db.rows = new Map();
  db.failFindMany = false;
  vi.stubEnv("AUTH_GOOGLE_CLIENT_ID", "test-client-id");
  vi.stubEnv("AUTH_GOOGLE_CLIENT_SECRET", "test-client-secret");
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

// Calendar r2 W1 (2026-10-31 SELECT): google_oauth_personal held the SHOP's account, status failed,
// 63 refresh failures, and the daily Gmail ingest retried it twice per run. A failed row that is a
// copy of the shop's account is not a configured account; the grant card replaces it.
describe("listConfiguredAccounts · dead copy of the shop account", () => {
  it("leaves out a failed non-primary row that holds the shop's account", async () => {
    seed("google_oauth", { config: { refreshToken: "r", scopes: [], email: "shop@example.com", grantedAt: "x" } });
    seed("google_oauth_personal", { status: "failed", config: { refreshToken: "r", scopes: [], email: "Shop@example.com", grantedAt: "x" } });
    expect((await listConfiguredAccounts()).map((a) => a.accountKey)).toEqual(["primary"]);
  });

  it("still lists it when asked, so the calendar can name the wrong account", async () => {
    seed("google_oauth", { config: { refreshToken: "r", scopes: [], email: "shop@example.com", grantedAt: "x" } });
    seed("google_oauth_personal", { status: "failed", config: { refreshToken: "r", scopes: [], email: "shop@example.com", grantedAt: "x" } });
    const all = await listConfiguredAccounts({ includeDeadShopCopies: true });
    expect(all.map((a) => a.accountKey).sort()).toEqual(["personal", "primary"]);
  });

  it("CONTROL: a failed row on a DIFFERENT account stays listed (a real expired grant is not hidden)", async () => {
    seed("google_oauth", { config: { refreshToken: "r", scopes: [], email: "shop@example.com", grantedAt: "x" } });
    seed("google_oauth_personal", { status: "failed", config: { refreshToken: "r", scopes: [], email: "owner@example.com", grantedAt: "x" } });
    expect((await listConfiguredAccounts()).map((a) => a.accountKey).sort()).toEqual(["personal", "primary"]);
  });

  it("CONTROL: a healthy copy is not hidden by this rule (only a failed one is)", async () => {
    seed("google_oauth", { config: { refreshToken: "r", scopes: [], email: "shop@example.com", grantedAt: "x" } });
    seed("google_oauth_personal", { config: { refreshToken: "r", scopes: [], email: "shop@example.com", grantedAt: "x" } });
    expect((await listConfiguredAccounts()).map((a) => a.accountKey).sort()).toEqual(["personal", "primary"]);
  });
});

describe("getGoogleOauthAccountsStatus", () => {
  it("a dead non-primary account makes the whole read expired, naming the account", async () => {
    seed("google_oauth");
    seed("google_oauth_personal", { status: "failed", consecutiveFailures: 2 });
    const s = await getGoogleOauthAccountsStatus();
    expect(s.state).toBe("expired");
    expect(s.reason).toContain("personal");
    expect(s.accounts).toEqual([
      { key: "primary", state: "healthy" },
      { key: "personal", state: "expired" },
    ]);
  });

  it("an account with no ingest in 7 days is stale even while the primary is healthy", async () => {
    seed("google_oauth");
    seed("google_oauth_shop", { lastSyncAt: new Date(Date.now() - 9 * 24 * HOUR) });
    const s = await getGoogleOauthAccountsStatus();
    expect(s.state).toBe("stale");
    expect(s.reason).toContain("shop");
  });

  it("an unreadable table is probeFailed, never a claim about Google", async () => {
    db.failFindMany = true;
    const s = await getGoogleOauthAccountsStatus();
    expect(s.probeFailed).toBe(true);
    expect(s.state).not.toBe("healthy");
    expect(s.accounts).toEqual([]);
  });

  it("no primary row is missing, even when another account exists", async () => {
    seed("google_oauth_personal");
    const s = await getGoogleOauthAccountsStatus();
    expect(s.state).toBe("missing");
    expect(s.accounts).toContainEqual({ key: "primary", state: "missing" });
  });

  it("CONTROL: every account healthy reads healthy", async () => {
    seed("google_oauth");
    seed("google_oauth_personal");
    const s = await getGoogleOauthAccountsStatus();
    expect(s.state).toBe("healthy");
    expect(s.accounts.map((a) => a.state)).toEqual(["healthy", "healthy"]);
  });
});

describe("the digest highlight names the account to re-grant (consumer of the account key)", () => {
  it("a dead personal account links its own re-grant flow and says which account", async () => {
    seed("google_oauth");
    seed("google_oauth_personal", { status: "failed", consecutiveFailures: 2 });
    const hl = googleOauthHighlight(await getGoogleOauthAccountsStatus());
    expect(hl?.severity).toBe("critical");
    expect(hl?.headline).toContain("personal");
    expect(hl?.link).toBe("/api/oauth/google-data/start?account=personal");
  });

  it("CONTROL: a dead primary keeps the plain re-grant link and headline", async () => {
    seed("google_oauth", { status: "failed", consecutiveFailures: 1 });
    seed("google_oauth_personal");
    const hl = googleOauthHighlight(await getGoogleOauthAccountsStatus());
    expect(hl?.link).toBe("/api/oauth/google-data/start");
    expect(hl?.headline).not.toContain("personal");
  });
});

describe("a token refresh is not an ingest", () => {
  it("a successful refresh leaves lastSyncAt unchanged", async () => {
    const before = new Date(Date.now() - 9 * 24 * HOUR);
    seed("google_oauth_refreshonly", { lastSyncAt: before });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ access_token: "tok", expires_in: 3600 }), { status: 200 })),
    );
    await expect(getAccessToken("refreshonly")).resolves.toBe("tok");
    const row = db.rows.get("google_oauth_refreshonly")!;
    expect(row.lastSyncAt).toEqual(before);
    // positive control: the refresh DID write (status + cached token)
    expect((row.config as { accessToken?: string }).accessToken).toBe("tok");
  });
});
