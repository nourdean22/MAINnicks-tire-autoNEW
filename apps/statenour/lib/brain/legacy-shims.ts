/**
 * Legacy data-source shims · v10.0.55 · Wave A.
 *
 * Sources the brain layer's data demands from the right replacement
 * tables after the Apr 19 retirement of `DailyScore` + `HabitLog`
 * and the Aug-onwards migration of customer/job/lead/quote tables
 * to nickstire (TiDB on Railway).
 *
 * Why this module exists:
 *   The brain layer (lib/brain/*.ts) has 50+ historical sites that
 *   hard-coded `Promise.resolve([] as any[])` as placeholders during
 *   the migration. Each was a feature silently running on dead data.
 *   v10.0.50/.51/.53/.54 fixed the autonomous-engine + business-intel +
 *   service layer + tools.ts inline. This module captures the
 *   recurring "source data is gone, here's where it lives now"
 *   patterns so the remaining 17 brain files can swap in a single
 *   function call instead of duplicating the JSON-parse + fallback
 *   logic 50 times.
 *
 * Contract on bridge / DB failure: returns empty array, logs a
 * warn-once-per-process. Consumers must already handle the empty
 * case (every old `[]` placeholder was the empty case by accident).
 *
 * Shape parity: each shim returns the SAME SHAPE the legacy
 * placeholder pretended to return — the consumers iterate using
 * fields like `r.overallScore`, `r.workoutDone`, `h.habitKey`,
 * `j.serviceCategory`, etc. That contract is preserved here so the
 * brain modules need no refactor beyond the source swap.
 */

import { prisma } from "@/lib/prisma";
import { daysAgo, toDateString } from "@/lib/utils/datetime";
import { logger as rootLogger } from "@/lib/logger";
import { BRAIN_CATEGORIES } from "@/lib/brain/categories";
import { queryNick } from "@/lib/nickstire/query";

const log = rootLogger.withSurface("brain/legacy-shims");

const warnedShims = new Set<string>();
function warnOnce(shim: string, reason: string) {
  if (warnedShims.has(shim)) return;
  warnedShims.add(shim);
  log.warn("legacy_shim_active", { shim, reason });
}

// ── Identity snapshot history (legacy DailyScore replacement) ──

export interface LegacyScoreRow {
  date: string;
  /** Same value as updatedAt of the underlying snapshot row — kept
   *  as both `date` (string) and `createdAt` (Date) so consumers
   *  written against the legacy DailyScore shape (which had both)
   *  don't need refactor. */
  createdAt: Date;
  overallScore: number | null;
  disciplineScore: number | null;
  energyLevel: number | null;
  focusQuality: number | null;
  workoutDone: boolean;
  journalDone: boolean;
  mood: string | null;
}

/**
 * Recent N-day score history. Sourced from `BrainMemory` rows with
 * category="identity_snapshot" — the daily-rolled JSON snapshot is
 * parsed and projected onto the legacy DailyScore shape so existing
 * consumers (thinking-engine, predictive-engine, etc.) iterate the
 * same fields they always did.
 */
export async function recentScoreSnapshots(days = 14): Promise<LegacyScoreRow[]> {
  const since = daysAgo(days);
  const rows = await prisma.brainMemory
    .findMany({
      where: {
        category: BRAIN_CATEGORIES.IDENTITY_SNAPSHOT,
        deletedAt: null,
        updatedAt: { gte: since },
      },
      orderBy: { updatedAt: "desc" },
      select: { content: true, updatedAt: true },
    })
    .catch((): Array<{ content: string; updatedAt: Date }> => []);

  const out: LegacyScoreRow[] = [];
  for (const row of rows) {
    try {
      const parsed = JSON.parse(row.content) as {
        score?: number;
        discipline?: number;
        energy?: number;
        focus?: number;
        workoutDone?: boolean;
        journalDone?: boolean;
        mood?: string;
      };
      out.push({
        date: row.updatedAt.toISOString().slice(0, 10),
        createdAt: row.updatedAt,
        overallScore: typeof parsed.score === "number" ? parsed.score : null,
        disciplineScore: typeof parsed.discipline === "number" ? parsed.discipline : null,
        energyLevel: typeof parsed.energy === "number" ? parsed.energy : null,
        focusQuality: typeof parsed.focus === "number" ? parsed.focus : null,
        workoutDone: !!parsed.workoutDone,
        journalDone: !!parsed.journalDone,
        mood: typeof parsed.mood === "string" ? parsed.mood : null,
      });
    } catch {
      // Snapshot row not in JSON shape — skip.
    }
  }
  return out;
}

// ── Daily habit history (legacy HabitLog replacement) ──

export interface LegacyHabitRow {
  habitKey: string;
  completed: boolean;
  date: string;
}

/**
 * Recent N-day habit completion log. Sourced from `Task` rows with
 * loopKind="DAILY" — for each daily task, we synthesize one row
 * per day in the window: completed=true if lastCompletedAt for
 * that day matches, otherwise completed=false. Best-effort proxy
 * (we don't have a per-day completion ledger; streakCount tells us
 * the contiguous-recent-days count).
 */
export async function recentDailyHabits(days = 14): Promise<LegacyHabitRow[]> {
  const since = daysAgo(days);
  const tasks = await prisma.task
    .findMany({
      where: {
        loopKind: "DAILY",
        deletedAt: null,
      },
      select: { title: true, streakCount: true, lastCompletedAt: true },
    })
    .catch((): Array<{ title: string; streakCount: number; lastCompletedAt: Date | null }> => []);

  const out: LegacyHabitRow[] = [];
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  for (const t of tasks) {
    // Synthesize one row per day in the window. A task is "completed"
    // for a given day if it falls within (today - streakCount + 1)
    // through today, AND lastCompletedAt is recent enough to make
    // streakCount credible.
    const streakActive =
      t.lastCompletedAt &&
      t.lastCompletedAt.getTime() >= since.getTime();
    const streakDays = streakActive ? Math.min(days, t.streakCount) : 0;
    for (let i = 0; i < days; i++) {
      const day = new Date(today);
      day.setDate(today.getDate() - i);
      const dateStr = toDateString(day);
      const completed = i < streakDays;
      out.push({ habitKey: t.title, completed, date: dateStr });
    }
  }
  return out;
}

// ── Shop data shims (no bridge query yet → graceful empty) ──

export interface LegacyShopJob {
  serviceCategory: string;
  totalRevenue: number;
  jobDate: Date;
  /** Alias of jobDate — legacy consumers used both names. */
  createdAt: Date;
}
export interface LegacyShopLead {
  status: string;
  urgency: string;
  createdAt: Date;
  source: string;
}
export interface LegacyShopQuote {
  grandTotal: number;
  status: string;
  createdAt: Date;
  vehicleMake: string;
}

/**
 * Recent N-day shop jobs. Currently no nickstire bridge query
 * exposes a list of recent jobs (`jobs_today` is single-day; no
 * range query). Returns empty + warn-once. Brain consumers degrade
 * to seasonal/heuristic context.
 */
export async function recentShopJobs(days = 30): Promise<LegacyShopJob[]> {
  const res = await queryNick<{ invoices: Array<{ id: string; totalAmount: number; invoiceDate: string }> }>(
    "recent_invoices",
    { days }
  );
  if ("error" in res) {
    warnOnce("recentShopJobs", `failed to fetch recent invoices: ${res.error}`);
    return [];
  }
  return res.data.invoices.map((inv) => ({
    serviceCategory: "General",
    totalRevenue: Number(inv.totalAmount || 0) / 100,
    jobDate: new Date(inv.invoiceDate),
    createdAt: new Date(inv.invoiceDate),
  }));
}

export async function recentShopLeads(days = 30): Promise<LegacyShopLead[]> {
  const res = await queryNick<{
    leads: Array<{
      id: string;
      fullName: string;
      createdAt: string;
      status: string;
      urgencyScore: number;
      source: string;
    }>;
  }>("recent_leads", { days });
  if ("error" in res) {
    warnOnce("recentShopLeads", `failed to fetch recent leads: ${res.error}`);
    return [];
  }
  return res.data.leads.map((lead) => ({
    status: lead.status || "new",
    urgency: Number(lead.urgencyScore || 0) >= 4 ? "urgent" : "normal",
    createdAt: new Date(lead.createdAt),
    source: lead.source || "unknown",
  }));
}

export async function recentShopQuotes(_days = 30): Promise<LegacyShopQuote[]> {
  warnOnce("recentShopQuotes", "no nickstire bridge query for quotes list; returning empty");
  return [];
}
