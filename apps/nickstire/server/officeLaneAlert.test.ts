/**
 * The office lane pages when it records but nothing reaches the server (job
 * 2026-10-21-shop-eyes-ears-pro, F2). The heartbeat runs on its own thread on the shop PC, so a
 * hung transcriber keeps the camera row fresh while no episode arrives, and nothing paged on it.
 *
 * Executed through runCameraHealthAlerts (the existing 5-minute pass) against a fake database,
 * so the page rides the existing claim, cooldown and delivery rail. Office-lane claims are told
 * apart from camera claims by their key family (office_lane:).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type LaneRow = Record<string, unknown> | Error;

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

// Thursday 2026-10-08, 12:00 EDT: the shop is open.
const OPEN_MS = Date.UTC(2026, 9, 8, 16, 0, 0);
// The same Thursday, 23:00 EDT: closed.
const CLOSED_MS = Date.UTC(2026, 9, 9, 3, 0, 0);

const CATALOG = ["detectionsLast10m", "portalCrossingsLast60m", "conversationCapturesLast60m"].map((columnName) => ({ columnName }));

/** Office lane fields: heartbeat 20 s old, a capture 10 min ago, 3 captures this hour, last post 75 min ago. */
function lane(over: Record<string, unknown> = {}): Record<string, unknown> {
  const nowEpoch = Math.floor(Date.now() / 1000);
  const postAgeSeconds = (over.postAgeSeconds as number | null | undefined) === undefined ? 75 * 60 : (over.postAgeSeconds as number | null);
  return {
    ageSeconds: 20,
    captureAgeSeconds: 10 * 60,
    conversationCapturesLast60m: 3,
    postAgeSeconds,
    postEpoch: postAgeSeconds === null ? null : nowEpoch - postAgeSeconds,
    ...over,
  };
}

function install(laneRow: LaneRow, latestLane: { key: string; ageSeconds: number } | null = null): Flat[] {
  const executed: Flat[] = [];
  h.execute = async (q: unknown) => {
    const f = flat(q);
    executed.push(f);
    const t = f.text;
    if (t.includes("INFORMATION_SCHEMA.COLUMNS")) return [CATALOG, []];
    if (t.includes("lastConversationPostAt")) {
      if (laneRow instanceof Error) throw laneRow;
      return [[laneRow], []];
    }
    if (t.includes("FROM camera_runtime")) return [[], []];
    if (t.includes("FROM camera_health_events")) return [[], []];
    if (t.includes("INSERT INTO camera_health_events")) return [{ affectedRows: 1 }, []];
    if (t.includes("FROM cron_alerts_fired WHERE alert_key LIKE")) {
      return String(f.params[0]).startsWith("office_lane:") && latestLane
        ? [[{ alert_key: latestLane.key, payload: "{}", ageSeconds: latestLane.ageSeconds }], []]
        : [[], []];
    }
    if (t.includes("INSERT IGNORE INTO cron_alerts_fired")) return [{ affectedRows: 1 }, []];
    if (t.includes("DELETE FROM cron_alerts_fired")) return [{ affectedRows: 1 }, []];
    throw new Error(`officeLaneAlert.test: unexpected query ${t.slice(0, 120)}`);
  };
  return executed;
}

const laneClaims = (executed: Flat[]) =>
  executed
    .filter((q) => q.text.includes("INSERT IGNORE INTO cron_alerts_fired") && String(q.params[0]).startsWith("office_lane:"))
    .map((q) => String(q.params[0]));
const laneTexts = () => h.telegram.mock.calls.map((c) => String(c[0])).filter((t) => t.includes("Office conversations"));

beforeEach(() => {
  resetStorableHeartbeatColumns();
  h.notify.mockReset().mockResolvedValue({ emailSent: false, pushSent: false });
  h.telegram.mockReset().mockResolvedValue(true);
  vi.stubEnv("NOTIFICATION_WEBHOOK_URL", "");
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(OPEN_MS));
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe("office lane: CONVERSATIONS_NOT_POSTING on the camera-health pass", () => {
  it("open + fresh heartbeat + a capture 15 min ago + last post 75 min ago: pages once, in plain words, keyed on the silence", async () => {
    const row = lane({ captureAgeSeconds: 15 * 60 });
    const executed = install(row);
    await runCameraHealthAlerts();
    expect(laneClaims(executed)).toEqual([`office_lane:office:e${row.postEpoch}:CONVERSATIONS_NOT_POSTING`]);
    const texts = laneTexts();
    expect(texts).toHaveLength(1);
    expect(texts[0]).toContain("The office camera recorded a conversation 15 minutes ago and none has reached the server since; the last one arrived 75 minutes ago.");
  });

  it("a second pass inside the 30-minute cooldown does not page again", async () => {
    const row = lane();
    const executed = install(row, { key: `office_lane:office:e${row.postEpoch}:CONVERSATIONS_NOT_POSTING`, ageSeconds: 5 * 60 });
    await runCameraHealthAlerts();
    expect(laneClaims(executed)).toEqual([]);
    expect(laneTexts()).toEqual([]);
  });

  it("closed shop: no page", async () => {
    vi.setSystemTime(new Date(CLOSED_MS));
    const executed = install(lane());
    await runCameraHealthAlerts();
    expect(laneClaims(executed)).toEqual([]);
  });

  it("CONTROL: last post 20 min ago is posting, no page", async () => {
    const executed = install(lane({ postAgeSeconds: 20 * 60 }));
    await runCameraHealthAlerts();
    expect(laneClaims(executed)).toEqual([]);
  });

  it("the 60-minute line: 59 min since the last post is not a page, 61 min is", async () => {
    let executed = install(lane({ postAgeSeconds: 59 * 60 }));
    await runCameraHealthAlerts();
    expect(laneClaims(executed)).toEqual([]);
    executed = install(lane({ postAgeSeconds: 61 * 60 }));
    await runCameraHealthAlerts();
    expect(laneClaims(executed)).toHaveLength(1);
  });

  it("no capture in the last hour (61 min ago, 0 captures) is a quiet office, not a fault", async () => {
    const executed = install(lane({ captureAgeSeconds: 61 * 60, conversationCapturesLast60m: 0 }));
    await runCameraHealthAlerts();
    expect(laneClaims(executed)).toEqual([]);
  });

  it("a capture 15 min ago and no post ever recorded (NULL): pages, day-keyed", async () => {
    const executed = install(lane({ captureAgeSeconds: 15 * 60, postAgeSeconds: null }));
    await runCameraHealthAlerts();
    expect(laneClaims(executed)).toEqual(["office_lane:office:CONVERSATIONS_NOT_POSTING"]);
  });

  it("only the hourly capture count known (capture time NULL): not judged, no page", async () => {
    const executed = install(lane({ captureAgeSeconds: null, postAgeSeconds: null, conversationCapturesLast60m: 4 }));
    await runCameraHealthAlerts();
    expect(laneClaims(executed)).toEqual([]);
  });

  it("the first capture after opening (2 min ago, last post 14 h ago) is still in flight: no page (manager review of db2c1ebe7)", async () => {
    const executed = install(lane({ captureAgeSeconds: 2 * 60, postAgeSeconds: 14 * 3600 }));
    await runCameraHealthAlerts();
    expect(laneClaims(executed)).toEqual([]);
  });

  it("the 10-minute grace: a capture 9 min old does not page, 10 min old does", async () => {
    let executed = install(lane({ captureAgeSeconds: 9 * 60 }));
    await runCameraHealthAlerts();
    expect(laneClaims(executed)).toEqual([]);
    executed = install(lane({ captureAgeSeconds: 10 * 60 }));
    await runCameraHealthAlerts();
    expect(laneClaims(executed)).toHaveLength(1);
  });

  it("the last post must predate the capture by more than 10 min: capture 55 min ago, post 60m05s ago does not page, 66 min does", async () => {
    let executed = install(lane({ captureAgeSeconds: 55 * 60, postAgeSeconds: 3605 }));
    await runCameraHealthAlerts();
    expect(laneClaims(executed)).toEqual([]);
    executed = install(lane({ captureAgeSeconds: 55 * 60, postAgeSeconds: 66 * 60 }));
    await runCameraHealthAlerts();
    expect(laneClaims(executed)).toHaveLength(1);
  });

  it("capture data unknown (both NULL): no page -- unknown is not a fault for this rule", async () => {
    const executed = install(lane({ captureAgeSeconds: null, conversationCapturesLast60m: null }));
    await runCameraHealthAlerts();
    expect(laneClaims(executed)).toEqual([]);
  });

  it("a stale office heartbeat is the camera alert's job, not this one's", async () => {
    const executed = install(lane({ ageSeconds: 500 }));
    await runCameraHealthAlerts();
    expect(laneClaims(executed)).toEqual([]);
  });

  it("recovery: posting again after a page (past the cooldown) pages once, on the same episode", async () => {
    const executed = install(lane({ postAgeSeconds: 5 * 60 }), { key: "office_lane:office:e1791900000:CONVERSATIONS_NOT_POSTING", ageSeconds: 3600 });
    await runCameraHealthAlerts();
    expect(laneClaims(executed)).toEqual(["office_lane:office:e1791900000:CONVERSATIONS_POSTING"]);
    expect(laneTexts()).toHaveLength(1);
  });

  describe("CAPTURE_STUCK: the worker never came back from one recording (2026-10-22 17:51Z to 10-26)", () => {
    const FOUR_DAYS = 4 * 24 * 3600 - 1800;
    const stuckTexts = () => h.telegram.mock.calls.map((c) => String(c[0])).filter((t) => t.includes("Office worker stuck"));

    it("the production shape: heartbeat fresh, CAPTURING, capture and post ~4 days old, 0 captures this hour: pages once, with the fix", async () => {
      const captureEpoch = Math.floor(Date.now() / 1000) - FOUR_DAYS;
      const row = lane({ workerState: "CAPTURING", captureAgeSeconds: FOUR_DAYS, captureEpoch, postAgeSeconds: FOUR_DAYS + 295, conversationCapturesLast60m: 0 });
      const executed = install(row);
      await runCameraHealthAlerts();
      expect(laneClaims(executed)).toEqual([`office_lane:office:e${captureEpoch}:CAPTURE_STUCK`]);
      const texts = stuckTexts();
      expect(texts).toHaveLength(1);
      expect(texts[0]).toContain("stuck in one recording for 3 days 23 h and is not listening");
      expect(texts[0]).toContain("StateNour-OfficeIntelligence-ShopPC");
    });

    it("the 15-minute line: CAPTURING 14 min is a capture in progress, 16 min pages", async () => {
      let executed = install(lane({ workerState: "CAPTURING", captureAgeSeconds: 14 * 60, postAgeSeconds: 20 * 60 }));
      await runCameraHealthAlerts();
      expect(laneClaims(executed)).toEqual([]);
      executed = install(lane({ workerState: "CAPTURING", captureAgeSeconds: 16 * 60, postAgeSeconds: 20 * 60 }));
      await runCameraHealthAlerts();
      expect(laneClaims(executed)).toEqual([expect.stringMatching(/:CAPTURE_STUCK$/)]);
    });

    it("a capture still in progress (14 min, last post 75 min ago) pages nothing (Codex review on #3297)", async () => {
      const executed = install(lane({ workerState: "CAPTURING", captureAgeSeconds: 14 * 60, postAgeSeconds: 75 * 60 }));
      await runCameraHealthAlerts();
      expect(laneClaims(executed)).toEqual([]);
    });

    it("two hangs after the same last post are two pages: the claim is keyed on the stuck capture", async () => {
      const nowEpoch = Math.floor(Date.now() / 1000);
      const first = lane({ workerState: "CAPTURING", captureAgeSeconds: 3 * 3600, captureEpoch: nowEpoch - 3 * 3600, postAgeSeconds: 5 * 3600 });
      let executed = install(first);
      await runCameraHealthAlerts();
      expect(laneClaims(executed)).toEqual([`office_lane:office:e${nowEpoch - 3 * 3600}:CAPTURE_STUCK`]);
      const second = lane({ workerState: "CAPTURING", captureAgeSeconds: 20 * 60, captureEpoch: nowEpoch - 20 * 60, postAgeSeconds: 5 * 3600 });
      executed = install(second);
      await runCameraHealthAlerts();
      expect(laneClaims(executed)).toEqual([`office_lane:office:e${nowEpoch - 20 * 60}:CAPTURE_STUCK`]);
    });

    it("CONTROL: READY with a 4-day-old capture is a quiet office, not a stuck worker", async () => {
      const executed = install(lane({ workerState: "READY", captureAgeSeconds: FOUR_DAYS, postAgeSeconds: FOUR_DAYS, conversationCapturesLast60m: 0 }));
      await runCameraHealthAlerts();
      expect(laneClaims(executed)).toEqual([]);
    });

    it("closed shop: no page at night, it pages at the open", async () => {
      vi.setSystemTime(new Date(CLOSED_MS));
      const executed = install(lane({ workerState: "CAPTURING", captureAgeSeconds: FOUR_DAYS, postAgeSeconds: FOUR_DAYS }));
      await runCameraHealthAlerts();
      expect(laneClaims(executed)).toEqual([]);
    });

    it("recovery: posting again after a CAPTURE_STUCK page pages once", async () => {
      const executed = install(lane({ workerState: "READY", captureAgeSeconds: 6 * 60, postAgeSeconds: 5 * 60 }), { key: "office_lane:office:e1791900000:CAPTURE_STUCK", ageSeconds: 3600 });
      await runCameraHealthAlerts();
      expect(laneClaims(executed)).toEqual(["office_lane:office:e1791900000:CONVERSATIONS_POSTING"]);
    });
  });

  it("a failed office-lane read never reads as 'not posting': no page, and the run fails loudly", async () => {
    const executed = install(new Error("camera_runtime read timed out"));
    await expect(runCameraHealthAlerts()).rejects.toThrow(/office lane/);
    expect(laneClaims(executed)).toEqual([]);
  });
});
