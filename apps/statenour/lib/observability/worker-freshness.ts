import { prisma as defaultPrisma } from "@/lib/prisma";

type PrismaLike = Pick<typeof defaultPrisma, "cronJobLog">;

export const WORKER_HEARTBEAT_JOB = "brain-bus-drain";
export const WORKER_FRESHNESS_MS = 60 * 60 * 1000;

export interface WorkerFreshness {
  status: "fresh" | "stale" | "unknown";
  ageMinutes: number | null;
  lastSuccessAt: Date | null;
}

/**
 * The private Railway worker proves liveness by successfully forwarding
 * brain-bus-drain every 15 minutes. Four missed ticks (1h) => stale.
 *
 * This is persisted evidence, so external monitors can observe the worker
 * without reopening a public worker HTTP domain.
 */
export async function getLatestWorkerSuccessAt(
  db: PrismaLike = defaultPrisma,
): Promise<Date | null> {
  const row = await db.cronJobLog.findFirst({
    where: { jobName: WORKER_HEARTBEAT_JOB, status: "success" },
    orderBy: { createdAt: "desc" },
    select: { createdAt: true },
  });
  return row?.createdAt ?? null;
}

export async function getWorkerFreshness(
  db: PrismaLike = defaultPrisma,
  nowMs = Date.now(),
): Promise<WorkerFreshness> {
  try {
    const lastSuccessAt = await getLatestWorkerSuccessAt(db);
    if (!lastSuccessAt) {
      return { status: "unknown", ageMinutes: null, lastSuccessAt: null };
    }

    const ageMs = Math.max(0, nowMs - lastSuccessAt.getTime());
    return {
      status: ageMs <= WORKER_FRESHNESS_MS ? "fresh" : "stale",
      ageMinutes: Math.round(ageMs / 60_000),
      lastSuccessAt,
    };
  } catch {
    // Public heartbeat fails closed to "unknown"; callers that need to
    // distinguish "never produced" from "probe failed" should call
    // getLatestWorkerSuccessAt directly and let the DB error propagate.
    return { status: "unknown", ageMinutes: null, lastSuccessAt: null };
  }
}
