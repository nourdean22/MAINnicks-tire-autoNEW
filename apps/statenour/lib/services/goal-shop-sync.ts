/**
 * Goals fill themselves from the shop (job 2026-11-02-nour-os-interconnect R2b, 2026-11-03).
 *
 * An active metric goal in the business domain whose `metric` names a shop number gets its currentValue SET
 * nightly from the bridge: `revenue` = revenue_range totalDollars, `cars` = its invoiceCount (a counter invoice
 * is a closed job; its payment status means nothing). The write goes through updateGoal, so progress, the
 * achieved flip and the audit row behave as they do for a hand edit, and emits ONE progress_logged GoalEvent
 * with source shop-bridge carrying the window and the raw read. It is never a check-in: a check-in would turn
 * "check-in due" green without Nour looking (manager ruling, R1 audit).
 *
 * A failed, slow or empty read skips the goal and names why (empty-vs-error): it never writes 0.
 * `reviews` is recognised and always skipped: getReviewStats counts the reviews stored from Google Places
 * pulls (at most 5 per pull, lib/integrations/google-reviews.ts), not the shop's Google total, so writing it
 * would set a wrong number as measured. The bridge has no review-total query (cross-lane need).
 */
import { prisma } from "@/lib/prisma";
import { queryNick, readBridge } from "@/lib/nickstire/query";
import { SHOP_READ_DEADLINE_MS } from "@/lib/home/shop-today";
import { goalDue } from "@/lib/brain/goal-pace";
import { updateGoal } from "@/lib/services/goals";
import { etCalendarParts, toDateString } from "@/lib/utils/datetime";
import { logger as rootLogger } from "@/lib/logger";

const log = rootLogger.withSurface("services/goal-shop-sync");

/** The GoalEvent source of every value this sync writes. */
export const SHOP_SYNC_SOURCE = "shop-bridge";
/** The `metric` values (case-insensitive) a business goal can name that the shop measures. */
export const SHOP_METRICS = ["revenue", "cars", "reviews"] as const;
type ShopMetric = (typeof SHOP_METRICS)[number];
const isShopMetric = (m: string): m is ShopMetric => (SHOP_METRICS as readonly string[]).includes(m);

const REVIEWS_SKIP =
  "skipped: no shop review total to read (getReviewStats counts the stored Places sample, at most 5 per pull, not Google's total)";

type GoalForWindow = { horizon: string | null; deadline: Date | null; createdAt: Date };
type Window = { from: string; to: string };

/** ET day key of a wall-clock Y/M/D; Date.UTC normalises an out-of-range day (a Monday in the prior month). */
const dayKey = (year: number, month: number, day: number) => new Date(Date.UTC(year, month - 1, day)).toISOString().slice(0, 10);

/** First ET day of the horizon period (Mon-Sun week, calendar month / quarter / year) `at` falls in. */
function periodStart(horizon: string, at: Date): string {
  const { year, month, day, weekday } = etCalendarParts(at);
  if (horizon === "DAY") return dayKey(year, month, day);
  if (horizon === "WEEK") return dayKey(year, month, day - (weekday === 0 ? 6 : weekday - 1));
  if (horizon === "MONTH") return dayKey(year, month, 1);
  if (horizon === "QUARTER") return dayKey(year, Math.floor((month - 1) / 3) * 3 + 1, 1);
  return dayKey(year, 1, 1);
}

/**
 * The shop days (ET, both inclusive, as revenue_range reads them) a goal's number covers, or null when there
 * are none. The end is goalDue's (a deadline Nour set, else the end of the horizon period the goal was created
 * in), capped at today; so a goal past its period keeps its period's number instead of counting on. The start
 * is that period's first day for a horizon-dated goal ("$15K this month" counts the whole month) and the
 * creation day otherwise.
 * shortcut: a set deadline or a horizon change counts from createdAt, not from the latest horizon_set event;
 * upgrade if Nour re-dates goals often.
 */
export function goalShopWindow(g: GoalForWindow, now: Date = new Date()): Window | null {
  const due = goalDue({ deadline: g.deadline, horizon: g.horizon, createdAt: g.createdAt });
  const from = due.source === "horizon" ? periodStart(g.horizon!.toUpperCase(), g.createdAt) : toDateString(g.createdAt);
  const todayKey = toDateString(now);
  const dueKey = due.at ? toDateString(new Date(due.at)) : null;
  const to = dueKey && dueKey < todayKey ? dueKey : todayKey;
  return from <= to ? { from, to } : null;
}

type RangeRead = { status: "ok"; totalDollars: number; invoiceCount: number } | { status: "unknown"; reason: string };

/** revenue_range for one window, under the Home card's deadline (lib/home/shop-today.ts). Past it: unknown. */
async function readRange({ from, to }: Window): Promise<RangeRead> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<RangeRead>((resolve) => {
    timer = setTimeout(
      () => resolve({ status: "unknown", reason: `the shop did not answer within ${SHOP_READ_DEADLINE_MS / 1000} s` }),
      SHOP_READ_DEADLINE_MS,
    );
  });
  // The rejection is caught on the read itself, so a fetch that fails after the deadline won is not unhandled.
  const read = queryNick("revenue_range", { from, to }, SHOP_READ_DEADLINE_MS).then(
    (res): RangeRead => {
      const r = readBridge<{ totalDollars?: unknown; invoiceCount?: unknown } | null>(res);
      if (r.status !== "ok") return r;
      const { totalDollars, invoiceCount } = r.data ?? {};
      if (typeof totalDollars !== "number" || !Number.isFinite(totalDollars) || typeof invoiceCount !== "number" || !Number.isInteger(invoiceCount)) {
        return { status: "unknown", reason: "the answer carried no total" };
      }
      return { status: "ok", totalDollars, invoiceCount };
    },
    (err): RangeRead => ({ status: "unknown", reason: err instanceof Error ? err.message.slice(0, 120) : "bridge read failed" }),
  );
  try {
    return await Promise.race([read, deadline]);
  } finally {
    clearTimeout(timer);
  }
}

export type ShopSyncResult = {
  synced: Array<{ goalId: string; metric: ShopMetric; value: number }>;
  skipped: Array<{ goalId: string; reason: string }>;
  failed: Array<{ goalId: string; reason: string }>;
  /** cron-manager records this into cron_job_logs: goals whose value was written. */
  resultCount: number;
  degraded?: true;
  degradedReason?: string;
};

export async function syncGoalsFromShop(now: Date = new Date()): Promise<ShopSyncResult> {
  const goals = await prisma.lifeGoal.findMany({
    where: { status: "active", deletedAt: null, kind: "metric", domain: { equals: "business", mode: "insensitive" } },
    select: { id: true, metric: true, currentValue: true, horizon: true, deadline: true, createdAt: true },
    orderBy: { createdAt: "asc" },
  });
  const out: ShopSyncResult = { synced: [], skipped: [], failed: [], resultCount: 0 };
  const skip = (goalId: string, reason: string) => out.skipped.push({ goalId, reason });
  // Two goals over the same window share one read.
  const reads = new Map<string, Promise<RangeRead>>();

  for (const g of goals) {
    const metric = (g.metric ?? "").trim().toLowerCase();
    if (!isShopMetric(metric)) continue; // not a shop number: untouched
    if (metric === "reviews") {
      skip(g.id, REVIEWS_SKIP);
      continue;
    }
    const window = goalShopWindow(g, now);
    if (!window) {
      skip(g.id, "skipped: the goal's window holds no shop day");
      continue;
    }
    const key = `${window.from}|${window.to}`;
    if (!reads.has(key)) reads.set(key, readRange(window));
    const read = await reads.get(key)!;
    if (read.status !== "ok") {
      skip(g.id, `skipped: bridge unavailable (${read.reason})`);
      continue;
    }
    // A quiet window and a stalled shop sync both read as zero invoices: never written as a measured 0.
    if (read.invoiceCount === 0) {
      skip(g.id, "skipped: no invoices in the window (a quiet window and a stalled shop sync read the same)");
      continue;
    }
    const value = metric === "revenue" ? Math.round(read.totalDollars * 100) / 100 : read.invoiceCount;
    if (value === g.currentValue) {
      skip(g.id, "unchanged");
      continue;
    }
    try {
      await updateGoal(
        { id: g.id, currentValue: value },
        {
          source: SHOP_SYNC_SOURCE,
          progressPayload: { window, read: { query: "revenue_range", totalDollars: read.totalDollars, invoiceCount: read.invoiceCount } },
        },
      );
      out.synced.push({ goalId: g.id, metric, value });
    } catch (err) {
      out.failed.push({ goalId: g.id, reason: err instanceof Error ? err.message.slice(0, 200) : String(err) });
    }
  }
  out.resultCount = out.synced.length;
  // cron_job_logs keeps status + error, not this body: a goal the bridge or the write failed files the run
  // "partial" with the count and the first reason (cron-lifecycle deriveDegradation), so the miss is readable there.
  const unread = out.skipped.filter((s) => s.reason.startsWith("skipped: bridge unavailable"));
  if (unread.length || out.failed.length) {
    out.degraded = true;
    out.degradedReason = `${unread.length} goal(s) bridge unavailable, ${out.failed.length} write(s) failed: ${(unread[0] ?? out.failed[0])!.reason}`.slice(0, 300);
  }
  log.info("goal_shop_sync", { synced: out.synced.length, skipped: out.skipped, failed: out.failed });
  return out;
}
