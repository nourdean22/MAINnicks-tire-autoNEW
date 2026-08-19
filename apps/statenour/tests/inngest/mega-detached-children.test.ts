/**
 * mega-evening · long-running children must not be reported as failures.
 *
 * Measured in prod 2026-08-19 (api_request_logs, 7 days):
 *   /api/cron/consolidate  avg 19.6 min, max 36 min  — always 200
 *   /api/cron/mastery-xp   avg  5.1 min, max 9.9 min — always 200
 *
 * Both finish fine server-side; the PARENT aborted them at 240s and threw,
 * which failed the Inngest step, which (retries: 3) re-ran the whole evening
 * slot — 4 overlapping consolidate runs a night, ~2.3h of LLM churn, which
 * loaded the DB further and made consolidate slower still. 29 consecutive
 * nightly "failures" for work that had already completed.
 *
 * Raising the ceiling a third time (50s -> 90s -> 240s) cannot fix this: the
 * duration is unbounded-by-design and trending up. These children are now
 * DISPATCHED, not awaited — they write their own CronJobLog rows, which is
 * where their real outcome has always lived.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { dispatchChild, DETACHED_CHILDREN } from "@/lib/inngest/functions/mega-fanout";

const SECRET = "test-cron-secret";
const CONSOLIDATE = "/api/cron/consolidate";
const BOUNDED = "/api/cron/data-cleanup";

describe("dispatchChild · detached long-running children", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    process.env.APP_BASE_URL = "https://example.test";
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    delete process.env.APP_BASE_URL;
  });

  it("names the two measured offenders", () => {
    expect(DETACHED_CHILDREN.has(CONSOLIDATE)).toBe(true);
    expect(DETACHED_CHILDREN.has("/api/cron/mastery-xp")).toBe(true);
    // Bounded children must NOT be detached — they still need a real ceiling.
    expect(DETACHED_CHILDREN.has(BOUNDED)).toBe(false);
  });

  it("reports a still-running detached child as dispatched, not failed", async () => {
    // The exact prod shape: the child is still working when the parent looks.
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise(() => {})),
    );

    const pending = dispatchChild(CONSOLIDATE, SECRET);
    await vi.advanceTimersByTimeAsync(10_000);

    const result = await pending;
    expect(result.path).toBe(CONSOLIDATE);
    expect(result.status).toBe(202);
  });

  it("does not attach an abort signal to a detached child", async () => {
    // An abort signal is what killed the child's client connection and
    // manufactured the failure. It must be gone, not merely larger.
    const fetchMock = vi.fn(() => new Promise(() => {}));
    vi.stubGlobal("fetch", fetchMock);

    const pending = dispatchChild(CONSOLIDATE, SECRET);
    await vi.advanceTimersByTimeAsync(10_000);
    await pending;

    const init = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined;
    expect(init?.signal).toBeUndefined();
  });

  it("still throws when a detached child cannot be dispatched at all", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new Error("ECONNREFUSED"))),
    );

    await expect(dispatchChild(CONSOLIDATE, SECRET)).rejects.toThrow(/ECONNREFUSED/);
  });

  it("still throws when a detached child returns non-2xx before the ack window", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve({ ok: false, status: 500 } as Response)),
    );

    await expect(dispatchChild(CONSOLIDATE, SECRET)).rejects.toThrow(/500/);
  });

  it("leaves bounded children on the original abort path", async () => {
    const fetchMock = vi.fn(() => Promise.resolve({ ok: true, status: 200 } as Response));
    vi.stubGlobal("fetch", fetchMock);

    const result = await dispatchChild(BOUNDED, SECRET);

    expect(result.status).toBe(200);
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined;
    expect(init?.signal).toBeDefined();
  });
});
