/**
 * A missed or failed nightly TiDB backup must reach the owner. The safety check
 * (hourly tier, critical alerts always sent) is the existing path; this pins that
 * it reads the tidb-backup job's last COMPLETED run, so a night that failed and a
 * night that never ran both count as "no backup", and that it stays silent while
 * the job is switched off.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

let tidbAgeMinutes: unknown = null;
let tidbQueryThrows = false;
const queries: string[] = [];

vi.mock("../db", () => ({
  getDb: async () => ({
    execute: async (q: { queryChunks?: unknown }) => {
      const text = JSON.stringify(q.queryChunks ?? q);
      queries.push(text);
      if (text.includes("tidb-backup")) {
        if (tidbQueryThrows) throw new Error("Table 'cron_log' is locked");
        return [[{ age_min: tidbAgeMinutes }], []];
      }
      if (text.includes("db-backup")) return [[{ completed_at: new Date().toISOString() }], []];
      if (text.includes("SELECT 1")) return [[{ 1: 1 }], []];
      return [[{ cnt: 0 }], []];
    },
  }),
}));

const saved = process.env.TIDB_BACKUP_ENABLED;
beforeEach(() => {
  queries.length = 0;
  tidbAgeMinutes = null;
  tidbQueryThrows = false;
});
afterEach(() => {
  if (saved === undefined) delete process.env.TIDB_BACKUP_ENABLED;
  else process.env.TIDB_BACKUP_ENABLED = saved;
});

const tidbAlerts = (alerts: Array<{ severity: string; message: string }>) => alerts.filter((a) => /TiDB backup/i.test(a.message));

describe("safety check · nightly TiDB backup freshness", () => {
  it("is silent while TIDB_BACKUP_ENABLED is off", async () => {
    delete process.env.TIDB_BACKUP_ENABLED;
    const { checkDataSafety } = await import("./safetyMonitor");
    const r = await checkDataSafety();
    expect(tidbAlerts(r.alerts)).toEqual([]);
  });

  it("a backup completed 20h ago is fresh: no alert", async () => {
    process.env.TIDB_BACKUP_ENABLED = "true";
    tidbAgeMinutes = "1200";
    const { checkDataSafety } = await import("./safetyMonitor");
    expect(tidbAlerts((await checkDataSafety()).alerts)).toEqual([]);
    expect(queries.some((q) => q.includes("tidb-backup") && q.includes("completed"))).toBe(true);
  });

  it("no completed backup in 30h (a missed or failed night) is critical", async () => {
    process.env.TIDB_BACKUP_ENABLED = "true";
    tidbAgeMinutes = "1800";
    const { checkDataSafety } = await import("./safetyMonitor");
    const a = tidbAlerts((await checkDataSafety()).alerts);
    expect(a).toHaveLength(1);
    expect(a[0].severity).toBe("critical");
    expect(a[0].message).toMatch(/30h/);
  });

  it("enabled but never completed is critical", async () => {
    process.env.TIDB_BACKUP_ENABLED = "true";
    tidbAgeMinutes = null;
    const { checkDataSafety } = await import("./safetyMonitor");
    const a = tidbAlerts((await checkDataSafety()).alerts);
    expect(a.map((x) => x.severity)).toEqual(["critical"]);
    expect(a[0].message).toMatch(/never/i);
  });

  it("a failed freshness read is reported, never read as fresh", async () => {
    process.env.TIDB_BACKUP_ENABLED = "true";
    tidbQueryThrows = true;
    const { checkDataSafety } = await import("./safetyMonitor");
    const a = tidbAlerts((await checkDataSafety()).alerts);
    expect(a).toHaveLength(1);
    expect(a[0].message).toMatch(/unknown/i);
  });
});
