/**
 * GET /api/brain/active-alerts · v8.3 · Apr 29.
 *
 * Aggregates the recent BrainMemory alert categories that v8.2 added:
 *   · correlation_alert         (F2 cron output)
 *   · decision_quality_drift    (F3 cron output)
 *
 * Returns the last N alerts (default 10) per category, newest first,
 * with action context so the UI can render rich badges.
 *
 * Drives <ActiveAlertsCard /> on /brain.
 */

import { apiHandler } from "@/lib/utils/http";
import { prisma } from "@/lib/prisma";

const ALERT_CATEGORIES = [
  "correlation_alert",
  "decision_quality_drift",
  "schema_drift_alert",
  "storage_quota_alert",
  "creation_spike_alert",
  "update_spike_alert",
  "brain_bus_alert",
] as const;
const ALERT_CATEGORY_LIST: string[] = [...ALERT_CATEGORIES];

interface AlertRow {
  id: string;
  category: string;
  key: string;
  content: string;
  createdAt: Date;
  metadata: unknown;
}

export const GET = apiHandler(async (req) => {
  const url = new URL(req.url);
  const limit = Math.min(Math.max(Number(url.searchParams.get("limit")) || 10, 1), 50);
  const sinceDays = Math.min(
    Math.max(Number(url.searchParams.get("sinceDays")) || 30, 1),
    180,
  );
  const since = new Date(Date.now() - sinceDays * 86_400_000);

  const rows = (await prisma.brainMemory.findMany({
    where: {
      category: { in: ALERT_CATEGORY_LIST },
      createdAt: { gte: since },
      deletedAt: null,
    },
    orderBy: { createdAt: "desc" },
    take: limit * ALERT_CATEGORIES.length,
    select: {
      id: true,
      category: true,
      key: true,
      content: true,
      createdAt: true,
      metadata: true,
    },
  })) as AlertRow[];

  // Group by category, cap each to `limit`.
  const grouped: Record<string, AlertRow[]> = {};
  for (const cat of ALERT_CATEGORIES) grouped[cat] = [];
  for (const r of rows) {
    if (grouped[r.category].length < limit) grouped[r.category].push(r);
  }

  return {
    sinceDays,
    counts: Object.fromEntries(
      ALERT_CATEGORIES.map((c) => [c, grouped[c].length]),
    ),
    alerts: grouped,
  };
}, { auth: "owner" }); // v9.1.17 · added by add-get-route-auth.ts