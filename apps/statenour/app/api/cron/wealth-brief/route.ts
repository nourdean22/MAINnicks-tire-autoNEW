/**
 * GET /api/cron/wealth-brief — v10.0.529.106 · Wave 69.
 *
 * Sunday morning weekly wealth brief delivered via Telegram.
 *
 * Pre-Wave-69 the wisdom corpus (189+ Munger/Buffett/Naval entries)
 * was never applied to the actual balance sheet (FinancialSnapshot
 * model has been collecting weight/debt/savings/investment data for
 * months). The two layers existed but didn't talk.
 *
 * This cron:
 *   1. Reads the most recent FinancialSnapshot + the snapshot from
 *      7 days ago to compute week-over-week delta
 *   2. Picks ONE relevant wisdom from the corpus based on the dominant
 *      signal in the snapshot (high cash → Munger "cash burns"; high
 *      debt → Buffett "rule #1"; rising investment → Naval "leverage")
 *   3. Composes a 4-line Telegram card · runs Sunday 9am ET
 *
 * Idempotent · per-week marker prevents double-push if cron fires
 * multiple times on the same Sunday.
 */

import { cronHandler } from "@/lib/utils/http";
import { prisma } from "@/lib/prisma";
import { sendTelegram } from "@/lib/services/telegram";
import { logger as rootLogger } from "@/lib/logger";
import { today, daysAgo, toDateString } from "@/lib/utils/datetime";

const log = rootLogger.withSurface("cron/wealth-brief");

interface SnapshotShape {
  date: string;
  netWorthEstimate: number | null;
  checkingBalance: number | null;
  savingsBalance: number | null;
  investmentValue: number | null;
  businessRevenue: number | null;
  totalDebt: number | null;
}

interface WisdomCandidate {
  content: string;
  source: string;
}

export const GET = cronHandler(async () => {
  const todayStr = today();
  const isoWeek = isoWeekKey(new Date());
  const dedupKey = `wealth_brief_${isoWeek}`;

  // Per-week dedup · only one brief per ISO week.
  const sent = await prisma.brainMemory.findUnique({
    where: { category_key: { category: "proactive_push_sent", key: dedupKey } },
    select: { id: true },
  }).catch(() => null);
  if (sent) {
    return { skipped: true, reason: "already_sent_this_week", isoWeek };
  }

  // Pull latest + 7d-ago snapshots in parallel.
  const sevenDaysAgo = toDateString(daysAgo(7));
  const [latest, weekAgo] = await Promise.all([
    prisma.financialSnapshot.findFirst({
      orderBy: { date: "desc" },
    }).catch(() => null),
    prisma.financialSnapshot.findFirst({
      where: { date: { lte: sevenDaysAgo } },
      orderBy: { date: "desc" },
    }).catch(() => null),
  ]);

  if (!latest) {
    return { skipped: true, reason: "no_financial_data" };
  }

  // Identify dominant signal in the snapshot · drives wisdom selection.
  const signal = dominantSignal(latest as SnapshotShape, weekAgo as SnapshotShape | null);

  // Match a wisdom row to that signal.
  const wisdom = await pickWisdom(signal.theme).catch(() => null);

  // Compose the card.
  const lines: string[] = [`📊 <b>Weekly wealth brief · ${todayStr}</b>`, ``];

  if (latest.netWorthEstimate !== null && weekAgo?.netWorthEstimate != null) {
    const delta = latest.netWorthEstimate - weekAgo.netWorthEstimate;
    const sign = delta >= 0 ? "+" : "";
    lines.push(`Net worth: $${fmt(latest.netWorthEstimate)} (${sign}$${fmt(delta)} 7d)`);
  } else if (latest.netWorthEstimate !== null) {
    lines.push(`Net worth: $${fmt(latest.netWorthEstimate)}`);
  }

  if (latest.totalDebt !== null && latest.totalDebt > 0) {
    lines.push(`Debt: $${fmt(latest.totalDebt)}`);
  }

  if (latest.businessRevenue !== null) {
    lines.push(`Business: $${fmt(latest.businessRevenue)}/mo`);
  }

  lines.push(``);
  lines.push(`<i>Signal: ${signal.headline}</i>`);

  if (wisdom) {
    lines.push(``);
    lines.push(`<b>${wisdom.source}:</b> ${wisdom.content.slice(0, 180)}`);
  }

  lines.push(``);
  lines.push(`Tap to open /financial · review + adjust.`);

  const text = lines.join("\n");
  const ok = await sendTelegram(text).catch(() => false);
  if (!ok) {
    log.warn("wealth_brief_send_failed", { isoWeek });
    return { sent: false, reason: "telegram_failed", isoWeek };
  }

  // Mark sent · 14d TTL covers operator scrolling back to debug.
  await prisma.brainMemory.create({
    data: {
      category: "proactive_push_sent",
      key: dedupKey,
      content: `wealth brief sent for week ${isoWeek}`,
      source: "wealth_brief_cron",
      confidence: 1.0,
      expiresAt: new Date(Date.now() + 14 * 24 * 3600_000),
    },
  }).catch(() => undefined);

  return { sent: true, isoWeek, signal: signal.theme };
});

function fmt(n: number): string {
  if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (Math.abs(n) >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return `${Math.round(n)}`;
}

function isoWeekKey(d: Date): string {
  // Returns YYYY-WW · used as the per-week dedup key.
  const date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dayNum = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((date.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${date.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

interface SignalResult {
  theme: "cash_heavy" | "debt_heavy" | "investment_growth" | "revenue_growth" | "neutral";
  headline: string;
}

function dominantSignal(latest: SnapshotShape, prior: SnapshotShape | null): SignalResult {
  // Order matters · highest-stakes signal wins. Debt > cash > growth.
  if (latest.totalDebt !== null && latest.totalDebt > 50_000) {
    return {
      theme: "debt_heavy",
      headline: `Debt of $${fmt(latest.totalDebt)} is the largest single item on the sheet.`,
    };
  }
  const cash = (latest.checkingBalance ?? 0) + (latest.savingsBalance ?? 0);
  const investment = latest.investmentValue ?? 0;
  if (cash > 50_000 && cash > investment * 1.5) {
    return {
      theme: "cash_heavy",
      headline: `$${fmt(cash)} sitting in checking+savings · earning near-zero.`,
    };
  }
  if (prior && (latest.investmentValue ?? 0) > (prior.investmentValue ?? 0) * 1.05) {
    const delta = (latest.investmentValue ?? 0) - (prior.investmentValue ?? 0);
    return {
      theme: "investment_growth",
      headline: `Investments up $${fmt(delta)} this week.`,
    };
  }
  if (prior && (latest.businessRevenue ?? 0) > (prior.businessRevenue ?? 0) * 1.05) {
    return {
      theme: "revenue_growth",
      headline: `Business revenue up this week.`,
    };
  }
  return { theme: "neutral", headline: `Sheet stable week-over-week.` };
}

/**
 * Pick a wisdom row from the corpus that matches the dominant
 * financial signal. Falls back to a random Munger entry when no
 * theme-matched wisdom exists.
 */
async function pickWisdom(theme: SignalResult["theme"]): Promise<WisdomCandidate | null> {
  // Theme-keyword map · drives the LIKE search.
  const themeKeywords: Record<SignalResult["theme"], string[]> = {
    debt_heavy: ["debt", "leverage", "borrow", "credit", "interest"],
    cash_heavy: ["cash", "compound", "invest", "patient", "wait"],
    investment_growth: ["compound", "long-term", "patient", "moat"],
    revenue_growth: ["focus", "moat", "discipline", "execution"],
    neutral: ["patience", "wisdom", "long"],
  };
  const keywords = themeKeywords[theme] ?? ["wisdom"];
  const orFilters = keywords.map((k) => ({
    content: { contains: k, mode: "insensitive" as const },
  }));

  // Prefer Munger/Buffett/Naval wisdom over generic.
  const preferredAuthors = ["munger", "buffett", "naval"];

  const rows = await prisma.brainMemory.findMany({
    where: {
      category: "wisdom",
      deletedAt: null,
      OR: orFilters,
    },
    select: { content: true, key: true, metadata: true, source: true },
    take: 20,
  }).catch(() => []);

  if (rows.length === 0) return null;

  // Rank · preferred-author keys score higher.
  const scored = rows.map((r) => {
    let score = 0;
    const meta = (r.metadata ?? {}) as { persona?: string; author?: string };
    const author = (meta.persona ?? meta.author ?? r.key).toLowerCase();
    for (const pref of preferredAuthors) {
      if (author.includes(pref)) score += 5;
    }
    score += Math.random(); // tiebreaker
    return { row: r, score, author };
  });
  scored.sort((a, b) => b.score - a.score);
  const top = scored[0];

  return {
    content: top.row.content,
    source: capitalize(top.author),
  };
}

function capitalize(s: string): string {
  if (!s) return s;
  return s.charAt(0).toUpperCase() + s.slice(1);
}
