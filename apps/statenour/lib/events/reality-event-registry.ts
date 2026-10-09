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

/**
 * The authenticated door a batch came through (reality-ledger.ts
 * EvidenceProducer, derived from the credential, never from the body).
 * Restated here because reality-ledger.ts imports this module.
 */
export type RealityEventProducer = "ledger" | "bridge" | "operator";

export interface RealityEventContract {
  family: string;
  eventVersion: number;
  retentionClass: RealityEventRetentionClass;
  payloadSchema: z.ZodType<Record<string, unknown>>;
  matches: (eventType: string) => boolean;
  canonicalType: (eventType: string) => string;
  /**
   * 2026-10-09 - Optional door scope. Absent = any authenticated door may
   * write the type (every family registered before this date). Present = only
   * these doors; any other door, or a caller that does not say which door it
   * is, is refused (fail closed). Used where a reader presents the rows as one
   * specific producer's output, so a different key holder cannot write a row
   * that renders exactly like it.
   */
  producers?: readonly RealityEventProducer[];
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

/**
 * receptionist.prompt_experiment v1 (2026-10-09) - one receipt per weekly
 * prompt-evolution run in nickstire (source.uri "cron:prompt-evolution-weekly").
 * The producer's full payload is outcome, promotionStage, baseline,
 * candidate, lanes, cohorts, gates, previousProposal, usage. Only
 * `outcome` is required here, the way experiment.verdict requires only
 * `status`: the /proof reader (recentPromptExperiments) tolerates every other
 * key being absent or null, and a stricter write schema would drop a whole
 * weekly receipt over one renamed sub-field. Everything else passes through.
 *
 * Door: bridge only. nickstire posts with STATENOUR_SYNC_KEY
 * (apps/nickstire/server/services/evidenceLedger.ts), which the evidence route
 * resolves to "bridge". /proof labels these rows as that cron's receipts, and
 * the scoped EVIDENCE_LEDGER_KEY is held by Night Shift (an LLM), so without
 * the scope a ledger-door post would render exactly like the cron's.
 */
const receptionistPromptExperimentPayload = z
  .object({
    outcome: z.string().min(1).max(64),
    promotionStage: z.string().max(64).nullable().optional(),
  })
  .passthrough();

const EPISODE_TYPE =
  /^episode\.(decision|tool|tool_gap|mission|worker|content|experiment|business_outcome)\.([a-z0-9_]+)$/;
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
  {
    family: "receptionist",
    eventVersion: 1,
    retentionClass: "evidence",
    payloadSchema: receptionistPromptExperimentPayload,
    matches: (eventType) => eventType === "receptionist.prompt_experiment",
    canonicalType: () =>
      eventTypeName("receptionist", "prompt_experiment", "recorded", 1),
    producers: ["bridge"],
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
  /** The door the batch came through; required only by a contract with `producers`. */
  producer?: RealityEventProducer;
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
    contract.producers &&
    (input.producer === undefined || !contract.producers.includes(input.producer))
  ) {
    return {
      ok: false,
      error: `${input.eventType} is accepted only through the ${contract.producers.join("/")} door (this request: ${input.producer ?? "unknown door"})`,
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
