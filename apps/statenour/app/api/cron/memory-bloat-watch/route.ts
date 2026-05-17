// /api/cron/memory-bloat-watch — alert when brain_memory rows balloon.
//
// v7 · BATCH 6 · Apr 28. Counts rows by category. Alerts when total
// crosses 50K OR any single category crosses 10K. Triggers an extra
// semantic-dedup pass when alert fires.
//
// Vercel cron schedule: "0 11 * * 1"  (Mondays 6am Cleveland)

import { cronHandler } from "@/lib/utils/http";
import { prisma } from "@/lib/prisma";
import { logger as rootLogger } from "@/lib/logger";

const log = rootLogger.withSurface("cron/memory-bloat-watch");

const TOTAL_THRESHOLD = 50_000;
const PER_CATEGORY_THRESHOLD = 10_000;

export const maxDuration = 60;

export const GET = cronHandler(async () => {
  const rawCounts = await prisma.brainMemory.groupBy({
    by: ["category"],
    _count: { _all: true },
    orderBy: { _count: { id: "desc" } },
    take: 50,
  }).catch(() => [] as Array<{ category: string; _count: { _all: number } }>);

  // Normalize types — Prisma's groupBy return type is generic-heavy; we
  // only care about the two fields we actually read.
  const counts = (rawCounts as unknown as Array<{ category: string; _count: { _all: number } }>);
  const total = counts.reduce((s: number, c) => s + c._count._all, 0);
  const heavyCategories = counts.filter((c) => c._count._all >= PER_CATEGORY_THRESHOLD);
  const shouldAlert = total >= TOTAL_THRESHOLD || heavyCategories.length > 0;

  if (!shouldAlert) {
    return {
      ok: true,
      alerted: false,
      total,
      summary: `${total.toLocaleString()} rows across ${counts.length} categories — healthy`,
    };
  }

  // Persist alert
  await prisma.brainMemory.create({
    data: {
      category: "memory_alert",
      key: `bloat:${new Date().toISOString().split("T")[0]}`,
      source: "memory_bloat_watch",
      content: `🧠 BrainMemory at ${total.toLocaleString()} rows${heavyCategories.length > 0 ? ` · heavy: ${heavyCategories.map((c) => `${c.category}=${c._count._all}`).join(", ")}` : ""}`,
      confidence: 0.95,
      metadata: {
        total,
        heavyCategories: heavyCategories.map((c) => ({ category: c.category, count: c._count._all })),
        threshold: { total: TOTAL_THRESHOLD, perCategory: PER_CATEGORY_THRESHOLD },
        topCategories: counts.slice(0, 10).map((c) => ({ category: c.category, count: c._count._all })),
      } as unknown as Parameters<typeof prisma.brainMemory.create>[0]["data"]["metadata"],
    },
  }).catch(() => {});

  // Trigger an extra semantic-dedup pass since we're bloated
  let dedupResult: { merged: number; deleted: number } | null = null;
  try {
    const { runSemanticDedup } = await import("@/lib/brain/semantic-dedup");
    dedupResult = await runSemanticDedup({ dryRun: false });
  } catch (err) {
    log.warn("dedup_trigger_failed", { err: err instanceof Error ? err.message : String(err) });
  }

  return {
    ok: true,
    alerted: true,
    total,
    heavyCategories: heavyCategories.length,
    triggeredDedup: !!dedupResult,
    dedupMerged: dedupResult?.merged ?? 0,
    dedupDeleted: dedupResult?.deleted ?? 0,
    summary: `🔴 ALERTED: ${total.toLocaleString()} rows · triggered dedup ${dedupResult ? `(${dedupResult.deleted} deleted)` : "(skipped)"}`,
  };
});

export const POST = GET;
