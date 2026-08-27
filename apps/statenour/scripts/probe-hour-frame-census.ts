/**
 * Hour-frame key census — READ-ONLY probe. No writes.
 *
 * lib/brain/hour-frame.ts records the split: BrainMemory keys that embed an
 * hour were written from `new Date().getHours()` (UTC on Railway) before
 * #1809 merged at 2026-08-25T15:17:30Z, and from `hourET()` after. Nothing
 * on a row says which clock its key used; hourFrameMeta() stamps new rows
 * (`metadata.hourFrame = "et"`) but the marker is deliberately never
 * backfilled — absence means UTC-keyed.
 *
 * This probe counts each key family on both sides of that boundary (live
 * and soft-deleted separately — soft-deleted rows hide in bare counts) so
 * the mixed-frame report's numbers come from prod, not from the marker
 * module's 2026-08-26 snapshot.
 *
 * Run: pnpm exec tsx scripts/probe-hour-frame-census.ts
 */
import { prisma } from "@/lib/prisma";
import { HOUR_FRAME_BOUNDARY_ISO } from "@/lib/brain/hour-frame";

function dbHost(): string {
  try {
    return new URL(process.env.DATABASE_URL ?? "").host || "(unparseable)";
  } catch {
    return "(unset or unparseable)";
  }
}

const FAMILIES = [
  // Prefixes are mutually exclusive as written: startsWith("mood_") cannot
  // match a journal_mood_ key, so no cross-family exclusion is needed.
  { label: "journal_mood_{date}_{h}", prefix: "journal_mood_" },
  { label: "mood_{date}_{h}", prefix: "mood_" },
  { label: "booking_hour_{h}", prefix: "booking_hour_" },
  { label: "unanswered_leads_{date}_{h}", prefix: "unanswered_leads_" },
] as const;

async function main(): Promise<void> {
  console.log(`DB host: ${dbHost()}`);
  const boundary = new Date(HOUR_FRAME_BOUNDARY_ISO);
  console.log(`Boundary (#1809 merge): ${HOUR_FRAME_BOUNDARY_ISO}\n`);

  for (const fam of FAMILIES) {
    const base = { key: { startsWith: fam.prefix } };
    const [preLive, postLive, preDeleted, postDeleted, marked] =
      await Promise.all([
        prisma.brainMemory.count({
          where: { ...base, deletedAt: null, createdAt: { lt: boundary } },
        }),
        prisma.brainMemory.count({
          where: { ...base, deletedAt: null, createdAt: { gte: boundary } },
        }),
        prisma.brainMemory.count({
          where: { ...base, deletedAt: { not: null }, createdAt: { lt: boundary } },
        }),
        prisma.brainMemory.count({
          where: { ...base, deletedAt: { not: null }, createdAt: { gte: boundary } },
        }),
        prisma.brainMemory.count({
          where: {
            ...base,
            metadata: { path: ["hourFrame"], equals: "et" },
          },
        }),
      ]);
    console.log(
      `${fam.label.padEnd(30)} pre(UTC-keyed) live:${preLive} deleted:${preDeleted} · post(ET-keyed) live:${postLive} deleted:${postDeleted} · hourFrame-marked:${marked}`,
    );
  }

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
