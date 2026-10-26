/**
 * A vitest run must never reach the real Telegram bot.
 *
 * 2026-10-26: a local run paged Nour with "MEMORY 233% 1191MB/512MB heap" and a fixture
 * "Follow-Up Report: 1 sent · 1 queued · 4 failed". apps/nickstire/.env (copied into every
 * worktree) carries TELEGRAM_BOT_TOKEN, and railway run injects it too, so any real code path that
 * reaches sendTelegram posted to api.telegram.org. The fix is vitest.config.ts `test.env`; these
 * tests drive the real path that leaked and fail if a token ever reaches the test process (the
 * follow-up report path was deleted on main by PR 3294, so its two cases went with it).
 *
 * Each "blocked" case has a positive control: the same path DOES fetch Telegram once the test
 * itself supplies a token, so a green "no fetch" is not a path that never ran.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../db", () => ({ getDb: async () => null }));
vi.mock("../sms", () => ({ sendSms: vi.fn(), thankYouSms: () => "thanks" }));
// receipt class is held unless this flag is on; incident is sent unless its mute flag is on.
vi.mock("../services/featureFlags", () => ({ isEnabled: async (k: string) => k === "telegram_receipt" }));
// notifyOwner returns false on a log-only fallback: that is the branch that falls through to Telegram.
vi.mock("../_core/notification", () => ({ notifyOwner: async () => false }));

const fetchMock = vi.fn(async (..._a: unknown[]) => new Response(JSON.stringify({ ok: true }), { status: 200 }));

function telegramCalls(): string[] {
  return fetchMock.mock.calls.map((c) => String(c[0])).filter((u) => u.includes("api.telegram.org"));
}

async function flush(): Promise<void> {
  await vi.dynamicImportSettled();
  await new Promise((r) => setTimeout(r, 20));
  await vi.dynamicImportSettled();
}

beforeEach(() => {
  fetchMock.mockClear();
  vi.stubGlobal("fetch", fetchMock);
  vi.resetModules();
});
afterEach(() => {
  vi.restoreAllMocks();
  // singleFork: a stubbed fetch or env left behind here reaches the next test file (telegramClassMute went 11 red).
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("the vitest process carries no Telegram credentials", () => {
  it("TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID are empty, whatever the parent shell or .env held", () => {
    expect(process.env.TELEGRAM_BOT_TOKEN ?? "").toBe("");
    expect(process.env.TELEGRAM_CHAT_ID ?? "").toBe("");
  });
});

describe("health handler memory alert", () => {
  function forceHeapOver80PercentOf512() {
    vi.stubEnv("NODE_OPTIONS", "");
    const base = process.memoryUsage();
    const mb = 1024 * 1024;
    vi.spyOn(process, "memoryUsage").mockImplementation((() => ({
      ...base,
      heapUsed: 450 * mb,
      heapTotal: 480 * mb,
      rss: 600 * mb,
    })) as unknown as typeof process.memoryUsage);
  }

  async function runHealth(): Promise<Record<string, any>> {
    const { healthHandler } = await import("../lib/health");
    let body: Record<string, any> = {};
    const res = { status: () => res, json: (b: Record<string, any>) => { body = b; return res; } } as any;
    await healthHandler({} as any, res);
    await flush();
    return body;
  }

  it("does not reach api.telegram.org from a test run", async () => {
    forceHeapOver80PercentOf512();
    const body = await runHealth();
    expect(body.memory.percent).toBeGreaterThanOrEqual(80);
    expect(telegramCalls()).toEqual([]);
  }, 30_000);

  it("positive control: with a token supplied by the test, the same alert does fetch Telegram", async () => {
    forceHeapOver80PercentOf512();
    vi.stubEnv("TELEGRAM_BOT_TOKEN", "control-token");
    vi.stubEnv("TELEGRAM_CHAT_ID", "control-chat");
    const body = await runHealth();
    expect(body.memory.percent).toBeGreaterThanOrEqual(80);
    expect(telegramCalls().length).toBeGreaterThan(0);
    // a local process must never read as production
    const sent = JSON.parse(String((fetchMock.mock.calls[0][1] as { body: string }).body)).text as string;
    expect(sent).toContain("[local] MEMORY");
  }, 30_000);
});
