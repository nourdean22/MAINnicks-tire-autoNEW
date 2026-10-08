/**
 * `lot.health` EXECUTED, against a fake database, with rows in `camera_health_events`.
 *
 * Why this exists (review on #2929, P0): the handler declared two helpers (`bool`, `str`) AFTER
 * a closure that used them, and the coverage block called that closure before the declarations
 * ran. `tsc` does not track the temporal dead zone across closures, so the file compiled clean;
 * the handler threw `Cannot access 'str' before initialization` the first time a camera had an
 * anchor row -- which in production is every day after the first -- and the whole Lot health
 * read came back `ok: false`. Every existing test fed the pure helpers directly, so none of them
 * ever ran the handler with a row. This one does, with one anchor row and one same-state row
 * today, and reads the timeline, the live reconciliation and the coverage the Lot page renders.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  execute: async (_q: unknown): Promise<unknown> => [[], []],
}));

vi.mock("../db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../db")>()),
  // The admin middleware reads the security row through getDb: null is "no row", which the
  // READ path logs and falls back to pre-RBAC owner for. The handler under test is a query.
  getDb: async () => null,
  getDbTyped: async () => ({ execute: (q: unknown) => h.execute(q) }),
}));

import { lotRouter } from "./lot";
import type { TrpcContext } from "../_core/context";
import { BUSINESS } from "../../shared/business";
import { shopDayWindow } from "../../shared/shopState";
import { HEALTH_THRESHOLDS } from "../lib/cameraHealth";
import { resetStorableHeartbeatColumns } from "../lib/heartbeatStorableColumns";

type Flat = { text: string; params: unknown[] };

/** A drizzle `sql` object as the text mysql2 would see (whitespace collapsed) plus its params. */
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

function ctx(): TrpcContext {
  return {
    user: {
      id: 1, openId: "admin-user", email: "admin@nickstire.com", name: "Admin",
      loginMethod: "manus", role: "admin",
      createdAt: new Date(), updatedAt: new Date(), lastSignedIn: new Date(),
    },
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: { clearCookie: () => {} } as TrpcContext["res"],
  } as TrpcContext;
}

// Thursday 2026-10-08, 12:00 EDT: the shop is open 08:00-18:00 and the solar camera is awake.
const NOW_MS = Date.UTC(2026, 9, 8, 16, 0, 0);
const NOW_EPOCH = NOW_MS / 1000;
const AGE_SECONDS = 500;
const day = shopDayWindow(new Date(NOW_MS), BUSINESS.timezone, BUSINESS.hours.structured);
const DAY_START_EPOCH = day.dayStartMs / 1000;

/** The sign camera's latest heartbeat: 500 s old, so this read derives PRODUCER_OFFLINE. */
const signRuntime = {
  camera: "sign", producerInstanceId: "0f0abbba26066a27", producerVersion: "edge 2.3", gitSha: "ab5b91cb", heartbeatSeq: 105,
  mode: "PRODUCTION", commissioningRunId: null,
  ageSeconds: AGE_SECONDS, receivedAtEpoch: NOW_EPOCH - AGE_SECONDS,
  observedAtEdgeEpoch: NOW_EPOCH - AGE_SECONDS - 1, lastHealthyFrameAtEpoch: NOW_EPOCH - AGE_SECONDS - 2,
  sourceType: "rtsp", sourceGeneration: "v380", sourceConnected: 1, captureFps: 5, frameOk: 1, poseOk: 1, poseDelta: 0.1,
  authPlaneOk: null, eventPlaneOk: null, controlPlaneOk: null, mediaPlaneOk: null, ptzHomeOk: null,
  calibrationVersion: "cal-2026-09-28", detectorName: "yolo", modelSha256: "deadbeef", inferenceP95Ms: 40,
  outboxDepth: 0, oldestOutboxAgeSeconds: null, deadLetterDepth: 0, inferenceAgeSeconds: AGE_SECONDS,
  stateForSeconds: 4 * 3600, stateSinceEpoch: NOW_EPOCH - 4 * 3600, openVisits: 0,
};

type Fixtures = { anchor: Array<Record<string, unknown>>; today: Array<Record<string, unknown>> };

function install(fixtures: Fixtures): Flat[] {
  const executed: Flat[] = [];
  h.execute = async (q: unknown) => {
    const f = flat(q);
    executed.push(f);
    const t = f.text;
    if (t.includes("INFORMATION_SCHEMA.COLUMNS")) return [[], []];
    if (t.includes("FROM camera_runtime r")) return [[signRuntime], []];
    if (t.includes("FROM camera_health_events ORDER BY at DESC LIMIT 20")) return [[], []];
    if (t.includes("GROUP BY camera")) return [[], []];
    if (t.includes("WHERE at >= FROM_UNIXTIME(?)")) return [fixtures.today, []];
    if (t.includes("AND at < FROM_UNIXTIME(?)")) return [f.params[0] === "sign" ? fixtures.anchor : [], []];
    throw new Error(`lotHealth.test: unexpected query ${t.slice(0, 120)}`);
  };
  return executed;
}

async function health() {
  const res = await lotRouter.createCaller(ctx()).health();
  if (!res.ok) throw new Error(`lot.health failed: ${res.reason}`);
  return res;
}

describe("lot.health executed with rows in camera_health_events (review on #2929)", () => {
  beforeEach(() => {
    resetStorableHeartbeatColumns();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(NOW_MS));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("an anchored day: the handler runs (the P0), the open HEALTHY segment is cut where the live outage began, and coverage reads that", async () => {
    const executed = install({
      anchor: [{ camera: "sign", toState: "HEALTHY", reason: "first derived state: ok", atEpoch: DAY_START_EPOCH - 3600 }],
      // A same-state restart row at 09:00 is read through eventRow too, and says nothing new.
      today: [{ camera: "sign", fromState: "HEALTHY", toState: "HEALTHY", reason: "producer restarted (new instance id)", atEpoch: DAY_START_EPOCH + 9 * 3600 }],
    });
    const res = await health();
    expect(res.expected).toBe(3);
    expect(res.cameras).toHaveLength(3);

    const sign = res.cameras.find((c) => c.camera === "sign")!;
    expect(sign.state).toBe("PRODUCER_OFFLINE");
    expect(sign.stateForSeconds).toBe(AGE_SECONDS);
    // The outage began `offlineAfterSeconds` after the last heartbeat, on the heartbeat clock.
    const beganMs = (NOW_EPOCH - AGE_SECONDS + HEALTH_THRESHOLDS.offlineAfterSeconds) * 1000;
    expect(sign.timeline.anchorKnown).toBe(true);
    expect(sign.timeline.segments.map((s) => [s.state, s.fromMs, s.toMs, s.open])).toEqual([
      ["HEALTHY", day.dayStartMs, beganMs, false],
      ["PRODUCER_OFFLINE", beganMs, NOW_MS, true],
    ]);
    expect(sign.timeline.current).toEqual({ state: "PRODUCER_OFFLINE", sinceMs: beganMs, forSeconds: (NOW_MS - beganMs) / 1000 });

    // Coverage is the vehicle-truth camera's reconciled day: 4 h elapsed, the last 380 s not watched.
    const cov = res.coverage!;
    const watchedMs = NOW_MS - beganMs;
    expect(cov).toMatchObject({ camera: "sign", weekday: "thursday", anchorKnown: true, elapsedMinutes: 240, unknownMinutes: 0, solarMinutes: 0 });
    expect(cov.watchedMinutes).toBe(Math.round((4 * 3_600_000 - watchedMs) / 60_000));
    expect(cov.pct).toBeCloseTo((4 * 3_600_000 - watchedMs) / (4 * 3_600_000), 6);
    expect(cov.pctExpected).toBe(cov.pct);
    expect(cov.hours).toHaveLength(10);
    expect(cov.hours.map((x) => x.hour)).toEqual([8, 9, 10, 11, 12, 13, 14, 15, 16, 17]);
    expect(cov.hours[3]).toMatchObject({ elapsedMinutes: 60, unknownMinutes: 0, solarMinutes: 0 });
    expect(cov.hours[3].pct).toBeCloseTo((3_600_000 - watchedMs) / 3_600_000, 6);
    expect(cov.hours[4]).toMatchObject({ elapsedMinutes: 0, watchedMinutes: 0, pct: null });

    // The cameras with no heartbeat are listed, not hidden, and nothing is "steady" about a camera with no row.
    const office = res.cameras.find((c) => c.camera === "office")!;
    expect(office.state).toBe("NEVER_INGESTED");
    expect(office.timeline.current).toBeNull();
    expect(office.stability).toBeNull();

    // The anchor is the last row whose state actually CHANGED, and it is read per expected camera.
    const anchors = executed.filter((q) => q.text.includes("AND at < FROM_UNIXTIME(?)"));
    expect(anchors.map((q) => q.params[0])).toEqual(["sign", "inside", "office"]);
    for (const q of anchors) expect(q.text).toContain("AND (fromState IS NULL OR fromState <> toState) ORDER BY at DESC, id DESC LIMIT 1");
  });

  it("no anchor and no rows today: the day opens UNKNOWN up to the live outage, and unknown time is not watched", async () => {
    install({ anchor: [], today: [] });
    const res = await health();
    const sign = res.cameras.find((c) => c.camera === "sign")!;
    expect(sign.timeline.anchorKnown).toBe(false);
    expect(sign.timeline.segments.map((s) => s.state)).toEqual(["UNKNOWN", "PRODUCER_OFFLINE"]);
    const cov = res.coverage!;
    expect(cov.anchorKnown).toBe(false);
    expect(cov.watchedMinutes).toBe(0);
    expect(cov.pct).toBe(0);
    expect(cov.unknownMinutes + Math.round((NOW_MS - sign.timeline.current!.sinceMs) / 60_000)).toBe(240);
  });

  it("the stability counter does not count STALE as a drop, and the hourly expectation reads only the open hours", async () => {
    const executed = install({ anchor: [], today: [] });
    await health();
    const stability = executed.find((q) => q.text.includes("GROUP BY camera"))!;
    expect(stability.text).toContain("toState IN ('CAMERA_OFFLINE','DEGRADED_VISION','PRODUCER_OFFLINE'");
    expect(stability.text).not.toContain("'STALE'");
  });
});
