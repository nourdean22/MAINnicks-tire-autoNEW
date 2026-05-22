/**
 * Memory-of-the-day service · Phase UU.2 (2026-05-22 · legacy-modernizer
 * REST→tRPC settings slice).
 *
 * Lifted verbatim from `app/api/brain/memory-of-the-day/route.ts` so the
 * legacy REST endpoint AND the new `brain.memoryOfTheDay` procedure call
 * the same function · drift between consumers structurally impossible.
 *
 * Returns ONE memory worth surfacing today · weighted-random over
 * high-confidence rows in curated categories · idempotent for the day
 * (persists the pick keyed YYYY-MM-DD so refreshes don't reshuffle).
 */

import { prisma } from "@/lib/prisma";

const PICK_MARKER_CATEGORY = "memory_of_day_pick";
const SURFACE_CATEGORIES = [
  "wisdom",
  "insight",
  "pattern",
  "blind_spot",
  "strategic_plan",
  "qualitative_identity",
  "decision_pattern",
  "nick_advice",
  "counter_intuitive",
  "meta_pattern",
];

interface PickRow {
  id: string;
  category: string;
  key: string;
  content: string;
  confidence: number;
  last_seen: Date;
  created_at: Date;
}

/** Pick (or re-return) today's surfaced memory. */
export async function getMemoryOfTheDay() {
  const dayKey = new Date().toISOString().slice(0, 10);

  // Idempotent for the day — return same pick if already chosen.
  const existing = await prisma.brainMemory.findUnique({
    where: { category_key: { category: PICK_MARKER_CATEGORY, key: dayKey } },
    select: { content: true, metadata: true },
  });
  if (existing) {
    try {
      const meta = existing.metadata as
        | { memoryId?: string; pickedAt?: string }
        | null;
      if (meta?.memoryId) {
        const mem = await prisma.brainMemory.findUnique({
          where: { id: meta.memoryId },
          select: {
            id: true,
            category: true,
            key: true,
            content: true,
            confidence: true,
            lastSeen: true,
            createdAt: true,
          },
        });
        if (mem) {
          return {
            dayKey,
            pickedAt: meta.pickedAt,
            memory: {
              id: mem.id,
              category: mem.category,
              key: mem.key,
              content: mem.content,
              confidence: mem.confidence,
              lastSeen: mem.lastSeen.toISOString(),
              createdAt: mem.createdAt.toISOString(),
              ageDays: Math.floor(
                (Date.now() - mem.createdAt.getTime()) / 86_400_000,
              ),
            },
            cached: true,
          };
        }
      }
    } catch {
      // fall through to re-pick
    }
  }

  // Pull weighted-random pick.
  const rows = await prisma.$queryRawUnsafe<PickRow[]>(
    `
      SELECT id::text,
             category::text,
             key::text,
             content::text,
             confidence::float,
             last_seen,
             created_at
      FROM brain_memories
      WHERE deleted_at IS NULL
        AND confidence >= 0.5
        AND category = ANY($1::text[])
      ORDER BY (
          confidence
          + CASE WHEN expires_at IS NULL THEN 0.2 ELSE 0 END
          + CASE WHEN last_seen >= NOW() - INTERVAL '30 days' THEN 0.15 ELSE 0 END
        ) * random()
        DESC
      LIMIT 1
    `,
    SURFACE_CATEGORIES,
  );

  if (rows.length === 0) {
    return {
      dayKey,
      memory: null,
      note: "no qualifying memory (confidence>=0.5 in surface categories)",
    };
  }

  const pick = rows[0];
  const pickedAt = new Date().toISOString();

  // Persist the day's pick so subsequent calls return the same one.
  await prisma.brainMemory
    .upsert({
      where: {
        category_key: { category: PICK_MARKER_CATEGORY, key: dayKey },
      },
      create: {
        category: PICK_MARKER_CATEGORY,
        key: dayKey,
        content: `Pick: [${pick.category}] ${pick.key}`,
        confidence: 1.0,
        source: "api:memory-of-the-day",
        metadata: { memoryId: pick.id, pickedAt },
      },
      update: {
        content: `Pick: [${pick.category}] ${pick.key}`,
        metadata: { memoryId: pick.id, pickedAt },
      },
    })
    .catch(() => {});

  return {
    dayKey,
    pickedAt,
    memory: {
      id: pick.id,
      category: pick.category,
      key: pick.key,
      content: pick.content,
      confidence: pick.confidence,
      lastSeen: pick.last_seen.toISOString(),
      createdAt: pick.created_at.toISOString(),
      ageDays: Math.floor((Date.now() - pick.created_at.getTime()) / 86_400_000),
    },
    cached: false,
  };
}
