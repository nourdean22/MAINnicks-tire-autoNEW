/**
 * metricRecordedForTrace · the shared dedupe read both per-turn shadows consult.
 *
 * The post-turn outbox replays runDeferredBackgroundWork, so a shadow metric
 * can be written twice for one turn. This pins the reader's where clause —
 * the metric, a bounded createdAt window, and the JSON-key filter on
 * tags.traceId whose semantics were measured against production for the
 * calibration reader (#2484) — and its boolean mapping. Prisma is mocked; the
 * shape sent to it is the subject.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Lazy arrow so the hoisted factory never touches the spy before it exists.
const findFirst = vi.fn();
vi.mock("@/lib/prisma", () => ({ prisma: { systemMetric: { findFirst: (a: unknown) => findFirst(a) } } }));

import { metricRecordedForTrace, TRACE_DEDUPE_WINDOW_MS } from "@/lib/services/metrics";

type Arg = { where: { metric: string; createdAt: { gte: Date }; tags: { path: string[]; equals: string } }; select: unknown };

beforeEach(() => findFirst.mockReset());

describe("metricRecordedForTrace", () => {
  it("POSITIVE CONTROL: a found row reads as recorded, and the where clause names metric + trace + window", async () => {
    findFirst.mockResolvedValue({ id: "m1" });
    const before = Date.now();
    expect(await metricRecordedForTrace("action.done.shadow", "t_1")).toBe(true);
    const arg = findFirst.mock.calls[0]?.[0] as Arg;
    expect(arg.where.metric).toBe("action.done.shadow");
    expect(arg.where.tags).toEqual({ path: ["traceId"], equals: "t_1" });
    const lowerBound = arg.where.createdAt.gte.getTime();
    expect(before - lowerBound).toBeGreaterThanOrEqual(TRACE_DEDUPE_WINDOW_MS - 1_000);
    expect(before - lowerBound).toBeLessThanOrEqual(TRACE_DEDUPE_WINDOW_MS + 5_000);
    expect(arg.select).toEqual({ id: true });
  });

  it("no row reads as not recorded", async () => {
    findFirst.mockResolvedValue(null);
    expect(await metricRecordedForTrace("recommendation.novelty", "t_2")).toBe(false);
  });

  it("the window is a parameter, so a caller can tighten it", async () => {
    findFirst.mockResolvedValue(null);
    const before = Date.now();
    await metricRecordedForTrace("x", "t_3", 60_000);
    const arg = findFirst.mock.calls[0]?.[0] as Arg;
    expect(before - arg.where.createdAt.gte.getTime()).toBeLessThanOrEqual(60_000 + 5_000);
  });

  it("a failing read PROPAGATES — the reader has no catch, so the callers see the rejection", () => {
    // Asserted on comment-stripped source rather than by rejecting the mock:
    // under this vitest a rejection that travels through the module-mock
    // wrapper and back to the test is reported as an unhandled rejection
    // before any assertion can observe it (measured 2026-09-22, three
    // assertion shapes), while the same rejection CAUGHT by a caller is fine —
    // which is exactly how production consumes it. The two callers' tests pin
    // that behaviour: a rejecting `alreadyRecorded` is a "failed" outcome
    // under the instrument scope and never a second write. This test pins the
    // other half — nothing in the reader can swallow the failure first.
    const src = readFileSync(resolve(process.cwd(), "lib/services/metrics.ts"), "utf8");
    const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
    const start = code.indexOf("export async function metricRecordedForTrace(");
    expect(start, "metricRecordedForTrace not found").toBeGreaterThan(-1);
    const body = code.slice(start, code.indexOf("\n}\n", start));
    expect(body).not.toMatch(/\bcatch\b/);
    expect(body).toMatch(/await prisma\.systemMetric\.findFirst\(/);
  });
});
