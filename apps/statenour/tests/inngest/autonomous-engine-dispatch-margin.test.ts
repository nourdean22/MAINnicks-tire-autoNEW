/**
 * The hourly automation-engine tick dispatches /api/cron/autonomous-engine
 * through dispatchChild. The route declares maxDuration = 90 s and the
 * dispatcher's default ceiling was also 90 s, so a run answering at the end
 * of its own budget lost its real status: the ceiling fired first and the
 * tick filed 202 "still running" (audit 2026-10-10, 14-live-crons item 5).
 * The dispatcher waits the route's budget plus a 10 s margin, and the Inngest
 * serve route that runs the step must allow at least that long.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { dispatchChild } from "@/lib/inngest/functions/mega-fanout";

const ROUTE = "/api/cron/autonomous-engine";
const MARGIN_MS = 10_000;
const maxDurationMs = (rel: string) =>
  Number(readFileSync(join(__dirname, "../..", rel), "utf-8").match(/export const maxDuration = (\d+)/)?.[1]) * 1000;
const MAX_DURATION_MS = maxDurationMs("app/api/cron/autonomous-engine/route.ts");

beforeEach(() => {
  vi.useFakeTimers();
  process.env.APP_BASE_URL = "https://example.test";
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  delete process.env.APP_BASE_URL;
});

/** A fetch that answers `status` after `afterMs`, or never when afterMs is null. */
function stubFetch(status: number, afterMs: number | null) {
  vi.stubGlobal(
    "fetch",
    vi.fn(
      (_url: string, init: { signal: AbortSignal }) =>
        new Promise((resolve, reject) => {
          init.signal.addEventListener("abort", () => reject(new Error("aborted")));
          if (afterMs !== null) setTimeout(() => resolve({ ok: status < 400, status }), afterMs);
        }),
    ),
  );
}

async function dispatchFor(ms: number) {
  const settled = dispatchChild(ROUTE, "s").then(
    (v) => ({ ok: true as const, v }),
    (e: unknown) => ({ ok: false as const, e }),
  );
  await vi.advanceTimersByTimeAsync(ms);
  return settled;
}

describe("autonomous-engine dispatch · ceiling = route maxDuration + 10 s", () => {
  it("reads the route budget", () => {
    expect(MAX_DURATION_MS).toBeGreaterThan(0);
  });

  it("a 500 answered 9 s past the route's budget reaches the tick as a failure, not 202", async () => {
    stubFetch(500, MAX_DURATION_MS + MARGIN_MS - 1_000);
    const out = await dispatchFor(MAX_DURATION_MS + MARGIN_MS - 1_000);
    expect(out.ok, out.ok ? `got status ${out.v.status}` : "").toBe(false);
    if (!out.ok) expect(String(out.e)).toMatch(/returned 500/);
  });

  it("a child that never answers is still released as 202 at the margin (the ceiling stays bounded)", async () => {
    stubFetch(200, null);
    const out = await dispatchFor(MAX_DURATION_MS + MARGIN_MS);
    expect(out.ok && out.v.status).toBe(202);
  });

  it("the Inngest serve route that runs the step allows the full ceiling", () => {
    expect(maxDurationMs("app/api/inngest/route.ts")).toBeGreaterThanOrEqual(MAX_DURATION_MS + MARGIN_MS);
  });
});
