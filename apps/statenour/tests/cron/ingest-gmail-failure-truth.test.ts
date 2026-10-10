/**
 * 08-F3 (ingest half): ingest-gmail must not file a dead run as green.
 *
 * 1. Every configured account erroring (the dead-token shape: each Gmail listing
 *    throws "Google refresh failed") used to return a normal totals object, so
 *    cron_job_logs said success. It now returns `ok: false`, which logCronRun
 *    files as a failed row.
 * 2. listConfiguredAccounts swallowed a DB error into `[]`, so an unreadable
 *    integrations table came back as `skipped: true, configuredAccounts: 0`:
 *    "not configured", blaming a grant that was fine. It now throws.
 *
 * Real google-oauth module; Prisma and the Gmail API are faked.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/utils/http", () => ({
  cronHandler: (h: (req: Request, ctx: unknown) => Promise<unknown>) => h,
}));
vi.mock("@/lib/brain/memory-manager", () => ({ brainMemory: { remember: vi.fn().mockResolvedValue({}) } }));
vi.mock("@/lib/ai/email-classifier", () => ({ classifyEmail: vi.fn() }));
vi.mock("@/lib/services/telegram", () => ({ sendTelegram: vi.fn() }));

const { listMessages, integrationFindMany } = vi.hoisted(() => ({
  listMessages: vi.fn(),
  integrationFindMany: vi.fn(),
}));
vi.mock("@/lib/services/gmail-api", () => ({ listMessages, getMessage: vi.fn() }));

vi.mock("@/lib/prisma", () => {
  const generic = () => ({
    findFirst: vi.fn().mockResolvedValue(null),
    findMany: vi.fn().mockResolvedValue([]),
    create: vi.fn().mockResolvedValue({}),
  });
  return {
    prisma: new Proxy(
      {},
      {
        get: (_t, prop: string) =>
          prop === "integration" ? { findMany: (...a: unknown[]) => integrationFindMany(...a) } : generic(),
      },
    ),
  };
});

const ACCOUNTS = [
  { name: "google_oauth", config: { refreshToken: "r1", email: "a@example.com" } },
  { name: "google_oauth_personal", config: { refreshToken: "r2", email: "b@example.com" } },
];

async function runRoute() {
  vi.resetModules();
  const { GET } = await import("@/app/api/cron/ingest-gmail/route");
  return (await GET(new Request("http://x/api/cron/ingest-gmail"), {} as never)) as Record<string, unknown>;
}

beforeEach(() => {
  listMessages.mockReset();
  integrationFindMany.mockReset();
  integrationFindMany.mockResolvedValue(ACCOUNTS);
});

describe("ingest-gmail: a run where nothing worked is a failure", () => {
  it("returns ok:false when every account errors", async () => {
    listMessages.mockRejectedValue(new Error('Google refresh failed for "primary": 400 invalid_grant'));

    const out = await runRoute();

    expect(out.ok).toBe(false);
    expect(String(out.reason)).toMatch(/every Gmail account failed/);
    expect(String(out.reason)).toMatch(/invalid_grant/);
  });

  it("stays a normal run when only one of two accounts errors", async () => {
    listMessages.mockImplementation(async (_q: string, _n: number, accountKey: string) => {
      if (accountKey === "primary") throw new Error("Google refresh failed");
      return [];
    });

    const out = await runRoute();

    expect(out.ok).toBeUndefined();
    expect(out.accounts).toBe(2);
  });

  it("stays a normal run when every account is reachable but has no mail", async () => {
    listMessages.mockResolvedValue([]);

    const out = await runRoute();

    expect(out.ok).toBeUndefined();
    expect(out.errorCount).toBe(0);
  });
});

describe("ingest-gmail: an unreadable integrations table is not 'not configured'", () => {
  it("throws instead of reporting skipped / configuredAccounts: 0", async () => {
    integrationFindMany.mockRejectedValue(new Error("Connection terminated unexpectedly"));

    await expect(runRoute()).rejects.toThrow(/Connection terminated/);
  });

  it("still skips cleanly when the table is readable and holds no account", async () => {
    integrationFindMany.mockResolvedValue([]);

    const out = await runRoute();

    expect(out).toMatchObject({ skipped: true, configuredAccounts: 0 });
  });
});
