/**
 * tests/lib/system/capability-health.test.ts · 2026-10-02 · full-circle Lane A
 *
 * The durable receipt behind the Owner Panel's `capability_degraded` row.
 * Pinned: a first failure creates a healthy row that remembers its error and
 * its first-failure time; the Nth consecutive failure flips it to degraded
 * without losing that time; rows another integration owns, or the operator
 * disabled, are never touched; a dead database is a warn log, not the caller's
 * error; a degraded tool in a hot loop does not become a hot loop against the
 * database; the first success after a streak resets it and costs no query
 * afterwards until the next failure.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findUnique: vi.fn(),
  upsert: vi.fn(),
  update: vi.fn(),
  warn: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    integration: {
      findUnique: (...a: unknown[]) => mocks.findUnique(...a),
      upsert: (...a: unknown[]) => mocks.upsert(...a),
      update: (...a: unknown[]) => mocks.update(...a),
    },
  },
}));

vi.mock("@/lib/logger", () => ({
  logger: {
    withSurface: () => ({
      warn: (...a: unknown[]) => mocks.warn(...a),
      info: vi.fn(),
      debug: vi.fn(),
      error: vi.fn(),
    }),
  },
}));

import {
  CAPABILITY_DEGRADED_AFTER,
  CAPABILITY_INTEGRATION_TYPE,
  CAPABILITY_WRITE_THROTTLE_MS,
  __resetCapabilityHealthMemory,
  recordCapabilityFailure,
  recordCapabilityRecovery,
} from "@/lib/system/capability-health";

const at = new Date("2026-10-02T10:16:36Z");

const failure = (over: Record<string, unknown> = {}) => ({
  toolName: "firecrawl-scrape",
  category: "unknown",
  error: "Insufficient credits to perform this request.",
  at,
  ...over,
});

const row = (over: Record<string, unknown> = {}) => ({
  type: CAPABILITY_INTEGRATION_TYPE,
  status: "healthy",
  enabled: true,
  consecutiveFailures: 0,
  metadata: null as unknown,
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("DATABASE_URL", "postgresql://unit-test@localhost:5432/receipts");
  __resetCapabilityHealthMemory();
  mocks.findUnique.mockResolvedValue(null);
  mocks.upsert.mockResolvedValue({});
  mocks.update.mockResolvedValue({});
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("without a connection string", () => {
  it("attempts nothing and throws nothing — there is no database to write to", async () => {
    vi.stubEnv("DATABASE_URL", "");
    await recordCapabilityFailure(failure());
    await recordCapabilityRecovery("firecrawl-scrape");
    expect(mocks.findUnique).not.toHaveBeenCalled();
    expect(mocks.upsert).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
  });
});

describe("recordCapabilityFailure", () => {
  it("first failure creates a healthy capability row with the error, its class and the first-failure time", async () => {
    await recordCapabilityFailure(failure());
    expect(mocks.upsert).toHaveBeenCalledOnce();
    const arg = mocks.upsert.mock.calls[0][0];
    expect(arg.where).toEqual({ name: "firecrawl-scrape" });
    expect(arg.create).toMatchObject({
      name: "firecrawl-scrape",
      type: "capability",
      enabled: true,
      status: "healthy",
      errorCount: 1,
      consecutiveFailures: 1,
    });
    expect(arg.create.metadata).toMatchObject({
      source: "guardian",
      lastCategory: "unknown",
      lastError: "Insufficient credits to perform this request.",
      firstFailureAt: at.toISOString(),
      lastFailureAt: at.toISOString(),
    });
    expect(arg.update).toMatchObject({
      status: "healthy",
      errorCount: { increment: 1 },
      consecutiveFailures: { increment: 1 },
    });
  });

  it(`the ${CAPABILITY_DEGRADED_AFTER}th consecutive failure flips the row to degraded and keeps the first-failure time`, async () => {
    mocks.findUnique.mockResolvedValue(
      row({
        consecutiveFailures: CAPABILITY_DEGRADED_AFTER - 1,
        metadata: { firstFailureAt: "2026-10-01T18:03:11.000Z", lastError: "old text" },
      }),
    );
    await recordCapabilityFailure(failure());
    const arg = mocks.upsert.mock.calls[0][0];
    expect(arg.update.status).toBe("degraded");
    expect(arg.update.metadata.firstFailureAt).toBe("2026-10-01T18:03:11.000Z");
    expect(arg.update.metadata.lastError).toBe("Insufficient credits to perform this request.");
  });

  it("a streak that was reset starts a new first-failure time", async () => {
    mocks.findUnique.mockResolvedValue(
      row({ consecutiveFailures: 0, metadata: { firstFailureAt: "2026-09-01T00:00:00.000Z" } }),
    );
    await recordCapabilityFailure(failure());
    expect(mocks.upsert.mock.calls[0][0].update.metadata.firstFailureAt).toBe(at.toISOString());
  });

  it("never touches a row another integration owns, nor one the operator disabled", async () => {
    mocks.findUnique.mockResolvedValue(row({ type: "api" }));
    await recordCapabilityFailure(failure({ toolName: "google" }));
    mocks.findUnique.mockResolvedValue(row({ enabled: false }));
    await recordCapabilityFailure(failure());
    expect(mocks.upsert).not.toHaveBeenCalled();
  });

  it("while degraded, failures inside the throttle window do not reach the database", async () => {
    mocks.findUnique.mockResolvedValue(
      row({ status: "degraded", consecutiveFailures: 8, metadata: { firstFailureAt: at.toISOString() } }),
    );
    await recordCapabilityFailure(failure());
    await recordCapabilityFailure(failure({ at: new Date(at.getTime() + 1_000) }));
    expect(mocks.upsert).toHaveBeenCalledTimes(1);
    await recordCapabilityFailure(failure({ at: new Date(at.getTime() + CAPABILITY_WRITE_THROTTLE_MS + 1) }));
    expect(mocks.upsert).toHaveBeenCalledTimes(2);
  });

  it("a database error is a warn log, never the caller's error", async () => {
    mocks.findUnique.mockRejectedValue(new Error("db down"));
    await expect(recordCapabilityFailure(failure())).resolves.toBeUndefined();
    expect(mocks.warn).toHaveBeenCalledWith(
      "capability_failure_receipt_failed",
      expect.objectContaining({ toolName: "firecrawl-scrape", error: "db down" }),
    );
  });
});

describe("recordCapabilityRecovery", () => {
  it("the first success after a streak resets the row to healthy and records when", async () => {
    mocks.findUnique.mockResolvedValue(
      row({ status: "degraded", consecutiveFailures: 9, metadata: { lastError: "credits" } }),
    );
    await recordCapabilityRecovery("firecrawl-scrape");
    expect(mocks.update).toHaveBeenCalledOnce();
    const arg = mocks.update.mock.calls[0][0];
    expect(arg.where).toEqual({ name: "firecrawl-scrape" });
    expect(arg.data).toMatchObject({ status: "healthy", consecutiveFailures: 0 });
    expect(arg.data.metadata).toMatchObject({ lastError: "credits" });
    expect(typeof arg.data.metadata.lastRecoveryAt).toBe("string");
  });

  it("costs no query on later successes until the next failure, then recovers again", async () => {
    mocks.findUnique.mockResolvedValue(row({ status: "degraded", consecutiveFailures: 3 }));
    await recordCapabilityRecovery("x");
    await recordCapabilityRecovery("x");
    expect(mocks.findUnique).toHaveBeenCalledTimes(1);
    await recordCapabilityFailure(failure({ toolName: "x" }));
    await recordCapabilityRecovery("x");
    expect(mocks.update).toHaveBeenCalledTimes(2);
  });

  it("a healthy row with no streak is left alone; a row of another type is never touched", async () => {
    mocks.findUnique.mockResolvedValue(row());
    await recordCapabilityRecovery("a");
    mocks.findUnique.mockResolvedValue(row({ type: "api", status: "degraded", consecutiveFailures: 4 }));
    await recordCapabilityRecovery("b");
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("a database error is logged once and not retried on every later success", async () => {
    mocks.findUnique.mockRejectedValue(new Error("db down"));
    await recordCapabilityRecovery("y");
    await recordCapabilityRecovery("y");
    expect(mocks.findUnique).toHaveBeenCalledTimes(1);
    expect(mocks.warn).toHaveBeenCalledWith(
      "capability_recovery_receipt_failed",
      expect.objectContaining({ toolName: "y" }),
    );
  });
});

describe("recordCapabilityRecovery · an operator-disabled row (bug-hunt 2026-10-02)", () => {
  it("a success never rewrites a disabled capability to healthy", async () => {
    mocks.findUnique.mockResolvedValue(row({ status: "degraded", consecutiveFailures: 4, enabled: false }));
    await recordCapabilityRecovery("disabled-tool");
    expect(mocks.update).not.toHaveBeenCalled();
  });
});

