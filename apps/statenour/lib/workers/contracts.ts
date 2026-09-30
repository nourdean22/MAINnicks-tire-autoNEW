import { z } from "zod";
import {
  CAPABILITY_ALIASES,
  ROUTING_MODES,
  type CapabilityAlias,
  type RoutingMode,
} from "@nour/ai-capabilities";

export const EXTERNAL_WORKER_LANE_IDS = [
  "codex",
  "claude-code",
  "antigravity",
  "local-qwen",
] as const;

export type ExternalWorkerLaneId = (typeof EXTERNAL_WORKER_LANE_IDS)[number];

export const ExternalWorkerLaneIdSchema = z.enum(EXTERNAL_WORKER_LANE_IDS);
export const ExternalWorkerCapabilitySchema = z.enum(CAPABILITY_ALIASES);
export const ExternalWorkerRoutingModeSchema = z.enum(ROUTING_MODES);

export const ExternalWorkerQueueRequestSchema = z.object({
  prompt: z.string().min(5).max(20_000),
  capability: ExternalWorkerCapabilitySchema.default("coder"),
  mode: ExternalWorkerRoutingModeSchema.default("AUTO"),
  preferredLane: ExternalWorkerLaneIdSchema.optional(),
  workspaceKey: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[a-z0-9][a-z0-9_-]*$/)
    .default("repo"),
  allowWorkspaceWrite: z.boolean().default(false),
  idempotencyKey: z.string().min(1).max(160).optional(),
  requestedBy: z.enum(["operator", "nick"]).default("nick"),
});

export type ExternalWorkerQueueRequest = z.infer<
  typeof ExternalWorkerQueueRequestSchema
>;

export const ExternalWorkerJobPayloadSchema = z.object({
  schemaVersion: z.literal(1),
  capability: ExternalWorkerCapabilitySchema,
  mode: ExternalWorkerRoutingModeSchema,
  candidateLaneIds: z.array(ExternalWorkerLaneIdSchema).min(1).max(4),
  workspaceKey: z.string().min(1).max(64),
  allowWorkspaceWrite: z.boolean(),
  prompt: z.string().min(5).max(20_000),
  requestedBy: z.enum(["operator", "nick"]),
});

export type ExternalWorkerJobPayload = z.infer<
  typeof ExternalWorkerJobPayloadSchema
>;

export const ExternalWorkerResultSchema = z.object({
  schemaVersion: z.literal(1),
  laneId: ExternalWorkerLaneIdSchema,
  status: z.enum(["completed", "failed", "refused"]),
  output: z.string().max(50_000).default(""),
  outputTruncated: z.boolean().default(false),
  elapsedMs: z.number().int().min(0).max(3_600_000),
  exitCode: z.number().int().min(-1).max(255).nullable().optional(),
  model: z.string().max(160).nullable().optional(),
  errorCode: z.string().max(80).nullable().optional(),
});

export type ExternalWorkerResult = z.infer<typeof ExternalWorkerResultSchema>;

export type ExternalWorkerLaneSnapshot = {
  health: "ready" | "degraded" | "unavailable" | "unknown";
  quota: "available" | "limited" | "exhausted" | "unknown";
  auth: string;
  detail?: string;
  checkedAt?: string;
};

export type ExternalWorkerLaneSummary = {
  id: ExternalWorkerLaneId;
  capability: readonly CapabilityAlias[];
  modeSafe: readonly RoutingMode[];
  health: ExternalWorkerLaneSnapshot["health"];
  quota: ExternalWorkerLaneSnapshot["quota"];
  costClass:
    | "LOCAL_FREE"
    | "SUBSCRIPTION_INCLUDED"
    | "FREE_TIER"
    | "EXISTING_INFRA"
    | "METERED_PAID";
  authClass:
    | "none"
    | "local"
    | "subscription"
    | "free_tier"
    | "existing_infra"
    | "api_metered";
  detail?: string;
};
