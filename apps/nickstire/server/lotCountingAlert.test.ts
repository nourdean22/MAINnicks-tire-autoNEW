/**
 * The car counter pages when the sign camera is awake and seeing but nothing is counted (job
 * 2026-10-26-lot-vision-v2). 2026-10-24 and 10-25: the camera reported HEALTHY most open minutes
 * with detections flowing (273 in 10 min at one read) and 0 portal crossings, vehicle_visits got 0
 * rows of any kind, and nothing paged, because HEALTHY + detections reads as "seeing".
 */
import { describe, expect, it } from "vitest";
import {
  lotCountingAlertClaim,
  lotCountingAlertDecision,
  lotCountingVerdict,
  lotWatchedSinceMs,
} from "./services/lotCountingAlert";

const H = 60 * 60_000;
const THREE_HOURS = 3 * H; // the documented page line
// 2026-10-24 (a Saturday) 14:00 ET = 18:00Z; the camera woke about 10:21 ET (14:21Z).
const now = Date.parse("2026-10-24T18:00:00Z");
const woke = Date.parse("2026-10-24T14:21:00Z");

const base = {
  shopOpen: true,
  cameraState: "HEALTHY",
  detectionsLast10m: 273,
  watchedSinceMs: woke,
  nowMs: now,
  arrivalsSinceWatched: 0,
};

describe("lotCountingVerdict", () => {
  it("pages the 10-24 shape: awake, healthy, seeing, 3+ hours, 0 counted", () => {
    const v = lotCountingVerdict(base);
    expect(v.state).toBe("NOT_COUNTING");
    expect(v.reason).toContain("0 cars counted");
  });

  it("does not page before 3 hours of watching", () => {
    expect(lotCountingVerdict({ ...base, nowMs: woke + THREE_HOURS - 60_000 }).state).toBe("NOT_JUDGED");
    expect(lotCountingVerdict({ ...base, nowMs: woke + THREE_HOURS }).state).toBe("NOT_COUNTING");
  });

  it("one counted car is counting", () => {
    expect(lotCountingVerdict({ ...base, arrivalsSinceWatched: 1 }).state).toBe("COUNTING");
  });

  it("a failed arrivals read is never a verdict", () => {
    expect(lotCountingVerdict({ ...base, arrivalsSinceWatched: null }).state).toBe("NOT_JUDGED");
  });

  it("a camera that is not HEALTHY is the camera alert's job", () => {
    for (const s of ["DEGRADED_VISION", "CAMERA_OFFLINE", "PRODUCER_OFFLINE", "EXPECTED_SOLAR_OFFLINE"]) {
      expect(lotCountingVerdict({ ...base, cameraState: s }).state).toBe("NOT_JUDGED");
    }
  });

  it("no detections or unknown detections is quiet, not a counting fault", () => {
    expect(lotCountingVerdict({ ...base, detectionsLast10m: 0 }).state).toBe("NOT_JUDGED");
    expect(lotCountingVerdict({ ...base, detectionsLast10m: null }).state).toBe("NOT_JUDGED");
  });

  it("closed shop or no watch window is not judged", () => {
    expect(lotCountingVerdict({ ...base, shopOpen: false }).state).toBe("NOT_JUDGED");
    expect(lotCountingVerdict({ ...base, watchedSinceMs: null }).state).toBe("NOT_JUDGED");
  });
});

describe("lotWatchedSinceMs", () => {
  const open = Date.parse("2026-10-24T12:00:00Z"); // 08:00 ET
  it("is the later of opening and the solar camera waking", () => {
    expect(lotWatchedSinceMs({ openMs: open, nowMs: now, solar: { expectedOffline: false, fromMs: woke } })).toBe(woke);
    expect(lotWatchedSinceMs({ openMs: open, nowMs: now, solar: null })).toBe(open);
  });
  it("starts when the camera last became healthy, if that is later (offline 10:00-12:59, healthy at 13:00)", () => {
    const healthyAt = Date.parse("2026-10-24T17:00:00Z"); // 13:00 ET
    const since = lotWatchedSinceMs({ openMs: open, nowMs: now, solar: { expectedOffline: false, fromMs: woke }, healthySinceMs: healthyAt });
    expect(since).toBe(healthyAt);
    expect(lotCountingVerdict({ ...base, watchedSinceMs: since, nowMs: healthyAt + 60_000 }).state).toBe("NOT_JUDGED");
  });
  it("is null while the solar camera is expected dark, before opening, or with no hours", () => {
    expect(lotWatchedSinceMs({ openMs: open, nowMs: now, solar: { expectedOffline: true, fromMs: woke } })).toBeNull();
    expect(lotWatchedSinceMs({ openMs: now + H, nowMs: now, solar: null })).toBeNull();
    expect(lotWatchedSinceMs({ openMs: null, nowMs: now, solar: null })).toBeNull();
  });
});

describe("lotCountingAlertDecision and claim", () => {
  it("pages a fault unless the cooldown holds it", () => {
    expect(lotCountingAlertDecision("NOT_COUNTING", null, null)).toEqual({ notify: true, recovery: false, held: false });
    expect(lotCountingAlertDecision("NOT_COUNTING", null, 60)).toMatchObject({ notify: false, held: true });
  });
  it("sends a recovery only after a NOT_COUNTING page", () => {
    expect(lotCountingAlertDecision("COUNTING", "lot_count:sign:e1:NOT_COUNTING", null)).toMatchObject({ notify: true, recovery: true });
    expect(lotCountingAlertDecision("COUNTING", "sign:e1:PRODUCER_OFFLINE", null).notify).toBe(false);
    expect(lotCountingAlertDecision("NOT_JUDGED", "lot_count:sign:e1:NOT_COUNTING", null).notify).toBe(false);
  });
  it("keys one page per watch window in its own family", () => {
    const c = lotCountingAlertClaim("sign", "NOT_COUNTING", Math.floor(woke / 1000));
    expect(c.key).toBe(`lot_count:sign:e${Math.floor(woke / 1000)}:NOT_COUNTING`);
    expect(c.firedFor).toBe("2026-10-24");
  });
});
