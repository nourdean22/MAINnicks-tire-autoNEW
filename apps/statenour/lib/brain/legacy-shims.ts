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
import { daysAgo } from "@/lib/utils/datetime";
import { logger as rootLogger } from "@/lib/logger";
import { BRAIN_CATEGORIES } from "@/lib/brain/categories";
import { queryNick } from "@/lib/nickstire/query";
import { logError } from "@/lib/utils/error-log";

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
    .catch((err): Array<{ content: string; updatedAt: Date }> => {
      logError("brain.legacy-shims", err, { fn: "recentScoreSnapshots.findMany" });
      return [];
    });

  let parseFailures = 0;
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
      parseFailures++;
    }
  }
  if (parseFailures > 0) {
    logError("brain.legacy-shims", new Error(`${parseFailures} snapshot parse failures`), { fn: "recentScoreSnapshots.parse" }, "warn");
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
 * Recent N-day habit completion log, newest day first per habit. Sourced from
 * `Task` rows with loopKind="DAILY", one row per day, read off the TaskEvent
 * ledger by habitDays (lib/services/daily-backfill.ts): a backfilled day is
 * done on its own day, an unchecked one is not. Until 2026-11-03 this counted
 * streakCount back from lastCompletedAt, which hid every backfilled day.
 * A failed read returns [] (no rows to correlate), never a window of false.
 */
export async function recentDailyHabits(days = 14): Promise<LegacyHabitRow[]> {
  try {
    const tasks = await prisma.task.findMany({
      where: { loopKind: "DAILY", deletedAt: null },
      select: { id: true, title: true, loopKind: true, streakCount: true, lastCompletedAt: true },
    });
    const { habitDays } = await import("@/lib/services/daily-backfill");
    const grid = await habitDays(tasks, days);
    return tasks.flatMap((t) =>
      (grid.get(t.id) ?? []).map((d) => ({ habitKey: t.title, completed: d.done, date: d.day })),
    );
  } catch (err) {
    logError("brain.legacy-shims", err, { fn: "recentDailyHabits" });
    return [];
  }
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
 * Recent N-day shop jobs, read from the NICKSTIRE BRIDGE over HTTP.
 *
 * CORRECTED 2026-09-16. This comment previously said "no nickstire bridge
 * query exposes a list of recent jobs (`jobs_today` is single-day; no range
 * query). Returns empty + warn-once." That was false: the body below calls
 * `recent_invoices` with a `days` range and maps the result. Measured with no
 * DATABASE_URL set, it returned enough live invoices for the teaching-moments
 * engine to emit two revenue moments (n=11 and n=8 day-samples).
 *
 * The staleness had a real cost. `tests/lib/brain-engines-smoke.test.ts`
 * describes its subjects as "100% DB-dominated" and mocks only `@/lib/prisma`
 * — reasonable if you believe this comment. Because this shim actually reaches
 * the network, that test's verdict was decided by bridge reachability rather
 * than by the contract it meant to lock: green in CI, red on a machine that can
 * reach the bridge.
 *
 * So: this is a NETWORK read, not a DB read. Anything mocking the database
 * alone has NOT emptied this input. It still returns [] + warn-once when the
 * bridge errors or no sync key is configured, which is the degrade path the
 * old comment described as the only path.
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
