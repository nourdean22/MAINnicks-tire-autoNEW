/**
 * Canonical registry for append-only RealityEvent ingestion.
 *
 * Q-25 does NOT replace lib/events/envelope.ts. That module is the existing
 * CloudEvents-shaped read envelope across StateNour event models. This registry
 * governs the compact event_type vocabulary stored in reality_events, pins each
 * type/family to a schema version + retention class, and maps it into the
 * existing DomainEventEnvelope type vocabulary for projections.
 *
 * Backward compatibility: eventVersion / retentionClass may be omitted by older
 * producers; the registry supplies the canonical values. If a producer sends
 * either field explicitly and it disagrees with the registry, the event is
 * rejected loudly rather than silently coerced.
 */
import { z } from "zod";
import { eventTypeName } from "@/lib/events/envelope";

export const REALITY_EVENT_RETENTION_CLASSES = [
  "operational",
  "evidence",
  "learning",
  "audit",
] as const;
export type RealityEventRetentionClass =
  (typeof REALITY_EVENT_RETENTION_CLASSES)[number];

export interface RealityEventContract {
  family: string;
  eventVersion: number;
  retentionClass: RealityEventRetentionClass;
  payloadSchema: z.ZodType<Record<string, unknown>>;
  matches: (eventType: string) => boolean;
  canonicalType: (eventType: string) => string;
}

const recordPayload = z.record(z.string(), z.unknown());

const experimentVerdictPayload = z
  .object({
    status: z.string().min(1).max(64),
  })
  .passthrough();

const proofPayload = z
  .object({
    outcome: z.string().max(64).optional(),
  })
  .passthrough();

const episodePayload = z
  .object({
    schemaVersion: z.literal(1),
    episodeId: z.string().min(1).max(200),
    traceId: z.string().max(200).nullable().optional(),
    missionId: z.string().max(200).nullable().optional(),
  })
  .passthrough();

const darwinPayload = recordPayload;

const EPISODE_TYPE =
  /^episode\.(decision|tool|tool_gap|mission|content|experiment|business_outcome)\.([a-z0-9_]+)$/;
const PROOF_TYPE = /^proof\.(run|holdout|episode_failed)$/;
const DARWIN_TYPE =
  /^darwin\.(run_refused|run_failed|proposal_opened|no_proposal)$/;

export const REALITY_EVENT_REGISTRY: readonly RealityEventContract[] = [
  {
    family: "experiment",
    eventVersion: 1,
    retentionClass: "evidence",
    payloadSchema: experimentVerdictPayload,
    matches: (eventType) => eventType === "experiment.verdict",
    canonicalType: () => eventTypeName("experiment", "experiment", "verdict", 1),
  },
  {
    family: "proof",
    eventVersion: 1,
    retentionClass: "evidence",
    payloadSchema: proofPayload,
    matches: (eventType) => PROOF_TYPE.test(eventType),
    canonicalType: (eventType) =>
      eventTypeName("proof", "proof", eventType.split(".")[1] ?? "event", 1),
  },
  {
    family: "episode",
    eventVersion: 1,
    retentionClass: "learning",
    payloadSchema: episodePayload,
    matches: (eventType) => EPISODE_TYPE.test(eventType),
    canonicalType: (eventType) => {
      const match = EPISODE_TYPE.exec(eventType);
      return eventTypeName(
        "episode",
        match?.[1] ?? "episode",
        match?.[2] ?? "event",
        1,
      );
    },
  },
  {
    family: "darwin",
    eventVersion: 1,
    retentionClass: "audit",
    payloadSchema: darwinPayload,
    matches: (eventType) => DARWIN_TYPE.test(eventType),
    canonicalType: (eventType) =>
      eventTypeName("autonomy", "darwin", eventType.split(".")[1] ?? "event", 1),
  },
  {
    family: "shopstate",
    eventVersion: 1,
    retentionClass: "operational",
    payloadSchema: recordPayload,
    matches: (eventType) => eventType === "shopstate.transition",
    canonicalType: () => eventTypeName("shopstate", "shop", "transition", 1),
  },
] as const;

export function realityEventContract(
  eventType: string,
): RealityEventContract | null {
  return REALITY_EVENT_REGISTRY.find((entry) => entry.matches(eventType)) ?? null;
}

export interface RealityEventRegistrationInput {
  eventType: string;
  eventVersion?: number;
  retentionClass?: RealityEventRetentionClass;
  payload?: Record<string, unknown>;
}

export type RealityEventRegistrationResult =
  | {
      ok: true;
      eventVersion: number;
      retentionClass: RealityEventRetentionClass;
      canonicalType: string;
      payload: Record<string, unknown>;
    }
  | { ok: false; error: string };

/**
 * Resolve and validate the ingestion contract for one RealityEvent.
 *
 * Unknown event types are rejected. A supplied eventVersion or retentionClass
 * must match the registry. Payload validation is family-specific.
 */
export function validateRealityEventRegistration(
  input: RealityEventRegistrationInput,
): RealityEventRegistrationResult {
  const contract = realityEventContract(input.eventType);
  if (!contract) {
    return {
      ok: false,
      error: `unregistered RealityEvent type "${input.eventType}"`,
    };
  }

  if (
    input.eventVersion !== undefined &&
    input.eventVersion !== contract.eventVersion
  ) {
    return {
      ok: false,
      error: `eventVersion ${input.eventVersion} does not match registered version ${contract.eventVersion} for ${input.eventType}`,
    };
  }

  if (
    input.retentionClass !== undefined &&
    input.retentionClass !== contract.retentionClass
  ) {
    return {
      ok: false,
      error: `retentionClass "${input.retentionClass}" does not match registered class "${contract.retentionClass}" for ${input.eventType}`,
    };
  }

  const parsed = contract.payloadSchema.safeParse(input.payload ?? {});
  if (!parsed.success) {
    const message = parsed.error.issues
      .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
      .join("; ");
    return {
      ok: false,
      error: `payload does not match ${contract.family} v${contract.eventVersion}: ${message}`,
    };
  }

  return {
    ok: true,
    eventVersion: contract.eventVersion,
    retentionClass: contract.retentionClass,
    canonicalType: contract.canonicalType(input.eventType),
    payload: parsed.data,
  };
}
