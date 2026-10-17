/**
 * F6 review P3-4 · the paid-repair circuit breaker (qualityGate providerHealthy) must not
 * read F6 retirements as provider failures: one pass can retire 20 rows, and 3 failures
 * in an hour pause paid repairs. Behavioural: the REAL where clause is captured from
 * evaluateReelPublishGate, rendered by drizzle's MySQL dialect and evaluated against rows.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MySqlDialect } from "drizzle-orm/mysql-core";

let breakerWhere: unknown = null;
const job = {
  id: 7,
  clips: null,
  payload: JSON.stringify({
    renderedQa: { decision: "approve", qaState: "completed", critic: "vision", findings: [], framesEvaluated: 3, evaluatedAt: "2026-10-17T10:00:00.000Z" },
  }),
};

vi.mock("./db", () => ({
  getDb: async () => ({
    select: (proj?: Record<string, unknown>) => ({
      from: () => ({
        where: (cond: unknown) => {
          if (proj && "n" in proj) breakerWhere = cond; // the hourly failure count
          return Object.assign(Promise.resolve([{ n: 0 }]), { limit: async () => [job] });
        },
      }),
    }),
  }),
}));
vi.mock("./services/autonomyControl", () => ({ getActivePolicy: async () => ({ limits: { maxRepairAttemptsPerAsset: 2 } }) }));

type Row = { status: string; error: string | null; updatedAt: string };
function LIKE(v: unknown, pat: unknown): boolean {
  if (v === null || v === undefined) return false;
  const re = String(pat).replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/%/g, ".*").replace(/_/g, ".");
  return new RegExp(`^${re}$`, "s").test(String(v));
}
function evaluator(cond: unknown): (r: Row) => boolean {
  const { sql, params } = new MySqlDialect().sqlToQuery(cond as never);
  let i = 0;
  const js = sql.replace(/\?/g, () => `P[${i++}]`)
    .replace(/`reel_jobs`\.`(\w+)`/g, 'r["$1"]')
    .replace(/(r\["\w+"\]) in \(([^)]*)\)/g, "[$2].includes($1)")
    .replace(/(r\["\w+"\]) like (P\[\d+\])/g, "LIKE($1, $2)")
    .replace(/(r\["\w+"\]) is null/g, "($1 == null)")
    .replace(/ = /g, " === ")
    .replace(/\bnot /g, "!")
    .replace(/ and /g, " && ")
    .replace(/ or /g, " || ");
  expect(js, `untranslated SQL left: ${js}`).not.toMatch(/`|\b(in|like|is|not|and|or)\b/);
  const P = params.map((p) => (p instanceof Date ? p.toISOString() : p));
  const fn = new Function("r", "P", "LIKE", `return ${js};`) as (r: Row, p: unknown[], l: typeof LIKE) => boolean;
  return (r) => Boolean(fn(r, P, LIKE));
}

const recent = "9999-12-31T00:00:00.000Z";

describe("providerHealthy's failure count", () => {
  beforeEach(() => { process.env.RENDERED_QA_ENABLED = "true"; process.env.AUDIO_QA_ENABLED = "false"; breakerWhere = null; });
  afterEach(() => { delete process.env.RENDERED_QA_ENABLED; delete process.env.AUDIO_QA_ENABLED; });

  it("counts failures with no error and with an ordinary error, and not F6 retirements", async () => {
    const { evaluateReelPublishGate } = await import("./services/qualityGate");
    await evaluateReelPublishGate(7);
    expect(breakerWhere, "breaker query not reached").not.toBeNull();
    const counts = evaluator(breakerWhere);
    // CONTROL: the two real failure shapes are counted, so the exclusion is not vacuous.
    expect(counts({ status: "failed", error: null, updatedAt: recent })).toBe(true);
    expect(counts({ status: "needs_regen", error: "Kling: provider 503", updatedAt: recent })).toBe(true);
    expect(counts({ status: "failed", error: "retired automatically: parked on reject since 2026-10-01T00:00:00.000Z (parked longer than 7 days)", updatedAt: recent })).toBe(false);
    // and the window still bounds it
    expect(counts({ status: "failed", error: null, updatedAt: "1970-01-01T00:00:00.000Z" })).toBe(false);
  });
});
