/**
 * lib/services/journal-calibrate.ts · Phase TT.2 (2026-05-22 ·
 * legacy-modernizer REST→tRPC journal slice).
 *
 * The memory-calibration read + write paths, extracted verbatim from
 * the /api/ultron/calibrate route handler so the legacy REST route and
 * the new `journal.calibrationSamples` / `journal.calibrate` tRPC
 * procedures call the SAME functions · drift structurally impossible.
 *
 * Calibration is the active half of the reflect → calibrate loop:
 * surface 1-3 aging high-confidence brain memories, let the operator
 * verify (confidence +0.1) · update (replace + reset to 0.8) · or
 * retire (soft-delete via expiresAt). Reflections are the NEW
 * observations; calibration re-weights the OLD beliefs.
 */

import { prisma } from "@/lib/prisma";
import { daysAgo } from "@/lib/utils/datetime";
import { ServiceError } from "@/lib/utils/service-error";
import type { CalibrationRulingInput } from "@/lib/validators/journal";

export interface MemorySample {
  id: string;
  category: string;
  key: string;
  content: string;
  confidence: number;
  ageDays: number;
  seenCount: number;
  source: string | null;
}

const CALIBRATABLE_CATEGORIES = [
  "pattern",
  "insight",
  "preference",
  "feedback",
  "wisdom",
  "rule",
  "routine",
  "identity",
];

/**
 * Pick 1-3 high-confidence aging brain memories for the operator to
 * re-rule. Selection biases toward memories that could plausibly be
 * stale (createdAt > 30d OR lastSeen > 14d · confidence > 0.6 · in a
 * calibratable category). Deterministic per-day shuffle so a refresh
 * doesn't churn the picks. Mirrors the legacy GET handler exactly.
 */
export async function getCalibrationSamples(): Promise<{
  samples: MemorySample[];
  generatedAt: string;
}> {
  const now = Date.now();
  // Two candidate pools — combine and pick 3 diverse ones.
  const [agedMemories, staleSeen] = await Promise.all([
    prisma.brainMemory
      .findMany({
        where: {
          category: { in: CALIBRATABLE_CATEGORIES },
          confidence: { gte: 0.6 },
          createdAt: { lte: daysAgo(30) },
          OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
        },
        orderBy: { confidence: "desc" },
        take: 30,
        select: {
          id: true,
          category: true,
          key: true,
          content: true,
          confidence: true,
          createdAt: true,
          seenCount: true,
          source: true,
          lastSeen: true,
        },
      })
      .catch(() => []),
    prisma.brainMemory
      .findMany({
        where: {
          category: { in: CALIBRATABLE_CATEGORIES },
          confidence: { gte: 0.6 },
          lastSeen: { lte: daysAgo(14) },
          OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
        },
        orderBy: { lastSeen: "asc" },
        take: 20,
        select: {
          id: true,
          category: true,
          key: true,
          content: true,
          confidence: true,
          createdAt: true,
          seenCount: true,
          source: true,
          lastSeen: true,
        },
      })
      .catch(() => []),
  ]);

  // Dedupe + pick up to 3 with category diversity.
  const seenIds = new Set<string>();
  const all = [...agedMemories, ...staleSeen].filter((m) => {
    if (seenIds.has(m.id)) return false;
    seenIds.add(m.id);
    return true;
  });

  // Shuffle lightly (deterministic per-day so refresh doesn't churn).
  const todaySeed = Math.floor(Date.now() / 86_400_000);
  all.sort((a, b) => {
    const ah = (a.id + todaySeed)
      .split("")
      .reduce((s, c) => s + c.charCodeAt(0), 0);
    const bh = (b.id + todaySeed)
      .split("")
      .reduce((s, c) => s + c.charCodeAt(0), 0);
    return ah - bh;
  });

  const picks: typeof all = [];
  const usedCategories = new Set<string>();
  for (const m of all) {
    if (picks.length >= 3) break;
    if (!usedCategories.has(m.category)) {
      picks.push(m);
      usedCategories.add(m.category);
    }
  }
  // Fill remaining slots without category dedup if needed.
  for (const m of all) {
    if (picks.length >= 3) break;
    if (!picks.includes(m)) picks.push(m);
  }

  const samples: MemorySample[] = picks.map((m) => ({
    id: m.id,
    category: m.category,
    key: m.key,
    content: m.content,
    confidence: m.confidence,
    ageDays: Math.floor((now - m.createdAt.getTime()) / 86_400_000),
    seenCount: m.seenCount,
    source: m.source,
  }));

  return { samples, generatedAt: new Date().toISOString() };
}

/**
 * Apply one calibration ruling to a brain memory. Mirrors the legacy
 * PATCH handler exactly:
 *   verify → confidence += 0.1 (max 1.0), lastSeen = now, seenCount++
 *   update → content replaced, confidence = 0.8, lastSeen = now
 *   retire → expiresAt = now (soft-delete · memory stops surfacing)
 *
 * Throws ServiceError(404) when the memory is gone and ServiceError(400)
 * when an `update` ruling omits `newContent` · both transports map
 * those to the matching status / TRPC code.
 */
export async function applyCalibration(
  input: CalibrationRulingInput,
): Promise<{ ok: true; action: "verified" | "updated" | "retired" }> {
  const existing = await prisma.brainMemory
    .findUnique({ where: { id: input.id } })
    .catch(() => null);
  if (!existing) {
    throw new ServiceError("not found", 404);
  }

  if (input.action === "verify") {
    await prisma.brainMemory.update({
      where: { id: input.id },
      data: {
        confidence: Math.min(1.0, existing.confidence + 0.1),
        seenCount: existing.seenCount + 1,
        lastSeen: new Date(),
      },
    });
    return { ok: true, action: "verified" };
  }

  if (input.action === "update") {
    const newContent = (input.newContent ?? "").trim();
    if (!newContent) {
      throw new ServiceError("newContent required for update", 400);
    }
    await prisma.brainMemory.update({
      where: { id: input.id },
      data: {
        content: newContent,
        confidence: 0.8,
        seenCount: existing.seenCount + 1,
        lastSeen: new Date(),
      },
    });
    return { ok: true, action: "updated" };
  }

  // input.action === "retire"
  await prisma.brainMemory.update({
    where: { id: input.id },
    data: { expiresAt: new Date() },
  });
  return { ok: true, action: "retired" };
}
