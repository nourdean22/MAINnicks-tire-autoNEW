/**
 * What changed in Nick's head since the operator last looked · 2026-09-15
 * (wave 3, the ChangeSet primitive's second consumer).
 *
 * The continuity report answers "since yesterday" with fixed 24h / 7d
 * buckets. This answers "since YOUR last visit", cursor-based, the way
 * Home's briefChanges does — same clamp (7d, said out loud), same honesty:
 * every count is a claim a query returned, every failed query is NAMED in
 * `failedSources` rather than zeroed.
 *
 * Three claims, each with a reason it is a change and not a read:
 *   · new       createdAt ≥ since — a row that did not exist last visit.
 *   · reinforced lastSeen ≥ since AND createdAt < since — an OLD row seen
 *               again; `updatedAt` is not used because recall bumps it on
 *               every wisdom hit (lib/brain/contextual-recall.ts), which
 *               would make reading a memory count as change.
 *   · tombstoned deletedAt ≥ since — the sweep's and the operator's soft
 *               deletes alike (brain-continuity.ts `prunedLast24h` doctrine).
 * The gateway's shadow-write channel is machine telemetry, not memory in the
 * operator's sense, and is excluded (2026-09-01 brain-deletion postmortem).
 */

import { prisma } from "@/lib/prisma";
import { activeOnly } from "@/lib/db/soft-delete";
import { clampSince, type ChangeSet } from "@/lib/ui/change-cursor";

const SHADOW_CATEGORIES = ["memory_gateway_shadow"];

async function guarded<T>(p: Promise<T>): Promise<T | null> {
  try {
    return await p;
  } catch {
    return null;
  }
}

export async function buildBrainChangesSince(sinceMsRaw: number, now = new Date()): Promise<ChangeSet> {
  const { since: sinceMs, clamped } = clampSince(sinceMsRaw, now.getTime());
  const since = new Date(sinceMs);

  const [created, reinforced, tombstoned] = await Promise.all([
    guarded(
      prisma.brainMemory.count({
        where: activeOnly({ createdAt: { gte: since }, category: { notIn: SHADOW_CATEGORIES } }),
      }),
    ),
    guarded(
      prisma.brainMemory.count({
        where: activeOnly({ lastSeen: { gte: since }, createdAt: { lt: since }, category: { notIn: SHADOW_CATEGORIES } }),
      }),
    ),
    guarded(prisma.brainMemory.count({ where: { deletedAt: { gte: since } } })),
  ]);

  const failedSources: string[] = [];
  const parts: ChangeSet["parts"] = [];
  const push = (label: string, v: number | null, source: string) => {
    if (v === null) failedSources.push(source);
    else if (v > 0) parts.push({ label, count: v });
  };
  push("new memories", created, "new memories");
  push("reinforced", reinforced, "reinforced");
  push("tombstoned", tombstoned, "tombstoned");

  return {
    since: sinceMs,
    clamped,
    parts,
    failedSources,
    // No error-log read on this surface: the "no recorded errors" claim is
    // Home's, and only when Home measured it.
    errors: { measured: false, count: 0 },
  };
}
