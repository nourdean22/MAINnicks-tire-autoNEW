/**
 * tests/services/brain-health-coverage-denominator.test.ts
 * 2026-09-02 · from two P2 review findings on PR #2090.
 *
 * FINDING 1 · the coverage denominator was still wrong, one grain finer.
 * The same-day fix scoped vectorization coverage to non-telemetry rows,
 * removing the 5,169 telemetry rows that policy forbids embedding. But
 * app/api/cron/embed-backfill/route.ts excludes on TWO predicates, not one:
 *
 *     deleted_at IS NULL AND confidence >= 0.2 AND NOT (category = ANY(telemetry))
 *
 * The confidence floor is per ROW, not per category. `api_token` records are
 * written at confidence 0 — knowledge by category, ineligible by row — so they
 * sat in the denominator and could never reach the numerator, permanently
 * depressing coverage. That is the identical false-backlog defect the fix was
 * written to remove, surviving at a finer resolution.
 *
 * FINDING 2 · only one of the two callers was actually fixed. See the
 * delegation test at the bottom.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

const { mockQueryRaw } = vi.hoisted(() => ({ mockQueryRaw: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: { $queryRaw: mockQueryRaw } }));

import { buildMemoryHealth } from "@/lib/services/brain-health";

/** One aggregation row, shaped as the SQL returns it. */
function row(over: Partial<Record<string, unknown>> & { category: string; count: number }) {
  return {
    permanent: 0,
    decayed: 0,
    vectorized: 0,
    embeddable: over.count,
    embeddable_vectorized: 0,
    avg_conf: 0.9,
    avg_seen: 1,
    newest: new Date(),
    oldest: new Date(),
    ...over,
  };
}

describe("brain-health · coverage is measured over what the embedder may take", () => {
  beforeEach(() => mockQueryRaw.mockReset());

  it("ineligible low-confidence rows leave the denominator", async () => {
    // 10 knowledge rows: 8 embeddable and all 8 embedded, 2 below the 0.2
    // floor that the backfill will never pick up.
    mockQueryRaw.mockResolvedValue([
      row({ category: "wisdom", count: 10, vectorized: 8, embeddable: 8, embeddable_vectorized: 8 }),
    ]);
    const r = await buildMemoryHealth();
    expect(r.totals.knowledgeEmbeddable).toBe(8);
    // 8/8, not 8/10. The two ineligible rows are not a backlog.
    expect(r.totals.knowledgeVectorizedPct).toBe(100);
  });

  it("PLANTED POSITIVE · a real gap still reads as a real gap", async () => {
    // Without this, a denominator that silently equalled the numerator would
    // report 100% forever and pass the test above.
    mockQueryRaw.mockResolvedValue([
      row({ category: "wisdom", count: 10, vectorized: 5, embeddable: 10, embeddable_vectorized: 5 }),
    ]);
    const r = await buildMemoryHealth();
    expect(r.totals.knowledgeVectorizedPct).toBe(50);
    expect(r.totals.knowledgeEmbeddable).toBe(10);
  });

  it("telemetry stays out of both the numerator and the denominator", async () => {
    mockQueryRaw.mockResolvedValue([
      row({ category: "wisdom", count: 4, vectorized: 4, embeddable: 4, embeddable_vectorized: 4 }),
      // mastery_xp_event is on the embedding-policy denylist.
      row({ category: "mastery_xp_event", count: 1000, vectorized: 0, embeddable: 1000 }),
    ]);
    const r = await buildMemoryHealth();
    expect(r.totals.knowledgeEmbeddable).toBe(4);
    expect(r.totals.knowledgeVectorizedPct).toBe(100);
    // The raw figures still describe every row, telemetry included — they are
    // the honest row count, just not the coverage measure.
    expect(r.totals.live).toBe(1004);
  });

  it("an all-ineligible category cannot divide by zero", async () => {
    mockQueryRaw.mockResolvedValue([
      row({ category: "api_token", count: 6, vectorized: 0, embeddable: 0 }),
    ]);
    const r = await buildMemoryHealth();
    expect(r.totals.knowledgeEmbeddable).toBe(0);
    expect(r.totals.knowledgeVectorizedPct).toBe(0);
    expect(Number.isFinite(r.totals.knowledgeVectorizedPct)).toBe(true);
  });
});

describe("brain-health · both callers run the same code", () => {
  it("the REST route delegates instead of keeping its own aggregation", () => {
    // The service header claimed "the legacy REST endpoint AND the new
    // brain.memoryHealth tRPC procedure call the SAME function · drift between
    // consumers structurally impossible." It was false for four months: the
    // route kept a 100-line copy, so the same-day coverage fix reached tRPC
    // callers and not REST ones. A second copy repaired is a second copy that
    // can drift again, so this asserts there is only one.
    const src = readFileSync(
      resolve(APP_ROOT, "app/api/brain/memory-health/route.ts"),
      "utf8",
    );
    const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*/g, "");
    expect(code).toContain("buildMemoryHealth");
    expect(code, "the route is aggregating again — delegate to the service").not.toContain(
      "$queryRaw",
    );
    expect(code, "the route is re-deriving flags").not.toContain("no_vectors");
  });
});
