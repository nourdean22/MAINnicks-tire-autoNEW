/**
 * What changed among the operator's people since they last looked ·
 * 2026-09-16 (the ChangeSet primitive's third consumer, spec §3.7 / §5).
 *
 * Same contract as Home's briefChanges and Brain's changesSince: a cursor,
 * the 7-day clamp said out loud, every count a claim a query returned, every
 * failed query NAMED in `failedSources` rather than zeroed.
 *
 * Three claims, each a change and not a read:
 *   · new people          createdAt ≥ since on live rows.
 *   · interactions logged relationship_ledger rows with createdAt ≥ since —
 *                         every source (gmail, calendar, chat, telegram,
 *                         manual, auto, greene_play) counts alike.
 *   · went overdue        an ACTIVE person with a cadence whose
 *                         lastInteraction + cadenceDays crossed into the
 *                         window — the threshold fell between since and now,
 *                         so it is news; a person overdue since before the
 *                         visit is not (the watchlist already carries them).
 *
 * Measured base rates before building (Neon, 2026-09-16): 20 active people,
 * 0 with cadenceDays, 23 ledger rows total, the last on 2026-07-10 — so the
 * line was SILENT in production. The ledger silence was the finding, not the
 * line: the same day the ledger got one writer (record-interaction.ts) fed by
 * the modal / ⌘K, Telegram /log, Nick's person.logInteraction, the picks
 * outreach button and digest-extracted interactions, so "interactions logged"
 * now has a producer. "went overdue" stays silent until a cadence is set —
 * that silence is the honest render of "nothing changed", not a bug.
 */

import { prisma } from "@/lib/prisma";
import { activeOnly } from "@/lib/db/soft-delete";
import { clampSince, type ChangeSet } from "@/lib/ui/change-cursor";
import { contactRowsOnly } from "@/lib/services/people/contact-rows";

const DAY_MS = 86_400_000;

async function guarded<T>(p: Promise<T>): Promise<T | null> {
  try {
    return await p;
  } catch {
    return null;
  }
}

/** Pure: how many (lastInteraction, cadenceDays) pairs crossed their threshold inside (since, now]. */
export function countWentOverdue(
  rows: ReadonlyArray<{ lastInteraction: Date | null; cadenceDays: number | null }>,
  sinceMs: number,
  nowMs: number,
): number {
  let n = 0;
  for (const r of rows) {
    if (!r.lastInteraction || !r.cadenceDays || r.cadenceDays <= 0) continue;
    const dueAt = r.lastInteraction.getTime() + r.cadenceDays * DAY_MS;
    if (dueAt > sinceMs && dueAt <= nowMs) n += 1;
  }
  return n;
}

export async function buildPeopleChangesSince(sinceMsRaw: number, now = new Date()): Promise<ChangeSet> {
  const { since: sinceMs, clamped } = clampSince(sinceMsRaw, now.getTime());
  const since = new Date(sinceMs);

  const [created, logged, cadenceRows] = await Promise.all([
    guarded(prisma.personProfile.count({ where: activeOnly({ createdAt: { gte: since } }) })),
    // CONTACT rows only (W8): the line renders as "interactions logged", so a
    // status-flip audit row must not count as an interaction. Counted in TS
    // rather than SQL — a Prisma JSON filter drops NULL metadata, which is
    // most rows (contact-rows.ts).
    guarded(
      prisma.relationshipLedger
        .findMany({ where: { createdAt: { gte: since } }, select: { metadata: true } })
        .then((rows) => contactRowsOnly(rows).length),
    ),
    guarded(
      prisma.personProfile.findMany({
        where: activeOnly({ status: "active", cadenceDays: { not: null }, lastInteraction: { not: null } }),
        select: { lastInteraction: true, cadenceDays: true },
      }),
    ),
  ]);

  const failedSources: string[] = [];
  const parts: ChangeSet["parts"] = [];
  const push = (label: string, v: number | null, source: string) => {
    if (v === null) failedSources.push(source);
    else if (v > 0) parts.push({ label, count: v });
  };
  push("new people", created, "new people");
  push("interactions logged", logged, "interactions logged");
  push("went overdue", cadenceRows === null ? null : countWentOverdue(cadenceRows, sinceMs, now.getTime()), "went overdue");

  return {
    since: sinceMs,
    clamped,
    parts,
    failedSources,
    // No error-log read on this surface: "no recorded errors" is not claimable here.
    errors: { measured: false, count: 0 },
  };
}
