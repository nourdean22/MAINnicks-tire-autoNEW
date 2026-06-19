/**
 * SMS Gateway Health Monitor (wave-109)
 *
 * Pings the Capevace cloud's /device endpoint every pulse cycle (15 min)
 * and fires a Telegram alert if the F25e shop gateway hasn't checked in
 * within the last 30 minutes. The shop gateway is the primary SMS path
 * for ~80% of customer-facing flows; if it goes silently offline (battery
 * dead, wifi cut, app crashed) the operator needs to know fast.
 *
 * De-dup: only alerts ONCE per offline incident — re-arms when the gateway
 * comes back online. State held in-process (resets on deploy, which is
 * fine — at worst we re-alert once after a deploy if still offline).
 */
import { createLogger } from "../../lib/logger";
// Single source of truth for the offline window — the SAME constant the live
// `sms.gatewayHealth` resolver uses, so the alert and the admin badges can
// never disagree on what "offline" means.
import { GATEWAY_OFFLINE_MINUTES as OFFLINE_THRESHOLD_MIN } from "../../lib/gateway-device";

const log = createLogger("cron:sms-gateway-health");

let alertedOffline = false; // re-arms after a successful online ping

interface CapevaceDevice {
  id: string;
  name?: string;
  lastSeen?: string;
}

export async function runSmsGatewayHealthMonitor(): Promise<{
  recordsProcessed: number;
  details: string;
}> {
  const username = process.env.SHOP_SMS_GATEWAY_USERNAME;
  const password = process.env.SHOP_SMS_GATEWAY_PASSWORD;
  const baseUrl = process.env.SHOP_SMS_GATEWAY_URL || "https://api.sms-gate.app/3rdparty/v1";

  if (!username || !password) {
    return { recordsProcessed: 0, details: "Not configured (SHOP_SMS_GATEWAY_* env vars missing)" };
  }

  const auth = Buffer.from(`${username}:${password}`).toString("base64");

  let devices: CapevaceDevice[] = [];
  try {
    const res = await fetch(`${baseUrl}/device`, {
      headers: { Authorization: `Basic ${auth}` },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      log.warn("Capevace /device returned non-OK", { status: res.status });
      // API problem != gateway offline; don't fire spurious alert
      return { recordsProcessed: 0, details: `Capevace API ${res.status}` };
    }
    devices = (await res.json()) as CapevaceDevice[];
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.warn("Capevace /device unreachable", { error: msg });
    return { recordsProcessed: 0, details: `Capevace unreachable: ${msg}` };
  }

  if (!devices.length) {
    if (!alertedOffline) {
      await fireOfflineAlert("No devices registered with Capevace cloud", null);
      alertedOffline = true;
    }
    return { recordsProcessed: 0, details: "No devices registered" };
  }

  // wave-181.101 (#7) — pick the RIGHT device, not blindly devices[0].
  // The Capevace account can hold >1 device (an old test phone alongside
  // the F25e) and the array order is not guaranteed. A stale device
  // sorting first makes the monitor either false-alarm or — far worse —
  // report "online" while the real F25e is dead. Prefer an explicit
  // SHOP_SMS_GATEWAY_DEVICE_ID (the F25e is f_U1jrQBy_g8W-2pWz7g4);
  // otherwise fall back to the freshest device by lastSeen, since the
  // F25e is the one actually sending traffic.
  const targetId = process.env.SHOP_SMS_GATEWAY_DEVICE_ID;
  const dev: CapevaceDevice | undefined = targetId
    ? devices.find((d) => d.id === targetId)
    : devices.reduce((freshest, d) => {
        const t = d.lastSeen ? new Date(d.lastSeen).getTime() : 0;
        const ft = freshest.lastSeen ? new Date(freshest.lastSeen).getTime() : 0;
        return t > ft ? d : freshest;
      });

  if (!dev) {
    // SHOP_SMS_GATEWAY_DEVICE_ID was set but no registered device matches —
    // treat exactly like an offline gateway.
    if (!alertedOffline) {
      await fireOfflineAlert(
        `Configured F25e device (${targetId}) not found among ${devices.length} registered device(s)`,
        null,
      );
      alertedOffline = true;
    }
    return { recordsProcessed: 0, details: "Configured device not registered" };
  }

  const lastSeenMs = dev.lastSeen ? new Date(dev.lastSeen).getTime() : 0;
  const ageMin = lastSeenMs ? Math.round((Date.now() - lastSeenMs) / 60_000) : 999;

  if (ageMin >= OFFLINE_THRESHOLD_MIN) {
    if (!alertedOffline) {
      await fireOfflineAlert(`F25e shop gateway last seen ${ageMin} min ago (threshold: ${OFFLINE_THRESHOLD_MIN} min)`, dev);
      alertedOffline = true;
    }
    return {
      recordsProcessed: 1,
      details: `OFFLINE — ${ageMin}m since last check-in`,
    };
  }

  // Healthy: re-arm the alert + log heartbeat
  if (alertedOffline) {
    // Recovery alert
    await fireRecoveryAlert(dev, ageMin);
    alertedOffline = false;
  }
  return {
    recordsProcessed: 1,
    details: `online — last seen ${ageMin}m ago`,
  };
}

async function fireOfflineAlert(reason: string, dev: CapevaceDevice | null): Promise<void> {
  log.error("SMS gateway offline", { reason, deviceId: dev?.id, deviceName: dev?.name });
  try {
    const { sendTelegram } = await import("../../services/telegram");
    await sendTelegram(
      `🚨 SHOP SMS GATEWAY OFFLINE\n` +
      `${reason}\n\n` +
      `Customer SMS via 216-862-0005 now QUEUES and auto-delivers when the\n` +
      `F25e is back online — nothing is dropped (Twilio is intentionally off).\n\n` +
      `Check the F25e:\n` +
      `• Battery + plug status\n` +
      `• Wifi/LTE connection\n` +
      `• SMS Gateway app is running (open it once)\n` +
      `• Cloud Server toggle is ON\n\n` +
      `Status: nickstire.org/admin → SMS section`
    );
  } catch (err) {
    log.warn("Failed to send Telegram offline alert", { error: err instanceof Error ? err.message : String(err) });
  }
}

async function fireRecoveryAlert(dev: CapevaceDevice, ageMin: number): Promise<void> {
  log.info("SMS gateway back online", { deviceId: dev.id, ageMin });
  try {
    const { sendTelegram } = await import("../../services/telegram");
    await sendTelegram(
      `✅ Shop SMS gateway back online\n` +
      `F25e checked in ${ageMin}m ago. Customer SMS via 216-862-0005 is working again.`
    );
  } catch {
    // Don't break the cron if Telegram is down
  }
}
