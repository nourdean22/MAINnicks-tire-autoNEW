/**
 * lib/services/escalations.ts · cross-domain residuals slice
 * (2026-05-22 · legacy-modernizer REST→tRPC · chat cross-domain
 * residuals).
 *
 * The most-recent unresolved lead-escalation read · lifted verbatim
 * from app/api/brain/escalations/route.ts so the legacy REST endpoint
 * AND the new `brain.escalations` tRPC procedure call the SAME function
 * · drift between consumers structurally impossible.
 *
 * Returns an explicit, shallow `EscalationView` shape: the BrainMemory
 * `metadata` Json column is projected to `unknown` so the recursive
 * `JsonValue` type never reaches the AppRouter — the TS2589 firewall.
 */

import { prisma } from "@/lib/prisma";

/** The most-recent lead escalation · null when nothing's on fire. */
export interface EscalationView {
  escalation: {
    id: string;
    content: string;
    /** BrainMemory.metadata · `unknown` to keep the AppRouter shallow. */
    metadata: unknown;
    ageMinutes: number;
  } | null;
}

/**
 * Read the latest lead_escalation BrainMemory row from the last 6h. The
 * REST route and the tRPC `brain.escalations` procedure both call this.
 *
 * Fail-soft · a DB error resolves to `{ escalation: null }` (the legacy
 * route's `.catch(() => null)` behavior · the chat placeholder + HQ
 * banner just stay quiet).
 */
export async function getLatestEscalation(): Promise<EscalationView> {
  const recent = await prisma.brainMemory
    .findFirst({
      where: {
        category: "lead_escalation",
        createdAt: { gte: new Date(Date.now() - 6 * 60 * 60 * 1000) },
      },
      orderBy: { createdAt: "desc" },
      select: { id: true, content: true, metadata: true, createdAt: true },
    })
    .catch(() => null);

  if (!recent) return { escalation: null };

  return {
    escalation: {
      id: recent.id,
      content: recent.content,
      metadata: recent.metadata as unknown,
      ageMinutes: Math.round(
        (Date.now() - recent.createdAt.getTime()) / 60_000,
      ),
    },
  };
}
