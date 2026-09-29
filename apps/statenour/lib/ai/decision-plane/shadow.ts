import { createHash } from "node:crypto";
import { z } from "zod";
import { getFlag } from "@/lib/feature-flags";
import { getInngest, isInngestFullyConfigured } from "@/lib/inngest/client";
import { findPii } from "@/lib/services/reality-ledger";
import {
  getDecisionBackendStatuses,
} from "./backends";
import {
  buildTurnDecisionRequest,
  incumbentTurnDecision,
  type IncumbentTurnDecision,
  type IncumbentTurnDecisionInput,
} from "./turn-schema";

const IncumbentSchema = z.object({
  intent: z.string(),
  complexity: z.string(),
  outputShape: z.string(),
  domain: z.string(),
  urgency: z.string(),
  needsTools: z.boolean(),
  needsWeb: z.boolean(),
  actionRequest: z.boolean(),
  needsDeepReasoning: z.boolean(),
  needsBackgroundMission: z.null(),
  mode: z.string(),
  finalTaskType: z.string(),
});

export const TurnDecisionShadowEventSchema = z.object({
  schemaVersion: z.literal(1),
  traceId: z.string().min(1).max(200),
  conversationId: z.string().min(1).max(200).optional(),
  inputHash: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  state: z.object({
    message: z.string().max(12_000),
    truncated: z.boolean(),
  }),
  incumbent: IncumbentSchema,
});

export type TurnDecisionShadowEvent = z.infer<typeof TurnDecisionShadowEventSchema>;

function hashJson(value: unknown): string {
  return `sha256:${createHash("sha256").update(JSON.stringify(value)).digest("hex")}`;
}

function samplePct(): number {
  const raw = Number.parseFloat(process.env.NICK_DECISION_PLANE_SHADOW_SAMPLE_PCT ?? "10");
  if (!Number.isFinite(raw)) return 10;
  return Math.max(0, Math.min(100, raw));
}

export function isDecisionShadowSampled(traceId: string, percent = samplePct()): boolean {
  if (percent <= 0) return false;
  if (percent >= 100) return true;
  const hex = createHash("sha256").update(traceId).digest("hex").slice(0, 8);
  const value = Number.parseInt(hex, 16) / 0xffffffff;
  return value * 100 < percent;
}

export interface ScheduleTurnDecisionShadowInput extends IncumbentTurnDecisionInput {
  userContent: string;
  traceId: string;
  conversationId?: string;
  privateMode?: boolean;
}

export type DecisionShadowScheduleResult =
  | { queued: true; eventIds: string[]; incumbent: IncumbentTurnDecision }
  | {
      queued: false;
      reason:
        | "feature_disabled"
        | "private_mode"
        | "pii_detected"
        | "sampled_out"
        | "no_configured_backend"
        | "inngest_not_configured";
    };

export async function scheduleTurnDecisionShadow(
  input: ScheduleTurnDecisionShadowInput,
): Promise<DecisionShadowScheduleResult> {
  if (!(getFlag("NICK_DECISION_PLANE_SHADOW")?.isOn ?? false)) {
    return { queued: false, reason: "feature_disabled" };
  }
  if (input.privateMode) {
    return { queued: false, reason: "private_mode" };
  }
  if (!isDecisionShadowSampled(input.traceId)) {
    return { queued: false, reason: "sampled_out" };
  }

  // Never send obvious customer/operator identifiers into a research pilot.
  // This is intentionally stricter than the normal chat provider path.
  if (findPii({ message: input.userContent })) {
    return { queued: false, reason: "pii_detected" };
  }

  const configured = getDecisionBackendStatuses().some((status) => status.configured);
  if (!configured) {
    return { queued: false, reason: "no_configured_backend" };
  }
  if (!isInngestFullyConfigured()) {
    return { queued: false, reason: "inngest_not_configured" };
  }

  const request = buildTurnDecisionRequest(input.userContent);
  const state = request.state as { message: string; truncated: boolean };
  const incumbent = incumbentTurnDecision(input);
  const event = TurnDecisionShadowEventSchema.parse({
    schemaVersion: 1,
    traceId: input.traceId,
    conversationId: input.conversationId,
    inputHash: hashJson(state),
    state,
    incumbent,
  });

  const sent = await getInngest().send({
    name: "decision-plane/shadow.requested",
    data: event,
  });
  return { queued: true, eventIds: sent.ids, incumbent };
}
