/**
 * The car-counter page reaches the owner through runCameraHealthAlerts (the existing 5-minute
 * pass), with its own claim family (lot_count:). Fake database, real policy and delivery rail.
 * The 10-24 shape: sign camera HEALTHY with detections, no visit row since it woke.
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

// Saturday 2026-10-24, 14:00 EDT: open, and well past the solar camera's ~10:00 wake.
const AFTERNOON_MS = Date.UTC(2026, 9, 24, 18, 0, 0);
// Same day, 11:00 EDT: open, camera awake about an hour.
const LATE_MORNING_MS = Date.UTC(2026, 9, 24, 15, 0, 0);

const CATALOG = ["detectionsLast10m", "portalCrossingsLast60m"].map((columnName) => ({ columnName }));

function healthySign(): Record<string, unknown> {
  const now = Math.floor(Date.now() / 1000);
  return {
    camera: "sign",
    producerInstanceId: "p1-shop-sign-test",
    heartbeatSeq: 500,
    ageSeconds: 5,
    observedAtEdgeEpoch: now,
    receivedAtEpoch: now,
    stateSinceEpoch: now - 4 * 3600,
    stateAgeSeconds: 4 * 3600,
    sourceConnected: 1,
    lastHealthyFrameAtEpoch: now - 1,
    frameOk: 1,
    poseOk: 1,
    calibrationVersion: "test-calib",
    outboxDepth: 0,
    oldestOutboxAgeSeconds: 0,
    deadLetterDepth: 0,
    inferenceAgeSeconds: 2,
    detectionsLast10m: 273,
    portalCrossingsLast60m: 0,
  };
}

function install(arrivals: number | Error): Flat[] {
  const executed: Flat[] = [];
  h.execute = async (q: unknown) => {
    const f = flat(q);
    executed.push(f);
    const t = f.text;
    if (t.includes("INFORMATION_SCHEMA.COLUMNS")) return [CATALOG, []];
    if (t.includes("lastConversationPostAt")) return [[], []];
    if (t.includes("FROM camera_runtime")) return [[healthySign()], []];
    if (t.includes("FROM vehicle_visits")) {
      if (arrivals instanceof Error) throw arrivals;
      return [[{ n: arrivals }], []];
    }
    if (t.includes("FROM camera_health_events")) return [[{ toState: "HEALTHY", atEpoch: Math.floor(Date.now() / 1000) - 3600 }], []];
    if (t.includes("INSERT INTO camera_health_events")) return [{ affectedRows: 1 }, []];
    if (t.includes("FROM cron_alerts_fired WHERE alert_key LIKE")) return [[], []];
    if (t.includes("INSERT IGNORE INTO cron_alerts_fired")) return [{ affectedRows: 1 }, []];
    if (t.includes("DELETE FROM cron_alerts_fired")) return [{ affectedRows: 1 }, []];
    throw new Error(`lotCountingAlertRun.test: unexpected query ${t.slice(0, 120)}`);
  };
  return executed;
}

const lotClaims = (executed: Flat[]) =>
  executed
    .filter((q) => q.text.includes("INSERT IGNORE INTO cron_alerts_fired") && String(q.params[0]).startsWith("lot_count:"))
    .map((q) => String(q.params[0]));
const lotTexts = () => h.telegram.mock.calls.map((c) => String(c[0])).filter((t) => t.includes("Car counter"));

beforeEach(() => {
  resetStorableHeartbeatColumns();
  h.notify.mockReset().mockResolvedValue({ emailSent: false, pushSent: false });
  h.telegram.mockReset().mockResolvedValue(true);
  vi.stubEnv("NOTIFICATION_WEBHOOK_URL", "");
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(AFTERNOON_MS));
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe("car counter: NOT_COUNTING on the camera-health pass", () => {
  it("healthy, seeing, 0 cars since the camera woke: pages once in its own claim family", async () => {
    const executed = install(0);
    const result = await runCameraHealthAlerts();
    const claims = lotClaims(executed);
    expect(claims).toHaveLength(1);
    expect(claims[0]).toMatch(/^lot_count:sign:e\d+:NOT_COUNTING$/);
    expect(lotTexts()).toHaveLength(1);
    expect(lotTexts()[0]).toContain("sees cars but counts none");
    expect(result.details).toContain("car-counter=NOT_COUNTING");
  });

  it("CONTROL: two cars counted is counting, no page", async () => {
    const executed = install(2);
    const result = await runCameraHealthAlerts();
    expect(lotClaims(executed)).toEqual([]);
    expect(result.details).toContain("car-counter=COUNTING");
  });

  it("under 3 hours awake is not judged", async () => {
    vi.setSystemTime(new Date(LATE_MORNING_MS));
    const executed = install(0);
    await runCameraHealthAlerts();
    expect(lotClaims(executed)).toEqual([]);
  });

  it("a failed arrivals read fails the run and pages nothing", async () => {
    const executed = install(new Error("tidb down"));
    await expect(runCameraHealthAlerts()).rejects.toThrow(/car counter read failed: tidb down/);
    expect(lotClaims(executed)).toEqual([]);
  });

  it("the arrivals read is scoped to production, non-preexisting sign rows since the watch began", async () => {
    const executed = install(0);
    await runCameraHealthAlerts();
    const q = executed.find((e) => e.text.includes("FROM vehicle_visits"));
    expect(q?.text).toContain("dataClass = 'PRODUCTION' AND preexisting = 0");
    expect(q?.params[0]).toBe("sign");
    expect(Number(q?.params[1])).toBeLessThan(Math.floor(AFTERNOON_MS / 1000) - 3 * 3600);
  });
});
