/**
 * tests/security/integrations-secret-exposure.test.ts
 * 2026-09-02 deep-research audit · finding C-1
 *
 * GET /api/integrations paginated the raw Prisma model with no `select`, so
 * every column shipped to the client — and `config` is where
 * lib/services/google-oauth.ts stores the Google REFRESH TOKEN in cleartext.
 * Owner-gated, so not an anonymous leak; but a long-lived credential in an
 * HTTP response is in browser memory, devtools, any saved HAR, and within
 * reach of a client-side error reporter (Sentry went live the same morning).
 *
 * The subject under test is the ROUTE'S RESPONSE BODY, not the shape of the
 * select object. A test that asserted "the handler passes a select" would
 * pass while a future `select` still included `config`; this one reads what
 * the operator's browser would actually receive and looks for the secret.
 *
 * Canary discipline (guard-red-team): the negative case is paired with a
 * positive control — the same response MUST still carry the non-secret
 * fields and the derived `configKeys`, so a handler that returned `{}` for
 * everything would fail rather than trivially "pass" the secret check.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const REFRESH_TOKEN = "1//0gFAKE-refresh-token-value-do-not-ship";
const ACCESS_TOKEN = "ya29.FAKE-access-token-value";

const findMany = vi.fn();
const count = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    integration: {
      findMany: (...args: unknown[]) => findMany(...args),
      count: (...args: unknown[]) => count(...args),
    },
  },
  // apiHandler's query-count instrumentation lives in the same module.
  resetQueryCount: () => {},
  getQueryCount: () => 0,
  checkDbConnection: async () => ({ connected: true, latency_ms: 0 }),
}));

const GOOGLE_ROW = {
  id: "int_1",
  name: "google-data:primary",
  type: "oauth",
  enabled: true,
  status: "healthy",
  lastSyncAt: new Date("2026-09-01T10:00:00Z"),
  nextSyncAt: null,
  healthCheckUrl: null,
  errorCount: 0,
  consecutiveFailures: 0,
  createdAt: new Date("2026-08-01T10:00:00Z"),
  updatedAt: new Date("2026-09-01T10:00:00Z"),
  config: {
    refreshToken: REFRESH_TOKEN,
    accessToken: ACCESS_TOKEN,
    scopes: ["https://www.googleapis.com/auth/gmail.readonly"],
    email: "operator@example.com",
    grantedAt: "2026-08-01T10:00:00.000Z",
    accessTokenExpiresAt: 1_756_000_000_000,
  },
};

async function callRoute(): Promise<{ status: number; text: string; json: any }> {
  const { GET } = await import("@/app/api/integrations/route");
  const res = (await GET(
    new Request("http://localhost/api/integrations"),
    { params: Promise.resolve({}) } as never,
  )) as Response;
  const text = await res.text();
  return { status: res.status, text, json: JSON.parse(text) };
}

describe("GET /api/integrations · OAuth secrets never reach the response body", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    findMany.mockResolvedValue([GOOGLE_ROW]);
    count.mockResolvedValue(1);
  });

  it("does not emit the refresh token, the access token, or the raw config blob", async () => {
    const { status, text, json } = await callRoute();

    expect(status).toBe(200);
    // The whole serialized payload — not a field-by-field walk, so a token
    // nested anywhere new (metadata, a debug echo) still fails this test.
    expect(text).not.toContain(REFRESH_TOKEN);
    expect(text).not.toContain(ACCESS_TOKEN);
    // Deliberately NOT asserting the absence of the string "refreshToken":
    // `configKeys` publishes key NAMES on purpose, so that assertion would
    // contradict the design one test below. The subject here is the VALUE.

    const rows = json?.data?.data ?? json?.data ?? [];
    expect(Array.isArray(rows)).toBe(true);
    expect(rows).toHaveLength(1);
    expect(rows[0]).not.toHaveProperty("config");
  });

  it("positive control · the row is still useful: identity, health, and the config KEY NAMES survive", async () => {
    const { json } = await callRoute();
    const rows = json?.data?.data ?? json?.data ?? [];
    const row = rows[0];

    // If this half fails, the route has been "secured" by returning nothing,
    // which would make the assertion above meaningless.
    expect(row.name).toBe("google-data:primary");
    expect(row.status).toBe("healthy");
    expect(row.hasConfig).toBe(true);
    // Key NAMES answer "is a refresh token stored?" without shipping it.
    expect(row.configKeys).toContain("refreshToken");
    expect(row.configKeys).toContain("scopes");
  });

  it("an integration with no config reports hasConfig false and an empty key list", async () => {
    findMany.mockResolvedValue([{ ...GOOGLE_ROW, id: "int_2", name: "tavily", config: null }]);
    const { json } = await callRoute();
    const rows = json?.data?.data ?? json?.data ?? [];
    expect(rows[0].hasConfig).toBe(false);
    expect(rows[0].configKeys).toEqual([]);
  });
});
