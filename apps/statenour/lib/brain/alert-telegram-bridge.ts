/**
 * Alert → Telegram bridge · v8.5 · BATCH 29 · Apr 29.
 *
 * Pushes high-signal v8.2 alerts (correlation_alert,
 * decision_quality_drift) to Telegram so Nour gets them on his
 * phone when they're fresh, instead of having to load /brain.
 *
 * Composition layer:
 *   · Reads BrainMemory rows in the alert categories created in
 *     the last `windowMinutes`.
 *   · Filters by an `idempotency_key` derived from the alert's
 *     natural identity (category + key + content hash) — once
 *     pushed, the same alert won't fire again even on retries.
 *   · Persists the dedup marker in BrainMemory category="alert_pushed"
 *     keyed by the source alert's id, so the SQL filter
 *     "alerts that don't yet have a matching push marker" is cheap.
 *
 * Cadence: every 15 minutes via /api/cron/alert-telegram-push.
 * Faster than that risks notification fatigue; slower means an
 * alert raised after 8am could land at 8:14 instead of right away,
 * which is fine.
 */

import { prisma } from "@/lib/prisma";
import { sendTelegram } from "@/lib/services/telegram";
import { logger as rootLogger } from "@/lib/logger";

const log = rootLogger.withSurface("brain/alert-telegram-bridge");

const SOURCE_CATEGORIES = [
  "correlation_alert",
  "decision_quality_drift",
  "schema_drift_alert",
  "storage_quota_alert",
  "creation_spike_alert",
  "update_spike_alert",
  "brain_bus_alert",
  // 2026-05-27 · cron-watcher Telegram gap close. The watcher cron
  // detects scheduled crons that have gone silent beyond 2× SLA but
  // wrote to auditEvent only · the bridge couldn't see it. Watcher
  // now mirrors to BrainMemory(category="watcher_alert") with
  // per-day idempotency · this row picks it up.
  "watcher_alert",
] as const;
const PUSHED_MARKER_CATEGORY = "alert_pushed";
// v9.1.16 · was 30 (with cron firing every 15 min, every run scanned
// a 30-minute window — 15 min of overlap with the previous run).
// Combined with the take:50 cap below, a busy detector storm could
// silently drop the oldest alerts in the overlap. Now: 15 min,
// matching cron cadence — no overlap, no gap, no risk of cap drop.
const DEFAULT_WINDOW_MIN = 15;

const FRIENDLY_LABEL: Record<string, string> = {
  correlation_alert: "🔗 New strong correlation",
  decision_quality_drift: "📉 Decision quality drift",
  schema_drift_alert: "⚠️ Schema drift",
  storage_quota_alert: "💾 Storage quota",
  creation_spike_alert: "🌊 Creation spike",
  update_spike_alert: "🔁 Update spike",
  brain_bus_alert: "🛰️ Brain-bus probe",
  watcher_alert: "🕵️ Cron silent",
};

export interface PushReport {
  ranAt: string;
  windowMinutes: number;
  scanned: number;
  pushed: number;
  alreadyPushed: number;
  errors: number;
}

/**
 * Scan recent alerts and push the un-pushed ones to Telegram.
 * Returns a structured report — caller (cron) returns it as the
 * response body so /system/cron-diagnostics can render the stats.
 */
export async function runAlertTelegramPush(
  windowMinutes: number = DEFAULT_WINDOW_MIN,
): Promise<PushReport> {
  const ranAt = new Date().toISOString();
  const since = new Date(Date.now() - windowMinutes * 60_000);

  // Pull recent alerts. Hands-off the "have we already pushed this?"
  // question to a JOIN against the marker rows so we don't N+1.
  const alerts = await prisma.brainMemory.findMany({
    where: {
      category: { in: SOURCE_CATEGORIES as unknown as string[] },
      createdAt: { gte: since },
      deletedAt: null,
    },
    orderBy: { createdAt: "desc" },
    take: 50,
    select: { id: true, category: true, key: true, content: true, createdAt: true },
  });

  if (alerts.length === 0) {
    return {
      ranAt,
      windowMinutes,
      scanned: 0,
      pushed: 0,
      alreadyPushed: 0,
      errors: 0,
    };
  }

  // For each alert, check if a push marker already exists. The
  // marker key = `<category>__<sourceId>` so a future per-alert
  // dedup is unambiguous.
  const markerKeys = alerts.map((a) => markerKeyFor(a.category, a.id));
  const existingMarkers = await prisma.brainMemory.findMany({
    where: {
      category: PUSHED_MARKER_CATEGORY,
      key: { in: markerKeys },
      deletedAt: null, // v10.0.66 · soft-deleted marker = re-push allowed
    },
    select: { key: true },
  });
  const alreadyPushedSet = new Set(existingMarkers.map((m) => m.key));

  let pushed = 0;
  let alreadyPushed = 0;
  let errors = 0;

  // v10.0.42 — write the marker BEFORE Telegram. Pre-fix the marker
  // was written AFTER sendTelegram succeeded; if Telegram returned
  // ok=false (transient API error) the alert was re-attempted on
  // every 15-minute cron run within the same window. With Telegram
  // intermittent, this turned into a notification spam storm.
  // Now: claim the marker first via P2002-protected create. If the
  // claim wins, attempt send. If send fails, mark the row as failed
  // so we don't retry forever (delete on send-success path is too
  // aggressive — leaving the marker means we won't ever retry, which
  // is the right call — operator can manually re-trigger via
  // /system/alerts if needed).
  for (const alert of alerts) {
    const mkey = markerKeyFor(alert.category, alert.id);
    if (alreadyPushedSet.has(mkey)) {
      alreadyPushed++;
      continue;
    }

    // Claim the slot first — P2002 means another run beat us.
    try {
      await prisma.brainMemory.create({
        data: {
          category: PUSHED_MARKER_CATEGORY,
          key: mkey,
          content: `Claiming push for alert ${alert.id} (${alert.category}) at ${ranAt}`,
          confidence: 1.0,
          source: "cron:alert-telegram-push",
        },
      });
    } catch (err: unknown) {
      if (err && typeof err === "object" && (err as { code?: string }).code === "P2002") {
        alreadyPushed++;
        continue;
      }
      errors++;
      log.warn("marker_claim_failed", { err: err instanceof Error ? err.message : String(err) });
      continue;
    }

    // We own the slot. Send Telegram. If it fails, we still keep the
    // marker (no retry storm) — operator can re-trigger manually.
    const label = FRIENDLY_LABEL[alert.category] ?? alert.category;
    const message = `<b>${escapeHtml(label)}</b>\n${escapeHtml(alert.content.slice(0, 800))}`;
    const ok = await sendTelegram(message, undefined, "HTML");

    if (ok) {
      pushed++;
      // Update the marker content so the operator can see it actually
      // pushed (not just claimed).
      await prisma.brainMemory
        .update({
          where: {
            category_key: { category: PUSHED_MARKER_CATEGORY, key: mkey },
          },
          data: {
            content: `Pushed alert ${alert.id} (${alert.category}) at ${ranAt}`,
          },
        })
        .catch(() => {});
    } else {
      errors++;
      // Marker stays in place to prevent retry storm; surface for
      // operator visibility.
      log.warn("telegram_send_failed_marker_kept", { markerKey: mkey });
    }
  }

  return {
    ranAt,
    windowMinutes,
    scanned: alerts.length,
    pushed,
    alreadyPushed,
    errors,
  };
}

function markerKeyFor(category: string, id: string): string {
  return `${category}__${id}`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
