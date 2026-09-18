/**
 * Push Notification System — NOUR OS
 *
 * Sends push notifications to subscribed devices (phone, desktop).
 * Uses Web Push protocol with VAPID authentication.
 *
 * Notification levels:
 * - CRITICAL: vibrate + sound (new lead urgency 4-5, callback request)
 * - HIGH: vibrate only (revenue milestone, pipeline critical)
 * - MEDIUM: silent (score reminder, estimate aging 48h+)
 * - LOW: badge only (brain report ready, weekly digest)
 *
 * Context-aware: respects time of day and current state.
 * Morning = MIT reminders. Afternoon = revenue alerts. Evening = score prompt only.
 */

import { prisma } from "@/lib/prisma";
import { recordError } from "@/lib/errors/record-error";

// v10.0.529.106 · Wave 58 · CRITICAL · the hardcoded VAPID private key
// fallback ("DVVZYcfpRodg5Eg8FUiUFoHdOCQuBiWOdVaLCyICA3M") was a
// production secret living in source. Anyone with repo access could
// forge push notifications to subscribed devices → phishing risk on
// the operator's phone. Same class of bug as the Wave 49 runner-secret
// fix · resolved the same way: require the env var in every
// environment, fail loudly when missing.
//
// VAPID_PUBLIC_KEY is safe to keep as a fallback (it's PUBLIC by
// design · embedded in client-side subscription payloads). The
// PRIVATE key is the one that signs the auth header.
const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY || "BMRh6IVSGRS5c95RYa6FwpmAROSUa-XX-wZa0kbWkjZrsnwDTtV2GFZCy1eT4e_o5QKsZp_B07cW6ZPMlZle6tg";
const VAPID_PRIVATE_KEY = (process.env.VAPID_PRIVATE_KEY || "").trim();
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || "mailto:nourdean22@gmail.com";

export { VAPID_PUBLIC_KEY };

export type NotificationLevel = "critical" | "high" | "medium" | "low";

export interface PushPayload {
  title: string;
  body: string;
  level: NotificationLevel;
  url?: string; // URL to open when notification is clicked
  tag?: string; // Dedup tag — same tag replaces previous notification
  data?: Record<string, unknown>;
  // v10.0.529.96 · Wave 40 · notification → chat pre-seed. When set,
  // tapping the notification opens /chat?q=<prompt>&suggKind=X&suggId=Y
  // (overriding `url`). Chat hydrates input + transportBodyRef anchors
  // on mount via the existing Wave 36 deep-link reader · operator lands
  // pre-primed instead of re-explaining the situation.
  //
  // Use for notifications where the natural follow-up is a chat turn
  // (broken promises · drift alerts · stalled goals). Leave undefined
  // for notifications where the panel is the destination (lead alerts
  // → admin · revenue → command dashboard).
  chatSeed?: {
    prompt: string;
    suggKind?: string;
    suggId?: string;
  };
  // 2026-08-20 · per-tag flood control. Explicit 0 = never suppress (leads).
  // Undefined = level default via resolveCooldownMs. Only applies when `tag`
  // is explicitly set — the level-default tag is shared across unrelated
  // callers and must never let one caller's push suppress another's.
  cooldownMs?: number;
  // 2026-09-18 · notification ACTION BUTTONS, overriding the level default
  // below. Added so the daily brief can be RATED from the notification itself:
  // `intelligence_outcomes` had ~90 daily_brief rows that were structurally
  // unlabelable because the brief's primary surface is web push, and web push
  // had no affordance. The service worker already forwarded `data.actions` to
  // the Notification API — nothing ever set it.
  //
  // Pair with `data.ledgerId`; public/sw.js routes an `oc_*` action to
  // POST /api/outcomes/rate instead of navigating.
  actions?: Array<{ action: string; title: string }>;
}

/**
 * 2026-08-20 · the storm audit. The coach-events P0 bridge believed
 * `tag: key` meant re-fires "REPLACE the standing notification instead of
 * stacking" — but tag replacement is a DISPLAY behavior. Every push still
 * delivers, buzzes, and wakes the phone. On 2026-08-20 the cron-healer
 * recursion (#1735) sent the operator 2,279 CRITICAL pushes in ~5.5 hours
 * (1,240× "Rescued ingest-reviews", 1,039× "Rescued ollama-model-liveness"),
 * against a normal baseline of 2-3 pushes/day. Content dedup could not have
 * caught it — the bodies differ per run ("duration: 54608ms" vs "54415ms").
 *
 * So the transport now rate-limits per tag: a tag that pushed within its
 * cooldown is suppressed (logged as `push_suppressed`, so the silence is
 * visible in /system/events, never invisible). A still-broken system
 * re-pages when the cooldown lapses — the operator learns it once per
 * cooldown, not once per cron run.
 */
export const PUSH_COOLDOWN_BY_LEVEL: Record<NotificationLevel, number> = {
  critical: 30 * 60 * 1000,
  high: 60 * 60 * 1000,
  medium: 120 * 60 * 1000,
  low: 120 * 60 * 1000,
};

/** Effective cooldown for a payload. Pure. 0 = no suppression. */
export function resolveCooldownMs(payload: Pick<PushPayload, "tag" | "level" | "cooldownMs">): number {
  if (payload.cooldownMs !== undefined) return Math.max(0, payload.cooldownMs);
  if (!payload.tag) return 0;
  return PUSH_COOLDOWN_BY_LEVEL[payload.level] ?? 0;
}

/**
 * Web Push TTL + urgency per level. Pre-2026-08-20 nothing was set, so the
 * web-push default TTL (four WEEKS) applied — a "CRITICAL" page queued while
 * the phone was offline could deliver days after it stopped being true. A
 * critical alert that is hours old is noise, not signal.
 */
export function pushTransportOptions(level: NotificationLevel): { TTL: number; urgency: "high" | "normal" | "low" } {
  switch (level) {
    case "critical":
      return { TTL: 4 * 3600, urgency: "high" };
    case "high":
      return { TTL: 12 * 3600, urgency: "high" };
    case "medium":
      return { TTL: 24 * 3600, urgency: "normal" };
    default:
      return { TTL: 24 * 3600, urgency: "low" };
  }
}

/**
 * Store a push subscription from a client.
 */
export async function saveSubscription(subscription: {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}): Promise<void> {
  await prisma.userPreference.upsert({
    where: { key: `push_subscription_${hashEndpoint(subscription.endpoint)}` },
    create: {
      key: `push_subscription_${hashEndpoint(subscription.endpoint)}`,
      value: JSON.stringify(subscription),
      type: "json",
      category: "notifications",
    },
    update: {
      value: JSON.stringify(subscription),
      updatedAt: new Date(),
    },
  });
}

/**
 * Remove a push subscription.
 */
export async function removeSubscription(endpoint: string): Promise<void> {
  await prisma.userPreference.deleteMany({
    where: { key: `push_subscription_${hashEndpoint(endpoint)}` },
  });
}

/**
 * Get all active push subscriptions.
 */
async function getSubscriptions(): Promise<Array<{ endpoint: string; keys: { p256dh: string; auth: string } }>> {
  const prefs = await prisma.userPreference.findMany({
    where: { key: { startsWith: "push_subscription_" } },
    select: { value: true },
  });

  return prefs.map(p => {
    try { return JSON.parse(p.value); } catch { return null; }
  }).filter(Boolean);
}

/**
 * Send a push notification to all subscribed devices.
 * Uses Web Push protocol via fetch (no npm dependency needed).
 */
export async function sendPush(payload: PushPayload): Promise<{ sent: number; failed: number }> {
  // Context-aware filtering
  const hour = parseInt(
    new Date().toLocaleString("en-US", { timeZone: "America/New_York", hour: "numeric", hour12: false }),
    10
  );

  // Don't send LOW/MEDIUM notifications during shutdown hours (9pm-7am)
  if ((hour >= 21 || hour < 7) && (payload.level === "low" || payload.level === "medium")) {
    return { sent: 0, failed: 0 };
  }

  // Don't send LOW notifications during peak block (8am-11am) unless critical
  if (hour >= 8 && hour < 11 && payload.level === "low") {
    return { sent: 0, failed: 0 };
  }

  // Per-tag flood control (see PUSH_COOLDOWN_BY_LEVEL). Best-effort: the
  // audit row lands after delivery, so two truly concurrent sends can both
  // pass — acceptable for a backstop whose adversary is a LOOP (the storm
  // fired ~90s apart). Failure of the check itself falls through to sending:
  // flood control must never become a reason a real page went missing.
  const cooldownMs = resolveCooldownMs(payload);
  if (cooldownMs > 0) {
    try {
      const prior = await prisma.auditEvent.findFirst({
        where: {
          actor: "push-notification",
          eventType: "push_sent",
          createdAt: { gte: new Date(Date.now() - cooldownMs) },
          payload: { path: ["tag"], equals: payload.tag },
        },
        select: { id: true },
      });
      if (prior) {
        await prisma.auditEvent.create({
          data: {
            actor: "push-notification",
            eventType: "push_suppressed",
            detail: `${payload.level}: ${payload.title} — within ${Math.round(cooldownMs / 60000)}min cooldown for tag "${payload.tag}"`,
            payload: { title: payload.title, level: payload.level, tag: payload.tag, cooldownMs } as any,
          },
        }).catch((err) => recordError("notifications:audit", err, { level: payload.level, suppressed: true }));
        return { sent: 0, failed: 0 };
      }
    } catch (err) {
      recordError("notifications:cooldown", err, { tag: payload.tag });
    }
  }

  const subscriptions = await getSubscriptions();
  if (subscriptions.length === 0) return { sent: 0, failed: 0 };

  let sent = 0;
  let failed = 0;

  // v10.0.529.96 · Wave 40 · chatSeed wins · routes operator to /chat
  // pre-seeded with the suggested prompt + suggestion anchor. Falls
  // back to payload.url then home (`/`) — the retired /command route
  // redirects to home, so land there directly to avoid a dead-route hop.
  let clickUrl: string;
  if (payload.chatSeed) {
    const params = new URLSearchParams({ q: payload.chatSeed.prompt });
    if (payload.chatSeed.suggKind) params.set("suggKind", payload.chatSeed.suggKind);
    if (payload.chatSeed.suggId) params.set("suggId", payload.chatSeed.suggId);
    clickUrl = `/chat?${params.toString()}`;
  } else {
    clickUrl = payload.url || "/";
  }

  // Build notification options based on level
  const options: Record<string, unknown> = {
    title: payload.title,
    body: payload.body,
    icon: "/icon-192.png",
    badge: "/icon-192.png",
    tag: payload.tag || payload.level,
    data: {
      url: clickUrl,
      level: payload.level,
      ...payload.data,
    },
    // Level-specific behavior
    ...(payload.level === "critical" ? {
      vibrate: [200, 100, 200, 100, 200],
      requireInteraction: true,
      actions: [{ action: "open", title: "Open Now" }],
    } : payload.level === "high" ? {
      vibrate: [200, 100, 200],
      actions: [{ action: "open", title: "View" }],
    } : payload.level === "medium" ? {
      silent: true,
    } : {
      silent: true,
    }),
    // AFTER the level spread on purpose: an explicit caller list wins over the
    // level default, without losing that level's vibrate/requireInteraction.
    ...(payload.actions && payload.actions.length > 0 ? { actions: payload.actions } : {}),
  };

  const notificationPayload = JSON.stringify(options);

  for (const sub of subscriptions) {
    try {
      const response = await sendWebPush(sub, notificationPayload, payload.level);
      if (response.ok) {
        sent++;
      } else if (response.status === 410 || response.status === 404) {
        // Subscription expired — remove it
        await removeSubscription(sub.endpoint);
        failed++;
      } else {
        failed++;
      }
    } catch {
      failed++;
    }
  }

  // Log notification for analytics
  await prisma.auditEvent.create({
    data: {
      actor: "push-notification",
      // The counts already ride in the payload; the LABEL said "sent" even
      // when every delivery failed, so /system/events read as a successful
      // push. Derive it from the outcome like everything else.
      eventType: sent > 0 ? "push_sent" : "push_undelivered",
      detail: `${payload.level}: ${payload.title}${sent > 0 ? "" : ` — 0 delivered, ${failed} failed`}`,
      payload: { title: payload.title, body: payload.body, level: payload.level, tag: payload.tag ?? null, sent, failed } as any,
    },
  }).catch((err) => recordError("notifications:audit", err, { level: payload.level, sent, failed }));

  return { sent, failed };
}

// ── Web Push implementation (no npm dependency) ──

async function sendWebPush(
  subscription: { endpoint: string; keys: { p256dh: string; auth: string } },
  payload: string,
  level: NotificationLevel = "high",
): Promise<Response> {
  // v10.0.529.106 · Wave 58 · refuse to send if the VAPID private key
  // is missing · pre-Wave-58 the module would silently fall back to a
  // hardcoded private key, allowing anyone with repo access to forge
  // pushes. Now: explicit configuration required, with a clear log
  // when it's missing so the operator knows to set the env var.
  if (!VAPID_PRIVATE_KEY) {
    console.warn(
      "[push] VAPID_PRIVATE_KEY not configured · push notifications disabled. " +
      "Set the env var (Vercel project settings) to enable web push. " +
      "Generate with: `npx web-push generate-vapid-keys`",
    );
    return new Response(null, { status: 501 });
  }

  // Web Push requires the web-push npm package for ECDH encryption.
  // If not installed, fall back to logging (notifications stored, not delivered).
  try {
    const webpush = await import("web-push") as any;
    if (webpush.setVapidDetails) {
      webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
      await webpush.sendNotification(subscription, payload, pushTransportOptions(level));
      return new Response(null, { status: 201 });
    }
    // Module loaded but no setVapidDetails — wrong shape
    console.warn("[push] web-push module loaded but API not found");
    return new Response(null, { status: 500 });
  } catch (err: any) {
    if (err?.code === "MODULE_NOT_FOUND" || err?.code === "ERR_MODULE_NOT_FOUND") {
      console.warn("[push] web-push not installed. Run: npm install web-push");
      return new Response(null, { status: 501 }); // Not implemented — needs npm install
    }
    return new Response(null, { status: err?.statusCode || 500 });
  }
}

// ── Helpers ──

function hashEndpoint(endpoint: string): string {
  // Simple hash for dedup key
  let hash = 0;
  for (let i = 0; i < endpoint.length; i++) {
    const char = endpoint.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return Math.abs(hash).toString(36);
}

// ── Convenience senders ──

export async function pushLeadAlert(leadName: string, service: string, urgency: number): Promise<void> {
  await sendPush({
    title: urgency >= 4 ? "🔴 URGENT LEAD" : "📱 New Lead",
    body: `${leadName} — ${service}`,
    level: urgency >= 4 ? "critical" : "high",
    url: "/admin",
    tag: "lead",
    // Revenue exception: two leads in ten minutes are two separate pages.
    // Flood control exists for machine loops, not customers.
    cooldownMs: 0,
  });
}

export async function pushRevenueAlert(amount: number, target: number): Promise<void> {
  const pct = Math.round((amount / target) * 100);
  if (pct >= 100) {
    await sendPush({
      title: "🎯 TARGET HIT",
      body: `$${amount.toLocaleString()} — target exceeded!`,
      level: "high",
      url: "/",
      tag: "revenue",
    });
  } else if (pct >= 80) {
    await sendPush({
      title: "📈 Almost There",
      body: `$${amount.toLocaleString()} (${pct}% of target)`,
      level: "medium",
      url: "/",
      tag: "revenue",
    });
  }
}

export async function pushDriftAlert(message: string): Promise<void> {
  // v10.0.529.96 · Wave 40 · chatSeed · operator tapping a drift alert
  // lands in chat with the drift summary pre-quoted · Nick can dig in
  // immediately ("yes, walk me through what happened") without
  // re-explaining what the alert was.
  await sendPush({
    title: "⚠️ DRIFT DETECTED",
    body: message,
    level: "high",
    url: "/",
    tag: "drift",
    chatSeed: {
      prompt: `drift alert just fired · "${message.slice(0, 200)}" · walk me through what's actually happening and what to do about it`,
      suggKind: "drift",
    },
  });
}

export async function pushScoreReminder(): Promise<void> {
  // v10.0.529.96 · Wave 40 · chatSeed · tap → chat already primed to
  // capture score conversationally instead of bouncing to a form.
  await sendPush({
    title: "📝 Log Your Score",
    body: "The system can't help what it can't see. 30 seconds.",
    level: "medium",
    url: "/#score",
    tag: "score",
    chatSeed: {
      prompt: `let's log today's score · ask me one quick question at a time (overall · energy · discipline · workout · mood) and updateMasteryScore as we go`,
    },
  });
}

export async function pushPipelineAging(critical: number, value: number): Promise<void> {
  await sendPush({
    title: "💰 Pipeline Aging",
    body: `${critical} critical items — $${Math.round(value).toLocaleString()} at risk`,
    level: critical >= 3 ? "critical" : "high",
    url: "/admin",
    tag: "pipeline",
  });
}
