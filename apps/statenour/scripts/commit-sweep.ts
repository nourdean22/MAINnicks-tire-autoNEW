/**
 * Commitment sweep · v11.1
 *
 * Two cleanups:
 *   1. Anything active/in_progress & updated >14d ago → status='expired'
 *   2. Dedup near-identical descriptions (keep most recent) → 'expired'
 *
 * Nick's context was paraphrasing "10 commitments" back at Nour, but
 * most were chat-extractor noise (Continue conversation, date-night ×4).
 * Run this once to reset, then the live 7d-filter in system-prompt.ts
 * keeps things clean going forward.
 */
import { prisma } from "../lib/prisma";

const STALE_DAYS = 14;

(async () => {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - STALE_DAYS);

  // 1. Expire stale
  const staleRes = await prisma.commitment.updateMany({
    where: {
      status: { in: ["active", "in_progress"] },
      updatedAt: { lt: cutoff },
    },
    data: { status: "expired" },
  });
  console.log(`step 1 · expired ${staleRes.count} stale commitments (>${STALE_DAYS}d untouched)`);

  // 2. Dedup
  const remaining = await prisma.commitment.findMany({
    where: { status: { in: ["active", "in_progress"] } },
    orderBy: { updatedAt: "desc" },
    select: { id: true, description: true },
  });

  const seen = new Set<string>();
  const toExpire: string[] = [];
  for (const r of remaining) {
    const k = r.description.toLowerCase().trim().slice(0, 60);
    if (seen.has(k)) toExpire.push(r.id);
    else seen.add(k);
  }

  if (toExpire.length > 0) {
    await prisma.commitment.updateMany({
      where: { id: { in: toExpire } },
      data: { status: "expired" },
    });
  }
  console.log(`step 2 · expired ${toExpire.length} duplicate commitments`);

  // 3. Kill undated chat-artifact commitments older than 3d — these are
  //    paraphrases the extractor emitted from conversations. Real
  //    commitments have a deadline; these don't.
  const artifactCutoff = new Date();
  artifactCutoff.setDate(artifactCutoff.getDate() - 3);
  const artifactRes = await prisma.commitment.updateMany({
    where: {
      status: { in: ["active", "in_progress"] },
      deadline: null,
      createdAt: { lt: artifactCutoff },
    },
    data: { status: "expired" },
  });
  console.log(`step 3 · expired ${artifactRes.count} undated artifact commitments (>3d, no deadline)`);

  const stillActive = await prisma.commitment.count({
    where: { status: { in: ["active", "in_progress"] } },
  });
  console.log(`remaining active: ${stillActive}`);

  await prisma.$disconnect();
})();
