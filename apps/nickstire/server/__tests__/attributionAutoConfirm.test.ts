/**
 * Auto-confirm gate (job 2026-10-25-attribution-self-learning, PR 2).
 *
 * What these pin: an open band confirms ONE ruling per invoice with the measured numbers on
 * the row; a planted band under threshold writes nothing; a failed calibration read writes
 * nothing and says failed (never "closed", never "ok"); an invoice already confirmed, or a
 * racer's duplicate key, is counted as skipped and not thrown.
 */
import { describe, expect, it } from "vitest";

import { calibrateBands, type BandRuling } from "../lib/attributionCalibration";
import { autoConfirmCalibrated, type AutoConfirmCandidate, type CalibrationState } from "../services/attributionAutoConfirm";

// The decider string is a ledger contract (rollback and calibration both key on it), so it is pinned literally.
const AUTO_DECIDER = "auto:calibration-v1";

const rulings = (band: "strong" | "weak", confirmed: number, rejected: number): BandRuling[] => [
  ...Array.from({ length: confirmed }, () => ({ band, decision: "confirmed" as const, source: "human" as const })),
  ...Array.from({ length: rejected }, () => ({ band, decision: "rejected" as const, source: "human" as const })),
];
const calibration = (r: BandRuling[]): CalibrationState => ({
  status: "ok",
  measuredAt: "2026-10-25T12:00:00.000Z",
  ...calibrateBands(r),
  inputs: { humanRulings: r.length, recordedLinks: 0, linksScored: 0, linksNoClaim: 0, linksMissingCall: 0 },
  control: { callsWithPhone: 100, after14d: 10, before14d: 4 },
});
const cand = (callId: number, invoiceId: number, confidence: number, minute = 0): AutoConfirmCandidate => ({
  callId,
  invoiceId,
  resolution: "manual_review",
  confidence,
  matchMethod: "phone_time_service_candidate",
  leadId: null,
  bookingId: null,
  occurredAt: new Date(Date.UTC(2026, 9, 20, 12, minute)),
});

type Query = { sql: string; params: unknown[] };
/** Flatten a drizzle sql`` template into text + params (house pattern, cameraHealthAlerts.test.ts). */
function flat(q: { queryChunks: unknown[] }): Query {
  const text: string[] = [];
  const params: unknown[] = [];
  const walk = (chunks: unknown[]) => {
    for (const c of chunks) {
      if (c && typeof c === "object" && "queryChunks" in (c as object)) walk((c as { queryChunks: unknown[] }).queryChunks);
      else if (c && typeof c === "object" && "value" in (c as object) && Array.isArray((c as { value: unknown }).value)) text.push((c as { value: string[] }).value.join(""));
      else { params.push(c); text.push("?"); }
    }
  };
  walk(q.queryChunks);
  return { sql: text.join("").replace(/\s+/g, " ").trim(), params };
}
function fakeDb(opts: { affected?: number; throwOnInsert?: Error } = {}) {
  const queries: Query[] = [];
  return {
    queries,
    db: {
      execute: async (q: unknown) => {
        queries.push(flat(q as { queryChunks: unknown[] }));
        if (opts.throwOnInsert) throw opts.throwOnInsert;
        return [{ affectedRows: opts.affected ?? 1 }];
      },
    },
  };
}
const inserts = (qs: Query[]) => qs.filter((q) => /INSERT INTO revenue_attribution_decisions/.test(q.sql));

describe("autoConfirmCalibrated", () => {
  it("an open band writes one confirmed ruling per invoice, decided by the machine, with the numbers on the row", async () => {
    const { db, queries } = fakeDb();
    const out = await autoConfirmCalibrated(db, {
      runId: "run-1",
      calibration: calibration(rulings("weak", 30, 2)),
      candidates: [cand(1, 900, 0.75, 1), cand(2, 900, 0.75, 2), cand(3, 901, 0.75, 3)],
    });
    expect(out).toEqual({ status: "ok", eligible: 3, confirmed: 2, skipped: 1 });
    const ins = inserts(queries);
    expect(ins).toHaveLength(2);
    for (const q of ins) {
      expect(q.params).toContain(AUTO_DECIDER);
      // claim-before-act: the swap names every fact the decision read, not only "NOT EXISTS".
      expect(q.sql).toMatch(/NOT EXISTS \( SELECT 1 FROM revenue_attribution_decisions x WHERE x\.call_id = \? AND x\.current_slot = 1 \)/);
      expect(q.sql).toMatch(/NOT EXISTS \( SELECT 1 FROM revenue_attribution_decisions y WHERE y\.invoice_id = \? AND y\.current_slot = 1 AND y\.decision = 'confirmed' \)/);
      const evidence = q.params.find((p) => typeof p === "string" && p.startsWith("{")) as string;
      expect(JSON.parse(evidence)).toMatchObject({ via: "auto_confirm", band: "weak", right: 30, n: 32, precision: 30 / 32, queuedRunId: "run-1" });
    }
    // The earliest call wins the shared invoice (same rule as the review queue).
    expect(ins[0].params).toContain(1);
  });

  it("PLANTED: a band under threshold writes nothing and reports closed", async () => {
    const { db, queries } = fakeDb();
    const out = await autoConfirmCalibrated(db, {
      runId: "run-1",
      calibration: calibration(rulings("weak", 17, 3)),
      candidates: [cand(1, 900, 0.75)],
    });
    expect(out.status).toBe("closed");
    expect(inserts(queries)).toHaveLength(0);
  });

  it("an open weak band does not open strong: only the measured band confirms", async () => {
    const { db, queries } = fakeDb();
    const out = await autoConfirmCalibrated(db, {
      runId: "run-1",
      calibration: calibration(rulings("weak", 30, 0)),
      candidates: [cand(1, 900, 0.9), cand(2, 901, 0.75)],
    });
    expect(out.eligible).toBe(1);
    expect(inserts(queries)).toHaveLength(1);
    expect(inserts(queries)[0].params).toContain(2);
  });

  it("a failed calibration read writes nothing and says failed, never closed or ok", async () => {
    const { db, queries } = fakeDb();
    const out = await autoConfirmCalibrated(db, {
      runId: "run-1",
      calibration: { status: "failed", error: "ER_NO_SUCH_TABLE" },
      candidates: [cand(1, 900, 0.75)],
    });
    expect(out.status).toBe("failed");
    expect(out.error).toBe("ER_NO_SUCH_TABLE");
    expect(queries).toHaveLength(0);
  });

  it("an invoice already confirmed (0 rows affected) is skipped, not confirmed", async () => {
    const { db } = fakeDb({ affected: 0 });
    const out = await autoConfirmCalibrated(db, { runId: "r", calibration: calibration(rulings("weak", 30, 0)), candidates: [cand(1, 900, 0.75)] });
    expect(out).toEqual({ status: "ok", eligible: 1, confirmed: 0, skipped: 1 });
  });

  it("a racer's duplicate key is skipped, not thrown", async () => {
    const dup = Object.assign(new Error("Duplicate entry"), { code: "ER_DUP_ENTRY", errno: 1062 });
    const { db } = fakeDb({ throwOnInsert: dup });
    const out = await autoConfirmCalibrated(db, { runId: "r", calibration: calibration(rulings("weak", 30, 0)), candidates: [cand(1, 900, 0.75)] });
    expect(out).toEqual({ status: "ok", eligible: 1, confirmed: 0, skipped: 1 });
  });

  it("any other insert error stops the pass and reports failed with what landed", async () => {
    const { db } = fakeDb({ throwOnInsert: new Error("connection lost") });
    const out = await autoConfirmCalibrated(db, { runId: "r", calibration: calibration(rulings("weak", 30, 0)), candidates: [cand(1, 900, 0.75)] });
    expect(out.status).toBe("failed");
    expect(out.confirmed).toBe(0);
  });
});
