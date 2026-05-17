/**
 * GET /api/system/tire-stock-requests — used-tire stock-check log.
 *
 * v10.0.279 · reads brainMemory rows where category='tire_stock_request'
 * (written by /api/vapi/check-used-tire-stock when a caller asks if we
 * have a specific used tire in stock). Aggregates ·
 *   · total requests in window
 *   · top-asked sizes (inventory signal · what to stock more of)
 *   · urgency mix (broken-down vs casual)
 *   · most-recent N requests (call-by-call detail)
 *
 * Window query · ?days=N (1 / 7 / 30 / 90 · default 30).
 * Auth · owner.
 */

import { apiHandler } from "@/lib/utils/http";
import { prisma } from "@/lib/prisma";
import { logger as rootLogger } from "@/lib/logger";

const log = rootLogger.withSurface("api/system/tire-stock-requests");

export const dynamic = "force-dynamic";

interface SizeAgg {
  size: string;
  count: number;
}

interface RequestRow {
  id: string;
  capturedAt: string | null;
  size: string;
  quantity: number;
  callerName: string | null;
  callerPhone: string | null;
  vehicle: string | null;
  urgency: string;
  notes: string | null;
}

export const GET = apiHandler(async (req) => {
  const url = new URL(req.url);
  const days = Math.max(1, Math.min(365, parseInt(url.searchParams.get("days") ?? "30", 10) || 30));
  const since = new Date(Date.now() - days * 86_400_000);

  const rows = await prisma.brainMemory.findMany({
    where: {
      category: "tire_stock_request",
      createdAt: { gte: since },
      deletedAt: null,
    },
    select: { id: true, content: true, createdAt: true },
    orderBy: { createdAt: "desc" },
    take: 200,
  });

  const sizeBuckets = new Map<string, number>();
  // v10.0.292 · per-day histogram for the sparkline chart on the
  // dashboard. Tracks total volume + urgent share so the chart can
  // overlay both colors.
  const dailyMap = new Map<string, { count: number; urgent: number }>();
  let urgentCount = 0;
  const recent: RequestRow[] = [];

  for (const r of rows) {
    let parsed:
      | {
          tireSize?: string;
          quantity?: number;
          callerName?: string | null;
          callerPhone?: string | null;
          vehicle?: { year?: string | number | null; make?: string | null; model?: string | null };
          urgency?: string;
          notes?: string | null;
          capturedAt?: string;
        }
      | null = null;
    try {
      parsed = JSON.parse(r.content);
    } catch {
      log.warn("tire_stock_parse_failed", { id: r.id });
      continue;
    }
    if (!parsed) continue;

    const size = (parsed.tireSize ?? "(unknown)").trim();
    sizeBuckets.set(size, (sizeBuckets.get(size) ?? 0) + 1);
    const isUrgent = parsed.urgency === "urgent";
    if (isUrgent) urgentCount += 1;

    // v10.0.292 · histogram bump · key by capturedAt (preferred · the
    // ISO Nick attached at tool time) or fallback to row createdAt.
    const dayKey = (parsed.capturedAt ?? r.createdAt.toISOString()).slice(0, 10);
    const dayBucket = dailyMap.get(dayKey) ?? { count: 0, urgent: 0 };
    dayBucket.count += 1;
    if (isUrgent) dayBucket.urgent += 1;
    dailyMap.set(dayKey, dayBucket);

    if (recent.length < 25) {
      const v = parsed.vehicle ?? {};
      const vehStr = [v.year, v.make, v.model].filter(Boolean).join(" ").trim() || null;
      recent.push({
        id: r.id,
        capturedAt: parsed.capturedAt ?? r.createdAt.toISOString(),
        size,
        quantity: parsed.quantity ?? 1,
        callerName: parsed.callerName ?? null,
        callerPhone: parsed.callerPhone ?? null,
        vehicle: vehStr,
        urgency: parsed.urgency ?? "normal",
        notes: parsed.notes ?? null,
      });
    }
  }

  const topSizes: SizeAgg[] = Array.from(sizeBuckets.entries())
    .map(([size, count]) => ({ size, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 25);

  // v10.0.292 · materialize a contiguous day-by-day histogram so the
  // chart on the dashboard can render bars even for empty days. We
  // walk back `days` days and fill from the dailyMap (or zeros).
  const dailyHistogram: Array<{ date: string; count: number; urgent: number }> = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(Date.now() - i * 86_400_000);
    const dayKey = d.toISOString().slice(0, 10);
    const v = dailyMap.get(dayKey) ?? { count: 0, urgent: 0 };
    dailyHistogram.push({ date: dayKey, ...v });
  }

  return {
    windowDays: days,
    sinceIso: since.toISOString(),
    totalRequests: rows.length,
    urgentCount,
    urgencyRate:
      rows.length > 0 ? Number(((urgentCount / rows.length) * 100).toFixed(1)) : 0,
    topSizes,
    dailyHistogram,
    recent,
  };
}, { auth: "owner" });
