/**
 * Person action handler (person.update).
 *
 * Extracted VERBATIM from lib/ai/nick-agent.ts executeAction (2026-06-02
 * structural split). The C1 suggest-then-approve gate (role/trust →
 * pendingClassification) was just fixed (2026-06-02) and is moved
 * byte-identically — Nick must NEVER silently reclassify a person.
 */
import { prisma } from "@/lib/prisma";
import { today } from "@/lib/utils/datetime";
import type { ActionParams, ActionResult } from "./types";

export async function handlePersonUpdate(params: ActionParams, type: string): Promise<ActionResult> {
  // 2026-05-27 · routed through fuzzy resolver (lib/brain/person-profile-fuzzy)
  // to prevent typo dupes. If the AI types "Danai" but operator already
  // has "Dania", the resolver finds the existing row via Levenshtein
  // ≤1 instead of creating a ghost.
  const { resolvePersonByName } = await import("@/lib/brain/person-profile-fuzzy");
  const resolution = await resolvePersonByName(String(params.name), {
    role: String(params.role || "unknown"),
    relationship: String(params.relationship || ""),
    trustScore: Number(params.trustScore ?? 0.5),
  });
  // Apply any explicit field updates from the tool call · matched or created.
  if (resolution.matched) {
    // 2026-06-02 · C1 fix · honor the suggest-then-approve gate.
    // relationship / leverageNotes / interaction are low-risk →
    // write immediately. But role + trustScore reclassify a person
    // the operator may have curated → route them into
    // pendingClassification (same shape as people-intelligence.ts
    // writes + task.acceptClassification reads) so Nick can NEVER
    // silently overwrite a role/trust; the operator approves on /people.
    const current = await prisma.personProfile.findUnique({
      where: { id: resolution.person.id },
      select: { role: true, trustScore: true },
    });
    const { isPersonRole } = await import("@/lib/brain/person-roles");

    // Immediate (low-risk) writes.
    await prisma.personProfile.update({
      where: { id: resolution.person.id },
      data: {
        ...(params.relationship ? { relationship: String(params.relationship) } : {}),
        ...(params.leverageNotes ? { leverageNotes: String(params.leverageNotes) } : {}),
        interactionCount: { increment: 1 },
        lastInteraction: new Date(),
      },
    });

    // Build a role/trust PROPOSAL (never a live write).
    const requestedRole = params.role ? String(params.role) : null;
    const suggestedRole =
      requestedRole && isPersonRole(requestedRole) && requestedRole !== current?.role
        ? requestedRole
        : null;
    let trustAdjustment = 0;
    if (params.trustScore != null && current) {
      const rawAdj = Number(params.trustScore) - current.trustScore;
      trustAdjustment = Number.isFinite(rawAdj)
        ? Math.max(-0.1, Math.min(0.1, rawAdj))
        : 0;
    }

    let pendingProposed = false;
    if (suggestedRole || trustAdjustment !== 0) {
      await prisma.personProfile.update({
        where: { id: resolution.person.id },
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
        id: resolution.person.id,
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
  } else if (params.leverageNotes) {
    // Created path · resolvePersonByName doesn't accept leverageNotes · set if provided.
    await prisma.personProfile.update({
      where: { id: resolution.person.id },
      data: { leverageNotes: String(params.leverageNotes) },
    });
  }
  return { action: type, success: true, result: { id: resolution.person.id, name: resolution.person.name, matched: resolution.matched, matchTier: resolution.matchTier } };
}
