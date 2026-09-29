import { randomUUID } from "node:crypto";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { recordEpisode } from "@/lib/intelligence/episodes";
import { buildToolGapReport, type ToolGapClass } from "@/lib/observability/tool-gap-report";
import { getToolCapability } from "@/lib/tools/tool-registry";
import { ServiceError } from "@/lib/utils/service-error";

export type CapabilityGapAction =
  | "FIX_DISCOVERABILITY"
  | "FIX_ROUTING"
  | "REPAIR_INTEGRATION"
  | "INVESTIGATE_NEW_CAPABILITY";

export type CapabilityLifecycleState =
  | "PROPOSED"
  | "APPROVED"
  | "REJECTED"
  | "IMPLEMENTED_UNVERIFIED"
  | "VERIFIED"
  | "RETIRED";

const GAP_ACTION: Record<ToolGapClass, CapabilityGapAction> = {
  DISCOVERABILITY_GAP: "FIX_DISCOVERABILITY",
  ROUTING_GAP: "FIX_ROUTING",
  EXTERNAL_SERVICE_GAP: "REPAIR_INTEGRATION",
  UNRESOLVED_GAP: "INVESTIGATE_NEW_CAPABILITY",
};

export const CapabilityProposalSchema = z.object({
  need: z.string().trim().min(10).max(1200),
  sourceGapClass: z.enum([
    "DISCOVERABILITY_GAP",
    "ROUTING_GAP",
    "EXTERNAL_SERVICE_GAP",
    "UNRESOLVED_GAP",
  ]),
  sourceToolName: z.string().trim().min(1).max(160).optional(),
  evidenceCount: z.number().int().positive().max(1_000_000).optional(),
  existingToolId: z.string().trim().min(1).max(160).optional(),
  readAccess: z.boolean().default(true),
  writeAccess: z.boolean().default(false),
  externalMutation: z.boolean().default(false),
  memoryWriteAllowed: z.boolean().default(false),
  notes: z.string().trim().max(1500).optional(),
});

export type CapabilityProposalInput = z.input<typeof CapabilityProposalSchema>;

export const CapabilityTransitionSchema = z.object({
  proposalId: z.string().uuid(),
  targetState: z.enum([
    "APPROVED",
    "REJECTED",
    "IMPLEMENTED_UNVERIFIED",
    "VERIFIED",
    "RETIRED",
  ]),
  note: z.string().trim().max(1500).optional(),
  implementationRef: z.string().trim().min(3).max(500).optional(),
  verificationRef: z.string().trim().min(3).max(500).optional(),
});

export type CapabilityTransitionInput = z.infer<typeof CapabilityTransitionSchema>;

const TRANSITIONS: Record<CapabilityLifecycleState, readonly CapabilityLifecycleState[]> = {
  PROPOSED: ["APPROVED", "REJECTED"],
  APPROVED: ["IMPLEMENTED_UNVERIFIED", "REJECTED"],
  REJECTED: [],
  IMPLEMENTED_UNVERIFIED: ["VERIFIED", "REJECTED"],
  VERIFIED: ["RETIRED"],
  RETIRED: [],
};

function proposalRisk(input: z.infer<typeof CapabilityProposalSchema>): {
  riskClass: "low" | "medium" | "high";
  approvalPolicy: "none" | "owner_required" | "memory_review_required";
} {
  if (input.memoryWriteAllowed) {
    return { riskClass: "high", approvalPolicy: "memory_review_required" };
  }
  if (input.externalMutation) {
    return { riskClass: "high", approvalPolicy: "owner_required" };
  }
  if (input.writeAccess) {
    return { riskClass: "medium", approvalPolicy: "owner_required" };
  }
  return { riskClass: "low", approvalPolicy: "none" };
}

function phaseForState(state: CapabilityLifecycleState): string {
  switch (state) {
    case "PROPOSED":
      return "capability_proposed";
    case "APPROVED":
      return "capability_approved";
    case "REJECTED":
      return "capability_rejected";
    case "IMPLEMENTED_UNVERIFIED":
      return "capability_implemented_unverified";
    case "VERIFIED":
      return "capability_verified";
    case "RETIRED":
      return "capability_retired";
  }
}

function objectValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

async function lifecycleRows(proposalId?: string) {
  return prisma.realityEvent.findMany({
    where: {
      eventType: {
        in: [
          "episode.tool_gap.capability_proposed",
          "episode.tool_gap.capability_approved",
          "episode.tool_gap.capability_rejected",
          "episode.tool_gap.capability_implemented_unverified",
          "episode.tool_gap.capability_verified",
          "episode.tool_gap.capability_retired",
        ],
      },
      ...(proposalId
        ? { payload: { path: ["episodeId"], equals: proposalId } }
        : {}),
    },
    orderBy: { observedAt: "asc" },
    select: { eventType: true, observedAt: true, payload: true },
  });
}

function stateFromEventType(eventType: string): CapabilityLifecycleState | null {
  if (eventType.endsWith(".capability_proposed")) return "PROPOSED";
  if (eventType.endsWith(".capability_approved")) return "APPROVED";
  if (eventType.endsWith(".capability_rejected")) return "REJECTED";
  if (eventType.endsWith(".capability_implemented_unverified")) {
    return "IMPLEMENTED_UNVERIFIED";
  }
  if (eventType.endsWith(".capability_verified")) return "VERIFIED";
  if (eventType.endsWith(".capability_retired")) return "RETIRED";
  return null;
}

export async function proposeCapability(rawInput: CapabilityProposalInput): Promise<{
  ok: true;
  proposalId: string;
  state: "PROPOSED";
  recommendedGapAction: CapabilityGapAction;
}> {
  const input = CapabilityProposalSchema.parse(rawInput);
  const recommendedGapAction = GAP_ACTION[input.sourceGapClass];

  if (
    input.sourceGapClass !== "UNRESOLVED_GAP" &&
    !input.existingToolId
  ) {
    throw new ServiceError(
      `${input.sourceGapClass} points to an incumbent repair, not a new capability. Supply existingToolId and fix/reuse the incumbent first.`,
      400,
    );
  }

  if (input.existingToolId && !getToolCapability(input.existingToolId)) {
    throw new ServiceError(`existing tool ${input.existingToolId} is not registered`, 400);
  }

  const proposalId = randomUUID();
  const risk = proposalRisk(input);
  const recorded = await recordEpisode({
    kind: "tool_gap",
    phase: phaseForState("PROPOSED"),
    episodeId: proposalId,
    actor: "operator",
    quality: "observed",
    decision: {
      state: "PROPOSED",
      need: input.need,
      sourceGapClass: input.sourceGapClass,
      sourceToolName: input.sourceToolName ?? null,
      evidenceCount: input.evidenceCount ?? null,
      existingToolId: input.existingToolId ?? null,
      recommendedGapAction,
      requestedCapability: {
        readAccess: input.readAccess,
        writeAccess: input.writeAccess,
        externalMutation: input.externalMutation,
        memoryWriteAllowed: input.memoryWriteAllowed,
      },
      riskClass: risk.riskClass,
      approvalPolicy: risk.approvalPolicy,
    },
    metadata: {
      notes: input.notes ?? null,
      toolsmithAuthority: "proposal_only",
    },
  });
  if (!recorded) throw new ServiceError("capability proposal ledger write rejected", 500);

  return { ok: true, proposalId, state: "PROPOSED", recommendedGapAction };
}

export async function transitionCapabilityProposal(rawInput: CapabilityTransitionInput) {
  const input = CapabilityTransitionSchema.parse(rawInput);
  const rows = await lifecycleRows(input.proposalId);
  if (rows.length === 0) {
    throw new ServiceError(`capability proposal ${input.proposalId} not found`, 404);
  }

  const current = stateFromEventType(rows.at(-1)!.eventType);
  if (!current) throw new ServiceError("capability proposal has invalid lifecycle history", 409);
  if (!TRANSITIONS[current].includes(input.targetState)) {
    throw new ServiceError(
      `illegal capability transition ${current} -> ${input.targetState}`,
      409,
    );
  }
  if (
    input.targetState === "IMPLEMENTED_UNVERIFIED" &&
    !input.implementationRef
  ) {
    throw new ServiceError("implementationRef is required before implementation can be claimed", 400);
  }
  if (input.targetState === "VERIFIED" && !input.verificationRef) {
    throw new ServiceError("verificationRef is required before a capability can be verified", 400);
  }

  const recorded = await recordEpisode({
    kind: "tool_gap",
    phase: phaseForState(input.targetState),
    episodeId: input.proposalId,
    actor: "operator",
    quality: "observed",
    outcome: {
      state: input.targetState,
      note: input.note ?? null,
      implementationRef: input.implementationRef ?? null,
      verificationRef: input.verificationRef ?? null,
    },
    metadata: {
      previousState: current,
      toolsmithAuthority: "no_activation_authority",
    },
  });
  if (!recorded) throw new ServiceError("capability lifecycle ledger write rejected", 500);

  return { ok: true as const, proposalId: input.proposalId, previousState: current, state: input.targetState };
}

export async function buildCapabilityLifecycleReport(windowDays = 30) {
  const boundedDays = Math.max(1, Math.min(Math.floor(windowDays), 90));
  const [gapReport, rows] = await Promise.all([
    buildToolGapReport(boundedDays),
    // Lifecycle state is governance, not telemetry. A proposal must remain
    // visible until it reaches a terminal state even when its last transition
    // predates the telemetry window.
    lifecycleRows(),
  ]);

  const proposals = new Map<
    string,
    {
      proposalId: string;
      state: CapabilityLifecycleState;
      need: string | null;
      sourceGapClass: string | null;
      existingToolId: string | null;
      riskClass: string | null;
      recommendedGapAction: string | null;
      updatedAt: string;
      implementationRef: string | null;
      verificationRef: string | null;
    }
  >();

  for (const row of rows) {
    const payload = objectValue(row.payload);
    const proposalId = typeof payload?.episodeId === "string" ? payload.episodeId : null;
    const state = stateFromEventType(row.eventType);
    if (!proposalId || !state) continue;

    const decision = objectValue(payload?.decision);
    const outcome = objectValue(payload?.outcome);
    const previous = proposals.get(proposalId);
    proposals.set(proposalId, {
      proposalId,
      state,
      need:
        typeof decision?.need === "string"
          ? decision.need
          : previous?.need ?? null,
      sourceGapClass:
        typeof decision?.sourceGapClass === "string"
          ? decision.sourceGapClass
          : previous?.sourceGapClass ?? null,
      existingToolId:
        typeof decision?.existingToolId === "string"
          ? decision.existingToolId
          : previous?.existingToolId ?? null,
      riskClass:
        typeof decision?.riskClass === "string"
          ? decision.riskClass
          : previous?.riskClass ?? null,
      recommendedGapAction:
        typeof decision?.recommendedGapAction === "string"
          ? decision.recommendedGapAction
          : previous?.recommendedGapAction ?? null,
      updatedAt: row.observedAt.toISOString(),
      implementationRef:
        typeof outcome?.implementationRef === "string"
          ? outcome.implementationRef
          : previous?.implementationRef ?? null,
      verificationRef:
        typeof outcome?.verificationRef === "string"
          ? outcome.verificationRef
          : previous?.verificationRef ?? null,
    });
  }

  return {
    windowDays: boundedDays,
    gapTelemetryAvailable: gapReport.available,
    gapRecommendations: gapReport.topGaps.map((gap) => ({
      ...gap,
      recommendedAction: GAP_ACTION[gap.classification],
      newCapabilityCandidate: gap.classification === "UNRESOLVED_GAP",
    })),
    proposals: [...proposals.values()].sort((a, b) =>
      b.updatedAt.localeCompare(a.updatedAt),
    ),
    counts: {
      proposed: [...proposals.values()].filter((p) => p.state === "PROPOSED").length,
      approved: [...proposals.values()].filter((p) => p.state === "APPROVED").length,
      implementedUnverified: [...proposals.values()].filter(
        (p) => p.state === "IMPLEMENTED_UNVERIFIED",
      ).length,
      verified: [...proposals.values()].filter((p) => p.state === "VERIFIED").length,
    },
    generatedAt: new Date().toISOString(),
    caveat:
      "Toolsmith has proposal/lifecycle authority only. Routing, discoverability, and service failures must repair the incumbent first; implementation requires an external artifact and verification requires a receipt.",
  };
}
