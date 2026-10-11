/**
 * 08-F3 (writer half, audit 2026-10-10): lastSyncAt means "ingest fetched".
 *
 * The token refresh used to stamp Integration.lastSyncAt, so the 7-day
 * "stale" check in getGoogleOauthAccountsStatus could never fire while
 * refreshes worked. ingest-gmail now stamps it per account whose Gmail
 * listing answered, and never for an account whose fetch failed.
 *
 * Real google-oauth module; Prisma and the Gmail API are faked (same shape as
 * ingest-gmail-failure-truth.test.ts).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/utils/http", () => ({
  cronHandler: (h: (req: Request, ctx: unknown) => Promise<unknown>) => h,
}));
vi.mock("@/lib/brain/memory-manager", () => ({ brainMemory: { remember: vi.fn().mockResolvedValue({}) } }));
vi.mock("@/lib/ai/email-classifier", () => ({ classifyEmail: vi.fn() }));
vi.mock("@/lib/services/telegram", () => ({ sendTelegram: vi.fn() }));

const { listMessages, integrationUpdate } = vi.hoisted(() => ({
  listMessages: vi.fn(),
  integrationUpdate: vi.fn(),
}));
vi.mock("@/lib/services/gmail-api", () => ({ listMessages, getMessage: vi.fn() }));

vi.mock("@/lib/prisma", () => {
  const generic = () => ({
    findFirst: vi.fn().mockResolvedValue(null),
    findMany: vi.fn().mockResolvedValue([]),
    create: vi.fn().mockResolvedValue({}),
  });
  const accounts = [
    { name: "google_oauth", config: { refreshToken: "r1", email: "a@example.com" } },
    { name: "google_oauth_personal", config: { refreshToken: "r2", email: "b@example.com" } },
  ];
  return {
    prisma: new Proxy(
      {},
      {
        get: (_t, prop: string) =>
          prop === "integration"
            ? { findMany: async () => accounts, update: (...a: unknown[]) => integrationUpdate(...a) }
            : generic(),
      },
    ),
  };
});

async function runRoute() {
  const { GET } = await import("@/app/api/cron/ingest-gmail/route");
  return (await GET(new Request("http://x/api/cron/ingest-gmail"), {} as never)) as Record<string, unknown>;
}

const stamped = () =>
  integrationUpdate.mock.calls
    .filter((c) => (c[0] as { data?: { lastSyncAt?: unknown } }).data?.lastSyncAt instanceof Date)
    .map((c) => (c[0] as { where: { name: string } }).where.name);

beforeEach(() => {
  listMessages.mockReset();
  integrationUpdate.mockReset().mockResolvedValue({});
});

describe("ingest-gmail stamps lastSyncAt only for accounts it fetched", () => {
  it("the account that fetched is stamped; the one whose listing failed is not", async () => {
    listMessages.mockImplementation(async (_q: string, _n: number, accountKey: string) => {
      if (accountKey === "personal") throw new Error('Google refresh failed for "personal": 400 invalid_grant');
      return [];
    });
    await runRoute();
    expect(stamped()).toEqual(["google_oauth"]);
  });

  it("a failed stamp does not fail the run", async () => {
    listMessages.mockResolvedValue([]);
    integrationUpdate.mockRejectedValue(new Error("db down"));
    const out = await runRoute();
    expect(out.ok).not.toBe(false);
  });

  it("CONTROL: every account fetching stamps every account", async () => {
    listMessages.mockResolvedValue([]);
    await runRoute();
    expect(stamped().sort()).toEqual(["google_oauth", "google_oauth_personal"]);
  });
});
