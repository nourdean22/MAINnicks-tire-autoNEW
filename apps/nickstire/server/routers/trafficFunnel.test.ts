/**
 * trafficFunnel.overview declined-estimates action (2026-10-25).
 *
 * The action told the owner to "Enable FEATURE_DECLINED_RECOVERY=1" while the
 * declined-recovery texts were already running. The fix reads the same
 * recoverySendsEnabled rule the cron uses ("1" only), so the page cannot
 * disagree with the job. Every query returns the same one row; the router reads
 * only the keys it knows, so total/declined feed the alg_estimates branch and
 * the other stages read zero.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  row: { total: 20, declined: 18 } as Record<string, unknown>,
  hold: null as string | null,
  globalPause: { paused: false, readable: true } as { paused: boolean; readable: boolean },
}));
// Shop-wide SMS pause: sendSms queues every automated text while it is on (bug hunt 2026-10-27).
vi.mock("../services/smsControl", () => ({ getSmsPauseState: async () => h.globalPause }));

vi.mock("../db", () => {
  const db = { execute: async () => [[h.row]] };
  return { getDb: async () => db, getDbTyped: async () => db };
});
vi.mock("../pipelines/gsc-data", () => ({ getGscReport: async () => null }));
vi.mock("../services/sendPause", async (importOriginal) => ({ ...(await importOriginal<typeof import("../services/sendPause")>()), sendPauseHoldReason: async () => h.hold }));

import { trafficFunnelRouter } from "./trafficFunnel";

function ctx() {
  return {
    user: {
      id: 1, openId: "admin-user", email: "admin@nickstire.com", name: "admin", loginMethod: "manus",
      role: "admin", createdAt: new Date(), updatedAt: new Date(), lastSignedIn: new Date(),
    },
    req: { protocol: "https", headers: {} },
    res: { clearCookie: () => {} },
  } as never;
}

async function declinedAction() {
  const out = await trafficFunnelRouter.createCaller(ctx()).overview({ range: "30d" });
  return out.alerts.find((a) => a.title.endsWith("declined walk-in estimates"));
}

afterEach(() => {
  vi.unstubAllEnvs();
  h.hold = null;
  h.globalPause = { paused: false, readable: true };
});

describe("trafficFunnel.overview declined-estimates action", () => {
  it("recovery texts running: points at Money > Declined, never says to enable the flag", async () => {
    vi.stubEnv("FEATURE_DECLINED_RECOVERY", "1");
    const action = await declinedAction();
    expect(action?.title).toBe("18 declined walk-in estimates");
    expect(action?.fix).toContain("Money > Declined");
    expect(action?.fix).not.toContain("Enable FEATURE_DECLINED_RECOVERY");
  });

  it("flag unset: keeps the enable sentence", async () => {
    vi.stubEnv("FEATURE_DECLINED_RECOVERY", "");
    const action = await declinedAction();
    expect(action?.fix).toBe("Enable FEATURE_DECLINED_RECOVERY=1 to start 7d/30d SMS follow-ups.");
  });

  // 2026-10-26 audit: the cron also obeys send_pause_declined_recovery; the page used to read only the flag.
  it("flag on but the runtime pause holds: says paused, never running", async () => {
    vi.stubEnv("FEATURE_DECLINED_RECOVERY", "1");
    h.hold = "send_pause:declined_recovery";
    const action = await declinedAction();
    expect(action?.fix).toContain("paused");
    expect(action?.fix).not.toContain("running");
  });

  // Manager ruling 2026-10-26: a switch that cannot be read is UNKNOWN on this page, never "running" or "paused".
  it("flag on but the pause switch cannot be read: says unknown, neither running nor paused", async () => {
    vi.stubEnv("FEATURE_DECLINED_RECOVERY", "1");
    h.hold = "send_pause_unreadable:declined_recovery";
    const action = await declinedAction();
    expect(action?.fix).toMatch(/unknown/i);
    expect(action?.fix).not.toMatch(/running|paused/);
  });

  it("flag on, lane switch off, but the shop-wide SMS pause is on: says paused, never running", async () => {
    vi.stubEnv("FEATURE_DECLINED_RECOVERY", "1");
    h.globalPause = { paused: true, readable: true };
    const action = await declinedAction();
    expect(action?.fix).toContain("paused");
    expect(action?.fix).not.toContain("running");
  });

  it("flag on, lane switch off, shop-wide SMS pause unreadable: says unknown, neither running nor paused", async () => {
    vi.stubEnv("FEATURE_DECLINED_RECOVERY", "1");
    h.globalPause = { paused: false, readable: false };
    const action = await declinedAction();
    expect(action?.fix).toMatch(/unknown/i);
    expect(action?.fix).not.toMatch(/running|paused/);
  });

  it("says the walk-out is an inference (no matching invoice), never a recorded fact", async () => {
    const action = await declinedAction();
    expect(action?.detail).toMatch(/no matching invoice/);
    expect(action?.detail).toMatch(/most likely/);
  });

  it('flag "true" is off in the cron, so the page still says to enable it', async () => {
    vi.stubEnv("FEATURE_DECLINED_RECOVERY", "true");
    const action = await declinedAction();
    expect(action?.fix).toContain("Enable FEATURE_DECLINED_RECOVERY=1");
  });
});
