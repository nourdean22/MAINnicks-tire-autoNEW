/**
 * tests/services/embedding-coverage-personal-gap.test.ts · 2026-10-17 (brain W5)
 *
 * The "searchable memories without a vector" gauge.
 *
 * WHY IT EXISTS. A read-only prod probe on 2026-10-16 found 5,726 of 17,233 live
 * rows with no 1536 vector, but the biggest buckets were telemetry
 * (mastery_xp_event 2,804, persona_drift 1,227, nick_quality 884 ...). The raw
 * gap therefore said nothing about whether Nour's own memories are findable.
 * The gauge counts only rows the embedding policy says SHOULD be embedded, that
 * have no vector in the space dense recall actually reads.
 *
 * The SQL assertions read the statement the code sends (captured from a prisma
 * double), not the source file. A failed read must be UNKNOWN, never a green 0
 * (skill empty-vs-error).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  unsafe: vi.fn(),
  raw: vi.fn(),
  pgvector: { on: true },
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    $queryRawUnsafe: h.unsafe,
    $queryRaw: h.raw,
    auditEvent: { findMany: vi.fn().mockResolvedValue([]) },
    cronJobLog: { findMany: vi.fn().mockResolvedValue([]) },
  },
}));

vi.mock("@/lib/db/pgvector", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/db/pgvector")>()),
  isPgvectorAvailable: () => Promise.resolve(h.pgvector.on),
}));

import { TELEMETRY_CATEGORY_LIST } from "@/lib/brain/embedding-policy";
import { embeddingSpaceSql } from "@/lib/db/pgvector";
import { buildEmbeddingCoverage, buildPersonalGap } from "@/lib/services/embedding-coverage";
import { formatPersonalGap } from "@/lib/services/personal-gap";

beforeEach(() => {
  h.unsafe.mockReset();
  h.raw.mockReset();
  h.raw.mockResolvedValue([]);
  h.pgvector.on = true;
});

const row = (category: string, eligible: number, missing: number) => ({ category, eligible, missing });

describe("buildPersonalGap · what it counts", () => {
  it("sends one SELECT that excludes the policy's telemetry list, only live rows, and only the ACTIVE space's 1536 vector", async () => {
    h.unsafe.mockResolvedValue([row("health", 10, 1)]);
    await buildPersonalGap();

    expect(h.unsafe).toHaveBeenCalledTimes(1);
    const [sql, ...params] = h.unsafe.mock.calls[0] as [string, ...unknown[]];
    expect(sql).toMatch(/^\s*SELECT/i);
    expect(sql).not.toMatch(/\b(UPDATE|INSERT|DELETE|TRUNCATE|DROP)\b/i);
    expect(sql).toContain("deleted_at IS NULL");
    // the policy's own list, bound as a parameter -- never a second hand list
    expect(sql).toMatch(/NOT \(bm\.category = ANY\(\$1/);
    expect(params[0]).toEqual(TELEMETRY_CATEGORY_LIST);
    // "has a vector" means the column and the space dense recall reads
    expect(sql).toContain(`ve."sourceType" = 'brain_memory'`);
    expect(sql).toContain("ve.embedding_vec_1536 IS NOT NULL");
    expect(sql).toContain(embeddingSpaceSql("ve.model"));
    // the backfill never embeds below this floor, so those rows are not "missing"
    expect(sql).toContain("bm.confidence >= 0.2");
  });

  it("the excluded list really carries the edge and shadow categories the probe named", async () => {
    h.unsafe.mockResolvedValue([]);
    await buildPersonalGap();
    const excluded = (h.unsafe.mock.calls[0] as unknown[])[1] as string[];
    for (const c of ["semantic_edge", "memory_gateway_shadow", "mastery_xp_event", "persona_drift", "nick_quality"]) {
      expect(excluded).toContain(c);
    }
  });

  it("rolls categories up: totals, and the five categories with the most missing (zero-missing left out)", async () => {
    h.unsafe.mockResolvedValue([
      row("a", 100, 3),
      row("b", 50, 0),
      row("c", 40, 9),
      row("d", 30, 7),
      row("e", 20, 5),
      row("f", 10, 4),
      row("g", 10, 2),
      row("h", 1, 1),
    ]);
    const gap = await buildPersonalGap();
    expect(gap).toEqual({
      state: "ok",
      eligible: 261,
      missing: 31,
      byCategoryTop5: [
        { category: "c", missing: 9 },
        { category: "d", missing: 7 },
        { category: "e", missing: 5 },
        { category: "f", missing: 4 },
        { category: "a", missing: 3 },
      ],
    });
  });

  it("a measured zero is a real zero with its denominator", async () => {
    h.unsafe.mockResolvedValue([row("health", 12, 0)]);
    expect(await buildPersonalGap()).toEqual({ state: "ok", eligible: 12, missing: 0, byCategoryTop5: [] });
  });
});

describe("buildPersonalGap · a failed read is UNKNOWN, never 0", () => {
  it("query throws -> unknown with the reason, and no numbers at all", async () => {
    h.unsafe.mockRejectedValue(new Error("db down"));
    const gap = await buildPersonalGap();
    expect(gap).toEqual({ state: "unknown", reason: expect.stringContaining("db down") });
    expect(gap).not.toHaveProperty("missing");
    expect(gap).not.toHaveProperty("eligible");
  });

  it("pgvector extension off -> unknown, and the query is never sent", async () => {
    h.pgvector.on = false;
    const gap = await buildPersonalGap();
    expect(gap.state).toBe("unknown");
    expect(h.unsafe).not.toHaveBeenCalled();
  });

  it("a malformed row (non-numeric count) -> unknown, not a silent NaN or 0", async () => {
    h.unsafe.mockResolvedValue([{ category: "health", eligible: "abc", missing: null }]);
    expect((await buildPersonalGap()).state).toBe("unknown");
  });
});

describe("the gauge reaches the consumers", () => {
  it("buildEmbeddingCoverage returns personalGap beside the rollup", async () => {
    h.unsafe.mockResolvedValue([row("health", 10, 2)]);
    const cov = await buildEmbeddingCoverage();
    expect(cov.personalGap).toMatchObject({ state: "ok", eligible: 10, missing: 2 });
  });

  it("buildEmbeddingCoverage keeps UNKNOWN as unknown when the gauge read fails", async () => {
    h.unsafe.mockRejectedValue(new Error("boom"));
    const cov = await buildEmbeddingCoverage();
    expect(cov.personalGap.state).toBe("unknown");
  });

  it("the backfill's confidence floor is still 0.2 (the gauge's denominator pins it)", () => {
    const route = readFileSync(join(process.cwd(), "app/api/cron/embed-backfill/route.ts"), "utf8");
    expect(route).toContain("bm.confidence >= 0.2");
  });
});

describe("formatPersonalGap · what the operator reads", () => {
  it("a gap above 1%: 'N of M', warn tone, top categories listed, honest label", () => {
    const f = formatPersonalGap({
      state: "ok",
      eligible: 300,
      missing: 12,
      byCategoryTop5: [{ category: "health", missing: 8 }, { category: "event", missing: 4 }],
    });
    expect(f.label).toBe("searchable memories without a vector");
    expect(f.value).toBe("12 of 300");
    expect(f.tone).toBe("warn");
    expect(f.detail).toEqual(["health 8", "event 4"]);
  });

  it("a gap at or under 1% is the normal backfill lag: numbers shown, tone ok (the prod 18 of 17,721 case)", () => {
    const small = formatPersonalGap({
      state: "ok",
      eligible: 17721,
      missing: 18,
      byCategoryTop5: [{ category: "event", missing: 18 }],
    });
    expect(small.value).toBe("18 of 17721");
    expect(small.tone).toBe("ok");
    // exactly 1% is still ok; one row over is warn (the boundary, both sides)
    expect(formatPersonalGap({ state: "ok", eligible: 1000, missing: 10, byCategoryTop5: [] }).tone).toBe("ok");
    expect(formatPersonalGap({ state: "ok", eligible: 1000, missing: 11, byCategoryTop5: [] }).tone).toBe("warn");
  });

  it("eligible 0 is unknown ('no eligible rows'), never '0 of 0' in ok tone", () => {
    const f = formatPersonalGap({ state: "ok", eligible: 0, missing: 0, byCategoryTop5: [] });
    expect(f.value).toBe("?");
    expect(f.tone).toBe("warn");
    expect(f.detail.join(" ")).toContain("no eligible rows");
  });

  it("ok with nothing missing: a real zero in ok tone", () => {
    const f = formatPersonalGap({ state: "ok", eligible: 300, missing: 0, byCategoryTop5: [] });
    expect(f.value).toBe("0 of 300");
    expect(f.tone).toBe("ok");
  });

  it("unknown renders '?' in warn tone, never 0", () => {
    const f = formatPersonalGap({ state: "unknown", reason: "db down" });
    expect(f.value).toBe("?");
    expect(f.value).not.toMatch(/^0/);
    expect(f.tone).toBe("warn");
    expect(f.detail.join(" ")).toContain("db down");
  });
});
