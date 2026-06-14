import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getDailyCommandBrief } from "@/lib/services/dashboard";
import { getNourStatusSnapshot } from "@/lib/services/runner-state";
import { fetchShopSnapshot } from "@/lib/services/bridge";
import { requireSession } from "@/lib/auth-guard";
import { cached } from "@/lib/utils/cache";

export const dynamic = "force-dynamic";

// v10.0.44 — auth gate added. Pre-fix this route was unauthed, exposing
// shop revenue + CEO context payload + drift alerts + task queue +
// brain memory alerts to any caller. CRITICAL privacy hole.
//
// v10.0.514 — outer cache wrapper. The 2026-05-12 slow-paths audit
// showed this route at 10.4s every request because force-dynamic
// kept it uncached AND fetchShopSnapshot could stall on the
// nickstire bridge. v10.0.505 added a 4s timeout to the bridge
// fetch; this push adds a 60s outer cache so dashboard hits don't
// re-run 14 parallel queries per request. Cache key is single
// (single-operator system) — auth check still per-request.
export async function GET(req: Request) {
  await requireSession(req);
  const data = await cached("command_data_v1", 60, computeCommandData);
  return NextResponse.json({ ok: true, data });
}

async function computeCommandData() {
  const now = new Date();

  const [
    brief,
    nourStatus,
    shopData,
    latestRunner,
    deviceCounts,
    cameraCounts,
    unackedAlerts,
    recentAlerts,
    todayLaw,
    todayStrategy,
    latestDeviceActivity,
    latestBusinessMetrics,
    recentMemoryAlerts,
    latestCeoContext,
  ] = await Promise.all([
    getDailyCommandBrief().catch((): { topTasks: never[]; counts: { activeMissions: number; openTasks: number; urgentLeads: number; atRiskCustomers: number }; primaryMission: null; driftState: { level: string }; personalWinTarget: string; avoidThis: string } => ({
      topTasks: [],
      counts: { activeMissions: 0, openTasks: 0, urgentLeads: 0, atRiskCustomers: 0 },
      primaryMission: null,
      driftState: { level: "LOW" },
      personalWinTarget: "",
      avoidThis: "",
    })),
    getNourStatusSnapshot().catch((): { services: Record<string, unknown> } => ({ services: {} })),
    fetchShopSnapshot().catch((): null => null),
    prisma.runnerNode
      .findFirst({
        orderBy: { lastHeartbeatAt: "desc" },
        select: { lastHeartbeatAt: true, status: true, label: true },
      })
      .catch((): null => null),
    prisma.smartDevice.groupBy({ by: ["status"], _count: { id: true } }).catch((): never[] => []),
    prisma.smartDevice
      .groupBy({
        by: ["status"],
        where: { deviceType: "CAMERA" },
        _count: { id: true },
      })
      .catch((): never[] => []),
    (async () => {
      const { getUnresolvedAlerts } = await import("@/lib/mastery/drift-engine");
      return (await getUnresolvedAlerts().catch(() => [])).length;
    })(),
    (async () => {
      const { getUnresolvedAlerts } = await import("@/lib/mastery/drift-engine");
      const list = await getUnresolvedAlerts().catch(() => []);
      return list.slice(0, 5).map((a) => ({
        id: a.id,
        ruleName: a.ruleName,
        message: a.message,
        severity: a.severity,
        createdAt: a.createdAt,
      }));
    })(),
    prisma.strategicLaw
      .findFirst({
        orderBy: { id: "asc" },
        skip: Math.floor((Date.now() / 86400000) % 189),
        select: { number: true, title: true, essence: true, book: true, shopApplication: true },
      })
      .catch((): null => null),
    prisma.dailyStrategy
      .findFirst({
        where: {
          strategyDate: {
            gte: new Date(
              new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" })
            ),
          },
        },
        select: { briefing: true, shopAdvice: true, focusLaw: true },
      })
      .catch((): null => null),
    prisma.smartDevice
      .findFirst({ orderBy: { lastSeenAt: "desc" }, select: { lastSeenAt: true } })
      .catch((): null => null),
    prisma.auditEvent
      .findFirst({
        where: { eventType: "business_metrics_sync" },
        orderBy: { createdAt: "desc" },
        select: { payload: true, createdAt: true },
      })
      .catch((): null => null),
    // Recent memory alerts from brain
    prisma.auditEvent
      .findMany({
        where: {
          eventType: { in: ["memory_alert", "proactive_alert", "brain_insight"] },
          createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
        },
        orderBy: { createdAt: "desc" },
        take: 5,
        select: { eventType: true, payload: true, createdAt: true },
      })
      .catch((): never[] => []),
    prisma.auditEvent
      .findFirst({
        where: { eventType: "ceo_business_context" },
        orderBy: { createdAt: "desc" },
        select: { payload: true, createdAt: true },
      })
      .catch((): null => null),
  ]);

  // Device counts
  let totalDevices = 0,
    onlineDevices = 0;
  for (const g of deviceCounts as any[]) {
    totalDevices += g._count.id;
    if (g.status === "ONLINE") onlineDevices = g._count.id;
  }

  let totalCameras = 0,
    onlineCameras = 0;
  for (const g of cameraCounts as any[]) {
    totalCameras += g._count.id;
    if (g.status === "ONLINE") onlineCameras = g._count.id;
  }

  // Agent status
  const runnerAge = (latestRunner as any)?.lastHeartbeatAt
    ? now.getTime() - new Date((latestRunner as any).lastHeartbeatAt).getTime()
    : Infinity;
  const deviceAge = (latestDeviceActivity as any)?.lastSeenAt
    ? now.getTime() - new Date((latestDeviceActivity as any).lastSeenAt).getTime()
    : Infinity;
  const bestSignalAge = Math.min(runnerAge, deviceAge);
  const agentOnline = bestSignalAge < 5 * 60_000;
  const agentRecent = bestSignalAge < 60 * 60_000;

  // System health
  const CLOUD_CRITICAL = new Set(["database", "ai", "bridge", "email"]);
  const allServices = Object.entries((nourStatus as any).services || {}).filter(
    ([, s]: [string, any]) => s && s.severity && s.severity !== "info"
  );
  const trulyDegraded = allServices.filter(
    ([key, s]: [string, any]) =>
      CLOUD_CRITICAL.has(key) &&
      s?.status !== "auth_pending" &&
      s?.status !== "not_configured" &&
      s?.status !== "ready" &&
      s?.status !== "ok"
  );
  const systemStatus =
    trulyDegraded.length > 0 ? "degraded" : agentOnline ? "operational" : "partial";

  // Bridge/metrics
  const metricsPayload = ((latestBusinessMetrics as any)?.payload ?? null) as Record<
    string,
    any
  > | null;
  const bridgeConnected = !!shopData || !!metricsPayload;

  const todayRevenue =
    shopData?.revenue?.todayEstimate ??
    metricsPayload?.todayEstimate ??
    metricsPayload?.revenue?.todayEstimate ??
    0;
  const weekRevenue =
    shopData?.revenue?.weekEstimate ??
    metricsPayload?.weekRevenue ??
    metricsPayload?.revenue?.weekEstimate ??
    0;
  const todayBookings =
    shopData?.bookings?.todayCount ??
    metricsPayload?.revenue?.jobsToday ??
    metricsPayload?.jobsToday ??
    metricsPayload?.bookings?.todayCount ??
    0;
  const avgTicket =
    metricsPayload?.revenue?.avgTicket ?? metricsPayload?.avgTicket ?? 0;
  const walkRate =
    metricsPayload?.revenue?.walkRate ??
    metricsPayload?.intelligence?.shopPulse?.thisWeek?.walkRate ??
    metricsPayload?.walkRate ??
    0;
  // shopData is the LIVE bridge ShopSnapshot (keys urgentCount /
  // pendingCount / totalActive — correct there). metricsPayload is the
  // PUSHED business_metrics_sync payload (statenourSync.ts), whose keys
  // are leads.urgent / callbacks.new / leads.total. Reading the bridge
  // keys off the pushed payload meant the bridge-DOWN fallback — the one
  // moment it exists for — silently returned 0 for all three.
  const urgentLeads =
    shopData?.leads?.urgentCount ?? metricsPayload?.leads?.urgent ?? 0;
  const pendingCallbacks =
    shopData?.callbacks?.pendingCount ?? metricsPayload?.callbacks?.new ?? 0;
  const activeLeads =
    shopData?.leads?.totalActive ?? metricsPayload?.leads?.total ?? 0;

  return {
    timestamp: now.toISOString(),
    system: {
      status: systemStatus,
      agentOnline,
      agentRecent,
      bridgeConnected,
      devices: { total: totalDevices, online: onlineDevices },
      cameras: { total: totalCameras, online: onlineCameras },
      unackedAlerts,
    },
    shop: {
      todayRevenue,
      weekRevenue,
      todayBookings,
      avgTicket,
      walkRate,
      urgentLeads,
      pendingCallbacks,
      activeLeads,
    },
    strategic: {
      law: todayLaw,
      strategy: todayStrategy,
    },
    brief: {
      topTasks: (brief as any).topTasks?.slice(0, 3) ?? [],
      primaryMission: (brief as any).primaryMission,
      driftState: (brief as any).driftState,
      personalWinTarget: (brief as any).personalWinTarget,
      avoidThis: (brief as any).avoidThis,
      counts: (brief as any).counts,
    },
    alerts: recentAlerts.map((a: any) => ({
      id: a.id,
      ruleName: a.ruleName,
      message: a.message,
      severity: a.severity,
      createdAt: a.createdAt?.toISOString?.() ?? a.createdAt,
    })),
    memoryAlerts: (recentMemoryAlerts as any[]).map((m: any) => ({
      type: m.eventType,
      payload: m.payload,
      createdAt: m.createdAt?.toISOString?.() ?? m.createdAt,
    })),
    nickstire: {
      ceoContext: (latestCeoContext as { payload?: unknown } | null)?.payload ?? null,
      ceoContextAt:
        (latestCeoContext as { createdAt?: Date } | null)?.createdAt?.toISOString?.() ?? null,
      businessSyncedAt:
        (latestBusinessMetrics as { createdAt?: Date } | null)?.createdAt?.toISOString?.() ??
        null,
    },
  };
}
