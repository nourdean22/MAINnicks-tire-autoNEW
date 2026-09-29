/**
 * Universal learning episode envelope.
 *
 * IMPORTANT: this is NOT a new persistence system. Episodes are typed
 * RealityEvent records, so the existing evidence ledger remains the one
 * append-only substrate and keeps its PII tripwire/provenance rules.
 */
import { randomUUID } from "node:crypto";
import {
  recordEvidenceBatch,
  type RealityEventInput,
} from "@/lib/services/reality-ledger";

export const EPISODE_SCHEMA_VERSION = 1 as const;

export type EpisodeKind =
  | "decision"
  | "tool"
  | "tool_gap"
  | "mission"
  | "content"
  | "experiment"
  | "business_outcome";

export type EpisodeQuality = "observed" | "derived" | "inferred";

export interface EpisodeInput {
  kind: EpisodeKind;
  phase: string;
  episodeId?: string;
  occurredAt?: Date;
  traceId?: string;
  /** Cross-event lineage. Defaults to traceId, then missionId, then this episode id. */
  correlationId?: string;
  /** Stable id of the event/episode that directly caused this one, when known. */
  causationId?: string;
  missionId?: string;
  conversationId?: string;
  actor?: string;
  quality?: EpisodeQuality;
  inputHash?: string;
  policyVersion?: string;
  promptVersion?: string;
  toolSurfaceHash?: string;
  modelRevision?: string;
  codeRevision?: string;
  decision?: Record<string, unknown>;
  action?: Record<string, unknown>;
  receipt?: Record<string, unknown>;
  outcome?: Record<string, unknown>;
  businessValue?: Record<string, unknown>;
  operatorFeedback?: Record<string, unknown>;
  cost?: Record<string, unknown>;
  latencyMs?: number;
  metadata?: Record<string, unknown>;
}

function dottedPart(value: string): string {
  const normalized = value.trim().toLowerCase().replace(/[^a-z0-9_]+/g, "_");
  return normalized.replace(/^_+|_+$/g, "").slice(0, 32) || "event";
}

function runtimeRevision(): string | undefined {
  return (
    process.env.RAILWAY_GIT_COMMIT_SHA ||
    process.env.VERCEL_GIT_COMMIT_SHA ||
    process.env.GIT_COMMIT_SHA ||
    undefined
  );
}

/** Build the ledger event without writing it; useful for tests/replay tooling. */
export function buildEpisodeEvent(input: EpisodeInput): RealityEventInput {
  const episodeId = input.episodeId ?? randomUUID();
  const objects: RealityEventInput["objects"] = [
    { type: "episode", id: episodeId, role: input.kind },
  ];
  if (input.missionId) {
    objects.push({ type: "mission", id: input.missionId, role: "mission" });
  }

  const occurredAt = (input.occurredAt ?? new Date()).toISOString();

  return {
    eventType: `episode.${dottedPart(input.kind)}.${dottedPart(input.phase)}`,
    eventVersion: EPISODE_SCHEMA_VERSION,
    occurredAt,
    // observedAt stays populated for readers written before Q-25.
    observedAt: occurredAt,
    correlationId:
      input.correlationId ?? input.traceId ?? input.missionId ?? episodeId,
    causationId: input.causationId,
    retentionClass: "learning",
    objects,
    source: {
      system: "statenour",
      version: input.codeRevision ?? runtimeRevision(),
    },
    quality: input.quality ?? "observed",
    privacy: "internal",
    payload: {
      schemaVersion: EPISODE_SCHEMA_VERSION,
      episodeId,
      traceId: input.traceId ?? null,
      missionId: input.missionId ?? null,
      conversationId: input.conversationId ?? null,
      actor: input.actor ?? "system",
      inputHash: input.inputHash ?? null,
      policyVersion: input.policyVersion ?? null,
      promptVersion: input.promptVersion ?? null,
      toolSurfaceHash: input.toolSurfaceHash ?? null,
      modelRevision: input.modelRevision ?? null,
      decision: input.decision ?? null,
      action: input.action ?? null,
      receipt: input.receipt ?? null,
      outcome: input.outcome ?? null,
      businessValue: input.businessValue ?? null,
      operatorFeedback: input.operatorFeedback ?? null,
      cost: input.cost ?? null,
      latencyMs: input.latencyMs ?? null,
      metadata: input.metadata ?? null,
    },
  };
}

/**
 * Persist one episode through the existing evidence-ledger door.
 * This intentionally inherits the ledger's aggregate-only PII rejection.
 */
export async function recordEpisode(input: EpisodeInput): Promise<boolean> {
  const event = buildEpisodeEvent(input);
  const receipt = await recordEvidenceBatch(
    {
      events: [event],
      claims: [],
      sender: "statenour-episode",
      sentAt: new Date().toISOString(),
    },
    { producer: "ledger" },
  );

  return receipt.eventsWritten === 1 && receipt.rejected.length === 0;
}
