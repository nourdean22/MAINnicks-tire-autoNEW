import { createHash } from "node:crypto";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getInngest, isInngestFullyConfigured } from "@/lib/inngest/client";
import { findPii } from "@/lib/services/reality-ledger";
import { recordEpisode } from "@/lib/intelligence/episodes";
import { logError } from "@/lib/utils/error-log";
import { getFlag } from "@/lib/feature-flags";
import { logger as rootLogger } from "@/lib/logger";

const log = rootLogger.withSurface("missions/durable-execution");

const stepBase = z.object({
  id: z.string().min(1).max(40).regex(/^[A-Za-z0-9_-]+$/),
  label: z.string().min(1).max(120),
});

export const DurableMissionStepSchema = z.discriminatedUnion("kind", [
  stepBase.extend({ kind: z.literal("checkpoint") }),
  stepBase.extend({
    kind: z.literal("research"),
    question: z.string().min(5).max(4000),
  }),
]);

export const DurableMissionRequestSchema = z.object({
  missionId: z.string().min(1).max(120),
  objective: z.string().min(5).max(1000),
  steps: z.array(DurableMissionStepSchema).min(1).max(12),
  requestedBy: z.enum(["operator", "nick"]).default("nick"),
});
export const DurableMissionEventSchema = DurableMissionRequestSchema.extend({
  runId: z.string().uuid(),
});

export type DurableMissionStep = z.infer<typeof DurableMissionStepSchema>;
export type DurableMissionRequest = z.infer<typeof DurableMissionRequestSchema>;
export type DurableMissionEvent = z.infer<typeof DurableMissionEventSchema>;

export function hashMissionText(value: string): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

/** The latest run marker enqueue read for this mission (null = no prior run). */
type PriorRun = { runId: string; observedAt: string } | null;

/**
 * 2026-10-10 (audit 01-F3) · enqueue idempotency. One mission + objective +
 * the run marker enqueue read maps to ONE Inngest event id (Inngest drops a
 * repeated id for 24 h) and ONE runId, so a retry racing the first call reads
 * the same marker and dedupes, while a re-run after a completed, failed or
 * cancelled run reads a newer marker and really runs (B7 review).
 */
function missionRunSeed(missionId: string, objective: string, prior: PriorRun): string {
  return createHash("sha256").update(`${missionId}
${objective}
${prior?.runId ?? ""}
${prior?.observedAt ?? ""}`).digest("hex");
}

export function missionExecutionEventId(missionId: string, objective: string, prior: PriorRun): string {
  return `mission-exec-${missionRunSeed(missionId, objective, prior).slice(0, 40)}`;
}

/** UUID-shaped (version 5 nibble, RFC variant) so DurableMissionEventSchema accepts it. */
export function missionExecutionRunId(missionId: string, objective: string, prior: PriorRun): string {
  const h = missionRunSeed(missionId, objective, prior);
  const variant = ((parseInt(h[16]!, 16) & 0x3) | 0x8).toString(16);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-${variant}${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

/** Phases the run writes before it finishes (mission-execution.ts). */
const IN_FLIGHT_PHASES = new Set(["queued", "started", "step_started", "step_completed"]);
// A cancelled or lost run writes no terminal episode; past this gap its last
// marker stops counting. One step (a deep-research call) runs minutes, not this.
const IN_FLIGHT_MAX_GAP_MS = 30 * 60_000;

function isInFlight(latest: { phase: string; observedAt: string } | null): boolean {
  return (
    latest !== null &&
    IN_FLIGHT_PHASES.has(latest.phase) &&
    Date.now() - Date.parse(latest.observedAt) < IN_FLIGHT_MAX_GAP_MS
  );
}

export async function queueDurableMissionExecution(raw: unknown): Promise<
  | { queued: true; missionId: string; runId: string; eventIds: string[] }
  | { queued: false; reason: string; runId?: string }
> {
  const input = DurableMissionRequestSchema.parse(raw);

  const pii = findPii({
    objective: input.objective,
    research: input.steps.flatMap((s) =>
      s.kind === "research" ? [s.question] : [],
    ),
  });
  if (pii) return { queued: false, reason: `pii_not_allowed:${pii.reason}` };

  if (!(getFlag("NICK_DURABLE_MISSIONS")?.isOn ?? false)) {
    return { queued: false, reason: "feature_disabled" };
  }

  if (!isInngestFullyConfigured()) {
    return { queued: false, reason: "inngest_not_configured" };
  }
  const mission = await prisma.mission.findFirst({
    where: { id: input.missionId, deletedAt: null, status: "ACTIVE" },
    select: { id: true },
  });
  if (!mission) return { queued: false, reason: "active_mission_not_found" };

  // The function's singleton (mode "skip") silently drops a second run for
  // this mission, so say so instead of claiming queued:true. Exclusivity stays
  // Inngest's; this read only keeps the reply honest. A failed read throws.
  const latest = await getLatestMissionExecution(mission.id);
  if (latest && isInFlight(latest)) {
    // Name the run that IS going, so a retry reports it (01-F3).
    return { queued: false, reason: "already_running", runId: latest.runId };
  }

  const runId = missionExecutionRunId(mission.id, input.objective, latest);
  const sent = await getInngest().send({
    name: "mission/execution.requested",
    id: missionExecutionEventId(mission.id, input.objective, latest),
    data: { ...input, runId },
  });

  await recordEpisode({
    kind: "mission",
    phase: "queued",
    episodeId: runId,
    missionId: mission.id,
    actor: input.requestedBy,
    inputHash: hashMissionText(input.objective),
    action: {
      stepCount: input.steps.length,
      stepKinds: input.steps.map((s) => s.kind),
    },
    receipt: { inngestEventIds: sent.ids },
  }).catch((err) => {
    void logError("mission.durable_execution", err as Error, {
      fn: "queueDurableMissionExecution.recordEpisode",
      missionId: mission.id,
      runId,
    }, "warn");
  });

  return { queued: true, missionId: mission.id, runId, eventIds: sent.ids };
}
/**
 * 2026-10-10 (audit 01-F3) · stop. Sends the event the durable function's
 * `cancelOn` listens for; Inngest halts the run before its next step.
 * `cancelRequested: true` means the event was accepted, not that a run was
 * found and halted (there may be none in flight). `markerRecorded: false`
 * means the run was not marked cancelled, so a re-queue may read it as
 * already_running until the in-flight gap ends.
 */
export async function cancelMissionExecution(missionId: string): Promise<
  | { cancelRequested: true; missionId: string; eventIds: string[]; markerRecorded?: false }
  | { cancelRequested: false; reason: string }
> {
  if (!isInngestFullyConfigured()) {
    return { cancelRequested: false, reason: "inngest_not_configured" };
  }
  const sent = await getInngest().send({
    name: "mission/execution.cancelled",
    data: { missionId },
  });
  // A halted run writes no terminal episode, so mark it here; otherwise the
  // enqueue in-flight check reads the dead run as running until the gap ends.
  // Best effort: the cancel above was already accepted either way.
  let markerRecorded = true;
  try {
    const latest = await getLatestMissionExecution(missionId);
    if (latest && isInFlight(latest)) {
      // false (no throw) = the ledger rejected the row.
      markerRecorded = await recordEpisode({
        kind: "mission",
        phase: "cancel_requested",
        episodeId: latest.runId,
        missionId,
        receipt: { inngestEventIds: sent.ids },
      });
      if (!markerRecorded) {
        log.warn("cancel marker rejected by the ledger", { missionId, runId: latest.runId });
      }
    }
  } catch (err) {
    markerRecorded = false;
    void logError("mission.durable_execution", err as Error, {
      fn: "cancelMissionExecution.marker",
      missionId,
    }, "warn");
  }
  return {
    cancelRequested: true,
    missionId,
    eventIds: sent.ids,
    ...(markerRecorded ? {} : { markerRecorded: false as const }),
  };
}

export async function getLatestMissionExecution(missionId: string): Promise<{
  runId: string;
  phase: string;
  observedAt: string;
  metadata: Record<string, unknown> | null;
} | null> {
  const row = await prisma.realityEvent.findFirst({
    where: {
      eventType: { startsWith: "episode.mission." },
      payload: { path: ["missionId"], equals: missionId },
    },
    orderBy: { observedAt: "desc" },
    select: { eventType: true, observedAt: true, payload: true },
  });
  if (!row) return null;

  const payload = (row.payload ?? {}) as Record<string, unknown>;
  const runId = typeof payload.episodeId === "string" ? payload.episodeId : "unknown";
  const metadata = payload.metadata && typeof payload.metadata === "object"
    ? payload.metadata as Record<string, unknown>
    : null;
  return {
    runId,
    phase: row.eventType.replace(/^episode\.mission\./, ""),
    observedAt: row.observedAt.toISOString(),
    metadata,
  };
}
