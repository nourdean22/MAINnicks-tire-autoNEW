/**
 * Person action handlers (person.update · person.create).
 *
 * person.update edits an EXISTING person only — it NEVER creates. If the
 * name doesn't resolve to someone Nour already has, it returns an error
 * telling Nick to ASK before adding. person.create is the explicit add
 * path, used only after Nour confirms. Both reject pronoun / descriptor
 * names (resolvePersonByName guards "her", "the caller", etc.).
 *
 * 2026-06-06 · Fixes two Power-Atlas bugs: (a) the agent auto-creating
 * non-personal contacts (e.g. tire-shop callers), (b) ghost rows named
 * "her". Builds on the 2026-06-02 C1 suggest-then-approve gate (role/trust
 * → pendingClassification · Nick never silently reclassifies a person).
 *
 * 2026-09-16 · person.logInteraction is the CONTACT path. person.update is an
 * edit and no longer touches lastInteraction / interactionCount (it bumped
 * both on every call with no ledger row behind it — measured on Neon: the
 * counters summed to 191 against 23 ledger rows ever, none since 07-10).
 * Contact now has exactly one writer, lib/services/people/record-interaction.
 */
import { prisma } from "@/lib/prisma";
import { today } from "@/lib/utils/datetime";
import type { ActionParams, ActionResult } from "./types";

const INTERACTION_KINDS: ReadonlySet<string> = new Set(["in_person", "call", "text", "video", "other"]);
/** The seam clamps to ±100 (the modal's range); an LLM-decided swing is capped tighter. */
const AGENT_AMOUNT_CAP = 25;

export async function handlePersonUpdate(params: ActionParams, type: string): Promise<ActionResult> {
  // person.update edits an EXISTING person · createIfMissing:false means a
  // never-seen name (or a pronoun) resolves to no row, and we ask instead of
  // inventing a ghost. New people go through person.create after Nour's yes.
  const { resolvePersonByName } = await import("@/lib/brain/person-profile-fuzzy");
  const resolution = await resolvePersonByName(String(params.name), {
    role: String(params.role || "unknown"),
    relationship: String(params.relationship || ""),
    trustScore: Number(params.trustScore ?? 0.5),
    createIfMissing: false,
  });

  // No existing match · do NOT invent a person. Tell Nick to ask first.
  if (!resolution.matched || !resolution.person) {
    const name = String(params.name);
    return {
      action: type,
      success: false,
      error:
        resolution.matchTier === "rejected_nonname"
          ? `"${name}" is not a real name — never log to a pronoun or descriptor. Use the person's actual name.`
          : `No existing person matches "${name}". Do not assume one. Ask Nour: "want me to add ${name} to your people?" — then use person.create only after a yes.`,
    };
  }

  // 2026-06-02 · C1 fix · honor the suggest-then-approve gate.
  // relationship / leverageNotes are low-risk → write immediately. role +
  // trustScore reclassify a person Nour may have curated → route them into
  // pendingClassification (operator approves on /people) so Nick can NEVER
  // silently overwrite a role/trust.
  const personId = resolution.person.id;
  const current = await prisma.personProfile.findUnique({
    where: { id: personId },
    select: { role: true, trustScore: true },
  });
  const { isPersonRole } = await import("@/lib/brain/person-roles");

  // Immediate (low-risk) writes. 2026-09-16 · an EDIT is not a CONTACT: this
  // write no longer bumps interactionCount / lastInteraction. Contact goes
  // through person.logInteraction → the ledger seam, which owns both counters.
  const immediate: { relationship?: string; leverageNotes?: string } = {};
  if (params.relationship) immediate.relationship = String(params.relationship);
  if (params.leverageNotes) immediate.leverageNotes = String(params.leverageNotes);
  if (Object.keys(immediate).length > 0) {
    await prisma.personProfile.update({ where: { id: personId }, data: immediate });
  }

  // Build a role/trust PROPOSAL (never a live write).
  const requestedRole = params.role ? String(params.role) : null;
  const suggestedRole =
    requestedRole && isPersonRole(requestedRole) && requestedRole !== current?.role
      ? requestedRole
      : null;
  let trustAdjustment = 0;
  if (params.trustScore != null && current) {
    const rawAdj = Number(params.trustScore) - current.trustScore;
    trustAdjustment = Number.isFinite(rawAdj) ? Math.max(-0.1, Math.min(0.1, rawAdj)) : 0;
  }

  let pendingProposed = false;
  if (suggestedRole || trustAdjustment !== 0) {
    await prisma.personProfile.update({
      where: { id: personId },
      data: {
        pendingClassification: {
          role: suggestedRole,
          leverageNotes: null, // handled live above · not re-proposed
          trustAdjustment,
          basis: "nick_agent person.update",
          suggestedAt: today(),
        } as object,
      },
    });
    pendingProposed = true;
  }

  return {
    action: type,
    success: true,
    result: {
      id: personId,
      name: resolution.person.name,
      matched: resolution.matched,
      matchTier: resolution.matchTier,
      // Report what actually happened so Nick narrates honestly.
      applied: {
        relationship: params.relationship ? String(params.relationship) : null,
        leverageNotes: params.leverageNotes ? String(params.leverageNotes) : null,
      },
      pendingProposal: pendingProposed
        ? { role: suggestedRole, trustAdjustment, awaitingApprovalOn: "/people" }
        : null,
    },
  };
}

/**
 * person.create — explicit "add a NEW person" path. Used by Nick ONLY after
 * Nour confirms ("want me to add X?"). Creates via the fuzzy resolver (which
 * still matches a close existing person, and rejects pronoun / descriptor
 * names). role/relationship/leverageNotes apply to the new row.
 */
export async function handlePersonCreate(params: ActionParams, type: string): Promise<ActionResult> {
  const name = String(params.name || "").trim();
  const { resolvePersonByName } = await import("@/lib/brain/person-profile-fuzzy");
  const resolution = await resolvePersonByName(name, {
    role: String(params.role || "unknown"),
    relationship: String(params.relationship || ""),
    trustScore: Number(params.trustScore ?? 0.5),
    source: "agent",
    createIfMissing: true,
  });

  if (!resolution.person) {
    return {
      action: type,
      success: false,
      error: `"${name}" is not a usable name (looks like a pronoun or descriptor). Use the person's real name.`,
    };
  }

  // Apply leverageNotes if provided · the resolver's create path doesn't take it.
  if (params.leverageNotes) {
    await prisma.personProfile.update({
      where: { id: resolution.person.id },
      data: { leverageNotes: String(params.leverageNotes) },
    });
  }

  let undoToken: string | null = null;
  let undoExpiresAt: Date | null = null;
  if (!resolution.matched && resolution.person) {
    const personId = resolution.person.id;
    undoToken = `undo_${personId}_${Date.now()}`;
    undoExpiresAt = new Date(Date.now() + 30 * 1000);
    await prisma.brainMemory
      .create({
        data: {
          category: "undo_token",
          key: undoToken,
          content: JSON.stringify({
            toolName: "person.create",
            personId,
          }),
          source: "chat-tool",
          confidence: 1.0,
          expiresAt: undoExpiresAt,
          createdBy: "nick",
        },
      })
      .catch(() => null);
  }

  return {
    action: type,
    success: true,
    result: {
      id: resolution.person.id,
      name: resolution.person.name,
      created: !resolution.matched,
      matched: resolution.matched,
      matchTier: resolution.matchTier,
      note: resolution.matched
        ? "Already existed — matched an existing person, no duplicate created."
        : "Added a new person.",
      undoToken,
      undoExpiresAt: undoExpiresAt ? undoExpiresAt.toISOString() : undefined,
    },
  };
}

/**
 * person.logInteraction — the CONTACT path (2026-09-16). Nour reports that he
 * actually talked to / met / texted someone he already has; Nick records it
 * as ONE relationship-ledger row through the seam (row + both counters in one
 * transaction, embed + XP after the commit). Resolves through the same fuzzy
 * chain as person.update and NEVER creates a profile — an unknown name is an
 * ask-first error, exactly like person.update.
 *
 * amount is the deposit size (+1 routine touch · +5 meaningful · +10 major ·
 * negative for a withdrawal), clamped to ±AGENT_AMOUNT_CAP so a model-decided
 * swing can never reach the modal's ±100. source is "chat": the fact came in
 * through Nick; metadata.via says which writer.
 */
export async function handlePersonLogInteraction(params: ActionParams, type: string): Promise<ActionResult> {
  const name = String(params.name ?? "").trim();
  const note = String(params.note ?? "").trim();
  if (!note) {
    return {
      action: type,
      success: false,
      error: `person.logInteraction needs a note — one line saying what happened with ${name || "the person"}.`,
    };
  }
  const rawAmount = Number(params.amount ?? 1);
  const amount = Number.isFinite(rawAmount)
    ? Math.max(-AGENT_AMOUNT_CAP, Math.min(AGENT_AMOUNT_CAP, Math.trunc(rawAmount)))
    : 1;
  const kind = typeof params.kind === "string" && INTERACTION_KINDS.has(params.kind) ? params.kind : "other";

  const { resolvePersonByName } = await import("@/lib/brain/person-profile-fuzzy");
  const resolution = await resolvePersonByName(name, { createIfMissing: false });
  if (!resolution.matched || !resolution.person) {
    return {
      action: type,
      success: false,
      error:
        resolution.matchTier === "rejected_nonname"
          ? `"${name}" is not a real name — never log to a pronoun or descriptor. Use the person's actual name.`
          : `No existing person matches "${name}". Do not assume one. Ask Nour: "want me to add ${name} to your people?" — then use person.create only after a yes, and log the interaction after that.`,
    };
  }

  const { recordInteraction } = await import("@/lib/services/people/record-interaction");
  const recorded = await recordInteraction({
    personId: resolution.person.id,
    amount,
    note,
    source: "chat",
    metadata: { via: "nick_action", kind, matchTier: resolution.matchTier },
  });

  return {
    action: type,
    success: true,
    result: {
      id: recorded.personId,
      name: recorded.personName,
      ledgerId: recorded.ledgerId,
      amount: recorded.amount,
      note: recorded.note,
      kind,
      matchTier: resolution.matchTier,
      lastInteraction: recorded.lastInteraction ? recorded.lastInteraction.toISOString() : null,
      interactionCount: recorded.interactionCount,
    },
  };
}
