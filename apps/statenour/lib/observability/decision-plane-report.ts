import { prisma } from "@/lib/prisma";
import { getDecisionBackendStatuses } from "@/lib/ai/decision-plane/backends";

interface BackendRollup {
  backend: string;
  evaluated: number;
  failed: number;
  avgLatencyMs: number | null;
  avgIncumbentAgreement: number | null;
  lastObservedAt: string | null;
}

function objectValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export async function buildDecisionPlaneReport(windowDays = 30): Promise<{
  windowDays: number;
  featureConfigured: boolean;
  backends: ReturnType<typeof getDecisionBackendStatuses>;
  evaluated: number;
  failed: number;
  rollups: BackendRollup[];
  generatedAt: string;
  promotionReady: false;
  caveat: string;
}> {
  const since = new Date(Date.now() - windowDays * 86_400_000);
  const statuses = getDecisionBackendStatuses();
  const rows = await prisma.realityEvent.findMany({
    where: {
      eventType: {
        in: [
          "episode.decision.shadow_evaluated",
          "episode.decision.shadow_failed",
        ],
      },
      observedAt: { gte: since },
    },
    orderBy: { observedAt: "desc" },
    select: { eventType: true, observedAt: true, payload: true },
  });

  const groups = new Map<string, {
    evaluated: number;
    failed: number;
    latencies: number[];
    agreements: number[];
    lastObservedAt: Date | null;
  }>();

  for (const row of rows) {
    const payload = objectValue(row.payload);
    const decision = objectValue(payload?.decision);
    const outcome = objectValue(payload?.outcome);
    const metadata = objectValue(payload?.metadata);
    const backend =
      typeof decision?.backend === "string"
        ? decision.backend
        : typeof metadata?.backend === "string"
          ? metadata.backend
          : "unknown";
    const group = groups.get(backend) ?? {
      evaluated: 0,
      failed: 0,
      latencies: [],
      agreements: [],
      lastObservedAt: null,
    };

    if (row.eventType.endsWith("shadow_failed")) {
      group.failed += 1;
    } else {
      group.evaluated += 1;
      const latency = payload?.latencyMs;
      if (typeof latency === "number" && Number.isFinite(latency)) {
        group.latencies.push(latency);
      }
      const agreement = objectValue(outcome?.incumbentAgreement);
      const rate = agreement?.agreementRate;
      if (typeof rate === "number" && Number.isFinite(rate)) {
        group.agreements.push(rate);
      }
    }
    if (!group.lastObservedAt || row.observedAt > group.lastObservedAt) {
      group.lastObservedAt = row.observedAt;
    }
    groups.set(backend, group);
  }

  const rollups: BackendRollup[] = [...groups.entries()]
    .map(([backend, group]) => ({
      backend,
      evaluated: group.evaluated,
      failed: group.failed,
      avgLatencyMs:
        group.latencies.length > 0
          ? group.latencies.reduce((a, b) => a + b, 0) / group.latencies.length
          : null,
      avgIncumbentAgreement:
        group.agreements.length > 0
          ? group.agreements.reduce((a, b) => a + b, 0) / group.agreements.length
          : null,
      lastObservedAt: group.lastObservedAt?.toISOString() ?? null,
    }))
    .sort((a, b) => b.evaluated - a.evaluated || a.backend.localeCompare(b.backend));

  return {
    windowDays,
    featureConfigured: statuses.some((status) => status.configured),
    backends: statuses,
    evaluated: rollups.reduce((sum, row) => sum + row.evaluated, 0),
    failed: rollups.reduce((sum, row) => sum + row.failed, 0),
    rollups,
    generatedAt: new Date().toISOString(),
    // This stays false by construction until OUTCOME labels, not incumbent
    // agreement, are collected and scored by the calibration/replay layer.
    promotionReady: false,
    caveat:
      "Agreement with the incumbent is a regression comparison, not correctness or calibration. No backend may gain authority from this report alone.",
  };
}
