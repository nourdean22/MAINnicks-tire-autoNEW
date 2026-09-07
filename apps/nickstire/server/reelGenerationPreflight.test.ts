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
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

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

/**
 * The preflight now asks whether the KEY-BASED API lane is configured before it
 * probes the browser session, so this harness has to control that answer too.
 *
 * It was NOT mocked when the conditional landed, and the result was a CI-only
 * failure that passed alone: singleFork shares one `process.env`, a sibling
 * file leaks `HIGGSFIELD_API_KEY_ID`, the real resolver reads it, the API lane
 * looks configured, the session probe is skipped, and `res.error` is undefined
 * — `.toMatch()` then receives undefined. Exactly the order-dependent leak
 * AGENTS.md §3 warns about, caused by adding a dependency without extending
 * the mock surface that isolates this file from it.
 */
const getHiggsfieldApiCredentials = vi.hoisted(() => vi.fn());
vi.mock("./services/higgsfieldApiClient", () => ({ getHiggsfieldApiCredentials }));

import { processNextReelJob } from "./services/reelPipeline";

// 2026-08-20 · self-audit (workflow-confirmed P2): this file previously wrote
// process.env directly with no restore, leaking REEL_GENERATION_ENABLED and
// REEL_VIDEO_PROVIDER into every test that runs after it in the same
// singleFork process — the documented house rule (apps/nickstire/AGENTS.md
// §3: "restore-or-delete in afterEach/afterAll") that reelProviderFallbackChain.test.ts
// (the sibling this file was modeled on) already follows correctly.
// The two API-lane vars are saved/restored here as well. The resolver is
// mocked above so they no longer decide anything in this file, but a sibling
// that leaks them must not be able to reach in either — belt and braces, and
// the same restore-or-delete rule this block already documents.
const ENV_KEYS = [
  "REEL_GENERATION_ENABLED",
  "REEL_VIDEO_PROVIDER",
  "HIGGSFIELD_API_KEY_ID",
  "HIGGSFIELD_API_KEY_SECRET",
];
const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  dbState.claimCalls = 0;
  higgsfieldSessionHealth.mockReset();
  // Default: NO API lane, so the session is the only lane and the dead-session
  // abort below is reached. Each test that needs the other case says so.
  getHiggsfieldApiCredentials.mockReset();
  getHiggsfieldApiCredentials.mockResolvedValue(null);
  delete process.env.HIGGSFIELD_API_KEY_ID;
  delete process.env.HIGGSFIELD_API_KEY_SECRET;
  for (const k of ENV_KEYS) saved[k] = process.env[k];
  process.env.REEL_GENERATION_ENABLED = "true";
  process.env.REEL_VIDEO_PROVIDER = "higgsfield";
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
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

  it("does NOT abort on a dead session when the KEY-BASED API lane is configured", async () => {
    // Review P1 on #2170. higgsfieldStudio PREFERS the Cloud API whenever
    // getHiggsfieldApiCredentials() resolves, so aborting here on session
    // health meant that in the exact configuration the API lane exists to
    // rescue — keys present, browser session expired — generation still
    // refused to start, and blamed a session the render would never use.
    // Buying API credits would have unblocked nothing.
    getHiggsfieldApiCredentials.mockResolvedValue({ keyId: "k", keySecret: "s" });
    higgsfieldSessionHealth.mockResolvedValue({
      healthy: false,
      reason: "re-login required (refresh token revoked)",
      checkedAt: new Date("2026-08-20T12:00:00Z"),
    });

    const res = await processNextReelJob();

    // Must NOT carry the preflight abort. It proceeds to the claim path, which
    // in this harness finds no queued row — processed:false for a DIFFERENT
    // reason, exactly as the healthy-session case below.
    expect(res.error).toBeUndefined();
    expect(higgsfieldSessionHealth).not.toHaveBeenCalled();
  });

  it("canary — the API-lane bypass is what changed the verdict, not the mock", async () => {
    // Positive control for the test above: same dead session, same everything,
    // only the API credentials removed. If this did NOT abort, the assertion
    // above would be passing for a reason unrelated to its subject.
    getHiggsfieldApiCredentials.mockResolvedValue(null);
    higgsfieldSessionHealth.mockResolvedValue({
      healthy: false,
      reason: "re-login required (refresh token revoked)",
      checkedAt: new Date("2026-08-20T12:00:00Z"),
    });

    const res = await processNextReelJob();

    expect(res.error).toMatch(/preflight: higgsfield session dead/);
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
