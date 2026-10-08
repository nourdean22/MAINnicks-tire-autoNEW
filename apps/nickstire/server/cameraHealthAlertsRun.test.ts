/**
 * `runCameraHealthAlerts` EXECUTED against a fake database with every delivery rail refusing.
 *
 * Review on #2929 (P1): the page for one camera is delivered inside the per-camera loop, and
 * `deliverWithConfirmedNotification` THROWS when no rail accepts (after releasing the claim).
 * That throw ended the loop, so on a tick where the sign camera's page could not be delivered
 * the office camera was never judged, recorded or paged -- a notification outage silently
 * became a monitoring outage for every camera after the first. The loop now keeps the failure
 * and continues; the run still fails loudly at the end.
 *
 * Pre-fix receipt (this file against 2eee1c18): one claim, one release, the office camera
 * never reached. Post-fix: two of each, then the delivery error.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  execute: async (_q: unknown): Promise<unknown> => [[], []],
  notify: vi.fn(),
  telegram: vi.fn(),
}));

// The service reaches all three lazily (`import()` at call time), and nothing else in its
// static graph imports them, so minimal factories are enough and carry no side effects.
vi.mock("./db", () => ({ getDb: async () => ({ execute: (q: unknown) => h.execute(q) }) }));
vi.mock("./email-notify", () => ({ notifySystemAlert: (...a: unknown[]) => h.notify(...a) }));
vi.mock("./services/telegram", () => ({ sendTelegram: (...a: unknown[]) => h.telegram(...a) }));

import { runCameraHealthAlerts } from "./services/cameraHealthAlerts";
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

// Thursday 2026-10-08, 12:00 EDT: daylight, so the solar sign camera gets no excuse either.
const NOW_MS = Date.UTC(2026, 9, 8, 16, 0, 0);
const NOW_EPOCH = NOW_MS / 1000;

/** A heartbeat 500 s old: PRODUCER_OFFLINE for a fixed camera and for the PTZ one alike. */
const offlineRow = (camera: string) => ({
  camera, producerInstanceId: `${camera}-p1`, heartbeatSeq: 100,
  ageSeconds: 500, observedAtEdgeEpoch: NOW_EPOCH - 501, receivedAtEpoch: NOW_EPOCH - 500, stateSinceEpoch: NOW_EPOCH - 7200,
  sourceConnected: 1, lastHealthyFrameAtEpoch: NOW_EPOCH - 502, frameOk: 1, poseOk: 1, calibrationVersion: "c1",
  authPlaneOk: 1, eventPlaneOk: 1, controlPlaneOk: 1, mediaPlaneOk: 1, ptzHomeOk: 1,
  outboxDepth: 0, oldestOutboxAgeSeconds: null, deadLetterDepth: 0, inferenceAgeSeconds: 500,
});

function install(): Flat[] {
  const executed: Flat[] = [];
  h.execute = async (q: unknown) => {
    const f = flat(q);
    executed.push(f);
    const t = f.text;
    if (t.includes("INFORMATION_SCHEMA.COLUMNS")) return [[], []];
    if (t.includes("FROM camera_runtime")) return [[offlineRow("sign"), offlineRow("office")], []];
    // Both the pre- and post-review read shapes, so a run against the pre-fix service fails on
    // the claim count (the behaviour under test), not on this router.
    if (t.includes("FROM camera_health_events WHERE camera = ?")) return [[], []];
    if (t.includes("INSERT INTO camera_health_events")) return [{ affectedRows: 1 }, []];
    if (t.includes("FROM cron_alerts_fired WHERE alert_key LIKE")) return [[], []];
    if (t.includes("INSERT IGNORE INTO cron_alerts_fired")) return [{ affectedRows: 1 }, []];
    if (t.includes("DELETE FROM cron_alerts_fired")) return [{ affectedRows: 1 }, []];
    throw new Error(`cameraHealthAlertsRun.test: unexpected query ${t.slice(0, 120)}`);
  };
  return executed;
}

const claims = (executed: Flat[]) => executed.filter((q) => q.text.includes("INSERT IGNORE INTO cron_alerts_fired"));
const releases = (executed: Flat[]) => executed.filter((q) => q.text.includes("DELETE FROM cron_alerts_fired"));
const timelineWrites = (executed: Flat[]) => executed.filter((q) => q.text.includes("INSERT INTO camera_health_events"));

describe("runCameraHealthAlerts -- one camera's undeliverable page does not stop the next camera (review on #2929)", () => {
  beforeEach(() => {
    resetStorableHeartbeatColumns();
    h.notify.mockReset();
    h.telegram.mockReset();
    vi.stubEnv("NOTIFICATION_WEBHOOK_URL", "");
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(NOW_MS));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("every rail refusing: BOTH cameras are recorded, claimed and released, then the run fails with the delivery error", async () => {
    h.notify.mockResolvedValue({ emailSent: false, pushSent: false });
    h.telegram.mockResolvedValue(false);
    const executed = install();

    await expect(runCameraHealthAlerts()).rejects.toThrow(/no delivery surface accepted/);

    expect(timelineWrites(executed).map((q) => q.params.slice(0, 3))).toEqual([
      ["sign", null, "PRODUCER_OFFLINE"],
      ["office", null, "PRODUCER_OFFLINE"],
    ]);
    const claimed = claims(executed);
    expect(claimed).toHaveLength(2);
    expect(String(claimed[0].params[0])).toMatch(/^camera_health:sign:e\d+:PRODUCER_OFFLINE$/);
    expect(String(claimed[1].params[0])).toMatch(/^camera_health:office:e\d+:PRODUCER_OFFLINE$/);
    // Each undelivered claim is released, so both pages are retried next tick.
    expect(releases(executed)).toHaveLength(2);
    expect(h.telegram).toHaveBeenCalledTimes(2);
  });

  it("POSITIVE CONTROL: with Telegram accepting, the same tick pages both cameras and reports them", async () => {
    h.notify.mockResolvedValue({ emailSent: false, pushSent: false });
    h.telegram.mockResolvedValue(true);
    const executed = install();

    const result = await runCameraHealthAlerts();
    expect(result.recordsProcessed).toBe(2);
    expect(result.details).toContain("2 alert(s)");
    expect(result.details).toContain("2 timeline transition(s) recorded");
    expect(result.details).toContain("sign=PRODUCER_OFFLINE, office=PRODUCER_OFFLINE");
    expect(claims(executed)).toHaveLength(2);
    expect(releases(executed)).toHaveLength(0);
  });

  it("the timeline rows are stamped where the outage began on the heartbeat clock, not at the tick", async () => {
    h.notify.mockResolvedValue({ emailSent: false, pushSent: false });
    h.telegram.mockResolvedValue(true);
    const executed = install();
    await runCameraHealthAlerts();
    for (const w of timelineWrites(executed)) {
      expect(w.text).toContain("FROM_UNIXTIME(?))");
      // receivedAt (now - 500 s) + offlineAfterSeconds (120 s)
      expect(w.params.at(-1)).toBe(NOW_EPOCH - 500 + 120);
    }
  });
});
