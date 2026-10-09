/**
 * A one-heartbeat flicker does not page (2026-10-09).
 *
 * On the night of 2026-10-08 the sign camera's heartbeat dipped out of HEALTHY for a single
 * heartbeat (about 30 s) four times: CALIBRATION_INVALID at 00:42Z, 03:18Z and 09:00Z, and
 * UNVERIFIED_CAPABILITIES at 08:15:18Z. The five-minute pass at 08:15:22Z sampled the last one
 * 4 s in and paged the owner at 04:15 ET ("camera health alert fired", episode 1791533718); the
 * camera was HEALTHY again at 08:15:52Z, and the 30-minute cooldown then held the recovery page
 * until 08:45:22Z. Two pages in the night for nothing.
 *
 * A state the PRODUCER reported now pages once it has held for the offline SLO (120 s), or when
 * the camera keeps flickering (3 entries into a paging state in 30 minutes). The liveness
 * states keep their own clock, and an unknown state age or flicker count pages as before.
 *
 * Driven through the real `runCameraHealthAlerts` against a fake database, as
 * cameraHealthAlertsRun.test.ts does.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  execute: async (_q: unknown): Promise<unknown> => [[], []],
  notify: vi.fn(),
  telegram: vi.fn(),
}));

vi.mock("./db", () => ({ getDb: async () => ({ execute: (q: unknown) => h.execute(q) }) }));
vi.mock("./email-notify", () => ({ notifySystemAlert: (...a: unknown[]) => h.notify(...a) }));
vi.mock("./services/telegram", () => ({ sendTelegram: (...a: unknown[]) => h.telegram(...a) }));

import { runCameraHealthAlerts } from "./services/cameraHealthAlerts";
import { cameraAlertAwaitsPersistence } from "./services/cameraHealthAlertPolicy";
import { resetStorableHeartbeatColumns } from "./lib/heartbeatStorableColumns";

type Flat = { text: string; params: unknown[] };

function flat(q: unknown): Flat {
  const text: string[] = [];
  const params: unknown[] = [];
  const walk = (chunks: unknown[]) => {
    for (const c of chunks) {
      if (c && typeof c === "object" && "queryChunks" in (c as object)) walk((c as { queryChunks: unknown[] }).queryChunks);
      else if (c && typeof c === "object" && "value" in (c as object) && Array.isArray((c as { value: unknown }).value)) text.push((c as { value: string[] }).value.join(""));
      else { params.push(c); text.push("?"); }
    }
  };
  walk((q as { queryChunks: unknown[] }).queryChunks);
  return { text: text.join("").replace(/\s+/g, " ").trim(), params };
}

// 2026-10-09 08:15:22Z, the pass that paged.
const NOW_MS = Date.UTC(2026, 9, 9, 8, 15, 22);
const NOW_EPOCH = NOW_MS / 1000;

/**
 * The sign heartbeat at 08:15:18Z: fresh, but with the source unreported, so the lattice reads
 * UNVERIFIED_CAPABILITIES ("one or more required fixed-camera health facets have not been
 * proven yet") -- the state production derived. `stateAgeSeconds` is what the pass reads.
 */
const flickerRow = (stateAgeSeconds: number | null) => ({
  camera: "sign", producerInstanceId: "b1660f14fba214cc", heartbeatSeq: 1123,
  ageSeconds: 4, observedAtEdgeEpoch: NOW_EPOCH - 5, receivedAtEpoch: NOW_EPOCH - 4,
  stateSinceEpoch: stateAgeSeconds === null ? null : NOW_EPOCH - stateAgeSeconds,
  stateAgeSeconds,
  sourceConnected: null, lastHealthyFrameAtEpoch: NOW_EPOCH - 5, frameOk: 1, poseOk: 1, calibrationVersion: "c1",
  authPlaneOk: null, eventPlaneOk: null, controlPlaneOk: null, mediaPlaneOk: null, ptzHomeOk: null,
  outboxDepth: 0, oldestOutboxAgeSeconds: null, deadLetterDepth: 0, inferenceAgeSeconds: 5,
});

function install(opts: { stateAgeSeconds: number | null; flickers: number | Error }): Flat[] {
  const executed: Flat[] = [];
  h.execute = async (q: unknown) => {
    const f = flat(q);
    executed.push(f);
    const t = f.text;
    if (t.includes("INFORMATION_SCHEMA.COLUMNS")) return [[], []];
    // The office camera is not part of this replay; only the sign row comes back (the office
    // reads as NEVER_INGESTED and is asserted on by camera, never counted with the sign).
    if (t.includes("FROM camera_runtime")) return [[flickerRow(opts.stateAgeSeconds)], []];
    if (t.includes("COUNT(*)") && t.includes("FROM camera_health_events")) {
      if (opts.flickers instanceof Error) throw opts.flickers;
      return [[{ n: opts.flickers }], []];
    }
    if (t.includes("FROM camera_health_events WHERE camera = ?")) return [[{ toState: "HEALTHY", atEpoch: NOW_EPOCH - 3600 }], []];
    if (t.includes("INSERT INTO camera_health_events")) return [{ affectedRows: 1 }, []];
    if (t.includes("FROM cron_alerts_fired WHERE alert_key LIKE")) return [[], []];
    if (t.includes("INSERT IGNORE INTO cron_alerts_fired")) return [{ affectedRows: 1 }, []];
    if (t.includes("DELETE FROM cron_alerts_fired")) return [{ affectedRows: 1 }, []];
    throw new Error(`cameraHealthAlertsFlicker.test: unexpected query ${t.slice(0, 120)}`);
  };
  return executed;
}

const signClaims = (executed: Flat[]) =>
  executed.filter((q) => q.text.includes("INSERT IGNORE INTO cron_alerts_fired") && String(q.params[0]).startsWith("camera_health:sign:"));
const signTimeline = (executed: Flat[]) =>
  executed.filter((q) => q.text.includes("INSERT INTO camera_health_events") && q.params[0] === "sign");

describe("runCameraHealthAlerts -- a one-heartbeat flicker does not page (2026-10-09 08:15:22Z)", () => {
  beforeEach(() => {
    resetStorableHeartbeatColumns();
    h.notify.mockReset();
    h.telegram.mockReset();
    h.notify.mockResolvedValue({ emailSent: false, pushSent: false });
    h.telegram.mockResolvedValue(true);
    vi.stubEnv("NOTIFICATION_WEBHOOK_URL", "");
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(NOW_MS));
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  it("the replay: UNVERIFIED_CAPABILITIES 4 s old, no other flicker in 30 min -- no page, the timeline row is still written", async () => {
    const executed = install({ stateAgeSeconds: 4, flickers: 1 });
    const result = await runCameraHealthAlerts();

    expect(signClaims(executed)).toHaveLength(0);
    expect(result.details).toContain("sign=UNVERIFIED_CAPABILITIES");
    expect(result.details).toMatch(/1 state\(s\) under 120 s not paged yet/);
    // The gate holds the PAGE, not the record: the timeline still says what was derived.
    expect(signTimeline(executed).map((q) => q.params.slice(0, 3))).toEqual([["sign", "HEALTHY", "UNVERIFIED_CAPABILITIES"]]);
    // The flicker count reads the last 30 minutes of paging entries for this camera, in SQL.
    const count = executed.find((q) => q.text.includes("COUNT(*)"));
    expect(count?.text).toContain("at >= NOW() - INTERVAL ? SECOND");
    expect(count?.params.slice(0, 2)).toEqual(["sign", 1800]);
    expect(count?.params.slice(2)).toEqual(["HEALTHY", "STALE", "EXPECTED_SOLAR_OFFLINE"]);
  });

  it("POSITIVE CONTROL: the same state still standing at 130 s pages, keyed on the episode it began", async () => {
    const executed = install({ stateAgeSeconds: 130, flickers: 1 });
    const result = await runCameraHealthAlerts();

    const claimed = signClaims(executed);
    expect(claimed).toHaveLength(1);
    expect(claimed[0].params[0]).toBe(`camera_health:sign:e${NOW_EPOCH - 130}:UNVERIFIED_CAPABILITIES`);
    expect(result.details).not.toContain("not paged yet");
    // Old enough on its own: the flicker count is not even read.
    expect(executed.some((q) => q.text.includes("COUNT(*)"))).toBe(false);
  });

  it("a camera that keeps flickering pages although no single state lasts (3 entries in 30 min)", async () => {
    const executed = install({ stateAgeSeconds: 4, flickers: 3 });
    await runCameraHealthAlerts();
    expect(signClaims(executed)).toHaveLength(1);
  });

  it("unknown is never quiet: an unreadable flicker count pages as before", async () => {
    const executed = install({ stateAgeSeconds: 4, flickers: new Error("Lost connection to MySQL server during query") });
    await runCameraHealthAlerts();
    expect(signClaims(executed)).toHaveLength(1);
  });

  it("unknown is never quiet: a state with no recorded start pages as before", async () => {
    const executed = install({ stateAgeSeconds: null, flickers: 1 });
    await runCameraHealthAlerts();
    expect(signClaims(executed)).toHaveLength(1);
  });
});

describe("cameraAlertAwaitsPersistence", () => {
  const young = { stateAgeSeconds: 4, recentPagingEntries: 1 };

  it("holds a young producer-reported paging state", () => {
    for (const state of ["UNVERIFIED_CAPABILITIES", "CALIBRATION_INVALID", "CAMERA_OFFLINE", "DEGRADED_VISION", "CLOUD_BACKLOG"] as const) {
      expect(cameraAlertAwaitsPersistence({ state, ...young })).toBe(true);
    }
  });

  it("never holds a liveness state, a never-ingested camera or a non-paging state", () => {
    for (const state of ["PRODUCER_OFFLINE", "STALE", "EXPECTED_SOLAR_OFFLINE", "NEVER_INGESTED", "HEALTHY"] as const) {
      expect(cameraAlertAwaitsPersistence({ state, ...young })).toBe(false);
    }
  });

  it("releases at the offline SLO (120 s), on the third flicker, and on any unknown", () => {
    const s = "CALIBRATION_INVALID" as const;
    expect(cameraAlertAwaitsPersistence({ state: s, stateAgeSeconds: 119, recentPagingEntries: 2 })).toBe(true);
    expect(cameraAlertAwaitsPersistence({ state: s, stateAgeSeconds: 120, recentPagingEntries: 2 })).toBe(false);
    expect(cameraAlertAwaitsPersistence({ state: s, stateAgeSeconds: 4, recentPagingEntries: 3 })).toBe(false);
    expect(cameraAlertAwaitsPersistence({ state: s, stateAgeSeconds: null, recentPagingEntries: 0 })).toBe(false);
    expect(cameraAlertAwaitsPersistence({ state: s, stateAgeSeconds: 4, recentPagingEntries: null })).toBe(false);
    expect(cameraAlertAwaitsPersistence({ state: s, stateAgeSeconds: Number.NaN, recentPagingEntries: 0 })).toBe(false);
  });
});
