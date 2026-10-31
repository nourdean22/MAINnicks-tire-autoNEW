/**
 * The update the /people "accept suggestion" mutation writes (people W2, 2026-10-30).
 *
 * Moved out of lib/trpc/routers/task/power-atlas.ts acceptClassification so the
 * rules are testable; W2 adds the proposed cadence. His accept is the only
 * thing that ever writes these fields from a suggestion.
 */
import { isPersonRole } from "@/lib/brain/person-roles";

export interface PendingClassification {
  role?: string | null;
  leverageNotes?: string | null;
  trustAdjustment?: number;
  /** People W2: a proposed cadence in days. */
  cadenceDays?: number;
}

export function acceptClassificationData(pc: PendingClassification | null, trustScore: number): Record<string, unknown> {
  const data: Record<string, unknown> = { pendingClassification: null };
  if (!pc) return data;
  if (pc.role && isPersonRole(pc.role)) data.role = pc.role;
  if (pc.leverageNotes && pc.leverageNotes.trim()) data.leverageNotes = pc.leverageNotes.trim().slice(0, 2000);
  if (Number.isFinite(pc.trustAdjustment) && pc.trustAdjustment !== 0) {
    data.trustScore = Math.max(0, Math.min(1, trustScore + (pc.trustAdjustment as number)));
  }
  if (Number.isInteger(pc.cadenceDays) && (pc.cadenceDays as number) >= 1 && (pc.cadenceDays as number) <= 365) {
    data.cadenceDays = pc.cadenceDays;
  }
  return data;
}
