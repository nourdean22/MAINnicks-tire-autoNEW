import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { sendTelegram } from "@/lib/services/telegram";
import { sendEmail } from "@/lib/services/email";
import { brainMemory } from "@/lib/brain/memory-manager";
import { today, daysAgo, toDateString, hourET, weekdayET, startOfMonthET } from "@/lib/utils/datetime";
import { logger as rootLogger } from "@/lib/logger";
import { BRAIN_CATEGORIES } from "@/lib/brain/categories";
import { computeIsoWeekKey } from "@/lib/ai/context/command-center-state";
import { logError } from "@/lib/utils/error-log";

const log = rootLogger.withSurface("brain/autonomous");

// v10.0.50 · Wave A · Helper for the queryNick bridge. Rules that
// depend on shop-side data (revenue, leads, quotes, bookings) call
// through here. On bridge failure or 404, returns null so the rule
// can decide to skip rather than fire on dead data.
async function fetchBridge<T = unknown>(
  query: string,
  filters: Record<string, unknown> = {},
): Promise<T | null> {
  try {
    const { queryNick } = await import("@/lib/nickstire/query");
    const res = await queryNick<T>(query, filters);
    if ("error" in res) {
      log.warn("bridge_query_failed", { query, error: res.error });
      return null;
    }
    return res.data;
  } catch (err) {
    log.warn("bridge_query_threw", {
      query,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

interface ActionRule<T = unknown> {
  name: string;
  trigger: () => Promise<T[]>; // returns items to act on
  action: (item: T) => Promise<{ result: string; payload?: unknown }>;
  approval: "auto" | "ask"; // auto = execute immediately, ask = notify and wait
  actionType: string;
  targetType: string;
}

/**
 * Existential wrapper: preserves each rule's intra-rule item typing
 * (trigger output type flows to action's `item`) while letting the
 * heterogeneous RULES array hold rules with different item types,
 * erased to `unknown`. Identity at runtime.
 */
function defineRule<T>(rule: ActionRule<T>): ActionRule<unknown> {
  return rule as ActionRule<unknown>;
}

const RULES: ActionRule[] = [
  // ── Auto follow-up expired quotes ──────────────────────────
  // v10.0.50 · Wave A · Pre-fix the trigger was a dead `Promise.resolve([])`.
  // Quote data lives on nickstire (TiDB); the bridge exposes
  // `quotes_pending` which returns 3+-day-old pending quotes with the
  // customer email + vehicle details this action needs. Bridge
  // failure → empty array → rule no-ops (does NOT fire follow-ups
  // on stale or partial data, which would email customers about
  // quotes Nick can't actually verify exist).
  defineRule({
    name: "auto_followup_expired_quote",
    trigger: async () => {
      const data = await fetchBridge<{
        quotes?: Array<{
          quoteNumber: string;
          customerEmail: string | null;
          vehicleYear: number;
          vehicleMake: string;
          vehicleModel: string;
          grandTotal: number;
        }>;
      }>("quotes_pending", { ageDays: 3, hasEmail: true });
      const quotes = data?.quotes ?? [];
      // Defensive — only act on entries with a real customer email.
      return quotes.filter((q) => q.customerEmail);
    },
    action: async (quote) => {
      await sendEmail({
        to: quote.customerEmail!,
        subject: `Still interested? Your quote ${quote.quoteNumber} — Nick's Tire`,
        html: `
          <div style="font-family: system-ui; max-width: 600px; margin: 0 auto; background: #0a0a0a; color: #e5e5e5; padding: 24px; border-radius: 12px;">
            <h2 style="color: #e5e5e5;">Just checking in!</h2>
            <p style="color: #a1a1aa;">We sent you a quote for your ${quote.vehicleYear} ${quote.vehicleMake} ${quote.vehicleModel} a few days ago.</p>
            <div style="background: #1a1a1a; padding: 16px; border-radius: 8px; margin: 16px 0;">
              <div style="font-size: 20px; font-weight: 700;">$${quote.grandTotal.toFixed(2)}</div>
              <div style="color: #a1a1aa; font-size: 13px;">Quote #${quote.quoteNumber}</div>
            </div>
            <p style="color: #a1a1aa;">Have questions? We're happy to help. This price is still available!</p>
            <a href="tel:+12168620005" style="display: inline-block; background: #FDB913; color: #000; padding: 12px 24px; border-radius: 8px; text-decoration: none; font-weight: 600;">Call Now: (216) 862-0005</a>
          </div>
        `,
      });
      return { result: "success", payload: { quoteNumber: quote.quoteNumber, email: quote.customerEmail } };
    },
    approval: "auto",
    actionType: "send_email",
    targetType: "quote",
  }),

  // v10.0.529.103 · Wave 47 · `auto_remind_unreviewed_applicant` rule
  // deleted. Applicant entity moved to nickstire admin in v10.0.50.
  // Trigger had returned [] permanently for 30+ days. AutonomousAction
  // history rows referencing this ruleName remain valid for audit; new
  // fires were impossible.

  // ── Stale appointment requests ─────────────────────────────
  // v10.0.50 · Wave A · Wired to queryNick bridge. `bookings_status`
  // returns 4h+-old `pending` appointments with customer name,
  // phone, service, and preferred slot — exactly what the action
  // template needs. Filter is applied bridge-side via filters.
  defineRule({
    name: "auto_remind_pending_appointment",
    trigger: async () => {
      const data = await fetchBridge<{
        bookings?: Array<{
          id: string;
          customerName: string;
          customerPhone: string;
          serviceType: string;
          preferredDay: string | null;
          preferredTime: string | null;
          createdAt: string;
        }>;
      }>("bookings_status", { status: "pending", staleHours: 4 });
      const bookings = data?.bookings ?? [];
      // Re-hydrate createdAt as Date for the action template's `Date.now() - .getTime()` math.
      return bookings.map((b) => ({
        ...b,
        createdAt: new Date(b.createdAt),
      }));
    },
    action: async (appt) => {
      await sendTelegram(
        `⏰ <b>Unconfirmed Appointment — ${Math.round((Date.now() - appt.createdAt.getTime()) / (60 * 60 * 1000))}h</b>\n\n` +
        `${appt.customerName} — ${appt.serviceType}\n` +
        `📞 ${appt.customerPhone}\n` +
        `Preferred: ${appt.preferredDay || "Any"} ${appt.preferredTime || ""}\n\n` +
        `Confirm at bdnick.info/appointments`
      );
      return { result: "success" };
    },
    approval: "auto",
    actionType: "send_telegram",
    targetType: "appointment",
  }),

  // ── Decision replays due ───────────────────────────────────
  defineRule({
    name: "decision_replay_due",
    trigger: async () => {
      return prisma.decisionReplay.findMany({
        where: { reviewed: false, reviewAt: { lte: new Date() } },
        take: 3,
      });
    },
    action: async (replay) => {
      await sendTelegram(
        `🔄 <b>Decision Review Due</b>\n\n` +
        `"${replay.title}"\n` +
        `Choice: ${replay.choiceMade}\n` +
        `Made: ${replay.createdAt.toLocaleDateString()}\n\n` +
        `Time to evaluate: was this the right call?`
      );
      return { result: "success" };
    },
    approval: "auto",
    actionType: "send_telegram",
    targetType: "decision",
  }),

  // ── Dynamic pricing adjustment suggestion ──────────────────
  // v10.0.50 · Wave A · Wired to queryNick. `quotes_pending` (now
  // accepting `sinceHours: 168` for week) gives total quotes; the
  // bridge data shape includes a `bookedCount` separate from `count`
  // so we can derive the conversion rate. Bridge failure → empty so
  // the rule no-ops (safer than firing a misleading alert).
  defineRule({
    name: "suggest_pricing_adjustment",
    trigger: async (): Promise<
      Array<{ type: "underpriced" | "overpriced"; rate: number; total: number; booked: number }>
    > => {
      const data = await fetchBridge<{
        count?: number;
        bookedCount?: number;
      }>("quotes_pending", { sinceHours: 168 });

      const total = data?.count ?? 0;
      const booked = data?.bookedCount ?? 0;

      if (total < 5) return []; // not enough data

      const conversionRate = (booked / total) * 100;

      // If very high conversion (>60%), might be underpriced
      if (conversionRate > 60) return [{ type: "underpriced", rate: conversionRate, total, booked }];
      // If very low conversion (<20%), might be overpriced
      if (conversionRate < 20) return [{ type: "overpriced", rate: conversionRate, total, booked }];

      return [];
    },
    action: async (data) => {
      const msg = data.type === "underpriced"
        ? `📈 <b>Pricing Opportunity</b>\n\n${data.rate.toFixed(0)}% conversion rate this week (${data.booked}/${data.total}). You might be leaving money on the table. Consider a 5-10% markup increase.`
        : `📉 <b>Pricing Alert</b>\n\n${data.rate.toFixed(0)}% conversion rate this week (${data.booked}/${data.total}). Customers may be finding cheaper alternatives. Review markup rules.`;

      await sendTelegram(msg);

      await brainMemory.remember(
        "pricing_intelligence",
        `pricing_${data.type}_${today()}`,
        `Weekly conversion: ${data.rate.toFixed(1)}% (${data.booked}/${data.total}). Signal: ${data.type}. ${data.type === "underpriced" ? "Room to increase margins." : "Consider competitive pricing review."}`,
        "autonomous-engine:pricing"
      );

      return { result: "success", payload: data };
    },
    approval: "auto",
    actionType: "send_telegram",
    targetType: "pricing",
  }),

  // ── Daily score reminder ──────────────────────────────────
  // v10.0.50 · Wave A · The legacy DailyScore model was retired Apr 19;
  // identity-snapshot rolls + brain maturity replace it. Pre-fix this
  // rule's `Promise.resolve(null)` always returned null → fired the
  // "no daily score logged today" Telegram every single evening
  // regardless of state. Now: check whether today's identity_snapshot
  // BrainMemory row was updated today (the refresh-identity cron rolls
  // it forward at 4:30am ET; an evening roll only happens if Nour
  // engaged with the mastery surface). Soft-delete-aware.
  defineRule({
    name: "daily_score_reminder",
    trigger: async () => {
      const hour = hourET();
      if (hour < 19 || hour > 22) return []; // Only fire 7-10pm
      const todayStartET = new Date(
        new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" }) +
          "T00:00:00",
      );
      const snap = await prisma.brainMemory
        .findUnique({
          where: { category_key: { category: BRAIN_CATEGORIES.IDENTITY_SNAPSHOT, key: "current" } },
          select: { updatedAt: true, deletedAt: true },
        })
        .catch(() => null);
      if (snap && !snap.deletedAt && snap.updatedAt >= todayStartET) {
        // Snapshot was updated today (Nour engaged) — no nudge needed.
        return [];
      }
      return [{ message: "No score / identity engagement today" }];
    },
    action: async () => {
      await sendTelegram(
        `📊 <b>Score Check</b>\n\nNo daily score logged today. The system can't help what it can't see.\n\n→ Log at bdnick.info/mastery`
      );
      return { result: "success" };
    },
    approval: "auto",
    actionType: "send_telegram",
    targetType: "daily_score",
  }),

  // ── Commitment check-in (3-5 days old window) ──────────────
  // 2026-05-27 · operator volume cleanup. Pre-fix this fired on
  // EVERY active commitment 3+ days old · commitment_escalation_day5
  // ALSO fired on every commitment 5+ days old · with 3 active
  // commitments aged 7+ days that's up to 6 Telegram pings per
  // cron run. The 48h cross-rule suppressor only partially helped.
  // Fix: this rule now ONLY fires on 3-5d-old commitments · 5+d
  // belongs to commitment_escalation_day5 exclusively. Hard ceiling
  // of one rule firing per commitment regardless of age.
  defineRule({
    name: "commitment_checkin",
    trigger: async () => {
      const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
      const fiveDaysAgo = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000);
      return prisma.commitment.findMany({
        where: {
          status: "active",
          createdAt: { lte: threeDaysAgo, gte: fiveDaysAgo },
          deletedAt: null,
        },
        take: 3,
      });
    },
    action: async (commitment) => {
      const age = Math.round((Date.now() - commitment.createdAt.getTime()) / 86400000);
      await sendTelegram(
        `🔄 <b>Commitment Check — ${age} days</b>\n\n"${commitment.description}"\n\nDid you do this? If yes, mark it done. If not, renegotiate or drop it. Open commitments drain mental energy.`
      );
      return { result: "success" };
    },
    approval: "auto",
    actionType: "send_telegram",
    targetType: "commitment",
  }),

  // ── Workout reminder (if not done by 4pm on weekdays) ─────
  // v10.0.50 · Wave A · Replaces the retired DailyScore.workoutDone
  // check (returned null → fired every weekday afternoon regardless
  // of state). New source: a DAILY-loop Task with workout/gym/exercise
  // in the title, completed today (lastCompletedAt within ET-today).
  // Soft-delete-aware. If no workout DAILY task exists at all, the
  // rule fires (assumes Nour intends to work out) — that matches the
  // pre-existing prompt: "No workout logged today, body = business".
  defineRule({
    name: "workout_reminder",
    trigger: async () => {
      const hour = hourET();
      const dayOfWeek = weekdayET();
      if (hour < 15 || hour > 17 || dayOfWeek === 0 || dayOfWeek === 6) return [];
      const todayStartET = new Date(
        new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" }) +
          "T00:00:00",
      );
      const workoutTask = await prisma.task
        .findFirst({
          where: {
            loopKind: "DAILY",
            deletedAt: null,
            OR: [
              { title: { contains: "workout", mode: "insensitive" } },
              { title: { contains: "gym", mode: "insensitive" } },
              { title: { contains: "exercise", mode: "insensitive" } },
            ],
          },
          orderBy: { lastCompletedAt: "desc" },
          select: { lastCompletedAt: true },
        })
        .catch(() => null);
      const doneToday =
        workoutTask?.lastCompletedAt && workoutTask.lastCompletedAt >= todayStartET;
      if (doneToday) return [];
      return [{ message: "No workout logged yet today" }];
    },
    action: async () => {
      await sendTelegram(
        `💪 <b>Workout Check</b>\n\nNo workout logged today. Data shows weeks with 3+ workouts = higher revenue and better decision grades.\n\nNon-negotiable. Body = business performance.`
      );
      return { result: "success" };
    },
    approval: "auto",
    actionType: "send_telegram",
    targetType: "workout",
  }),

  // ── Weekly target check (Wednesday noon) ───────────────────
  defineRule({
    name: "midweek_target_check",
    trigger: async (): Promise<Array<{ noTargets?: boolean; targets?: string }>> => {
      const dayOfWeek = weekdayET();
      const hour = hourET();
      if (dayOfWeek !== 3 || hour !== 12) return []; // Wednesday noon only
      const weekKey = computeIsoWeekKey(new Date());
      const targets = await prisma.brainMemory.findUnique({
        where: { category_key: { category: BRAIN_CATEGORIES.WEEKLY_TARGET, key: `week_${weekKey}` } },
      });
      if (!targets) return [{ noTargets: true }];
      return [{ targets: targets.content }];
    },
    action: async (data) => {
      const msg = data.noTargets
        ? `📋 <b>Mid-Week Check</b>\n\nNo weekly targets set. You're operating without a scoreboard.\n\n→ Open Nick and set 3 targets: revenue, personal, health.`
        : `📋 <b>Mid-Week Check</b>\n\n${data.targets}\n\nAre you on track? What needs course correction?`;
      await sendTelegram(msg);
      return { result: "success" };
    },
    approval: "auto",
    actionType: "send_telegram",
    targetType: "weekly_targets",
  }),

  // ── Stale leads alert (business hours) ─────────────────────
  // v10.0.50 · Wave A · Wired to queryNick("stale_leads_count"). Pre-
  // fix the trigger was a hardcoded `Promise.resolve(0)` → the rule
  // never fired because stale was always 0. Now reads the live count
  // from the bridge.
  defineRule({
    name: "stale_leads_alert",
    trigger: async () => {
      const hour = hourET();
      if (hour < 9 || hour > 16) return [];
      // 2026-05-30 · was queryNick("stale_leads_count") — a DEAD bridge query
      // (HTTP 400 "Unknown query") that left `stale` always 0, so this alert
      // NEVER fired. Remapped to leads_urgent (a live query). Shape-tolerant
      // (count | leads[] | items[]) with `?? 0` fallback → strictly no-worse.
      const data = await fetchBridge<{ count?: number; leads?: unknown[]; items?: unknown[] }>(
        "leads_urgent",
      );
      const stale = data?.count ?? data?.leads?.length ?? data?.items?.length ?? 0;
      if (stale === 0) return [];
      return [{ count: stale }];
    },
    action: async (data) => {
      await sendTelegram(
        `🔴 <b>${data.count} Urgent Leads Need a Response</b>\n\nResponse time is the #1 conversion factor. Every hour = lower close rate.\n\nCall them NOW.`
      );
      return { result: "success" };
    },
    approval: "auto",
    actionType: "send_telegram",
    targetType: "leads",
  }),

  // ── Active task overload ──────────────────────────────────
  // Apr 18: OpenLoop retired → unified Task queue.
  defineRule({
    name: "task_overload_alert",
    trigger: async () => {
      // v9.1.15 · added deletedAt:null — soft-deleted tasks were
      // padding the overload count and triggering false alarms.
      const count = await prisma.task.count({
        where: {
          deletedAt: null,
          status: { in: ["INBOX", "READY", "DOING"] },
        },
      });
      if (count < 8) return [];
      return [{ count }];
    },
    action: async (data) => {
      await sendTelegram(
        `🔀 <b>${data.count} Open Loops</b>\n\nAttention is fragmented. Close 3 before adding anything new.\n\n→ bdnick.info/loops`
      );
      await brainMemory.remember(
        "pattern",
        `loop_overload_${today()}`,
        `Open loop count hit ${data.count}. Attention fragmentation alert triggered.`,
        "autonomous-engine"
      );
      return { result: "success" };
    },
    approval: "auto",
    actionType: "send_telegram",
    targetType: "loops",
  }),

  // ── Revenue pace alert (Friday if behind) ──────────────────
  // v10.0.50 · Wave A · Wired to queryNick("revenue_range"). Pre-fix
  // this read `Promise.resolve([])` for jobs → monthRevenue was
  // always 0 → projected was always 0 → rule fired every Friday 2pm
  // claiming the gap was = target (full miss). Now pulls real
  // month-to-date revenue from nickstire.
  defineRule({
    name: "friday_revenue_check",
    trigger: async () => {
      const day = weekdayET();
      const hour = hourET();
      if (day !== 5 || hour !== 14) return []; // Friday 2pm
      const monthStart = startOfMonthET();
      const data = await fetchBridge<{ totalDollars?: number }>("revenue_range", {
        since: monthStart.toISOString(),
      });
      if (data == null) return []; // bridge dead → don't false-alarm
      const monthRevenue = Number(data.totalDollars ?? 0);
      const parts = today().split("-");
      const year = Number(parts[0]);
      const month = Number(parts[1]);
      const dayOfMonth = Number(parts[2]);
      const daysInMonth = new Date(year, month, 0).getDate();
      const projectedMonthly = dayOfMonth > 0 ? (monthRevenue / dayOfMonth) * daysInMonth : 0;
      const { MONTHLY_REVENUE_TARGET } = await import("@/lib/config/business");
      const target = MONTHLY_REVENUE_TARGET;
      if (projectedMonthly >= target * 0.9) return []; // On pace
      return [{ actual: monthRevenue, projected: projectedMonthly, target, gap: target - projectedMonthly }];
    },
    action: async (data) => {
      await sendTelegram(
        `💰 <b>Friday Revenue Check</b>\n\nMonth so far: $${data.actual.toFixed(0)}\nProjected: $${data.projected.toFixed(0)}\nTarget: $${data.target.toLocaleString()}\nGap: -$${data.gap.toFixed(0)}\n\nWhat deals can you close before the weekend?`
      );
      return { result: "success" };
    },
    approval: "auto",
    actionType: "send_telegram",
    targetType: "revenue",
  }),

  // ── Drift pattern escalation ───────────────────────────────
  // v10.0.50 · Wave A · Replaces retired-DailyScore lookup. Now reads
  // identity-snapshot updates over the last 3 days — if no snapshot
  // touched in 3+ days (rolling cron + manual engagement both
  // refresh updatedAt), Nour has drifted. Pre-fix this rule fired
  // every 24h forever (recentScores was always []).
  defineRule({
    name: "drift_escalation",
    trigger: async () => {
      const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
      const recentSnap = await prisma.brainMemory
        .findFirst({
          where: {
            category: BRAIN_CATEGORIES.IDENTITY_SNAPSHOT,
            deletedAt: null,
            updatedAt: { gte: threeDaysAgo },
          },
          select: { id: true },
        })
        .catch(() => null);
      if (recentSnap) return []; // engaged within 3d, not drifting
      // Check if we already alerted about this
      const alerted = await prisma.autonomousAction.findFirst({
        where: { ruleName: "drift_escalation", createdAt: { gte: threeDaysAgo } },
      });
      if (alerted) return [];
      return [{ daysSinceScore: 3 }];
    },
    action: async () => {
      await sendTelegram(
        `⚠️ <b>DRIFT ALERT — 3+ Days No Scores</b>\n\nHistorical pattern: 3-day gaps → 5-7 day drift spirals → revenue drops.\n\nTODAY is the intervention point. Log one score. Just one.\n\n→ bdnick.info/mastery`
      );
      return { result: "success" };
    },
    approval: "auto",
    actionType: "send_telegram",
    targetType: "drift",
  }),

  // ── Morning brief push (7am weekdays) ──────────────────────
  defineRule({
    name: "morning_brief_push",
    trigger: async () => {
      const hour = hourET();
      const day = weekdayET();
      if (hour !== 7 || day === 0 || day === 6) return [];
      return [{ time: "7am" }];
    },
    action: async () => {
      // Pull live data for the brief
      let revToday = "?";
      let leadsWaiting = "?";
      try {
        const { queryNickBatch } = await import("@/lib/nickstire/query");
        const data = await queryNickBatch([{ query: "revenue_today" }, { query: "leads_urgent" }]);
        const rev = (data.revenue_today as any)?.data;
        const leads = (data.leads_urgent as any)?.data;
        if (rev) revToday = `$${rev.totalDollars || 0}`;
        if (leads) leadsWaiting = String(leads.count || 0);
      } catch (e) {
        logError("brain.autonomous-engine", e, { stage: "bridge-revenue-leads" }, "warn");
      }

      await sendTelegram(
        `☀️ <b>Morning Brief</b>\n\nRevenue today: ${revToday}\nLeads waiting: ${leadsWaiting}\n\n→ Open Nick for your full day plan: bdnick.info/chat`
      );
      return { result: "success" };
    },
    approval: "auto",
    actionType: "send_telegram",
    targetType: "morning_brief",
  }),

  // ── Overdue commitment escalation ──────────────────────────
  defineRule({
    name: "overdue_commitment_escalation",
    trigger: async () => {
      const overdue = await prisma.commitment.findMany({
        where: { status: "active", deadline: { lt: today() }, deletedAt: null },
        take: 3,
      });
      return overdue;
    },
    action: async (commitment) => {
      await sendTelegram(
        `🔴 <b>Overdue Commitment</b>\n\n"${commitment.description}"\nDeadline: ${commitment.deadline}\n\nBroken promises erode self-trust. Complete it, renegotiate it, or drop it. But don't leave it hanging.`
      );
      return { result: "success" };
    },
    approval: "auto",
    actionType: "send_telegram",
    targetType: "commitment",
  }),

  // ══════════════════════════════════════════════════════════
  // v6.0 — NEW AUTONOMOUS RULES
  // ══════════════════════════════════════════════════════════

  // ── Adaptive habit difficulty (auto-suggest upgrades) ─────
  // v10.0.50 · Wave A · Replaces dead `Promise.resolve([])` habit
  // history. New source: DAILY-loop Tasks with streakCount + recent
  // lastCompletedAt. A Task's streak indicates how reliably Nour
  // hits it. We surface easy ones (streak ≥ 14 days) the same way
  // the old rule surfaced 90%+ completion.
  defineRule({
    name: "adaptive_habit_upgrade",
    trigger: async () => {
      const dailyTasks = await prisma.task
        .findMany({
          where: {
            loopKind: "DAILY",
            deletedAt: null,
            status: { in: ["READY", "DOING"] },
          },
          select: { title: true, streakCount: true, lastCompletedAt: true },
        })
        .catch((): Array<{ title: string; streakCount: number; lastCompletedAt: Date | null }> => []);
      // "Too easy" heuristic: 14+ day streak that's been hit recently.
      // Mirrors the old 90%-over-2-weeks heuristic without the per-day
      // history rows the legacy DailyScore had.
      const twoDaysAgo = new Date(Date.now() - 2 * 86400000);
      const easy = dailyTasks
        .filter(
          (t) =>
            t.streakCount >= 14 &&
            t.lastCompletedAt &&
            t.lastCompletedAt >= twoDaysAgo,
        )
        .map((t) => ({ key: t.title, rate: Math.min(100, t.streakCount * 5) }));
      return easy.length > 0 ? [{ habits: easy }] : [];
    },
    action: async (data) => {
      const list = data.habits.map((h: { key: string; rate: number }) => `• ${h.key}: ${h.rate}% (2 weeks)`).join("\n");
      await sendTelegram(
        `📈 <b>Habit Upgrade Opportunity</b>\n\nThese habits are too easy (90%+ for 2 weeks):\n${list}\n\nIf it's not hard, it's not growing you. Level up or replace.`
      );
      return { result: "success" };
    },
    approval: "auto",
    actionType: "send_telegram",
    targetType: "habits",
  }),

  // ── Commitment enforcement loop (Day 5 escalation) ────────
  defineRule({
    name: "commitment_escalation_day5",
    trigger: async () => {
      const fiveDaysAgo = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000);
      // v9.1.25 · double-spam fix. Both this rule and
      // commitment_checkin trigger on the same active commitments
      // (3-day cutoff vs 5-day cutoff) — a 7-day-old commitment
      // satisfies both. The cooldown at line 779 is keyed by
      // (ruleName, targetId) so each rule has its own bucket and
      // they fire INDEPENDENTLY, double-spamming Telegram with both
      // the "3-day check-in" and the "Day 7 escalation" messages
      // on the same cron run.
      //
      // Fix: in this rule's trigger, exclude commitments that
      // received a commitment_checkin within the last 48h. The
      // operator just got a check-in — let it land before
      // escalating. Falls back to firing on the next cron run if
      // the commitment is still unresolved.
      const candidates = await prisma.commitment.findMany({
        where: { status: "active", createdAt: { lte: fiveDaysAgo }, deletedAt: null },
        take: 6,
      });
      if (candidates.length === 0) return [];
      const fortyEightHoursAgo = new Date(Date.now() - 48 * 60 * 60 * 1000);
      // Commitment.id is Int but autonomousAction.targetId is String —
      // the cooldown system stringifies on write, so we string-match
      // here too.
      const candidateIds = candidates.map((c) => String(c.id));
      const recentCheckIns = await prisma.autonomousAction.findMany({
        where: {
          ruleName: "commitment_checkin",
          targetId: { in: candidateIds },
          createdAt: { gte: fortyEightHoursAgo },
        },
        select: { targetId: true },
      });
      const recentlyCheckedIn = new Set(
        recentCheckIns.map((r) => r.targetId).filter(Boolean) as string[],
      );
      return candidates
        .filter((c) => !recentlyCheckedIn.has(String(c.id)))
        .slice(0, 3);
    },
    action: async (commitment) => {
      const age = Math.round((Date.now() - commitment.createdAt.getTime()) / 86400000);
      await sendTelegram(
        `🔴 <b>Commitment Breaking — Day ${age}</b>\n\n"${commitment.description}"\n\nYou made this promise ${age} days ago. It's now officially overdue.\n\nOptions:\n1. Do it TODAY (next 2 hours)\n2. Renegotiate with a new deadline\n3. Drop it and own that decision\n\nSilence = broken promise = eroded self-trust.`
      );
      await brainMemory.remember(
        "pattern",
        `commitment_break_${commitment.id}_${today()}`,
        `Commitment "${commitment.description}" is ${age} days old and unresolved. Escalation sent.`,
        "autonomous-engine"
      );
      return { result: "success" };
    },
    approval: "auto",
    actionType: "send_telegram",
    targetType: "commitment",
  }),

  // ── Memory promotion pipeline ─────────────────────────────
  defineRule({
    name: "memory_promotion",
    trigger: async () => {
      // Find memories with high seen count that aren't yet wisdom
      const candidates = await prisma.brainMemory.findMany({
        where: {
          // v9.1.15 · added deletedAt:null. Soft-deleted memories
          // were getting "promoted" (resurrected) by the pipeline.
          deletedAt: null,
          category: { not: "wisdom" },
          seenCount: { gte: 5 },
          confidence: { gte: 0.6 },
        },
        take: 3,
        orderBy: { seenCount: "desc" },
      });
      return candidates;
    },
    action: async (memory) => {
      // DUPE GUARD — before promoting, check whether a semantically
      // similar wisdom row already exists. The old bug: daily engines
      // write date-keyed rows (aging_2026-04-14, aging_2026-04-15, …)
      // and each got promoted independently, creating near-identical
      // wisdom entries that compete for vector-recall slots.
      //
      // Cheap guard: if any existing wisdom row's content contains
      // the distinctive first 40-char prefix of this memory's content
      // (after stripping the date), skip promotion and just reinforce
      // the seen count on this row so it stops getting picked up.
      const contentPrefix = memory.content
        .replace(/\[\d{4}-\d{2}-\d{2}\]/g, "")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 40);
      if (contentPrefix.length >= 20) {
        const dupe = await prisma.brainMemory.findFirst({
          where: {
            category: BRAIN_CATEGORIES.WISDOM,
            content: { contains: contentPrefix },
            id: { not: memory.id },
          },
          select: { id: true },
        });
        if (dupe) {
          // Mark this one as "not wisdom-worthy right now" by dropping
          // its effective confidence below the 0.6 threshold so the
          // promoter doesn't re-pick it every cycle.
          await prisma.brainMemory.update({
            where: { id: memory.id },
            data: { confidence: Math.max(0.3, memory.confidence - 0.3) },
          });
          return { result: "skipped", payload: { reason: "wisdom_dupe", existing: dupe.id } };
        }
      }

      // v10.0.416 · gate the promotion · 7-day audit found 68 junk
      // wisdoms (image markdown / chat replies / system pulses) that
      // were auto-promoted because seenCount crossed the threshold ·
      // the content was never wisdom-shaped. wisdom-quality-gate
      // exists for exactly this · run it BEFORE the promote.
      const { gateWisdom } = await import("@/lib/brain/wisdom-quality-gate");
      const gateResult = gateWisdom(memory.content);
      if (!gateResult.pass) {
        // Failed the gate · drop confidence so it's not re-picked next
        // cycle, but DON'T promote. Same path as dupe-detection above.
        await prisma.brainMemory.update({
          where: { id: memory.id },
          data: { confidence: Math.max(0.3, memory.confidence - 0.3) },
        });
        return {
          result: "skipped",
          payload: { reason: `gate_${gateResult.reason}`, content: memory.content.slice(0, 80) },
        };
      }

      // Promote to wisdom
      await prisma.brainMemory.update({
        where: { id: memory.id },
        data: {
          category: BRAIN_CATEGORIES.WISDOM,
          confidence: Math.min(1, memory.confidence + 0.2),
          content: `[PROMOTED TO WISDOM] ${memory.content}`,
        },
      });
      await sendTelegram(
        `🧠 <b>Memory → Wisdom</b>\n\nPromoted (referenced ${memory.seenCount}x):\n"${memory.content.slice(0, 150)}"\n\nThis pattern has proven itself. It's now permanent wisdom.`
      );
      return { result: "success", payload: { id: memory.id, seenCount: memory.seenCount } };
    },
    approval: "auto",
    actionType: "promote_memory",
    targetType: "memory",
  }),

  // v10.0.529.103 · Wave 47 · `adderall_timing_insight` rule deleted.
  // Depended on retired DailyScore.adderallTime/focusQuality fields
  // (dropped Apr 19). Trigger had returned [] permanently for 30+
  // days. AutonomousAction history rows remain valid for audit.

  // ── Revenue up overconfidence warning ──────────────────────
  // v10.0.50 · Wave A · Wired to queryNick("revenue_range") for
  // yesterday's revenue. Pre-fix this read `Promise.resolve([])` →
  // rev was always 0 → never fired (false negative). Now reads the
  // live shop number; bridge failure → empty (safer than firing on
  // dead data).
  defineRule({
    name: "revenue_overconfidence_gate",
    trigger: async () => {
      const hour = hourET();
      if (hour < 8 || hour > 10) return []; // Morning after a big day
      const yesterdayET = toDateString(daysAgo(1));
      const todayET = toDateString(daysAgo(0));
      const data = await fetchBridge<{ totalDollars?: number }>("revenue_range", {
        since: `${yesterdayET}T00:00:00`,
        until: `${todayET}T00:00:00`,
      });
      if (data == null) return [];
      const rev = Number(data.totalDollars ?? 0);
      if (rev < 2000) return [];
      return [{ revenue: rev }];
    },
    action: async (data) => {
      await sendTelegram(
        `⚡ <b>Overconfidence Gate</b>\n\nYesterday: $${data.revenue.toLocaleString()} (big day).\n\nPattern: good revenue days → relaxed follow-through → missed callbacks → drift.\n\nToday is the MOST DANGEROUS day for drift. Stay sharp. Clear callbacks first.`
      );
      return { result: "success" };
    },
    approval: "auto",
    actionType: "send_telegram",
    targetType: "revenue",
  }),

  // ── Decision review due ───────────────────────────────────
  defineRule({
    name: "decision_review_due",
    trigger: async () => {
      return prisma.masteryDecision.findMany({
        where: {
          deletedAt: null, // v9.1.15
          reviewDate: { lte: today() },
          actualOutcome: null,
        },
        take: 3,
      });
    },
    action: async (decision) => {
      const age = Math.round((Date.now() - decision.createdAt.getTime()) / 86400000);
      await sendTelegram(
        `🔄 <b>Decision Review Due</b>\n\n"${decision.title}"\nChose: ${decision.chosen || "pending"}\nMade: ${age} days ago (${decision.stakes} stakes)\n\nWas this the right call? What actually happened?\n\n→ Reply to Nick with your assessment.`
      );
      return { result: "success" };
    },
    approval: "auto",
    actionType: "send_telegram",
    targetType: "decision",
  }),

  // ── Quote conversion tracking ─────────────────────────────
  // v10.0.50 · Wave A · Wired to queryNick("quotes_pending") with a
  // 30-day window. Pre-fix the rule's two `Promise.resolve(0)` reads
  // gave total=0/booked=0 → never fired (false negative every Sunday).
  // Now pulls real numbers; the action sub-query also pulls real
  // quote distribution by price range.
  defineRule({
    name: "quote_conversion_insight",
    trigger: async () => {
      const day = weekdayET();
      if (day !== 0) return []; // Sunday only
      const data = await fetchBridge<{
        count?: number;
        bookedCount?: number;
      }>("quotes_pending", { sinceHours: 720 });
      if (data == null) return [];
      const total = Number(data.count ?? 0);
      const booked = Number(data.bookedCount ?? 0);
      if (total < 10) return [];
      const rate = (booked / total) * 100;
      return [{ total, booked, rate }];
    },
    action: async (data) => {
      // Analyze by price range — pull a snapshot of recent quotes
      // (capped at 200, last 30d) for grandTotal + status. Bridge
      // failure → quotes empty → ranges all show 0/0 (still ships
      // the overall rate which is the primary signal).
      const detail = await fetchBridge<{
        quotes?: Array<{ grandTotal: number; status: string }>;
      }>("quotes_pending", { sinceHours: 720, withDetail: true, limit: 200 });
      const quotes = detail?.quotes ?? [];

      const ranges = [
        { label: "Under $300", min: 0, max: 300, total: 0, booked: 0 },
        { label: "$300-$600", min: 300, max: 600, total: 0, booked: 0 },
        { label: "$600-$1000", min: 600, max: 1000, total: 0, booked: 0 },
        { label: "Over $1000", min: 1000, max: 999999, total: 0, booked: 0 },
      ];

      for (const q of quotes) {
        const amt = Number(q.grandTotal);
        const range = ranges.find(r => amt >= r.min && amt < r.max);
        if (range) {
          range.total++;
          if (q.status === "booked") range.booked++;
        }
      }

      const rangeLines = ranges
        .filter(r => r.total > 0)
        .map(r => `${r.label}: ${r.total > 0 ? Math.round((r.booked / r.total) * 100) : 0}% (${r.booked}/${r.total})`)
        .join("\n");

      await sendTelegram(
        `📊 <b>Weekly Quote Intelligence</b>\n\nOverall: ${data.rate.toFixed(0)}% conversion (${data.booked}/${data.total})\n\nBy price range:\n${rangeLines}\n\nUse this to adjust pricing strategy.`
      );

      await brainMemory.remember(
        "pricing_intelligence",
        `quote_conversion_${today()}`,
        `Quote conversion: ${data.rate.toFixed(1)}% (${data.booked}/${data.total}). ${rangeLines.replace(/\n/g, ". ")}`,
        "autonomous-engine"
      );

      return { result: "success", payload: data };
    },
    approval: "auto",
    actionType: "send_telegram",
    targetType: "pricing",
  }),
];

/**
 * Code-derived rule registry for /system dashboards (wiring census,
 * BDN-101). The census's own kill shot forbids hand-lists — lanes must
 * derive from the registry that actually dispatches, which is RULES.
 */
export function listRuleNames(): Array<{ name: string; actionType: string }> {
  return RULES.map((r) => ({ name: r.name, actionType: r.actionType }));
}

/**
 * Run all autonomous action rules.
 * Each rule: find items → execute action → log result.
 */
export async function runAutonomousActions(): Promise<{ executed: number; errors: number }> {
  let executed = 0;
  let errors = 0;

  for (const rule of RULES) {
    try {
      const items = await rule.trigger();
      if (items.length === 0) continue;

      for (const item of items) {
        // Items are heterogeneous (Prisma rows / object literals) erased to
        // `unknown` by the existential RULES array. Most carry no `id`; the
        // ones that do (commitments, memories, decisions) expose it here.
        // Single honest boundary read — value is unchanged at runtime
        // (Commitment.id stays a number; the cooldown layer stringifies on
        // write exactly as before).
        const itemId = (item as { id?: string | null }).id;
        // Check cooldown — don't fire same rule on same target twice in 24h
        const recent = await prisma.autonomousAction.findFirst({
          where: {
            ruleName: rule.name,
            targetId: itemId ?? null,
            createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
          },
        });
        if (recent) continue;

        // v10.0.35 — cross-rule family cooldown. Pre-fix
        // commitment_checkin + commitment_escalation_day5 each had
        // their own 24h cooldown but no shared check; if both
        // triggers fired in the same cron run (or two concurrent
        // cron workers raced before either wrote a row), both
        // Telegram messages went out for the same commitment ID.
        // Now: if ANY commitment-family action for this target
        // fired in the last 6h, suppress further commitment-family
        // rules for the same target.
        if (
          rule.targetType === "commitment" &&
          rule.name.startsWith("commitment_") &&
          itemId
        ) {
          const familyRecent = await prisma.autonomousAction.findFirst({
            where: {
              ruleName: { startsWith: "commitment_" },
              targetId: itemId,
              createdAt: { gte: new Date(Date.now() - 6 * 60 * 60 * 1000) },
            },
          });
          if (familyRecent) continue;
        }

        // v7.7 · Apr 29 · Universal idempotency. Mint a key from
        // (ruleName + targetType + targetId + 1h-bucket) so a re-fire
        // of the same rule against the same target within the hour
        // is suppressed by the unique index. The 1h bucket matches
        // the existing 24h "recent" dedup but tightens it for the
        // race-on-restart case.
        const { idempotencyRecipe, idempotentCreate } = await import("@/lib/db/idempotency");
        const key = idempotencyRecipe.autonomousAction({
          ruleName: rule.name,
          targetType: rule.targetType,
          targetId: itemId ?? null,
          bucketSeconds: 3600,
        });

        // v9.1.23 · CRITICAL fix · WRITE THE IDEMPOTENCY ROW BEFORE
        // FIRING SIDE EFFECTS. Previous order was action() → log,
        // which meant if log write failed (Neon timeout, race, etc.)
        // the side effect (Telegram push, email, callback) had
        // already gone out, but the idempotency row never landed —
        // so the next cron run re-fired the side effect AGAIN. The
        // comment "the prior fire already executed the side effect"
        // was exactly backwards.
        //
        // Now: lock the slot first via idempotentCreate with status
        // "pending". If the lock succeeds, fire the action and
        // update the row to "success" or "failed". If the lock
        // returns existing=true, another run already claimed this
        // slot — silently skip without re-firing.
        const lockAttempt = await idempotentCreate({
          model: prisma.autonomousAction,
          key,
          data: {
            ruleName: rule.name,
            trigger: `Auto-triggered: ${items.length} items matched`,
            actionType: rule.actionType,
            targetType: rule.targetType,
            targetId: itemId ?? null,
            approval: rule.approval,
            result: "pending",
            idempotencyKey: key,
          },
        }).catch((err) => {
          log.warn("lock_failed", {
            rule: rule.name,
            error: err instanceof Error ? err.message : String(err),
          });
          return null;
        });

        if (!lockAttempt || !lockAttempt.created) {
          // Slot was already locked by a prior run (created=false) OR
          // lock attempt failed entirely (null). Either way, do NOT
          // fire the side effect.
          continue;
        }

        // v10.0.151 · per-fire trace + envelope. The autonomous engine
        // didn't previously mint AgentTrace rows — the brain-bus event
        // captured the fact of fires but not the chain of reasoning.
        // Now every fire (success or failure) emits a trace tagged with
        // the policy id (autonomous-action.<rule.name>) so operators
        // can drill into /system/agent-traces/[id] and see exactly which
        // rule fired, what it consumed, and what rule of governance
        // authorized it.
        const { mintTraceId, recordTrace: __recordTrace } = await import(
          "@/lib/ai/agent-trace"
        );
        const { EnvelopeBuilder } = await import("@/lib/automation/envelope");
        const fireTraceId = mintTraceId();
        const fireStarted = Date.now();
        const policyId = `autonomous-action.${rule.name}`;
        const fireEnvelope = new EnvelopeBuilder(policyId)
          .addFact(`rule: ${rule.name}`)
          .addFact(`actionType: ${rule.actionType}`)
          .addFact(`targetType: ${rule.targetType}`)
          .addFact(`approval: ${rule.approval}`)
          .addFact(`trigger: ${items.length} items matched`);
        if (itemId) fireEnvelope.addFact(`targetId: ${itemId}`);

        // v10.0.157 · side-effect gating. Look up the AutomationPolicy
        // for this rule. If the policy declares approvalClass="pending"
        // OR the rule's own contract says approval="ask", DEFER the
        // side effect — store the matched item into payload as
        // `deferredItem` so the approval queue can replay rule.action
        // when an operator approves. Forbidden policies skip the
        // action entirely.
        //
        // Pre-fix: rule.action(item) ran unconditionally even for
        // approval="ask" rules; "pending" was metadata only and the
        // approval queue could only audit, not control.
        const { getPolicy } = await import("@/lib/automation/policy");
        const policy = await getPolicy(policyId).catch(() => null);
        const policyApproval = policy?.approvalClass ?? null;
        // v-truth · FAIL-CLOSED. A rule fires unattended ONLY when an
        // explicit `auto` AutomationPolicy exists. No policy (null) ->
        // defer to /system/approvals, never auto-send. Makes the engine
        // approval-only by default the moment NICK_AUTONOMY flips on;
        // the operator seeds `auto` policies for rules they trust to run
        // unattended. Pre-fix, a missing policy meant immediate auto-fire
        // (19 of 20 rules were ungated — see the autonomy safety audit).
        const shouldDefer =
          rule.approval === "ask" ||
          policyApproval === "pending" ||
          policyApproval === null;
        const isForbidden = policyApproval === "forbidden";

        if (isForbidden) {
          // Hard stop — this rule is administratively disabled. The
          // row stays in the registry as evidence of the trigger but
          // never executes.
          await prisma.autonomousAction
            .update({
              where: { id: lockAttempt.row.id },
              data: {
                executedAt: new Date(),
                result: "forbidden_by_policy",
                approval: "rejected",
              },
            })
            .catch(() => undefined);
          fireEnvelope.setReason(
            `Rule ${rule.name} BLOCKED by policy ${policyId} (approvalClass=forbidden) — never executed.`,
          );
          {
            const { logPolicyFire } = await import("@/lib/automation/policy");
            void logPolicyFire(policyId, "rolled_back");
          }
          void __recordTrace(
            {
              traceId: fireTraceId,
              source: "autonomous",
              label: `autonomous-fire-blocked:${rule.name}`,
              metadata: { envelope: fireEnvelope.build() },
            },
            { durationMs: Date.now() - fireStarted, toolCalls: 0 },
          );
          continue;
        }

        if (shouldDefer) {
          // v-truth · NICK_CONFIDENCE_TIER auto-execute escape hatch.
          // A provably-safe, reversible, NON-MESSAGING, NON-MONEY
          // allowlisted action type with a high operator-acceptance record
          // skips the queue and executes now. Flag OFF (default) ->
          // canAutoExecute returns false, so this is inert and the row
          // defers exactly as today. Money/people/messaging types can NEVER
          // pass (allowlist + denylist, two walls in confidence-tier.ts).
          {
            const { canAutoExecute } = await import("@/lib/ai/confidence-tier");
            const since = new Date(Date.now() - 45 * 24 * 60 * 60 * 1000);
            const tally = await prisma.autonomousAction
              .groupBy({
                by: ["approval"],
                where: {
                  actionType: rule.actionType,
                  approval: { in: ["approved", "rejected"] },
                  createdAt: { gte: since },
                },
                _count: { id: true },
              })
              .catch(
                () => [] as Array<{ approval: string; _count: { id: number } }>,
              );
            const approved =
              tally.find((t) => t.approval === "approved")?._count.id ?? 0;
            const rejected =
              tally.find((t) => t.approval === "rejected")?._count.id ?? 0;
            const decided = approved + rejected;
            const rate = decided > 0 ? approved / decided : 0;
            if (canAutoExecute(rule.actionType, rate, decided)) {
              try {
                const autoResult = await rule.action(item);
                await prisma.autonomousAction
                  .update({
                    where: { id: lockAttempt.row.id },
                    data: {
                      executedAt: new Date(),
                      approval: "approved",
                      result: autoResult.result,
                      payload: (autoResult.payload ?? null) as Prisma.InputJsonValue,
                    },
                  })
                  .catch(() => undefined);
                fireEnvelope.setReason(
                  `Rule ${rule.name} AUTO-EXECUTED by confidence-tier (allowlisted · accept ${(rate * 100).toFixed(0)}% of ${decided}) · result: ${autoResult.result}`,
                );
                {
                  const { logPolicyFire } = await import("@/lib/automation/policy");
                  void logPolicyFire(policyId, "success");
                }
                void __recordTrace(
                  {
                    traceId: fireTraceId,
                    source: "autonomous",
                    label: `autonomous-fire-autotier:${rule.name}`,
                    metadata: { envelope: fireEnvelope.build() },
                  },
                  { durationMs: Date.now() - fireStarted, toolCalls: 1 },
                );
                continue;
              } catch {
                // auto path threw → fall through to the normal defer-park.
              }
            }
          }
          // Persist the matched item into payload so the approval
          // queue can replay rule.action(deferredItem) on approve.
          // The row stays approval="pending" + result="pending_approval"
          // until the operator acts.
          await prisma.autonomousAction
            .update({
              where: { id: lockAttempt.row.id },
              data: {
                approval: "pending",
                result: "pending_approval",
                payload: { deferredItem: item } as Prisma.InputJsonValue,
              },
            })
            .catch(() => undefined);
          fireEnvelope.setReason(
            `Rule ${rule.name} DEFERRED for operator approval (policy=${policyApproval ?? "ask"}). Side effect held; approve via /system/approvals to execute.`,
          );
          {
            const { logPolicyFire } = await import("@/lib/automation/policy");
            void logPolicyFire(policyId, "pending_approval");
          }
          void __recordTrace(
            {
              traceId: fireTraceId,
              source: "autonomous",
              label: `autonomous-fire-deferred:${rule.name}`,
              metadata: { envelope: fireEnvelope.build() },
            },
            { durationMs: Date.now() - fireStarted, toolCalls: 0 },
          );
          continue;
        }

        try {
          const result = await rule.action(item);
          // Update the row to "success" with the action result.
          await prisma.autonomousAction
            .update({
              where: { id: lockAttempt.row.id },
              data: {
                executedAt: new Date(),
                result: result.result,
                payload: (result.payload ?? null) as Prisma.InputJsonValue,
              },
            })
            .catch(() => undefined);
          fireEnvelope.setReason(
            `Rule ${rule.name} fired against target ${rule.targetType}${itemId ? `:${itemId}` : ""} · result: ${result.result}`,
          );
          fireEnvelope.recordToolCall(rule.actionType, true, Date.now() - fireStarted);
          // v10.0.151 · log policy fire so /system/policies fireCount
          // becomes live data (was stuck at 0 with no caller before).
          {
            const { logPolicyFire } = await import("@/lib/automation/policy");
            void logPolicyFire(policyId, "success");
          }
          // Persist the trace row with envelope.
          void __recordTrace(
            {
              traceId: fireTraceId,
              source: "autonomous",
              label: `autonomous-fire:${rule.name}`,
              metadata: { envelope: fireEnvelope.build() },
            },
            { durationMs: Date.now() - fireStarted, toolCalls: 1 },
          );
          // v10.0.63 · brain-bus producer · emit autonomous.fired so
          // /system/agent-traces + brain pipeline can subscribe to
          // rule executions. Dedupe via idempotency key so repeats
          // are no-ops at the durable layer too.
          {
            const { emitAutonomousFired } = await import("@/lib/db/brain-bus-emit");
            void emitAutonomousFired({
              ruleName: rule.name,
              actionType: rule.actionType,
              targetType: rule.targetType,
              targetId: itemId ? String(itemId) : null,
              result: "success",
              idempotencyKey: key,
            });
          }
          executed++;
        } catch (err) {
          // Update the row to "failed" with the error message.
          await prisma.autonomousAction
            .update({
              where: { id: lockAttempt.row.id },
              data: {
                executedAt: new Date(),
                result: "failed",
                error: err instanceof Error ? err.message : "Unknown error",
              },
            })
            .catch(() => undefined);
          const errMsg = err instanceof Error ? err.message : "Unknown error";
          fireEnvelope.setReason(
            `Rule ${rule.name} FAILED against target ${rule.targetType}${itemId ? `:${itemId}` : ""}: ${errMsg.slice(0, 120)}`,
          );
          fireEnvelope.recordToolCall(rule.actionType, false, Date.now() - fireStarted);
          {
            const { logPolicyFire } = await import("@/lib/automation/policy");
            void logPolicyFire(policyId, "failure");
          }
          // v10.0.151 · also persist a trace on failure so the operator
          // can drill into the envelope to see what facts the rule
          // assumed at the moment it broke.
          void __recordTrace(
            {
              traceId: fireTraceId,
              source: "autonomous",
              label: `autonomous-fire:${rule.name}`,
              metadata: { envelope: fireEnvelope.build() },
            },
            {
              durationMs: Date.now() - fireStarted,
              toolCalls: 1,
              errorClass: "autonomous_action_threw",
              errorMessage: errMsg,
            },
          );
          // v10.0.63 · brain-bus producer · emit autonomous.fired
          // for the failed branch too — failed fires are themselves
          // a signal worth capturing for trend analysis.
          {
            const { emitAutonomousFired } = await import("@/lib/db/brain-bus-emit");
            void emitAutonomousFired({
              ruleName: rule.name,
              actionType: rule.actionType,
              targetType: rule.targetType,
              targetId: itemId ? String(itemId) : null,
              result: "failed",
              error: err instanceof Error ? err.message : "Unknown error",
              idempotencyKey: key,
            });
          }
          errors++;
        }
      }
    } catch (err) {
      log.error("trigger_failed", {
        rule: rule.name,
        error: err instanceof Error ? err.message : String(err),
      });
      errors++;
    }
  }

  return { executed, errors };
}

/**
 * v10.0.157 · Replay a deferred autonomous action after operator
 * approval. Called by the approval queue when an operator approves
 * a row that was held by side-effect gating (approval="pending").
 *
 * Flow:
 *   1. Look up the AutonomousAction row
 *   2. Find the rule by ruleName
 *   3. Read deferredItem from payload (stored at deferral time)
 *   4. Call rule.action(deferredItem) — same code path as the auto
 *      branch, just delayed
 *   5. Update the row with executedAt + result + payload merge
 *
 * Returns { ok, result, error } so the caller can surface the
 * outcome. Never throws — failure is data, not an exception.
 */
export async function executeApprovedAction(
  autonomousActionId: string,
): Promise<{ ok: boolean; result?: string; error?: string }> {
  const row = await prisma.autonomousAction
    .findUnique({ where: { id: autonomousActionId } })
    .catch(() => null);
  if (!row) return { ok: false, error: "row not found" };

  const rule = RULES.find((r) => r.name === row.ruleName);
  if (!rule) {
    return {
      ok: false,
      error: `rule "${row.ruleName}" not found in autonomous-engine RULES registry`,
    };
  }

  const payload = row.payload as { deferredItem?: unknown } | null;
  const deferredItem = payload?.deferredItem;
  if (!deferredItem) {
    return {
      ok: false,
      error:
        "no deferredItem in payload — row was not created via the v10.0.157 deferral path",
    };
  }

  const fireStarted = Date.now();
  try {
    const result = await rule.action(deferredItem);
    await prisma.autonomousAction
      .update({
        where: { id: autonomousActionId },
        data: {
          executedAt: new Date(),
          result: result.result,
          payload: {
            ...(payload as Record<string, unknown>),
            executionResult: result.result,
            executedAfterApprovalMs: Date.now() - fireStarted,
          } as Prisma.InputJsonValue,
        },
      })
      .catch(() => undefined);
    return { ok: true, result: result.result };
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    await prisma.autonomousAction
      .update({
        where: { id: autonomousActionId },
        data: {
          executedAt: new Date(),
          result: "failed",
          error: errMsg,
        },
      })
      .catch(() => undefined);
    return { ok: false, error: errMsg };
  }
}
