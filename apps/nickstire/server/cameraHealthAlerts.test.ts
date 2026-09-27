import fs from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  cameraAlertDecision,
  cameraAlertShopDay,
  deliverCameraAlertExternally,
  deliverWithConfirmedNotification,
  formatCameraHealthAlert,
} from "./services/cameraHealthAlertPolicy";
import { runCameraHealthAlertSelfTest } from "./services/cameraHealthAlerts";

describe("camera health alert policy", () => {
  it("does not page transient STALE or an ordinary healthy camera", () => {
    expect(cameraAlertDecision("STALE", null)).toEqual({ notify: false, recovery: false });
    expect(cameraAlertDecision("HEALTHY", null)).toEqual({ notify: false, recovery: false });
    expect(cameraAlertDecision("HEALTHY", "camera_health:sign:HEALTHY")).toEqual({
      notify: false,
      recovery: false,
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
      });
    }
  });

  it("sends recovery only after a prior degraded camera alert", () => {
    expect(
      cameraAlertDecision("HEALTHY", "camera_health:sign:CAMERA_OFFLINE"),
    ).toEqual({ notify: true, recovery: true });
    expect(
      cameraAlertDecision("HEALTHY", "camera_health:office:CONTROL_DEGRADED"),
    ).toEqual({ notify: true, recovery: true });
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
    expect(cameras).toMatch(/camera: "office"[\s\S]*?commissioned: false/);
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
