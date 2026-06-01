/**
 * 2026-05-27 · Power Atlas Phase 2 · Power plays runner.
 *
 * 4 play kinds the operator can fire on a person from the UI:
 *   · arc_plan          → emotional-arc-designer · planned conversation
 *   · message_draft     → copywriting/sequence/headline psych · ready-to-send
 *   · scarcity_play     → Greene Law 16 · when + how to be less available
 *   · reciprocity_assess→ compute initiator asymmetry · recommendation
 *
 * Each execution persists a RelationshipPlay row (kind · inputCtx ·
 * output) for operator review later. The output is returned to the
 * caller as the structured JSON the AI produced.
 *
 * Failure path · returns null (AI failure or JSON parse error). Caller
 * (the tRPC mutation) returns ok:false. UI shows an error toast.
 */

import "server-only";
import { prisma } from "@/lib/prisma";
import { tracedAiChat } from "@/lib/ai/traced-aichat";

export type PlayKind =
  | "arc_plan"
  | "message_draft"
  | "scarcity_play"
  | "reciprocity_assess";

const PROMPTS: Record<PlayKind, string> = {
  arc_plan:
    "Plan a conversation. Output JSON: {goal, currentState, desiredState, phases:[{order,label,prompt}]}. Use emotional-arc-designer framework (engineered progression from entry emotion to action emotion).",
  message_draft:
    "Draft a message to this person. Apply copywriting-psychologist + sequence-psychologist principles. Output JSON: {subject?, body, rationale}. Operator edits + sends.",
  scarcity_play:
    "Greene Law 16 · scarcity playbook. When + how should operator make themselves less available to increase respect? Output JSON: {when, how, why, lawApplied: 16}.",
  reciprocity_assess:
    "Compute reciprocity asymmetry. Who reached out first 80%+ of the time? Output JSON: {operatorInitiatedPct, theirInitiatedPct, recommendation}.",
};

export async function runPowerPlay(
  personId: string,
  kind: PlayKind,
  operatorGoal?: string,
): Promise<unknown> {
  const person = await prisma.personProfile.findUnique({
    where: { id: personId },
  });
  if (!person) return null;

  const recentLedger = await prisma.relationshipLedger.findMany({
    where: { personId },
    orderBy: { createdAt: "desc" },
    take: 20,
    select: { amount: true, note: true, source: true, createdAt: true },
  });

  const context = `Person: ${person.name}
Role: ${person.role}
Status: ${person.status}
Trust: ${Math.round(person.trustScore * 100)}/100
Power balance: ${person.powerBalance.toFixed(2)}
Greene type: ${person.greeneType ?? "unknown"}
Applicable laws: [${person.applicableLaws.join(",")}]
Dossier:
${(person.dossierMd ?? "").slice(0, 1500)}

Recent ledger (last 20):
${recentLedger
  .map(
    (l) =>
      `${l.amount >= 0 ? "+" : ""}${l.amount} · ${l.note.slice(0, 60)} · ${l.source}`,
  )
  .join("\n")}

Operator's goal: ${operatorGoal ?? "(not specified)"}`;

  const result = await tracedAiChat(
    {
      label: `power-play-${kind}`,
      source: "tool",
      metadata: { personId, kind },
    },
    [
      {
        role: "system",
        content: `${PROMPTS[kind]} Output STRICT JSON only · no markdown fences.`,
      },
      { role: "user", content: context },
    ],
    "reason",
  );

  try {
    const raw = (result.content ?? "")
      .trim()
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```\s*$/, "");
    const parsed = JSON.parse(raw);

    // Persist as RelationshipPlay for the operator's review history
    const play = await prisma.relationshipPlay.create({
      data: {
        personId,
        kind,
        inputCtx: {
          operatorGoal,
          person: {
            trust: person.trustScore,
            power: person.powerBalance,
          },
        } as never,
        output: parsed as never,
      },
    });

    // 2026-06-01 · credit a deliberate influence rep (idempotent per
    // play row · fire-and-forget). arc_plan→strategy · message_draft→
    // persuasion · scarcity_play→seduction · reciprocity_assess→networking.
    const { creditPowerPlay } = await import("@/lib/mastery/people-credit");
    void creditPowerPlay({ playId: play.id, personId, kind });

    return parsed;
  } catch {
    return null;
  }
}
