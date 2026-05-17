import { apiHandler } from "@/lib/utils/http";
import { prisma, checkDbConnection } from "@/lib/prisma";
import { getKpiSummary } from "@/lib/services/metrics";

export const GET = apiHandler(async () => {
  const [db, kpis, modelCounts, deviceCounts, integrations, queueCounts] = await Promise.all([
    checkDbConnection(),
    getKpiSummary(),
    // Get row counts for key models
    Promise.all([
      prisma.mission.count(),
      prisma.task.count(),
      Promise.resolve(0),
      Promise.resolve(0),
      Promise.resolve(0),
      prisma.smartDevice.count(),
      prisma.deviceEvent.count(),
      prisma.chatMessage.count(),
      prisma.aiGeneration.count(),
      prisma.systemMetric.count(),
      prisma.brainMemory.count(),
      prisma.automationRule.count(),
    ]).then(([missions, tasks, customers, leads, jobs, devices, deviceEvents, chatMessages, aiGenerations, systemMetrics, brainMemories, automationRules]) => ({
      missions, tasks, customers, leads, jobs, devices, deviceEvents, chatMessages, aiGenerations, systemMetrics, brainMemories, automationRules,
    })),
    prisma.smartDevice.groupBy({
      by: ["status"],
      _count: { id: true },
    }),
    prisma.integration.findMany({
      select: { name: true, status: true, lastSyncAt: true, enabled: true },
    }),
    Promise.all([
      Promise.resolve(0),
      Promise.resolve(0),
    ]).then(([pending, failed]) => ({ pending, failed })),
  ]);

  const devices = { online: 0, offline: 0, error: 0, total: 0 };
  for (const g of deviceCounts) {
    devices.total += g._count.id;
    if (g.status === "ONLINE") devices.online = g._count.id;
    else if (g.status === "ERROR") devices.error = g._count.id;
    else devices.offline += g._count.id;
  }

  return {
    db: { connected: db.connected, latency_ms: db.latency_ms },
    kpis,
    models: modelCounts,
    devices,
    integrations: integrations.map((i) => ({
      name: i.name,
      status: i.status,
      enabled: i.enabled,
      lastSync: i.lastSyncAt?.toISOString() ?? null,
    })),
    queue: queueCounts,
    version: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? "local",
    timestamp: new Date().toISOString(),
  };
}, { auth: "owner" }); // v9.1.17 · added by add-get-route-auth.ts