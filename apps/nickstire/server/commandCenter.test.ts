/**
 * Command center collector (milestone 10) — every section either carries real
 * rows or an explicit available:false. Silent zeros are the failure mode this
 * design exists to prevent.
 */
import { describe, expect, it, vi, afterEach } from "vitest";
import { DEFAULT_AUTONOMY_POLICY } from "../client/src/lib/autonomyPolicy";

afterEach(() => {
  vi.doUnmock("./db");
  vi.resetModules();
});

describe("collectCommandCenter", () => {
  it("with no storage at all: DEFAULT policy governs, source is honest, every data section is available:false", async () => {
    vi.doMock("./db", () => ({ getDb: vi.fn().mockResolvedValue(null) }));
    vi.resetModules();
    const { collectCommandCenter } = await import("./services/commandCenter");
    const s = await collectCommandCenter();

    expect(s.policy.version).toBe(DEFAULT_AUTONOMY_POLICY.version);
    expect(s.policy.source).toBe("fallback_unreachable");
    expect(s.spend.available).toBe(false);
    expect(s.spend.todayUsd).toBeNull();
    expect(s.reservations.available).toBe(false);
    expect(s.auditTail.available).toBe(false);
    expect(s.recentJobs.available).toBe(false);
  });

  it("with storage: sections fill from their tables and QA/repair state surfaces per job", async () => {
    const tableName = (t: Record<string, unknown>) =>
      "policyJson" in t ? "policy"
      : "reasoningCodes" in t ? "audit"
      : "windowStart" in t ? "reservations"
      : "actionId" in t ? "ledger"
      : "payload" in t ? "jobs"
      : "other";
    const rowsByTable: Record<string, unknown[]> = {
      policy: [],
      audit: [{ occurredAt: new Date(), actionType: "enqueue_render", decision: "ALLOW", reasoningCodes: "WITHIN_POLICY,actor:operator:admin", policyVersion: 1 }],
      reservations: [{ id: "resv_1", format: "reel", platform: "instagram", status: "reserved", windowStart: new Date(), topic: "freeze battery", cta: "BATTERY" }],
      ledger: [{ total: "1.50" }],
      jobs: [{ id: 9, status: "assembled", createdAt: new Date(), payload: JSON.stringify({ renderedQa: { decision: "repair" }, repairs: [{ beatNumber: 2 }] }) }],
    };
    const db = {
      select: () => ({
        from: (t: Record<string, unknown>) => {
          const rows = rowsByTable[tableName(t)] ?? [];
          const thenable = (r: unknown[]) => {
            const p = Promise.resolve(r) as Promise<unknown[]> & Record<string, unknown>;
            p.limit = () => Promise.resolve(r);
            p.orderBy = () => { const q = Promise.resolve(r) as Promise<unknown[]> & Record<string, unknown>; q.limit = () => Promise.resolve(r); return q; };
            return p;
          };
          return { where: () => thenable(rows), orderBy: () => thenable(rows), limit: () => Promise.resolve(rows) };
        },
      }),
      insert: () => ({ values: () => Promise.resolve({}) }),
      update: () => ({ set: () => ({ where: () => Promise.resolve({}) }) }),
    };
    vi.doMock("./db", () => ({ getDb: vi.fn().mockResolvedValue(db) }));
    vi.resetModules();
    const { collectCommandCenter } = await import("./services/commandCenter");
    const s = await collectCommandCenter();

    expect(s.spend.available).toBe(true);
    expect(s.spend.todayUsd).toBe(1.5);
    expect(s.spend.isEstimate).toBe(true);
    expect(s.reservations.available).toBe(true);
    expect(s.reservations.rows[0]).toMatchObject({ format: "reel", cta: "BATTERY", status: "reserved" });
    expect(s.auditTail.available).toBe(true);
    expect(s.auditTail.rows[0].reasoningCodes).toContain("WITHIN_POLICY");
    expect(s.recentJobs.available).toBe(true);
    expect(s.recentJobs.rows[0]).toMatchObject({ id: 9, status: "assembled", qaDecision: "repair", repairs: 1 });
  });

  it("an unparseable job payload degrades that job to status-only, not a crash", async () => {
    const db = {
      select: () => ({
        from: (t: Record<string, unknown>) => {
          const rows = "payload" in t ? [{ id: 3, status: "queued", createdAt: new Date(), payload: "{corrupt" }] : [];
          const thenable = (r: unknown[]) => {
            const p = Promise.resolve(r) as Promise<unknown[]> & Record<string, unknown>;
            p.limit = () => Promise.resolve(r);
            p.orderBy = () => { const q = Promise.resolve(r) as Promise<unknown[]> & Record<string, unknown>; q.limit = () => Promise.resolve(r); return q; };
            return p;
          };
          return { where: () => thenable(rows), orderBy: () => thenable(rows), limit: () => Promise.resolve(rows) };
        },
      }),
      insert: () => ({ values: () => Promise.resolve({}) }),
      update: () => ({ set: () => ({ where: () => Promise.resolve({}) }) }),
    };
    vi.doMock("./db", () => ({ getDb: vi.fn().mockResolvedValue(db) }));
    vi.resetModules();
    const { collectCommandCenter } = await import("./services/commandCenter");
    const s = await collectCommandCenter();
    expect(s.recentJobs.rows[0]).toMatchObject({ id: 3, qaDecision: null, repairs: 0 });
  });
});
