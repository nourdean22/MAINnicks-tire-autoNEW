/**
 * "What you're not seeing" (2026-10-22, docs/design/2026-10-22-what-you-are-not-seeing.md §5).
 *
 * One weekly section: the thinking engine's open claim-vs-record gaps (one per topic,
 * newest first) and last week's shop sales against the week before. A failed read says
 * so in its own line; it never renders as "no gaps" or "$0" (skill empty-vs-error).
 *
 * Preview any day: GET /api/brain/not-seeing (owner). It joins the Monday morning brief
 * only when NICK_WEEKLY_GAP_NOTE is on, which is OFF by default: what reaches Nour's
 * phone is his call (he stopped the scheduled briefs on 2026-10-18).
 */
import { prisma } from "@/lib/prisma";
import { queryNick, readBridge, type BridgeRead } from "@/lib/nickstire/query";
import { shiftDate } from "@/lib/ai/outcome-calibration";
import { escapeHtml } from "@/lib/utils/escape-html";

export interface NotSeeingSlice {
  /** Rendered HTML lines (the morning brief's format). */
  lines: string[];
  payload: Record<string, unknown>;
}

interface RevenueRange {
  totalDollars: number;
  invoiceCount: number;
}

const MAX_GAPS = 3;
const GAP_LOOKBACK_DAYS = 30; // memory-consolidation auto-resolves open rows at 30

const money = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;

/** Sales line for two complete 7-day windows. Unknown on either side stays unknown. */
export function salesLine(last: BridgeRead<RevenueRange>, prev: BridgeRead<RevenueRange>): string {
  if (last.status !== "ok" || typeof last.data?.totalDollars !== "number") {
    return "Sales: couldn't load the last 7 days (unknown, not zero)";
  }
  const invoices = typeof last.data.invoiceCount === "number" ? ` on ${last.data.invoiceCount} invoices` : "";
  const now = `Sales, last 7 days: ${money(last.data.totalDollars)}${invoices}`;
  if (prev.status !== "ok" || typeof prev.data?.totalDollars !== "number") {
    return `${now} (the week before couldn't load)`;
  }
  const before = prev.data.totalDollars;
  if (before <= 0) return `${now} (the week before had no sales recorded)`;
  const pct = Math.round(((last.data.totalDollars - before) / before) * 100);
  const move = pct === 0 ? "flat" : pct > 0 ? `up ${pct}%` : `down ${Math.abs(pct)}%`;
  return `${now}, ${move} vs the week before (${money(before)})`;
}

export async function buildNotSeeingSlice(todayIso: string): Promise<NotSeeingSlice> {
  const range = (from: number, to: number) => ({ from: shiftDate(todayIso, from), to: shiftDate(todayIso, to) });
  const unknownRead = (err: unknown): BridgeRead<RevenueRange> => ({
    status: "unknown",
    reason: err instanceof Error ? err.message : String(err),
  });

  const [gapRows, lastWeek, prevWeek] = await Promise.all([
    prisma.contradiction
      .findMany({
        where: {
          resolved: false,
          deletedAt: null,
          createdAt: { gte: new Date(Date.now() - GAP_LOOKBACK_DAYS * 86400_000) },
        },
        orderBy: { createdAt: "desc" },
        take: 40,
        select: { category: true, gap: true },
      })
      .catch((): null => null),
    queryNick("revenue_range", range(-7, -1)).then((r) => readBridge<RevenueRange>(r), unknownRead),
    queryNick("revenue_range", range(-14, -8)).then((r) => readBridge<RevenueRange>(r), unknownRead),
  ]);

  const lines: string[] = ["<b>What you're not seeing</b>"];
  let gapCount: number | null = null;
  if (gapRows === null) {
    lines.push("Open gaps: couldn't load (unknown, not empty)");
  } else {
    const seen = new Set<string>();
    const picks = gapRows.filter((r) => !seen.has(r.category) && seen.add(r.category)).slice(0, MAX_GAPS);
    gapCount = gapRows.length;
    if (picks.length === 0) lines.push("No open gaps between what you said and the record.");
    for (const p of picks) lines.push(`· ${escapeHtml(p.category)}: ${escapeHtml(p.gap.slice(0, 160))}`);
  }
  lines.push(salesLine(lastWeek, prevWeek));

  return {
    lines,
    payload: {
      openGaps: gapCount,
      sales: { last: lastWeek.status, previous: prevWeek.status },
    },
  };
}
