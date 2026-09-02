/**
 * tests/lib/error-log-redaction.test.ts
 * 2026-09-02 deep-research audit · finding C-3
 *
 * This app has two logging paths. lib/logger.ts redacted by key name; the
 * OTHER one — lib/utils/error-log.ts `logError()`, ~107 call sites — wrote
 * its caller-supplied `extra` verbatim into the PERSISTED `ErrorLog.context`
 * JSON column. One careless `logError("x", err, { token })` at any of those
 * sites would store a credential indefinitely, and `/system/logs` renders
 * that column.
 *
 * Call-site discipline is the first line and was, on inspection, holding.
 * This is the backstop that does not depend on it: both paths now share one
 * redaction implementation. The subject under test is the object handed to
 * `prisma.errorLog.create`, i.e. exactly what would land in the database.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const create = vi.fn().mockResolvedValue({});
vi.mock("@/lib/prisma", () => ({
  prisma: { errorLog: { create: (...a: unknown[]) => create(...a) } },
}));

async function contextWritten(): Promise<Record<string, unknown>> {
  // logError is fire-and-forget: it does not await the create. Yield once so
  // the microtask that issues it has run before we inspect the spy.
  await Promise.resolve();
  expect(create).toHaveBeenCalledTimes(1);
  return create.mock.calls[0][0].data.context as Record<string, unknown>;
}

describe("logError · persisted context is redacted before it reaches the database", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  it("redacts credential-shaped keys anywhere in the extra payload", async () => {
    const { logError } = await import("@/lib/utils/error-log");
    logError("services.google-oauth", new Error("refresh failed"), {
      token: "1//0gFAKE-refresh-token",
      nested: { authorization: "Bearer sk-live-FAKE", apiKey: "pk-FAKE" },
      stage: "refresh",
    });

    const ctx = await contextWritten();
    expect(JSON.stringify(ctx)).not.toContain("1//0gFAKE-refresh-token");
    expect(JSON.stringify(ctx)).not.toContain("sk-live-FAKE");
    expect(ctx.token).toBe("[REDACTED]");
    expect((ctx.nested as Record<string, unknown>).authorization).toBe("[REDACTED]");
  });

  it("positive control · non-sensitive fields survive, so the log is still diagnosable", async () => {
    // Without this half, a redactor that blanked the whole object would pass
    // the test above while destroying every error log in the system.
    const { logError } = await import("@/lib/utils/error-log");
    logError("brain.contextual-recall", new Error("timeout"), {
      stage: "rerank",
      attempts: 3,
      conversationId: "conv_123",
    });

    const ctx = await contextWritten();
    expect(ctx.source).toBe("brain.contextual-recall");
    expect(ctx.stage).toBe("rerank");
    expect(ctx.attempts).toBe(3);
    expect(ctx.conversationId).toBe("conv_123");
  });

  it("still records the source when no extra is supplied", async () => {
    const { logError } = await import("@/lib/utils/error-log");
    logError("cron.data-cleanup", new Error("boom"));
    const ctx = await contextWritten();
    expect(ctx).toEqual({ source: "cron.data-cleanup" });
  });
});
