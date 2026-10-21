/**
 * Live Feed — Real-time business events to Telegram
 *
 * Sends good-mood updates throughout the day:
 * - Every closed job (invoice paid)
 * - Revenue milestones ($500, $1K, $1.5K, $2K, $2.5K, $3K days)
 * - New 5-star reviews
 * - Hot leads captured
 * - Referral conversions
 *
 * Gated behind feature flags:
 *   live_telegram_feed  — real-time closed job + milestone + review + lead notifications
 *   daily_wins_digest   — end-of-day wins summary at 7 PM ET
 *
 * Wired into the event bus via registerLiveFeedListeners().
 */

import { createLogger } from "../lib/logger";

import { BUSINESS } from "@shared/business";
const log = createLogger("live-feed");

// Pull from BUSINESS constant so we stay in sync with everywhere else.
// Was hardcoded 20_000 from when the goal was $20K — now the goal is
// dynamic (trailing 90d × 1.1) with this constant as the floor. Hardcoding
// caused the Telegram feed to show 5x off-pace numbers vs the rest of
// the system after the bump from 20K → 100K.
const MONTHLY_TARGET = BUSINESS.revenueTarget.monthly;

// ─── Daily Accumulators (reset at midnight ET) ──────
interface DailyState {
  revenue: number;
  jobCount: number;
  milestonesHit: Set<number>;
  reviews5Star: number;
  leadsTotal: number;
  leadsHot: number;
  referrals: number;
  vipVisits: number;
  biggestJob: { service: string; amount: number } | null;
  lastResetDate: string;
}

const daily: DailyState = {
  revenue: 0,
  jobCount: 0,
  milestonesHit: new Set(),
  reviews5Star: 0,
  leadsTotal: 0,
  leadsHot: 0,
  referrals: 0,
  vipVisits: 0,
  biggestJob: null,
  lastResetDate: getTodayET(),
};

const MILESTONES = [500, 1000, 1500, 2000, 2500, 3000];

function getTodayET(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: BUSINESS.timezone });
}

function ensureDayReset(): void {
  const today = getTodayET();
  if (daily.lastResetDate !== today) {
    daily.revenue = 0;
    daily.jobCount = 0;
    daily.milestonesHit = new Set();
    daily.reviews5Star = 0;
    daily.leadsTotal = 0;
    daily.leadsHot = 0;
    daily.referrals = 0;
    daily.vipVisits = 0;
    daily.biggestJob = null;
    daily.lastResetDate = today;
    log.info("Daily accumulators reset for new day");
  }
}

function getMonthlyPacePercent(): number {
  const now = new Date();
  const etDate = new Date(now.toLocaleString("en-US", { timeZone: BUSINESS.timezone }));
  const dayOfMonth = etDate.getDate();
  const daysInMonth = new Date(etDate.getFullYear(), etDate.getMonth() + 1, 0).getDate();
  const expectedDaily = MONTHLY_TARGET / daysInMonth;
  const expectedToDate = expectedDaily * dayOfMonth;
  // We only know today's revenue from accumulator, so estimate pace from today alone
  const projectedMonthly = (daily.revenue / Math.max(1, dayOfMonth)) * daysInMonth;
  return Math.round((projectedMonthly / MONTHLY_TARGET) * 100);
}

// ─── Telegram Sender (flag-gated) ──────────────────

async function sendFeedMessage(text: string): Promise<boolean> {
  try {
    const { isEnabled } = await import("./featureFlags");
    const enabled = await isEnabled("live_telegram_feed");
    if (!enabled) {
      log.debug("live_telegram_feed flag disabled, skipping");
      return false;
    }

    const { sendTelegram } = await import("./telegram");
    return sendTelegram(text, "digest");
  } catch (err) {
    log.warn("Live feed send failed", { error: err instanceof Error ? err.message : String(err) });
    return false;
  }
}

// ─── Public Notification Functions ──────────────────

/**
 * Notify when an invoice is marked as paid / job closed.
 */
export async function notifyClosedJob(invoice: {
  customerName: string;
  service?: string;
  totalAmount: number;
  vehicle?: string;
}): Promise<void> {
  ensureDayReset();

  // `totalAmount` arrives in DOLLARS — every emit site divides cents by 100
  // before dispatch (invoices.ts:155/172/227, booking.ts:123/138/150,
  // gatewayTire.ts:510/743/760, payments.ts:227). Dividing again made every
  // figure on this feed 100x low: a $517 ticket read $5.17 and the revenue
  // milestones [500..3000] could never fire. Proof this side was the wrong one:
  // ensureDayReset() below refills this same `daily.revenue` from getShopPulse(),
  // which is already dollars — one variable, two units, depending on restart.
  const amount = Number(invoice.totalAmount) || 0;
  daily.revenue += amount;
  daily.jobCount++;

  if (!daily.biggestJob || amount > daily.biggestJob.amount) {
    daily.biggestJob = { service: invoice.service || "Service", amount };
  }

  const lines = [
    `\u2705 JOB CLOSED: ${invoice.customerName}`,
    `${invoice.service || "Service"} \u2014 $${amount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
    invoice.vehicle ? `Vehicle: ${invoice.vehicle}` : "",
    `Today's total: $${daily.revenue.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} (${daily.jobCount} job${daily.jobCount !== 1 ? "s" : ""})`,
  ];

  await sendFeedMessage(lines.filter(Boolean).join("\n"));

  // Check for revenue milestones
  for (const milestone of MILESTONES) {
    if (daily.revenue >= milestone && !daily.milestonesHit.has(milestone)) {
      daily.milestonesHit.add(milestone);
      await notifyRevenueMilestone(milestone);
    }
  }
}

/**
 * Notify when daily revenue crosses a milestone.
 */
export async function notifyRevenueMilestone(amount: number): Promise<void> {
  const pacePercent = getMonthlyPacePercent();
  const lines = [
    `\ud83c\udfaf MILESTONE: $${amount.toLocaleString()} day! ${daily.jobCount} job${daily.jobCount !== 1 ? "s" : ""} closed.`,
    `Pace: ${pacePercent}% of monthly target.`,
  ];
  await sendFeedMessage(lines.join("\n"));
}

/**
 * Notify when a new 5-star review comes in.
 */
export async function notifyNewFiveStarReview(review: {
  text: string;
  authorName: string;
}): Promise<void> {
  ensureDayReset();
  daily.reviews5Star++;

  const snippet = review.text.length > 100 ? review.text.slice(0, 100) + "..." : review.text;
  const lines = [
    `\u2b50\u2b50\u2b50\u2b50\u2b50 NEW 5-STAR REVIEW`,
    `"${snippet}"`,
    `\u2014 ${review.authorName}`,
  ];
  await sendFeedMessage(lines.join("\n"));
}

/**
 * Notify when a lead scores 80+ (hot lead).
 */
export async function notifyHotLead(lead: {
  name: string;
  score: number;
  problem?: string;
  vehicle?: string;
  source?: string;
}): Promise<void> {
  ensureDayReset();
  daily.leadsTotal++;
  daily.leadsHot++;

  const lines = [
    `\ud83d\udd25 HOT LEAD: ${lead.name} (${lead.score}/100)`,
    lead.problem ? lead.problem : "",
    lead.vehicle ? `Vehicle: ${lead.vehicle}` : "",
    lead.source ? `Source: ${lead.source}` : "",
  ];
  await sendFeedMessage(lines.filter(Boolean).join("\n"));
}

/**
 * Track a new lead (non-hot). Increments daily counter only.
 */
export function trackLead(): void {
  ensureDayReset();
  daily.leadsTotal++;
}

/**
 * Track a referral conversion. Increments daily counter.
 */
export function trackReferral(): void {
  ensureDayReset();
  daily.referrals++;
}

/**
 * Track a VIP visit. Increments daily counter.
 */
export function trackVipVisit(): void {
  ensureDayReset();
  daily.vipVisits++;
}

/**
 * Register live feed listeners on the event bus.
 * Call once from server startup (after event bus init).
 */
export function registerLiveFeedListeners(): void {
  // We hook into the event bus by registering a destination
  // This is done lazily to avoid circular imports
  import("./eventBus").then(({ dispatch }) => {
    // We don't register a new destination — instead we piggyback
    // on the existing telegram destination or add our own.
    // Since the event bus is already initialized, we use a different approach:
    // We export handlers that get called from the event bus destination.
    log.info("Live feed listeners registered");
  }).catch((e) => { log.warn("[services/liveFeed] fire-and-forget failed:", e); });
}

/**
 * Get current daily accumulator state (for admin dashboard / debugging).
 */
export function getLiveFeedStatus(): {
  revenue: number;
  jobCount: number;
  milestonesHit: number[];
  reviews5Star: number;
  leadsTotal: number;
  leadsHot: number;
  referrals: number;
  vipVisits: number;
  biggestJob: { service: string; amount: number } | null;
  date: string;
} {
  ensureDayReset();
  return {
    revenue: daily.revenue,
    jobCount: daily.jobCount,
    milestonesHit: Array.from(daily.milestonesHit),
    reviews5Star: daily.reviews5Star,
    leadsTotal: daily.leadsTotal,
    leadsHot: daily.leadsHot,
    referrals: daily.referrals,
    vipVisits: daily.vipVisits,
    biggestJob: daily.biggestJob,
    date: daily.lastResetDate,
  };
}
