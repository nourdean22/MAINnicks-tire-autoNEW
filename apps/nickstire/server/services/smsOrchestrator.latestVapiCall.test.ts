import { describe, it, expect, vi, beforeEach } from "vitest";
import { Column, SQL } from "drizzle-orm";

/**
 * Q-11 · the call summary that seeds an SMS reply must be the NEWEST call, not
 * the highest id. TiDB hands out AUTO_INCREMENT values in per-server batches
 * (docs.pingcap.com/tidb/stable/auto-increment), so across TiDB servers or a
 * restart a LATER row can carry a LOWER id. `ORDER BY id DESC LIMIT 1` then
 * returns an older call, and the drafter answers about the wrong visit.
 *
 * The mock below honours ORDER BY for real (it reads the column and direction
 * out of drizzle's `desc(col)` SQL), so the fixture — higher id = OLDER row —
 * returns the old call on id-only ordering and the new call on
 * (createdAt DESC, id DESC).
 */

type Row = Record<string, unknown>;
let tables: Record<string, Row[]> = {};

function tableName(t: any): string {
  return t?.[Symbol.for("drizzle:Name")] ?? "";
}

/** [dbColumnName, dir] for each orderBy arg; throws on a shape it cannot read. */
function sortKeys(args: unknown[]): Array<[string, 1 | -1]> {
  return args.map((a) => {
    if (a instanceof Column) return [a.name, 1];
    if (a instanceof SQL) {
      const chunks = (a as any).queryChunks as unknown[];
      const col = chunks.find((c) => c instanceof Column) as Column | undefined;
      const text = chunks.map((c: any) => (Array.isArray(c?.value) ? c.value.join("") : "")).join("");
      if (col) return [col.name, /\bdesc\b/i.test(text) ? -1 : 1];
    }
    throw new Error("unreadable orderBy arg in test mock");
  });
}

function builder(fields?: Record<string, Column>) {
  let rows: Row[] = [];
  const qb: any = {
    from: (t: any) => { rows = [...(tables[tableName(t)] ?? [])]; return qb; },
    where: () => qb,
    orderBy: (...args: unknown[]) => {
      const keys = sortKeys(args);
      rows.sort((x, y) => {
        for (const [k, dir] of keys) {
          const a = x[k] as any, b = y[k] as any;
          const av = a instanceof Date ? a.getTime() : a;
          const bv = b instanceof Date ? b.getTime() : b;
          if (av < bv) return -dir;
          if (av > bv) return dir;
        }
        return 0;
      });
      return qb;
    },
    limit: (n: number) => { rows = rows.slice(0, n); return qb; },
    then: (resolve: (v: Row[]) => void, reject: (e: unknown) => void) => {
      try {
        resolve(rows.map((r) => {
          if (!fields) return r;
          const out: Row = {};
          for (const [key, col] of Object.entries(fields)) out[key] = r[col.name];
          return out;
        }));
      } catch (e) { reject(e); }
    },
  };
  return qb;
}

const mockDb = {
  select: (fields?: Record<string, Column>) => builder(fields),
  execute: async () => [[]],
};

vi.mock("../db", () => ({
  getDbTyped: () => Promise.resolve(mockDb),
  getDb: () => Promise.resolve(mockDb),
}));

import { loadCustomerContext } from "./smsOrchestrator";

describe("loadCustomerContext · last VAPI call is chosen by event time, not id", () => {
  beforeEach(() => {
    tables = {};
  });

  it("higher id but OLDER row -> the newer call seeds the reply", async () => {
    tables.vapi_call_logs = [
      // Allocated from a later id batch on another TiDB server, but placed a week EARLIER.
      { id: 30001, vapiCallId: "vc_old", aiSummary: "asked about an oil change", serviceMention: "oil change", phoneNumber: "2165550001", createdAt: new Date("2026-09-10T15:00:00Z") },
      { id: 12, vapiCallId: "vc_new", aiSummary: "brakes grinding, wants a quote", serviceMention: "brakes", phoneNumber: "2165550001", createdAt: new Date("2026-09-17T15:00:00Z") },
    ];
    const ctx = await loadCustomerContext("2165550001");
    expect(ctx.lastVapiCall?.vapiCallId).toBe("vc_new");
    expect(ctx.recentServiceMention).toBe("brakes");
  });

  it("same createdAt second -> id breaks the tie deterministically", async () => {
    // Control: the tiebreak still exists, so two calls stamped in the same
    // second do not come back in arbitrary order.
    const t = new Date("2026-09-17T15:00:00Z");
    tables.vapi_call_logs = [
      { id: 7, vapiCallId: "vc_a", aiSummary: "a", serviceMention: "tires", phoneNumber: "2165550001", createdAt: t },
      { id: 9, vapiCallId: "vc_b", aiSummary: "b", serviceMention: "alignment", phoneNumber: "2165550001", createdAt: t },
    ];
    const ctx = await loadCustomerContext("2165550001");
    expect(ctx.lastVapiCall?.vapiCallId).toBe("vc_b");
  });
});
