/**
 * Commitment / decision / alert action handlers.
 *
 * Extracted VERBATIM from lib/ai/nick-agent.ts executeAction (2026-06-02
 * structural split).
 */
import { prisma } from "@/lib/prisma";
import { today } from "@/lib/utils/datetime";
import type { ActionParams, ActionResult } from "./types";

export async function handleCommitmentCreate(params: ActionParams, type: string): Promise<ActionResult> {
  const commitment = await prisma.commitment.create({
    data: {
      dateMade: today(),
      description: String(params.description || "New commitment"),
      toWhom: params.toWhom ? String(params.toWhom) : "self",
      domain: params.domain ? String(params.domain) : null,
      deadline: params.deadline ? String(params.deadline) : null,
    },
  });
  return { action: type, success: true, result: { id: commitment.id } };
}

export async function handleCommitmentUpdate(params: ActionParams, type: string): Promise<ActionResult> {
  const commitment = await prisma.commitment.update({
    where: { id: Number(params.id) },
    data: {
      ...(params.status ? { status: String(params.status) } : {}),
      ...(params.notes ? { notes: String(params.notes) } : {}),
    },
  });
  return { action: type, success: true, result: { id: commitment.id } };
}

export async function handleDecisionLog(params: ActionParams, type: string): Promise<ActionResult> {
  const decision = await prisma.masteryDecision.create({
    data: {
      date: today(),
      title: String(params.title || "Decision"),
      context: params.context ? String(params.context) : null,
      optionsConsidered: params.options ? String(params.options) : null,
      chosen: params.chosen ? String(params.chosen) : null,
      reasoning: params.reasoning ? String(params.reasoning) : null,
      stakes: params.stakes ? String(params.stakes) : "medium",
    },
  });
  return { action: type, success: true, result: { id: decision.id } };
}

export async function handleAlertResolve(params: ActionParams, type: string): Promise<ActionResult> {
  const alertId = params.id;
  if (typeof alertId !== "string" && typeof alertId !== "number") {
    return { action: type, success: false, error: "Alert ID required (must be string or number)" };
  }
  const { resolveAlert } = await import("@/lib/mastery/drift-engine");
  await resolveAlert(alertId);
  return { action: type, success: true, result: { id: alertId } };
}
