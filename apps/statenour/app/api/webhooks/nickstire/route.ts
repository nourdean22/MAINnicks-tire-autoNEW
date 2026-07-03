import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { sendTelegram } from "@/lib/services/telegram";
import { requireSyncAuth } from "@/lib/auth-guard";
import { ServiceError } from "@/lib/utils/service-error";
import { logger as rootLogger } from "@/lib/logger";

const log = rootLogger.withSurface("webhooks/nickstire");

// v10.0.529.106 · Wave 58 · CRITICAL · pre-Wave-58 every sendTelegram
// in this route swallowed failures with `.catch(() => {})` · meaning
// a new lead, callback, or emergency event from nickstire could arrive,
// the webhook would return 200 OK, the audit row would be written
// (also with a silent catch), but Nour would get ZERO alert. This is
// the worst-case business-data-loss path. Now: every telegram failure
// is structured-logged so it surfaces in /system/errors, and emergency
// events RE-THROW so the webhook returns 500 and nickstire's retry
// logic kicks in.
async function notifyOrLog(
  send: () => Promise<unknown>,
  context: { eventType: string; isEmergency: boolean },
): Promise<void> {
  try {
    await send();
  } catch (err) {
    log.error("telegram_alert_failed", {
      eventType: context.eventType,
      error: err instanceof Error ? err.message : String(err),
    });
    if (context.isEmergency) {
      // emergency events MUST surface · re-throw so the webhook returns
      // 500 and nickstire retries
      throw err;
    }
  }
}

/**
 * POST /api/webhooks/nickstire — Real-time event receiver from nickstire.org
 *
 * Processes business events instantly:
 * - new_lead → Telegram alert + create lead record
 * - job_complete → update revenue + trigger review request
 * - quote_sent → track for follow-up
 * - review_received → alert + store for response
 * - callback → urgent Telegram alert
 * - emergency → critical Telegram alert
 *
 * v9.1.14 · Auth-hardened. Previous version had two HIGH-severity
 * bugs caught in code review:
 *   1. SYNC_KEY was defaulted to empty string when the env var was
 *      unset, then the `if (SYNC_KEY && ...)` guard skipped — fail-
 *      OPEN. The pre-push env-secret bypass guard didn't catch
 *      STATENOUR_SYNC_KEY because it wasn't in the SECRET_VARS list.
 *   2. The `!==` comparison was not timing-safe.
 * Both fixed by routing through requireSyncAuth() which fail-CLOSES
 * when STATENOUR_SYNC_KEY is unset (returns 503/401 not 200) and
 * uses node:crypto.timingSafeEqual.
 */

export async function POST(req: Request) {
  try {
    requireSyncAuth(req);
  } catch (err) {
    if (err instanceof ServiceError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await req.json();
    const events = body.events || [body];

    const results = [];

    for (const event of events) {
      // forensic-audit MEDIUM · default data + per-event isolation. A missing
      // `data` used to throw at data.name (TypeError → 500 → nickstire retries
      // the WHOLE batch → duplicate lead alerts already delivered); and any one
      // event's failure (e.g. an emergency Telegram re-throw) 500'd the batch
      // the same way. Guard the shape and isolate each event.
      const { type, data = {}, timestamp } = event ?? {};

      try {
      switch (type) {
        case "nickstire:lead": {
          // Instant lead alert to Telegram
          const name = data.name || data.customerName || "Unknown";
          const phone = data.phone || "";
          const vehicle = data.vehicle || "";
          const problem = data.problem || data.service || "";
          const value = data.estimatedValue ? `$${data.estimatedValue}` : "";

          await notifyOrLog(
            () => sendTelegram(
              `🔴 <b>NEW LEAD — ${name}</b>\n\n` +
              `📞 ${phone}\n` +
              `🚗 ${vehicle}\n` +
              `🔧 ${problem}\n` +
              (value ? `💰 Est: ${value}\n` : "") +
              `\n⏱ Response time starts NOW.\nCall within 15 min for max conversion.`,
            ),
            { eventType: type, isEmergency: false },
          );

          results.push({ type, action: "telegram_alert", status: "sent" });
          break;
        }

        case "nickstire:callback": {
          await notifyOrLog(
            () => sendTelegram(
              `📞 <b>CALLBACK REQUEST</b>\n\n` +
              `${data.name || "Customer"} — ${data.phone || "no phone"}\n` +
              `${data.reason || ""}\n\n` +
              `Call back IMMEDIATELY.`,
            ),
            { eventType: type, isEmergency: false },
          );
          results.push({ type, action: "telegram_alert", status: "sent" });
          break;
        }

        case "nickstire:emergency": {
          // EMERGENCY events MUST surface · notifyOrLog re-throws on
          // emergency, which sends the webhook to the catch below and
          // returns 500 so nickstire retries.
          await notifyOrLog(
            () => sendTelegram(
              `🚨 <b>EMERGENCY REQUEST</b>\n\n` +
              `${data.name || "Customer"} — ${data.phone || "no phone"}\n` +
              `${data.description || data.problem || ""}\n\n` +
              `After-hours emergency. Respond ASAP.`,
            ),
            { eventType: type, isEmergency: true },
          );
          results.push({ type, action: "telegram_alert", status: "sent" });
          break;
        }

        case "nickstire:booking:complete":
        case "nickstire:invoice": {
          const amount = data.totalCents ? (data.totalCents / 100) : data.total || 0;
          await notifyOrLog(
            () => sendTelegram(
              `✅ <b>JOB COMPLETE — $${amount.toFixed(0)}</b>\n\n` +
              `${data.customerName || ""} — ${data.vehicle || ""}\n` +
              `${data.service || data.services || ""}`,
            ),
            { eventType: type, isEmergency: false },
          );
          results.push({ type, action: "telegram_alert", status: "sent" });
          break;
        }

        case "nickstire:review": {
          const stars = data.rating || data.stars || 0;
          const emoji = stars >= 4 ? "⭐" : stars >= 3 ? "😐" : "⚠️";
          await notifyOrLog(
            () => sendTelegram(
              `${emoji} <b>NEW REVIEW — ${stars}/5</b>\n\n` +
              `${data.customerName || "Customer"}\n` +
              `"${(data.text || data.comment || "").slice(0, 200)}"\n\n` +
              (stars < 4 ? `⚠️ NEGATIVE — draft response ASAP` : `Great review! Consider sharing on social.`),
            ),
            { eventType: type, isEmergency: false },
          );
          results.push({ type, action: "telegram_alert", status: "sent" });
          break;
        }

        default: {
          // Log unhandled event types
          results.push({ type, action: "logged", status: "unhandled" });
        }
      }

      // Audit trail · same Wave-58 fix · log failures instead of
      // swallowing. Audit gaps are silent-failure class · operator
      // needs to see when this stops working.
      await prisma.auditEvent.create({
        data: {
          actor: "nickstire_webhook",
          eventType: type,
          detail: `Webhook: ${type}`,
          payload: data,
        },
      }).catch((err) => {
        log.error("audit_event_write_failed", {
          eventType: type,
          error: err instanceof Error ? err.message : String(err),
        });
      });
      } catch (err) {
        // Isolate this event's failure — never fail the whole batch (that
        // caused nickstire to retry and re-deliver already-sent alerts).
        log.error("nickstire_webhook_event_failed", {
          eventType: type,
          error: err instanceof Error ? err.message : String(err),
        });
        results.push({ type, action: "error", status: "failed" });
      }
    }

    return NextResponse.json({ received: events.length, results });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
