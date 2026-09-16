/**
 * The counters as a pure function of the ledger · 2026-09-16 (W6).
 *
 *   interactionCount = number of CONTACT rows (contact-rows.ts)
 *   lastInteraction  = newest contact row's createdAt, else null
 *
 * `deriveCounters` is the formula; `computeCounterDeltas` applies it to
 * every profile and says which ones drift. Two callers, one formula:
 * delete-ledger-row.ts (recompute one person after a delete) and
 * scripts/reconcile-person-counters.ts (correct every person, once, for the
 * years the counters had writers the ledger never saw).
 *
 * Measured on prod 2026-09-16, before the reconcile: 27 profiles, counts
 * summing to 200 against 15 contact rows; 20 profiles counted with zero rows
 * behind them; the largest lie 69 vs 4, its lastInteraction 2026-09-12
 * against a last contact row of 2026-06-04.
 */

import { isContactRow } from "./contact-rows";

export interface LedgerRowLite {
  createdAt: Date;
  metadata: unknown;
}

export interface LedgerRowWithPerson extends LedgerRowLite {
  personId: string;
}

export interface ProfileCounters {
  id: string;
  name: string;
  interactionCount: number;
  lastInteraction: Date | null;
}

export interface CounterTarget {
  interactionCount: number;
  lastInteraction: Date | null;
}

export interface CounterDelta {
  id: string;
  name: string;
  before: CounterTarget;
  after: CounterTarget;
  changed: boolean;
}

/** The formula. Non-contact rows are invisible to both numbers. */
export function deriveCounters(rows: readonly LedgerRowLite[]): CounterTarget {
  let interactionCount = 0;
  let lastInteraction: Date | null = null;
  for (const row of rows) {
    if (!isContactRow(row)) continue;
    interactionCount += 1;
    if (lastInteraction === null || row.createdAt.getTime() > lastInteraction.getTime()) {
      lastInteraction = row.createdAt;
    }
  }
  return { interactionCount, lastInteraction };
}

function sameInstant(a: Date | null, b: Date | null): boolean {
  return (a?.getTime() ?? null) === (b?.getTime() ?? null);
}

/** One delta per profile, in the profiles' order. A profile with no rows derives to 0 / null. */
export function computeCounterDeltas(
  profiles: readonly ProfileCounters[],
  rows: readonly LedgerRowWithPerson[],
): CounterDelta[] {
  const byPerson = new Map<string, LedgerRowLite[]>();
  for (const row of rows) {
    const list = byPerson.get(row.personId);
    if (list) list.push(row);
    else byPerson.set(row.personId, [row]);
  }
  return profiles.map((p) => {
    const before: CounterTarget = {
      interactionCount: p.interactionCount,
      lastInteraction: p.lastInteraction,
    };
    const after = deriveCounters(byPerson.get(p.id) ?? []);
    const changed =
      before.interactionCount !== after.interactionCount ||
      !sameInstant(before.lastInteraction, after.lastInteraction);
    return { id: p.id, name: p.name, before, after, changed };
  });
}
