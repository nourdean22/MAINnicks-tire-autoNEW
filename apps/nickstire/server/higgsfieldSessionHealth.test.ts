/**
 * higgsfieldSessionHealth.test.ts · 2026-08-03
 *
 * Every Higgsfield credential check in this codebase is PRESENCE-only:
 * getHiggsfieldCredentialsJson returns the stored blob without parsing it, so an
 * expired session is byte-indistinguishable from a live one. The session expired
 * on 2026-07-31 and socialDeliveryIssues went on reporting generatorConfigured:
 * true while every render died at the CLI.
 *
 * Liveness was already being measured — higgsfield-session-keepalive runs every
 * 15 minutes and THROWS on an invalid session, so its verdict lands in cron_log.
 * Nothing read it. These tests pin the reader, and specifically pin the two ways
 * it must refuse to answer rather than guess.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

const MINUTE = 60_000;

/**
 * Serial vitest shares one process, so the db mock and module registry are torn
 * down after every case or the next file inherits them.
 */
afterEach(() => {
  vi.doUnmock("./lib/db-helper");
  vi.resetModules();
  vi.useRealTimers();
});

function mockKeepaliveRow(row: Record<string, unknown> | null) {
  vi.doMock("./lib/db-helper", () => ({
    db: async () => ({
      select: () => ({
        from: () => ({
          where: () => ({
            orderBy: () => ({
              limit: async () => (row ? [row] : []),
            }),
          }),
        }),
      }),
    }),
  }));
  vi.resetModules();
}

async function health() {
  const { higgsfieldSessionHealth } = await import("./services/higgsfieldStudio");
  return higgsfieldSessionHealth();
}

describe("higgsfieldSessionHealth · reads the keepalive's verdict", () => {
  it("reports healthy when the most recent keepalive completed", async () => {
    mockKeepaliveRow({ status: "completed", startedAt: new Date(Date.now() - 5 * MINUTE), errorMessage: null });

    expect(await health()).toMatchObject({ healthy: true });
  });

  it("reports UNHEALTHY when the most recent keepalive failed", async () => {
    mockKeepaliveRow({
      status: "failed",
      startedAt: new Date(Date.now() - 5 * MINUTE),
      errorMessage: "Higgsfield keepalive FAILED — re-login required (refresh token revoked).",
    });

    const result = await health();

    expect(result.healthy).toBe(false);
    // The operator needs to know it is a re-login, not a transient blip.
    expect(result.reason).toContain("re-login required");
  });
});

describe("higgsfieldSessionHealth · refuses to answer rather than guess", () => {
  /**
   * The blind spot that cost four days. A stale PASS is not evidence: if the
   * keepalive itself stopped running, its last "completed" describes a world
   * that may no longer exist. That is a different fault from an expired session,
   * and reporting it as healthy is how 526 consecutive failures went unnoticed.
   */
  it("returns unknown — not healthy — when the last verdict is too old to vouch for", async () => {
    mockKeepaliveRow({ status: "completed", startedAt: new Date(Date.now() - 3 * 60 * MINUTE), errorMessage: null });

    const result = await health();

    expect(result.healthy).toBeNull();
    expect(result.reason).toContain("too long ago");
  });

  it("returns unknown when the keepalive has never run", async () => {
    mockKeepaliveRow(null);

    expect(await health()).toMatchObject({ healthy: null });
  });

  it("returns unknown when the database is unavailable", async () => {
    vi.doMock("./lib/db-helper", () => ({ db: async () => null }));
    vi.resetModules();

    expect(await health()).toMatchObject({ healthy: null });
  });

  it("returns unknown — never a clean bill — when the query throws", async () => {
    vi.doMock("./lib/db-helper", () => ({
      db: async () => {
        throw new Error("ER_ACCESS_DENIED");
      },
    }));
    vi.resetModules();

    const result = await health();

    // The direction matters: a read failure must not become "session is fine".
    expect(result.healthy).toBeNull();
    expect(result.healthy).not.toBe(true);
  });

  it("treats a fresh failure as unhealthy but a stale failure as unknown", async () => {
    mockKeepaliveRow({ status: "failed", startedAt: new Date(Date.now() - 5 * MINUTE), errorMessage: "revoked" });
    expect((await health()).healthy).toBe(false);

    mockKeepaliveRow({ status: "failed", startedAt: new Date(Date.now() - 5 * 60 * MINUTE), errorMessage: "revoked" });
    expect((await health()).healthy).toBeNull();
  });
});
