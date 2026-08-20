/**
 * Reel generation preflight — abort BEFORE claiming a job, not after.
 *
 * 2026-08-20 · Higgsfield stock-fallback remediation, Phase 2. Before the
 * keystone guard, a dead Higgsfield session let `processNextReelJob` claim a
 * queued job (burning an attempt), then fail deep inside generation. The
 * preflight consults the SAME keepalive verdict the removed inline degrade
 * used to consult (`higgsfieldSessionHealth`, cron_log-backed, no CLI spawn)
 * and aborts the whole batch before any DB claim — no wasted attempt, no
 * partial job state, and the operator learns from ONE clean log line instead
 * of a claimed-then-failed row.
 *
 * `healthy === false` ONLY blocks. `null` (not-knowable: no row, stale
 * verdict, unreadable DB) must never block a working provider on a blind
 * spot — this is the same rule the pre-remediation code enforced.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const dbState = vi.hoisted(() => ({ claimCalls: 0 }));

vi.mock("../drizzle/schema", () => ({ reelJobs: {} }));
vi.mock("./db", () => ({
  getDb: async () => ({
    select: () => ({
      from: () => ({
        where: () => ({
          orderBy: () => ({ limit: () => Promise.resolve([]) }),
        }),
      }),
    }),
    update: () => {
      dbState.claimCalls += 1;
      return { set: () => ({ where: () => Promise.resolve([{ affectedRows: 0 }]) }) };
    },
  }),
}));

const higgsfieldSessionHealth = vi.hoisted(() => vi.fn());
vi.mock("./services/higgsfieldStudio", () => ({ higgsfieldSessionHealth }));
vi.mock("./services/veoStudio", () => ({ veoCredentialsPresent: () => false }));

import { processNextReelJob } from "./services/reelPipeline";

beforeEach(() => {
  dbState.claimCalls = 0;
  higgsfieldSessionHealth.mockReset();
  process.env.REEL_GENERATION_ENABLED = "true";
  process.env.REEL_VIDEO_PROVIDER = "higgsfield";
});

describe("reel generation preflight", () => {
  it("aborts BEFORE any DB claim when the keepalive proved the session dead", async () => {
    higgsfieldSessionHealth.mockResolvedValue({
      healthy: false,
      reason: "re-login required (refresh token revoked)",
      checkedAt: new Date("2026-08-20T12:00:00Z"),
    });

    const res = await processNextReelJob();

    expect(res.processed).toBe(false);
    expect(res.error).toMatch(/preflight: higgsfield session dead/);
    // The whole point: no job was ever queried or claimed for this dead run.
    expect(dbState.claimCalls).toBe(0);
  });

  it("proceeds to the normal claim path when the session is healthy", async () => {
    higgsfieldSessionHealth.mockResolvedValue({
      healthy: true,
      reason: "keepalive refreshed the session",
      checkedAt: new Date(),
    });

    const res = await processNextReelJob();

    // Reached the claim path (no queued rows in this harness → processed:false
    // for a DIFFERENT reason — but not the preflight's).
    expect(res.error).toBeUndefined();
    expect(res.processed).toBe(false);
  });

  it("does NOT block on an UNKNOWN verdict — a blind spot must never stop a working provider", async () => {
    higgsfieldSessionHealth.mockResolvedValue({
      healthy: null,
      reason: "keepalive last ran too long ago to vouch for the session",
      checkedAt: null,
    });

    const res = await processNextReelJob();

    expect(res.error).toBeUndefined();
  });

  it("never consults Higgsfield liveness for a different pinned provider", async () => {
    process.env.REEL_VIDEO_PROVIDER = "template_stock";
    higgsfieldSessionHealth.mockResolvedValue({ healthy: false, reason: "dead", checkedAt: new Date() });

    await processNextReelJob();

    expect(higgsfieldSessionHealth).not.toHaveBeenCalled();
  });
});
