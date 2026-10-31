/**
 * One maxim from his books under a relationship pick (people W3, 2026-10-30).
 *
 * The situation picks the tag: a draining relationship (ledger down 2+ in 30
 * days) gets "boundaries", his own judgment over other people's pressure; an
 * open promise gets "reputation" (keep your word); anything else gets "people".
 * Read through the existing pickMaximForDay, keyed by day AND person so two
 * picks on one day differ and a pick stays the same all day. No model call.
 */
import { MAXIM_POOL } from "@/lib/wisdom/maxim-pool";
import { pickMaximForDay, type Maxim } from "@/lib/wisdom/maxims";

export interface PickSituation {
  personId: string;
  ledgerDelta30d: number;
  brokenPromises: number;
  birthdayInDays: number | null;
}

export function maximTagForPick(s: PickSituation): "boundaries" | "reputation" | "people" {
  if (s.ledgerDelta30d <= -2) return "boundaries";
  if (s.brokenPromises > 0) return "reputation";
  return "people";
}

export function maximForPick(s: PickSituation, dayIso: string): Maxim | null {
  return pickMaximForDay(MAXIM_POOL, maximTagForPick(s), `${dayIso}:${s.personId}`);
}
