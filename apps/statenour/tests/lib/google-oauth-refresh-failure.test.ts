/**
 * 08-F3: a failed Google refresh must leave the integration `failed`.
 *
 * The `failed` write used to sit INSIDE getAccessToken's `$transaction`, right
 * before the throw that rolled the transaction back. The row kept reading
 * "healthy", so getGoogleOauthStatus (which branches on that write) reported
 * Gmail/Calendar healthy while every refresh was rejected.
 *
 * A plain mock that records `tx.integration.update` cannot see this: it records
 * the write either way. The fake below has the one property that matters, real
 * transaction semantics: writes made through `tx` are staged and committed only
 * when the callback resolves; a throw discards them.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Row = Record<string, unknown> & { name: string };

const { db } = vi.hoisted(() => ({ db: { rows: new Map<string, Row>() } }));

function applyUpdate(rows: Map<string, Row>, args: { where: { name: string }; data: Record<string, unknown> }) {
  const row = rows.get(args.where.name);
  if (!row) throw Object.assign(new Error("Record to update not found."), { code: "P2025" });
  for (const [k, v] of Object.entries(args.data)) {
    const inc = (v as { increment?: number } | null)?.increment;
    row[k] = typeof inc === "number" ? Number(row[k] ?? 0) + inc : v;
  }
  return { ...row };
}

function cloneRows(rows: Map<string, Row>): Map<string, Row> {
  return new Map([...rows].map(([k, r]) => [k, { ...r }]));
}

vi.mock("@/lib/prisma", () => {
  const integration = (rows: () => Map<string, Row>) => ({
    findUnique: async ({ where }: { where: { name: string } }) => {
      const r = rows().get(where.name);
      return r ? { ...r } : null;
    },
    update: async (args: { where: { name: string }; data: Record<string, unknown> }) => applyUpdate(rows(), args),
  });
  return {
    prisma: {
      integration: integration(() => db.rows),
      $transaction: async (cb: (tx: unknown) => Promise<unknown>) => {
        const staged = cloneRows(db.rows);
        const tx = { $executeRaw: async () => 0, integration: integration(() => staged) };
        const out = await cb(tx); // a throw here discards `staged`: rollback
        db.rows = staged; // commit
        return out;
      },
    },
  };
});

import { getAccessToken, getGoogleOauthStatus } from "@/lib/services/google-oauth";

function seed(name: string) {
  db.rows.set(name, {
    name,
    status: "healthy",
    errorCount: 0,
    consecutiveFailures: 0,
    lastSyncAt: new Date(),
    config: { refreshToken: "test-refresh", scopes: [], grantedAt: new Date().toISOString() },
  });
}

beforeEach(() => {
  db.rows = new Map();
  vi.stubEnv("AUTH_GOOGLE_CLIENT_ID", "test-client-id");
  vi.stubEnv("AUTH_GOOGLE_CLIENT_SECRET", "test-client-secret");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("getAccessToken: a rejected refresh survives the rollback", () => {
  it("a 400 invalid_grant leaves status failed, and getGoogleOauthStatus reports expired", async () => {
    seed("google_oauth");
    vi.stubGlobal("fetch", vi.fn(async () => new Response('{"error":"invalid_grant"}', { status: 400 })));

    await expect(getAccessToken("primary")).rejects.toThrow(/Google refresh failed/);

    const row = db.rows.get("google_oauth")!;
    expect(row.status).toBe("failed");
    expect(row.consecutiveFailures).toBe(1);
    expect(row.errorCount).toBe(1);
    const status = await getGoogleOauthStatus();
    expect(status.state).toBe("expired");
  });

  it("a 401 invalid_client is a rejected grant too: status failed", async () => {
    seed("google_oauth");
    vi.stubGlobal("fetch", vi.fn(async () => new Response('{"error":"invalid_client"}', { status: 401 })));

    await expect(getAccessToken("primary")).rejects.toThrow(/Google refresh failed/);

    expect(db.rows.get("google_oauth")!.status).toBe("failed");
  });

  it("positive control: the fake commits a successful refresh (it does not just drop every tx write)", async () => {
    seed("google_oauth_personal");
    db.rows.get("google_oauth_personal")!.status = "failed";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ access_token: "tok", expires_in: 3600 }), { status: 200 })),
    );

    await expect(getAccessToken("personal")).resolves.toBe("tok");

    expect(db.rows.get("google_oauth_personal")!.status).toBe("healthy");
  });
});

/**
 * 2026-10-10 hostile review: once the `failed` write survived the rollback,
 * EVERY non-2xx refresh landed it, so a Google 503 or 429 read as "expired:
 * re-grant access" (a critical alert, and the calendar ingest skips) for a
 * grant that was fine. A transient error keeps the prior status and is only
 * counted; consecutiveFailures is left alone too (>= 3 also maps to expired).
 */
describe("getAccessToken: a transient refresh error is not a broken grant", () => {
  for (const status of [503, 500, 429]) {
    it(`a ${status} keeps the integration healthy, counts the error, and does not read as expired`, async () => {
      seed("google_oauth");
      vi.stubGlobal("fetch", vi.fn(async () => new Response("upstream trouble", { status })));

      await expect(getAccessToken("primary")).rejects.toThrow(/Google refresh failed/);

      const row = db.rows.get("google_oauth")!;
      expect(row.status).toBe("healthy");
      expect(row.consecutiveFailures).toBe(0);
      expect(row.errorCount).toBe(1);
      expect((await getGoogleOauthStatus()).state).not.toBe("expired");
    });
  }

  it("a network error (fetch throws) keeps the integration healthy and counts the error", async () => {
    seed("google_oauth");
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new TypeError("fetch failed");
    }));

    await expect(getAccessToken("primary")).rejects.toThrow(/fetch failed/);

    const row = db.rows.get("google_oauth")!;
    expect(row.status).toBe("healthy");
    expect(row.errorCount).toBe(1);
  });

  it("a transient error does not clear an earlier rejection: a failed row stays failed", async () => {
    seed("google_oauth");
    db.rows.get("google_oauth")!.status = "failed";
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 503 })));

    await expect(getAccessToken("primary")).rejects.toThrow();

    expect(db.rows.get("google_oauth")!.status).toBe("failed");
  });
});
