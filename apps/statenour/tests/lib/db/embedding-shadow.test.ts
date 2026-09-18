/**
 * lib/db/embedding-shadow.ts — the shadow repair's guards.
 *
 * Every guard here is tested in BOTH directions: once tripped, once with the
 * single field that should let it through. A guard only asserted in its
 * blocking direction passes just as green when it blocks everything forever
 * (`lintGateFailClosed` / `policy.test.mjs` precedent).
 *
 * No vi.mock: sweepEmbeddingShadow takes `prisma` and `sources` as options, so
 * the fakes go in through the front door.
 */
import { describe, it, expect } from "vitest";
import {
  sweepEmbeddingShadow,
  SHADOW_SOURCES,
  UNMAPPED_SOURCE_TYPES,
  MAX_NEW_MARKS_PER_RUN,
  REASON_ROW_ABSENT,
  REASON_SOFT_DELETED,
  type ShadowSource,
} from "@/lib/db/embedding-shadow";

interface FakeCounts {
  live: number;
  absent: number;
  soft: number;
  clearable: number;
}

/**
 * Minimal prisma stand-in that answers by SQL SHAPE.
 *
 * Discriminating on shape rather than call order is deliberate: an order-based
 * fake passes when the implementation reorders its queries, which is exactly
 * the refactor most likely to break the guards.
 */
function fakePrisma(opts: {
  tables: string[];
  columns?: string[]; // "table.column"
  counts: Record<string, FakeCounts>;
}) {
  const tables = new Set(opts.tables);
  const columns = new Set(opts.columns ?? []);
  const executed: Array<{ sql: string; params: unknown[] }> = [];
  const spent = new Set<string>();

  const classify = (sql: string): keyof FakeCounts => {
    if (!sql.includes("sourceUnavailableAt")) return "live";
    if (sql.includes('"sourceUnavailableAt" IS NOT NULL')) return "clearable";
    if (sql.includes("NOT EXISTS")) return "absent";
    return "soft";
  };

  return {
    executed,
    client: {
      $queryRawUnsafe: async (sql: string, ...params: unknown[]) => {
        if (sql.includes("information_schema.tables")) {
          return [{ n: tables.has(String(params[0])) ? 1 : 0 }];
        }
        if (sql.includes("information_schema.columns")) {
          return [{ n: columns.has(`${params[0]}.${params[1]}`) ? 1 : 0 }];
        }
        const st = String(params[0]);
        return [{ n: opts.counts[st]?.[classify(sql)] ?? 0 }];
      },
      $executeRawUnsafe: async (sql: string, ...params: unknown[]) => {
        executed.push({ sql, params });
        const st = String(params[0]);
        const kind = classify(sql);
        const key = `${st}:${kind}`;
        if (spent.has(key)) return 0; // second batch finds nothing left
        spent.add(key);
        return opts.counts[st]?.[kind] ?? 0;
      },
    } as never,
  };
}

const ONE: ShadowSource = { sourceType: "widget", table: "widgets" };

describe("SHADOW_SOURCES is an allowlist, not a negation", () => {
  it("excludes every composite-sourceId type — a NOT EXISTS join on these matches nothing", () => {
    // `document` is the one that actually fooled a measurement: sourceId is
    // `${documentId}:chunk:${i}`, so 100% of rows read as orphaned.
    for (const st of ["document", "notebooklm", "obsidian"]) {
      expect(SHADOW_SOURCES.map((s) => s.sourceType)).not.toContain(st);
      expect(UNMAPPED_SOURCE_TYPES[st]).toMatch(/composite|file path/i);
    }
  });

  it("excludes code-defined types whose source is a file, not a row", () => {
    // Sweeping these would condemn 1,434 skill + 189 tool_catalog embeddings,
    // breaking skill recall and tool selection.
    for (const st of ["skill", "tool_catalog", "greene_law", "behavioral_persona"]) {
      expect(SHADOW_SOURCES.map((s) => s.sourceType)).not.toContain(st);
      expect(UNMAPPED_SOURCE_TYPES[st]).toContain("code-defined");
    }
  });

  it("every allowlisted source names a table and no duplicates exist", () => {
    const seen = new Set<string>();
    for (const s of SHADOW_SOURCES) {
      expect(s.table).toMatch(/^[A-Za-z_][A-Za-z0-9_]*$/);
      expect(seen.has(s.sourceType)).toBe(false);
      seen.add(s.sourceType);
    }
  });
});

describe("full-sweep guard — zero live rows looks identical to a broken mapping", () => {
  const counts = { widget: { live: 0, absent: 205, soft: 0, clearable: 0 } };

  it("REFUSES to mark 100% of a source type by default", async () => {
    const f = fakePrisma({ tables: ["widgets"], counts });
    const r = await sweepEmbeddingShadow({ prisma: f.client, sources: [ONE] });
    expect(r.totalMarked).toBe(0);
    expect(r.sources[0].skipped).toMatch(/100%/);
    expect(f.executed).toHaveLength(0); // nothing written at all
  });

  it("CANARY — allows it when a human set allowFullSweep", async () => {
    const f = fakePrisma({ tables: ["widgets"], counts });
    const r = await sweepEmbeddingShadow({
      prisma: f.client,
      sources: [{ ...ONE, allowFullSweep: true }],
    });
    expect(r.totalMarked).toBe(205);
    expect(r.sources[0].skipped).toBeUndefined();
  });
});

describe("cap guard", () => {
  const over = { widget: { live: 10, absent: MAX_NEW_MARKS_PER_RUN + 1, soft: 0, clearable: 3 } };

  it("refuses the marking pass over MAX_NEW_MARKS_PER_RUN", async () => {
    const f = fakePrisma({ tables: ["widgets"], counts: over });
    const r = await sweepEmbeddingShadow({ prisma: f.client, sources: [ONE] });
    expect(r.refused).toBe(true);
    expect(r.totalMarked).toBe(0);
    expect(r.refusedReason).toContain(String(MAX_NEW_MARKS_PER_RUN));
  });

  it("still CLEARS while refusing to mark — restoring recall is never the unsafe direction", async () => {
    const f = fakePrisma({ tables: ["widgets"], counts: over });
    const r = await sweepEmbeddingShadow({ prisma: f.client, sources: [ONE] });
    expect(r.totalCleared).toBe(3);
  });

  it("CANARY — force bypasses the cap", async () => {
    const f = fakePrisma({ tables: ["widgets"], counts: over });
    const r = await sweepEmbeddingShadow({ prisma: f.client, sources: [ONE], force: true });
    expect(r.refused).toBe(false);
    expect(r.totalMarked).toBe(MAX_NEW_MARKS_PER_RUN + 1);
  });

  it("CANARY — under the cap it applies without force", async () => {
    const f = fakePrisma({
      tables: ["widgets"],
      counts: { widget: { live: 10, absent: 5, soft: 0, clearable: 0 } },
    });
    const r = await sweepEmbeddingShadow({ prisma: f.client, sources: [ONE] });
    expect(r.refused).toBe(false);
    expect(r.totalMarked).toBe(5);
  });
});

describe("schema guards", () => {
  it("skips a source whose table does not exist rather than marking everything", async () => {
    const f = fakePrisma({
      tables: [],
      counts: { widget: { live: 0, absent: 9, soft: 0, clearable: 0 } },
    });
    const r = await sweepEmbeddingShadow({ prisma: f.client, sources: [ONE] });
    expect(r.sources[0].skipped).toMatch(/does not exist/);
    expect(f.executed).toHaveLength(0);
  });

  it("skips when the soft-delete column is missing — a rename would read every live row as deleted", async () => {
    const f = fakePrisma({
      tables: ["widgets"],
      columns: [], // widgets.deleted_at absent
      counts: { widget: { live: 10, absent: 0, soft: 0, clearable: 0 } },
    });
    const r = await sweepEmbeddingShadow({
      prisma: f.client,
      sources: [{ ...ONE, softDeleteColumn: "deleted_at" }],
    });
    expect(r.sources[0].skipped).toMatch(/column .* missing/);
    expect(f.executed).toHaveLength(0);
  });

  it("CANARY — proceeds when the soft-delete column is present", async () => {
    const f = fakePrisma({
      tables: ["widgets"],
      columns: ["widgets.deleted_at"],
      counts: { widget: { live: 10, absent: 0, soft: 4, clearable: 0 } },
    });
    const r = await sweepEmbeddingShadow({
      prisma: f.client,
      sources: [{ ...ONE, softDeleteColumn: "deleted_at" }],
    });
    expect(r.sources[0].skipped).toBeUndefined();
    expect(r.totalMarked).toBe(4);
  });

  it("throws on an unsafe table identifier rather than interpolating it", async () => {
    const f = fakePrisma({ tables: ["x"], counts: {} });
    await expect(
      sweepEmbeddingShadow({
        prisma: f.client,
        sources: [{ sourceType: "widget", table: 'widgets"; DROP TABLE x --' }],
      }),
    ).rejects.toThrow(/unsafe table identifier/);
  });
});

describe("reasons stay distinct", () => {
  it("tags a vanished row and a soft-deleted row differently", async () => {
    const f = fakePrisma({
      tables: ["widgets"],
      columns: ["widgets.deleted_at"],
      counts: { widget: { live: 10, absent: 2, soft: 3, clearable: 0 } },
    });
    await sweepEmbeddingShadow({
      prisma: f.client,
      sources: [{ ...ONE, softDeleteColumn: "deleted_at" }],
    });
    const reasons = f.executed.flatMap((e) => e.params.slice(1));
    expect(reasons).toContain(REASON_ROW_ABSENT);
    expect(reasons).toContain(REASON_SOFT_DELETED);
    // They must never collapse into one token — that is the cron_job_log.status
    // defect, where one word meant two states and both readers were wrong.
    expect(REASON_ROW_ABSENT).not.toBe(REASON_SOFT_DELETED);
  });

  it("writes nothing at all in a dry run", async () => {
    const f = fakePrisma({
      tables: ["widgets"],
      counts: { widget: { live: 10, absent: 4, soft: 0, clearable: 2 } },
    });
    const r = await sweepEmbeddingShadow({ prisma: f.client, sources: [ONE], dryRun: true });
    expect(r.dryRun).toBe(true);
    expect(r.totalMarked).toBe(4);
    expect(f.executed).toHaveLength(0);
  });

  it("every UPDATE is bounded by a LIMIT — an unbounded write in a nightly cron is the defect", async () => {
    const f = fakePrisma({
      tables: ["widgets"],
      counts: { widget: { live: 10, absent: 4, soft: 0, clearable: 2 } },
    });
    await sweepEmbeddingShadow({ prisma: f.client, sources: [ONE] });
    expect(f.executed.length).toBeGreaterThan(0);
    for (const e of f.executed) {
      expect(e.sql).toMatch(/LIMIT \d+/);
      expect(e.sql).not.toContain("__LIMIT__"); // placeholder must be substituted
    }
  });
});
