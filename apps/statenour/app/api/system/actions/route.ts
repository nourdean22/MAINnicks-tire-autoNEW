import { apiHandler } from "@/lib/utils/http";
import { prisma } from "@/lib/prisma";

/**
 * GET /api/system/actions — Nick's autonomous action audit feed.
 *
 * Returns recent actions grouped by rule + latest 100 individual rows.
 * Powers /system/actions — every autonomous Nick decision lives here.
 *
 * Query:
 *   ?rule=X          → filter to a specific ruleName
 *   ?since=7d|30d    → window (default 7d)
 *   ?approval=auto|pending|approved|rejected (filter)
 */

type Approval = "auto" | "pending" | "approved" | "rejected";

function windowCutoff(win: string | null): Date {
  if (win === "30d") return new Date(Date.now() - 30 * 86400_000);
  if (win === "24h") return new Date(Date.now() - 24 * 3600_000);
  return new Date(Date.now() - 7 * 86400_000);
}

export const GET = apiHandler(async (req) => {
  const url = new URL(req.url);
  const rule = url.searchParams.get("rule");
  const approval = url.searchParams.get("approval") as Approval | null;
  const since = windowCutoff(url.searchParams.get("since"));

  const where = {
    createdAt: { gte: since },
    ...(rule ? { ruleName: rule } : {}),
    ...(approval ? { approval } : {}),
  };

  const [recent, ruleStats, totals] = await Promise.all([
    prisma.autonomousAction.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: 100,
      select: {
        id: true,
        ruleName: true,
        trigger: true,
        actionType: true,
        targetType: true,
        targetId: true,
        payload: true,
        approval: true,
        approvedBy: true,
        executedAt: true,
        result: true,
        error: true,
        createdAt: true,
      },
    }),
    prisma.autonomousAction.groupBy({
      by: ["ruleName", "result"],
      where,
      _count: { id: true },
    }),
    prisma.autonomousAction.groupBy({
      by: ["approval"],
      where,
      _count: { id: true },
    }),
  ]);

  // Per-rule summary
  const ruleAgg = new Map<string, { total: number; success: number; failed: number; skipped: number; lastFiredAt: string | null }>();
  for (const r of ruleStats) {
    if (!ruleAgg.has(r.ruleName)) {
      ruleAgg.set(r.ruleName, { total: 0, success: 0, failed: 0, skipped: 0, lastFiredAt: null });
    }
    const s = ruleAgg.get(r.ruleName)!;
    s.total += r._count.id;
    if (r.result === "success") s.success = r._count.id;
    if (r.result === "failed") s.failed = r._count.id;
    if (r.result === "skipped") s.skipped = r._count.id;
  }
  // Last-fired per rule
  for (const row of recent) {
    const s = ruleAgg.get(row.ruleName);
    if (s && !s.lastFiredAt) s.lastFiredAt = row.createdAt.toISOString();
  }

  const rules = [...ruleAgg.entries()]
    .map(([ruleName, s]) => ({
      ruleName,
      ...s,
      successRate: s.total > 0 ? Math.round((s.success / s.total) * 100) : 0,
    }))
    .sort((a, b) => b.total - a.total);

  const approvalBreakdown = {
    auto: totals.find((t) => t.approval === "auto")?._count.id ?? 0,
    pending: totals.find((t) => t.approval === "pending")?._count.id ?? 0,
    approved: totals.find((t) => t.approval === "approved")?._count.id ?? 0,
    rejected: totals.find((t) => t.approval === "rejected")?._count.id ?? 0,
  };

  return {
    recent: recent.map((r) => ({
      ...r,
      createdAt: r.createdAt.toISOString(),
      executedAt: r.executedAt?.toISOString() ?? null,
    })),
    rules,
    approvalBreakdown,
    totalInWindow: recent.length,
    generatedAt: new Date().toISOString(),
  };
}, { auth: "owner" }); // v9.1.17 · added by add-get-route-auth.ts