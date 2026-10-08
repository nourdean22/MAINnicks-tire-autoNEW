import fs from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  cameraAlertClaim,
  cameraAlertCooldownSeconds,
  cameraAlertDecision,
  cameraAlertEpisode,
  deliverCameraAlertExternally,
  deliverWithConfirmedNotification,
  episodeFromAlertKey,
  formatCameraHealthAlert,
} from "./services/cameraHealthAlertPolicy";
import { recordDerivedHealthTransition, runCameraHealthAlertSelfTest } from "./services/cameraHealthAlerts";

const CAMERA_ALERT_COOLDOWN_SECONDS = cameraAlertCooldownSeconds();

/** The shop day as the claim records it: fired_for of a day-scoped (legacy) claim made at `now`. */
const cameraAlertShopDay = (now: Date = new Date()) => cameraAlertClaim("sign", "NEVER_INGESTED", null, now).firedFor;

/**
 * One page per EPISODE (2026-10-07). The day-scoped claim failed both ways on real days:
 * the second outage of a day was deduped against the first, and an outage that crossed
 * midnight paged again with nothing changed. The cooldown keeps a flapping source from
 * turning the fix into a storm (sign dropped 17 times on 2026-09-18).
 */
describe("camera health alert episodes", () => {
  it("a producer-reported state is keyed on stateSince; a liveness state on the last heartbeat; NEVER_INGESTED on nothing", () => {
    expect(cameraAlertEpisode({ state: "CAMERA_OFFLINE", stateSinceEpoch: 1_759_800_000, receivedAtEpoch: 1_759_800_600 })).toBe(1_759_800_000);
    expect(cameraAlertEpisode({ state: "CAMERA_OFFLINE", stateSinceEpoch: null, receivedAtEpoch: 1_759_800_600 })).toBe(1_759_800_600);
    expect(cameraAlertEpisode({ state: "PRODUCER_OFFLINE", stateSinceEpoch: 1_759_800_000, receivedAtEpoch: 1_759_800_600 })).toBe(1_759_800_600);
    expect(cameraAlertEpisode({ state: "STALE", stateSinceEpoch: 1_759_800_000, receivedAtEpoch: null })).toBeNull();
    expect(cameraAlertEpisode({ state: "NEVER_INGESTED", stateSinceEpoch: null, receivedAtEpoch: null })).toBeNull();
  });

  it("the claim key names the episode and its fired_for is the shop day the episode BEGAN, so midnight changes nothing", () => {
    // 2026-10-06 23:30 ET = 2026-10-07 03:30Z.
    const episode = Math.floor(Date.parse("2026-10-07T03:30:00Z") / 1000);
    const before = cameraAlertClaim("sign", "CAMERA_OFFLINE", episode, new Date("2026-10-07T03:40:00Z"));
    const after = cameraAlertClaim("sign", "CAMERA_OFFLINE", episode, new Date("2026-10-07T13:00:00Z"));
    expect(before).toEqual({ key: `camera_health:sign:e${episode}:CAMERA_OFFLINE`, firedFor: "2026-10-06" });
    expect(after).toEqual(before);
    expect(before.key.length).toBeLessThanOrEqual(100);
  });

  it("two outages on one day are two claims; the same outage is one claim however often the cron looks", () => {
    const first = cameraAlertClaim("sign", "CAMERA_OFFLINE", 1_759_830_000);
    const second = cameraAlertClaim("sign", "CAMERA_OFFLINE", 1_759_845_000);
    expect(first.key).not.toBe(second.key);
    expect(cameraAlertClaim("sign", "CAMERA_OFFLINE", 1_759_830_000)).toEqual(first);
  });

  it("without an episode the claim falls back to the day-scoped key this replaces", () => {
    const now = new Date("2026-10-07T15:00:00Z");
    expect(cameraAlertClaim("sign", "NEVER_INGESTED", null, now)).toEqual({ key: "camera_health:sign:NEVER_INGESTED", firedFor: "2026-10-07" });
  });

  it("a long camera id is clipped so the key fits alert_key VARCHAR(100)", () => {
    const { key } = cameraAlertClaim("x".repeat(64), "UNVERIFIED_CAPABILITIES", 1_759_830_000);
    expect(key.length).toBeLessThanOrEqual(100);
  });

  it("the episode is read back out of a claim key, and a legacy key reads as none", () => {
    expect(episodeFromAlertKey("camera_health:sign:e1759830000:CAMERA_OFFLINE")).toBe(1_759_830_000);
    expect(episodeFromAlertKey("camera_health:sign:CAMERA_OFFLINE")).toBeNull();
    expect(episodeFromAlertKey(null)).toBeNull();
  });

  it("recovery still recognises a degraded episode key, and is keyed on THAT episode by the service", () => {
    expect(cameraAlertDecision("HEALTHY", "camera_health:sign:e1759830000:CAMERA_OFFLINE")).toEqual({ notify: true, recovery: true, held: false });
    expect(cameraAlertDecision("HEALTHY", "camera_health:sign:e1759830000:HEALTHY")).toEqual({ notify: false, recovery: false, held: false });
  });

  it(`a page less than ${CAMERA_ALERT_COOLDOWN_SECONDS}s after the last one is HELD, not dropped: still degraded later, it pages then`, () => {
    expect(cameraAlertDecision("CAMERA_OFFLINE", "camera_health:sign:e1:HEALTHY", null, 600)).toEqual({ notify: false, recovery: false, held: true });
    expect(cameraAlertDecision("CAMERA_OFFLINE", "camera_health:sign:e1:HEALTHY", null, CAMERA_ALERT_COOLDOWN_SECONDS)).toEqual({ notify: true, recovery: false, held: false });
    expect(cameraAlertDecision("HEALTHY", "camera_health:sign:e1:CAMERA_OFFLINE", null, 60)).toEqual({ notify: false, recovery: true, held: true });
    // The very first page about a camera has nothing to wait on.
    expect(cameraAlertDecision("CAMERA_OFFLINE", null, null, null)).toEqual({ notify: true, recovery: false, held: false });
    // A non-paging state is never "held": nothing was going to be sent.
    expect(cameraAlertDecision("STALE", "camera_health:sign:e1:HEALTHY", null, 60)).toEqual({ notify: false, recovery: false, held: false });
  });

  it("a blind camera that stopped being judged because the shop closed is NOT a recovery; a seeing one is", () => {
    const prior = "camera_health:sign:e1759830000:DEGRADED_VISION";
    expect(cameraAlertDecision("HEALTHY", prior, { vision: "quiet" })).toEqual({ notify: false, recovery: false, held: false });
    expect(cameraAlertDecision("HEALTHY", prior, { vision: "seeing" })).toEqual({ notify: true, recovery: true, held: false });
    // A pre-0144 producer reports no window; its DEGRADED_VISION was a frozen capture and HEALTHY is real.
    expect(cameraAlertDecision("HEALTHY", prior, { vision: "unknown" })).toEqual({ notify: true, recovery: true, held: false });
    // Quiet after any OTHER degradation is still a recovery.
    expect(cameraAlertDecision("HEALTHY", "camera_health:sign:e1759830000:CAMERA_OFFLINE", { vision: "quiet" })).toEqual({ notify: true, recovery: true, held: false });
  });
});

describe("camera health alert policy", () => {
  it("does not page transient STALE or an ordinary healthy camera", () => {
    expect(cameraAlertDecision("STALE", null)).toEqual({ notify: false, recovery: false, held: false });
    expect(cameraAlertDecision("HEALTHY", null)).toEqual({ notify: false, recovery: false, held: false });
    expect(cameraAlertDecision("HEALTHY", "camera_health:sign:HEALTHY")).toEqual({
      notify: false,
      recovery: false,
      held: false,
    });
  });

  it("pages measured degradation states", () => {
    for (const state of [
      "NEVER_INGESTED",
      "PRODUCER_OFFLINE",
      "CAMERA_OFFLINE",
      "AUTH_DEGRADED",
      "EVENTS_DEGRADED",
      "CONTROL_DEGRADED",
      "MEDIA_DEGRADED",
      "PTZ_HOME_INVALID",
      "UNVERIFIED_CAPABILITIES",
      "CALIBRATION_INVALID",
      "DEGRADED_VISION",
      "CLOUD_BACKLOG",
    ] as const) {
      expect(cameraAlertDecision(state, null), state).toEqual({
        notify: true,
        recovery: false,
        held: false,
      });
    }
  });

  it("sends recovery only after a prior degraded camera alert", () => {
    expect(
      cameraAlertDecision("HEALTHY", "camera_health:sign:CAMERA_OFFLINE"),
    ).toEqual({ notify: true, recovery: true, held: false });
    expect(
      cameraAlertDecision("HEALTHY", "camera_health:office:CONTROL_DEGRADED"),
    ).toEqual({ notify: true, recovery: true, held: false });
  });

  it("operator copy names authority, state/recovery and proof", () => {
    const degraded = formatCameraHealthAlert({
      camera: "office",
      label: "Office PTZ — interactions",
      role: "interaction_ptz",
      recovery: false,
      verdict: {
        state: "CONTROL_DEGRADED",
        reason: "PTZ/P2P control has a measured failure",
        facets: {
          producer: "alive",
          source: "not_required",
          frames: "not_required",
          pose: "not_required",
          calibration: "not_required",
          vision: "not_required",
          auth: "ok",
          events: "ok",
          control: "down",
          media: "unknown",
          home: "unknown",
          cloud: "ok",
        },
      },
    });
    expect(degraded.title).toContain("Camera degraded");
    expect(degraded.message).toContain("CONTROL_DEGRADED");
    expect(degraded.message).toContain("interaction ptz");
    expect(degraded.message).toContain("control=down");

    const recovered = formatCameraHealthAlert({
      camera: "office",
      label: "Office PTZ — interactions",
      role: "interaction_ptz",
      recovery: true,
      verdict: {
        state: "HEALTHY",
        reason: "healthy",
        facets: {
          producer: "alive",
          source: "not_required",
          frames: "not_required",
          pose: "not_required",
          calibration: "not_required",
          vision: "not_required",
          auth: "ok",
          events: "ok",
          control: "ok",
          media: "ok",
          home: "ok",
          cloud: "ok",
        },
      },
    });
    expect(recovered.title).toContain("Camera recovered");
    expect(recovered.message).toContain("HEALTHY again");
  });
});

describe("camera health alert self-test", () => {
  it("uses the real fallback rail and reports the provider that accepted delivery", async () => {
    const sendTelegram = vi.fn().mockResolvedValue(true);
    const result = await runCameraHealthAlertSelfTest({
      notifySystem: vi.fn().mockResolvedValue({
        emailSent: false,
        pushSent: false,
      }),
      sendTelegram,
      webhookConfigured: false,
    });

    expect(result.recordsProcessed).toBe(1);
    expect(result.details).toContain("telegram");
    expect(sendTelegram).toHaveBeenCalledTimes(1);
    expect(String(sendTelegram.mock.calls[0]?.[0] ?? "")).toContain(
      "Camera alert delivery test",
    );
  });

  it("fails loudly when no external provider accepts the live test", async () => {
    await expect(
      runCameraHealthAlertSelfTest({
        notifySystem: vi.fn().mockResolvedValue({
          emailSent: false,
          pushSent: false,
        }),
        sendTelegram: vi.fn().mockResolvedValue(false),
        webhookConfigured: false,
      }),
    ).rejects.toThrow("no external delivery surface accepted");
  });

  it("does not double-page Telegram when email accepts the self-test", async () => {
    const sendTelegram = vi.fn().mockResolvedValue(true);
    const result = await runCameraHealthAlertSelfTest({
      notifySystem: vi.fn().mockResolvedValue({
        emailSent: true,
        pushSent: false,
      }),
      sendTelegram,
      webhookConfigured: false,
    });

    expect(result.details).toContain("email");
    expect(sendTelegram).not.toHaveBeenCalled();
  });
});

describe("camera health alert delivery truth", () => {
  it("uses the Cleveland shop day across summer, winter and DST boundaries", () => {
    vi.useFakeTimers();
    try {
      // Summer (UTC-4): 02:00Z is still the prior Cleveland evening.
      vi.setSystemTime(new Date("2026-09-27T02:00:00Z"));
      expect(cameraAlertShopDay()).toBe("2026-09-26");

      // Winter (UTC-5): 04:30Z is still the prior Cleveland day.
      vi.setSystemTime(new Date("2026-01-15T04:30:00Z"));
      expect(cameraAlertShopDay()).toBe("2026-01-14");
      vi.setSystemTime(new Date("2026-01-15T05:30:00Z"));
      expect(cameraAlertShopDay()).toBe("2026-01-15");

      // Spring DST transition day: midnight is still based on IANA shop time,
      // not a fixed UTC offset.
      vi.setSystemTime(new Date("2026-03-08T04:30:00Z"));
      expect(cameraAlertShopDay()).toBe("2026-03-07");
      vi.setSystemTime(new Date("2026-03-08T05:30:00Z"));
      expect(cameraAlertShopDay()).toBe("2026-03-08");
    } finally {
      vi.useRealTimers();
    }
  });

  it("releases the daily claim and throws when no delivery surface accepts the alert", async () => {
    const execute = vi.fn().mockResolvedValue([{ affectedRows: 1 }]);

    await expect(
      deliverWithConfirmedNotification({
        camera: "sign",
        state: "CAMERA_OFFLINE",
        alert: { title: "Camera degraded", message: "offline" },
        notify: async () => ({
          emailAccepted: false,
          webhookAccepted: false,
          telegramAccepted: false,
        }),
        releaseClaim: async () => {
          await execute("release");
        },
      }),
    ).rejects.toThrow("no delivery surface accepted");

    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("keeps the claim when at least one delivery surface accepts the alert", async () => {
    const execute = vi.fn();

    await deliverWithConfirmedNotification({
      camera: "sign",
      state: "CAMERA_OFFLINE",
      alert: { title: "Camera degraded", message: "offline" },
      notify: async () => ({
        emailAccepted: true,
        webhookAccepted: false,
        telegramAccepted: false,
      }),
      releaseClaim: async () => {
        await execute("release");
      },
    });

    expect(execute).not.toHaveBeenCalled();
  });


  it("uses Telegram only when email/webhook produced no external delivery", async () => {
    const notifySystem = vi.fn().mockResolvedValue({
      emailSent: false,
      pushSent: true, // logger-only fallback when webhookConfigured=false
    });
    const sendTelegram = vi.fn().mockResolvedValue(true);

    const delivery = await deliverCameraAlertExternally({
      alert: { title: "Camera degraded", message: "media down" },
      notifySystem,
      webhookConfigured: false,
      sendTelegram,
    });

    expect(delivery).toEqual({
      emailAccepted: false,
      webhookAccepted: false,
      telegramAccepted: true,
    });
    expect(sendTelegram).toHaveBeenCalledTimes(1);
    expect(sendTelegram.mock.calls[0]?.[0]).toContain("Camera degraded");
  });

  it("does not double-page Telegram when email was already accepted", async () => {
    const sendTelegram = vi.fn().mockResolvedValue(true);
    const delivery = await deliverCameraAlertExternally({
      alert: { title: "Camera degraded", message: "offline" },
      notifySystem: vi.fn().mockResolvedValue({
        emailSent: true,
        pushSent: false,
      }),
      webhookConfigured: false,
      sendTelegram,
    });

    expect(delivery).toEqual({
      emailAccepted: true,
      webhookAccepted: false,
      telegramAccepted: false,
    });
    expect(sendTelegram).not.toHaveBeenCalled();
  });

  it("a Telegram exception remains an undelivered page instead of fake success", async () => {
    const delivery = await deliverCameraAlertExternally({
      alert: { title: "Camera degraded", message: "offline" },
      notifySystem: vi.fn().mockResolvedValue({
        emailSent: false,
        pushSent: false,
      }),
      webhookConfigured: false,
      sendTelegram: vi.fn().mockRejectedValue(new Error("provider down")),
    });

    expect(delivery).toEqual({
      emailAccepted: false,
      webhookAccepted: false,
      telegramAccepted: false,
    });
  });


  it("still falls back to Telegram when the primary notification rail throws", async () => {
    const sendTelegram = vi.fn().mockResolvedValue(true);
    const delivery = await deliverCameraAlertExternally({
      alert: { title: "Camera degraded", message: "primary rail threw" },
      notifySystem: vi.fn().mockRejectedValue(new Error("primary down")),
      webhookConfigured: false,
      sendTelegram,
    });

    expect(delivery).toEqual({
      emailAccepted: false,
      webhookAccepted: false,
      telegramAccepted: true,
    });
    expect(sendTelegram).toHaveBeenCalledTimes(1);
  });

  it("escapes camera text before sending through Telegram HTML parse mode", async () => {
    const sendTelegram = vi.fn().mockResolvedValue(true);
    await deliverCameraAlertExternally({
      alert: {
        title: "Camera <degraded> & offline",
        message: "control < media & home > unknown",
      },
      notifySystem: vi.fn().mockResolvedValue({
        emailSent: false,
        pushSent: false,
      }),
      webhookConfigured: false,
      sendTelegram,
    });

    const text = String(sendTelegram.mock.calls[0]?.[0] ?? "");
    expect(text).toContain("Camera &lt;degraded&gt; &amp; offline");
    expect(text).toContain("control &lt; media &amp; home &gt; unknown");
  });
});

describe("camera health alert wiring", () => {
  const root = path.resolve(__dirname, "..");
  const service = fs.readFileSync(
    path.join(__dirname, "services", "cameraHealthAlerts.ts"),
    "utf8",
  );
  const policy = fs.readFileSync(
    path.join(__dirname, "services", "cameraHealthAlertPolicy.ts"),
    "utf8",
  );
  const scheduler = fs.readFileSync(
    path.join(__dirname, "cron", "scheduler.ts"),
    "utf8",
  );
  const cameras = fs.readFileSync(
    path.join(root, "shared", "cameras.ts"),
    "utf8",
  );
  const registryTierMap = fs.readFileSync(
    path.join(__dirname, "cron", "registry-tier-map.ts"),
    "utf8",
  );
  const cronIndex = fs.readFileSync(
    path.join(__dirname, "cron", "index.ts"),
    "utf8",
  );
  const adminRoutes = fs.readFileSync(
    path.join(__dirname, "routes", "adminRoutes.ts"),
    "utf8",
  );

  it("pages commissioned cameras only", () => {
    expect(service).toContain("EXPECTED_CAMERAS.filter((camera) => camera.commissioned)");
    expect(cameras).toContain('camera: "office"');
    expect(cameras).toMatch(/camera: "office"[\s\S]*?commissioned: true/);
  });

  it("uses the durable claim rail but releases an unconfirmed delivery for retry", () => {
    expect(service).toContain("INSERT IGNORE INTO cron_alerts_fired");
    expect(service).toContain("affectedRows");
    expect(service).toContain("camera_health:");
    expect(service).toContain("DELETE FROM cron_alerts_fired");
    expect(service).toContain("deliverWithConfirmedNotification");
    expect(policy).toContain("notificationDelivered(delivery)");
    expect(policy).toContain("releaseClaim");
    expect(policy).toContain("throw new Error");
    expect(service).not.toContain("notification_messages");
  });

  it("claims per EPISODE with the cooldown, keys a recovery on the episode it closes, and reads the 0144 columns only when production has them", () => {
    expect(service).toContain("UNIX_TIMESTAMP(stateSince) AS stateSinceEpoch");
    expect(service).toContain("cameraAlertEpisode(");
    expect(service).toContain("cameraAlertClaim(");
    expect(service).toContain("episodeFromAlertKey(");
    expect(service).toContain("UNIX_TIMESTAMP() - UNIX_TIMESTAMP(fired_at) AS ageSeconds");
    expect(service).toContain("cameraRuntimeHasColumns(db, PLAUSIBILITY_COLUMNS)");
    expect(service).toContain("shopOpenAt()");
    // The day-scoped claim is gone from the service: every claim goes through the policy.
    expect(service).not.toMatch(/alertKey\(camera, state\)/);
  });

  it("routes through the proven system notification surface", () => {
    expect(service).toContain('import("../email-notify")');
    expect(service).toContain('import("./telegram")');
    expect(service).toContain("notifySystemAlert");
    expect(service).toContain("sendTelegram");
    expect(service).toContain("deliverCameraAlertExternally");
  });

  it("is actually on the five-minute heartbeat tier", () => {
    const heartbeatStart = scheduler.indexOf('name: "heartbeat"');
    const pulseStart = scheduler.indexOf('name: "pulse"');
    expect(heartbeatStart).toBeGreaterThanOrEqual(0);
    expect(pulseStart).toBeGreaterThan(heartbeatStart);
    const heartbeat = scheduler.slice(heartbeatStart, pulseStart);
    expect(heartbeat).toContain('name: "camera-health-alerts"');
    expect(heartbeat).toContain('import("../services/cameraHealthAlerts")');
  });

  it("keeps the provider self-test manual-only but reachable through the staged control plane", () => {
    const selfTest = scheduler.indexOf('name: "camera-health-alert-selftest"');
    expect(selfTest).toBeGreaterThanOrEqual(0);
    expect(scheduler.slice(selfTest, selfTest + 300)).toContain("enabled: false");
    expect(registryTierMap).toContain('name: "camera-health-alert-selftest"');
    expect(cronIndex).toContain('registerJob("camera-health-alert-selftest"');
    expect(adminRoutes).toContain('app.post("/api/admin/run-staged-cron"');
    expect(adminRoutes).toContain("MANUAL_TRIGGER_STAGED");
  });
});

describe("camera health alert policy — solar-aware expected offline (audit N3)", () => {
  it("EXPECTED_SOLAR_OFFLINE never pages, and a HEALTHY morning after it is not a recovery page", () => {
    const night = cameraAlertDecision("EXPECTED_SOLAR_OFFLINE", "sign:2026-10-07:e1:HEALTHY", null, null);
    expect(night).toEqual({ notify: false, recovery: false, held: false });
    // The latest alert key still ends in HEALTHY because nothing fired overnight.
    const morning = cameraAlertDecision("HEALTHY", "sign:2026-10-07:e1:HEALTHY", null, null);
    expect(morning).toEqual({ notify: false, recovery: false, held: false });
  });

  it("a daytime outage that ran into dusk keeps its paged key, so the real recovery still pages once", () => {
    const dusk = cameraAlertDecision("EXPECTED_SOLAR_OFFLINE", "sign:2026-10-07:e2:PRODUCER_OFFLINE", null, null);
    expect(dusk.notify).toBe(false);
    const morning = cameraAlertDecision("HEALTHY", "sign:2026-10-07:e2:PRODUCER_OFFLINE", null, null);
    expect(morning).toEqual({ notify: true, recovery: true, held: false });
  });

  it("is keyed on the last heartbeat like the other read-derived liveness states", () => {
    expect(cameraAlertEpisode({ state: "EXPECTED_SOLAR_OFFLINE", stateSinceEpoch: 1_759_800_000, receivedAtEpoch: 1_759_800_600 })).toBe(1_759_800_600);
  });
});

/**
 * The health timeline's second writer (audit N6): the 5-minute pass records the state it
 * DERIVES when it differs from the last `camera_health_events` row. Without it the table read
 * HEALTHY straight through every outage, because an offline producer never changes its
 * reported state and no heartbeat arrives to log STALE / PRODUCER_OFFLINE / EXPECTED_SOLAR_OFFLINE.
 */
describe("camera health timeline — derived transitions from the 5-minute pass (audit N6)", () => {
  function flat(q: { queryChunks: unknown[] }): { text: string; params: unknown[] } {
    const text: string[] = [];
    const params: unknown[] = [];
    const walk = (chunks: unknown[]) => {
      for (const c of chunks) {
        if (c && typeof c === "object" && "queryChunks" in (c as object)) walk((c as { queryChunks: unknown[] }).queryChunks);
        else if (c && typeof c === "object" && "value" in (c as object) && Array.isArray((c as { value: unknown }).value)) text.push((c as { value: string[] }).value.join(""));
        else { params.push(c); text.push("?"); }
      }
    };
    walk(q.queryChunks);
    return { text: text.join("").replace(/\s+/g, " ").trim(), params };
  }
  const fakeDb = (latestToState: string | null | undefined) => {
    const execute = vi.fn()
      .mockResolvedValueOnce([latestToState === undefined ? [] : [{ toState: latestToState }]])
      .mockResolvedValueOnce([{ affectedRows: 1 }]);
    return { db: { execute } as unknown as Parameters<typeof recordDerivedHealthTransition>[0], execute };
  };
  const offline = { state: "PRODUCER_OFFLINE" as const, reason: "no heartbeat for 184 s" };

  it("writes one row when the derived state differs from the last recorded one, with the camera, both states and the producer", async () => {
    const { db, execute } = fakeDb("HEALTHY");
    await expect(recordDerivedHealthTransition(db, "sign", offline, "0f0abbba26066a27")).resolves.toBe(true);
    expect(execute).toHaveBeenCalledTimes(2);
    const read = flat(execute.mock.calls[0][0]);
    expect(read.text).toContain("SELECT toState FROM camera_health_events WHERE camera = ? ORDER BY at DESC, id DESC LIMIT 1");
    expect(read.params).toEqual(["sign"]);
    const write = flat(execute.mock.calls[1][0]);
    expect(write.text).toContain("INSERT INTO camera_health_events (camera, fromState, toState, reason, producerInstanceId, sourceGeneration)");
    expect(write.params).toEqual(["sign", "HEALTHY", "PRODUCER_OFFLINE", "derived on the 5-minute pass: no heartbeat for 184 s", "0f0abbba26066a27", null]);
  });

  it("writes nothing when the last row already says what this pass derived", async () => {
    const { db, execute } = fakeDb("PRODUCER_OFFLINE");
    await expect(recordDerivedHealthTransition(db, "sign", offline, null)).resolves.toBe(false);
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("anchors an empty history with a first derived state, and never times a camera that never ingested", async () => {
    const empty = fakeDb(undefined);
    await expect(recordDerivedHealthTransition(empty.db, "sign", { state: "HEALTHY", reason: "ok" }, null)).resolves.toBe(true);
    expect(flat(empty.execute.mock.calls[1][0]).params.slice(0, 3)).toEqual(["sign", null, "HEALTHY"]);
    const never = fakeDb(undefined);
    await expect(recordDerivedHealthTransition(never.db, "office", { state: "NEVER_INGESTED", reason: "no row" }, null)).resolves.toBe(false);
    expect(never.execute).toHaveBeenCalledTimes(1);
  });

  it("a missing table is skipped (logged once), any other failure propagates: a stopped timeline is not a quiet tick", async () => {
    const missing = { execute: vi.fn().mockRejectedValue({ code: "ER_NO_SUCH_TABLE", errno: 1146 }) };
    await expect(recordDerivedHealthTransition(missing as unknown as Parameters<typeof recordDerivedHealthTransition>[0], "sign", offline, null)).resolves.toBe(false);
    const broken = { execute: vi.fn().mockRejectedValue(new Error("connection lost")) };
    await expect(recordDerivedHealthTransition(broken as unknown as Parameters<typeof recordDerivedHealthTransition>[0], "sign", offline, null)).rejects.toThrow("connection lost");
  });

  it("is wired into the pass before the page, with the failure thrown after every camera is judged", () => {
    const service = fs.readFileSync(path.join(__dirname, "services", "cameraHealthAlerts.ts"), "utf8");
    const record = service.indexOf("await recordDerivedHealthTransition(");
    const page = service.indexOf("const latest = await latestCameraAlert(db, expected.camera);");
    expect(record).toBeGreaterThanOrEqual(0);
    expect(page).toBeGreaterThan(record);
    expect(service).toContain("timelineFailure = err;");
    expect(service).toContain("if (timelineFailure) {");
    expect(service.indexOf("if (timelineFailure) {")).toBeGreaterThan(service.lastIndexOf("await deliverClaimedAlert({"));
    expect(service).toContain("producerInstanceId,\n           UNIX_TIMESTAMP() - UNIX_TIMESTAMP(receivedAt) AS ageSeconds");
  });
});
