import { createHash } from "node:crypto";
import { WorkItemType, type Prisma } from "@prisma/client";
import {
  selectEligibleLanes,
  type CapabilityLane,
} from "@nour/ai-capabilities";
import { prisma } from "@/lib/prisma";
import { enqueueWorkItem } from "@/lib/services/runner-state";
import { findPii } from "@/lib/services/reality-ledger";
import { recordEpisode } from "@/lib/intelligence/episodes";
import {
  EXTERNAL_WORKER_LANE_IDS,
  ExternalWorkerJobPayloadSchema,
  ExternalWorkerQueueRequestSchema,
  ExternalWorkerResultSchema,
  type ExternalWorkerJobPayload,
  type ExternalWorkerLaneId,
  type ExternalWorkerLaneSnapshot,
  type ExternalWorkerResult,
} from "@/lib/workers/contracts";

const RUNNER_FRESH_MS = 3 * 60 * 1000;

const BASE_LANES: Record<ExternalWorkerLaneId, CapabilityLane> = {
  codex: {
    id: "codex",
    provider: "openai-codex",
    capabilities: ["coder", "deep_reasoner", "large_context"],
    kind: "subscription_agent",
    authClass: "subscription",
    costClass: "SUBSCRIPTION_INCLUDED",
    privacyClass: "external_provider",
    health: "unknown",
    quota: "unknown",
    priority: 10,
  },
  "claude-code": {
    id: "claude-code",
    provider: "anthropic-claude-code",
    capabilities: [
      "supervisor",
      "coder",
      "deep_reasoner",
      "large_context",
      "multimodal",
    ],
    kind: "subscription_agent",
    authClass: "subscription",
    costClass: "SUBSCRIPTION_INCLUDED",
    privacyClass: "external_provider",
    health: "unknown",
    quota: "unknown",
    priority: 20,
  },
  antigravity: {
    id: "antigravity",
    provider: "google-antigravity",
    capabilities: ["coder", "deep_reasoner", "large_context", "multimodal"],
    kind: "subscription_agent",
    authClass: "subscription",
    costClass: "SUBSCRIPTION_INCLUDED",
    privacyClass: "external_provider",
    health: "unknown",
    quota: "unknown",
    priority: 30,
  },
  "local-qwen": {
    id: "local-qwen",
    provider: "nour-local-gateway",
    model: "qwen35-4b-local",
    capabilities: ["cheap_local", "coder", "supervisor"],
    kind: "local_inference",
    authClass: "local",
    costClass: "LOCAL_FREE",
    privacyClass: "local_only",
    health: "unknown",
    quota: "available",
    priority: 80,
  },
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function parseSnapshot(value: unknown): ExternalWorkerLaneSnapshot | null {
  const row = asRecord(value);
  if (!row) return null;
  const health = String(row.health ?? "unknown");
  const quota = String(row.quota ?? "unknown");
  if (!["ready", "degraded", "unavailable", "unknown"].includes(health)) {
    return null;
  }
  if (!["available", "limited", "exhausted", "unknown"].includes(quota)) {
    return null;
  }
  return {
    health: health as ExternalWorkerLaneSnapshot["health"],
    quota: quota as ExternalWorkerLaneSnapshot["quota"],
    auth: String(row.auth ?? "unknown"),
    detail: typeof row.detail === "string" ? row.detail.slice(0, 240) : undefined,
    checkedAt:
      typeof row.checkedAt === "string" ? row.checkedAt.slice(0, 64) : undefined,
  };
}

export async function getExternalWorkerLaneSnapshots(): Promise<{
  runnerFresh: boolean;
  runnerNodeKey: string | null;
  runnerLastHeartbeatAt: string | null;
  lanes: Record<ExternalWorkerLaneId, ExternalWorkerLaneSnapshot | null>;
}> {
  const empty = Object.fromEntries(
    EXTERNAL_WORKER_LANE_IDS.map((id) => [id, null]),
  ) as Record<ExternalWorkerLaneId, ExternalWorkerLaneSnapshot | null>;

  const nodes = await prisma.runnerNode.findMany({
    orderBy: { lastHeartbeatAt: "desc" },
    take: 12,
    select: {
      nodeKey: true,
      lastHeartbeatAt: true,
      metadata: true,
    },
  });

  for (const node of nodes) {
    if (!node.lastHeartbeatAt) continue;
    const metadata = asRecord(node.metadata);
    const worker = asRecord(metadata?.externalWorker);
    const rawLanes = asRecord(worker?.lanes);
    if (!rawLanes) continue;

    const ageMs = Date.now() - node.lastHeartbeatAt.getTime();
    const runnerFresh = ageMs <= RUNNER_FRESH_MS;
    const lanes = { ...empty };
    for (const id of EXTERNAL_WORKER_LANE_IDS) {
      lanes[id] = parseSnapshot(rawLanes[id]);
      if (!runnerFresh && lanes[id]) {
        lanes[id] = {
          ...lanes[id]!,
          health: "unknown",
          quota: "unknown",
          detail: `stale worker heartbeat; ${lanes[id]?.detail ?? ""}`.trim(),
        };
      }
    }
    return {
      runnerFresh,
      runnerNodeKey: node.nodeKey,
      runnerLastHeartbeatAt: node.lastHeartbeatAt.toISOString(),
      lanes,
    };
  }

  return {
    runnerFresh: false,
    runnerNodeKey: null,
    runnerLastHeartbeatAt: null,
    lanes: empty,
  };
}

export async function getExternalWorkerLanes(): Promise<CapabilityLane[]> {
  const snapshot = await getExternalWorkerLaneSnapshots();
  return EXTERNAL_WORKER_LANE_IDS.map((id) => {
    const live = snapshot.lanes[id];
    const base = BASE_LANES[id];
    return {
      ...base,
      health: live?.health ?? base.health,
      quota: live?.quota ?? base.quota,
    };
  });
}

export function hashExternalWorkerPrompt(prompt: string): string {
  return `sha256:${createHash("sha256").update(prompt).digest("hex")}`;
}

export async function queueExternalWorker(raw: unknown): Promise<
  | {
      queued: true;
      jobId: string;
      selectedLane: ExternalWorkerLaneId;
      candidateLaneIds: ExternalWorkerLaneId[];
      runnerFresh: boolean;
    }
  | { queued: false; reason: string; denied?: unknown }
> {
  const input = ExternalWorkerQueueRequestSchema.parse(raw);

  const pii = findPii({ prompt: input.prompt });
  if (pii) {
    return { queued: false, reason: `pii_not_allowed:${pii.reason}` };
  }

  const snapshot = await getExternalWorkerLaneSnapshots();
  let lanes = await getExternalWorkerLanes();
  if (input.preferredLane) {
    lanes = lanes.filter((lane) => lane.id === input.preferredLane);
  }

  const eligible = selectEligibleLanes(lanes, {
    capability: input.capability,
    mode: input.mode,
    explicitMeteredConsent: false,
  });

  if (eligible.length === 0) {
    return {
      queued: false,
      reason: "no_eligible_worker_lane",
      denied: lanes.map((lane) => ({
        id: lane.id,
        health: lane.health,
        quota: lane.quota,
        costClass: lane.costClass,
      })),
    };
  }

  const candidateLaneIds = eligible.map(
    (lane) => lane.id as ExternalWorkerLaneId,
  );
  const requestPayload: ExternalWorkerJobPayload = {
    schemaVersion: 1,
    capability: input.capability,
    mode: input.mode,
    candidateLaneIds,
    workspaceKey: input.workspaceKey,
    allowWorkspaceWrite: input.allowWorkspaceWrite,
    prompt: input.prompt,
    requestedBy: input.requestedBy,
  };

  const workItem = await enqueueWorkItem({
    type: WorkItemType.AI_EXTERNAL_WORKER,
    requestPayload,
    idempotencyKey: input.idempotencyKey
      ? `external-worker:${input.idempotencyKey}`
      : undefined,
  });
  if (!workItem) return { queued: false, reason: "work_queue_unavailable" };

  await recordEpisode({
    kind: "worker",
    phase: "queued",
    episodeId: workItem.id,
    actor: input.requestedBy,
    inputHash: hashExternalWorkerPrompt(input.prompt),
    action: {
      capability: input.capability,
      mode: input.mode,
      candidateLaneIds,
      workspaceKey: input.workspaceKey,
      allowWorkspaceWrite: input.allowWorkspaceWrite,
    },
    receipt: {
      workItemId: workItem.id,
      runnerFresh: snapshot.runnerFresh,
      runnerNodeKey: snapshot.runnerNodeKey,
    },
  }).catch(() => false);

  return {
    queued: true,
    jobId: workItem.id,
    selectedLane: candidateLaneIds[0],
    candidateLaneIds,
    runnerFresh: snapshot.runnerFresh,
  };
}

export async function getExternalWorkerJob(jobId: string) {
  const item = await prisma.workItem.findUnique({
    where: { id: jobId },
    select: {
      id: true,
      type: true,
      status: true,
      requestPayload: true,
      resultPayload: true,
      errorCode: true,
      errorMessage: true,
      attempts: true,
      runnerNodeId: true,
      createdAt: true,
      claimedAt: true,
      completedAt: true,
      updatedAt: true,
    },
  });
  if (!item || item.type !== WorkItemType.AI_EXTERNAL_WORKER) return null;

  const events = await prisma.realityEvent.findMany({
    where: {
      eventType: { startsWith: "episode.worker." },
      payload: { path: ["episodeId"], equals: jobId },
    },
    orderBy: { observedAt: "asc" },
    select: { eventType: true, observedAt: true, payload: true },
  });

  return {
    ...item,
    createdAt: item.createdAt.toISOString(),
    claimedAt: item.claimedAt?.toISOString() ?? null,
    completedAt: item.completedAt?.toISOString() ?? null,
    updatedAt: item.updatedAt.toISOString(),
    phases: events.map((event) => ({
      phase: event.eventType.replace(/^episode\.worker\./, ""),
      observedAt: event.observedAt.toISOString(),
    })),
  };
}

export async function recordExternalWorkerStarted(input: {
  id: string;
  requestPayload: Prisma.JsonValue;
  runnerNodeId?: string | null;
}): Promise<void> {
  const parsed = ExternalWorkerJobPayloadSchema.safeParse(input.requestPayload);
  if (!parsed.success) return;
  await recordEpisode({
    kind: "worker",
    phase: "started",
    episodeId: input.id,
    actor: "runner",
    inputHash: hashExternalWorkerPrompt(parsed.data.prompt),
    action: {
      capability: parsed.data.capability,
      candidateLaneIds: parsed.data.candidateLaneIds,
      workspaceKey: parsed.data.workspaceKey,
      allowWorkspaceWrite: parsed.data.allowWorkspaceWrite,
    },
    receipt: { runnerNodeId: input.runnerNodeId ?? null },
  }).catch(() => false);
}

export async function recordExternalWorkerCompleted(input: {
  id: string;
  requestPayload: Prisma.JsonValue;
  resultPayload?: unknown;
  status: "completed" | "failed";
  errorCode?: string | null;
}): Promise<void> {
  const job = ExternalWorkerJobPayloadSchema.safeParse(input.requestPayload);
  if (!job.success) return;
  const result = ExternalWorkerResultSchema.safeParse(input.resultPayload);
  const parsedResult: ExternalWorkerResult | null = result.success
    ? result.data
    : null;
  const output = parsedResult?.output ?? "";
  await recordEpisode({
    kind: "worker",
    phase: input.status,
    episodeId: input.id,
    actor: "runner",
    inputHash: hashExternalWorkerPrompt(job.data.prompt),
    receipt: {
      laneId: parsedResult?.laneId ?? null,
      status: parsedResult?.status ?? input.status,
      elapsedMs: parsedResult?.elapsedMs ?? null,
      exitCode: parsedResult?.exitCode ?? null,
      outputBytes: Buffer.byteLength(output, "utf8"),
      outputHash: output ? hashExternalWorkerPrompt(output) : null,
      outputTruncated: parsedResult?.outputTruncated ?? false,
      errorCode: input.errorCode ?? parsedResult?.errorCode ?? null,
    },
    outcome: {
      completed: input.status === "completed",
    },
  }).catch(() => false);
}
