/**
 * Decay — natural degradation for unreinforced skills + beliefs.
 * Apr 19.
 *
 * Without decay, the brain library just accumulates dead weight. Any
 * skill/belief that hasn't been touched in a while should drift
 * toward lower confidence so the system stops citing it in chat.
 * Nour can always drop it manually from /brain — decay is the silent
 * half of the loop.
 *
 * Rules:
 *   - Active skills: if last_fired > 21d ago AND not graduated,
 *     subtract 0.05 from confidence per week past 21d, min 0.15.
 *     Below 0.25 → flag as "decay_candidate" in review_note.
 *   - Active beliefs: if updatedAt > 45d ago, subtract 0.03/week,
 *     min 0.2.
 *   - Graduated skills and manually-pinned beliefs never decay.
 *
 * Runs inside the daily refresh-identity cron. Returns counts so the
 * cron can emit a brain_insight when anything significant decayed.
 */

import { prisma } from "@/lib/prisma";
import type { Skill } from "./skill-extractor";
import type { Belief } from "./belief-harvester";
import { BRAIN_CATEGORIES } from "@/lib/brain/categories";

export interface DecaySummary {
  skills_decayed: number;
  skills_flagged: number;
  beliefs_decayed: number;
  evaluated_at: string;
}

export async function runDecay(): Promise<DecaySummary> {
  const now = new Date();
  let skillsDecayed = 0;
  let skillsFlagged = 0;
  let beliefsDecayed = 0;

  // ── Skills ──────────────────────────────────────────────
  // v10.0.46 — added `deletedAt: null` filter. Pre-fix decay would
  // mutate confidence on soft-deleted skill rows, soft-resurrecting
  // them by changing values that gate `loadCategory()` visibility.
  const activeSkillRows = await prisma.brainMemory
    .findMany({
      where: { category: BRAIN_CATEGORIES.SKILL, deletedAt: null },
      select: { id: true, key: true, content: true, confidence: true },
    })
    .catch(() => []);

  for (const r of activeSkillRows) {
    try {
      const s = JSON.parse(r.content) as Skill;
      if (s.graduated) continue;
      if (!s.last_fired) continue;
      const daysIdle = (now.getTime() - new Date(s.last_fired).getTime()) / 86400_000;
      if (daysIdle <= 21) continue;

      const weeksOver = Math.floor((daysIdle - 21) / 7);
      const decayAmount = weeksOver * 0.05;
      const newConfidence = Math.max(0.15, r.confidence - decayAmount);

      if (newConfidence < r.confidence - 0.01) {
        const updates: any = { confidence: newConfidence, lastSeen: now };
        if (newConfidence < 0.25) {
          const updatedSkill: Skill = {
            ...s,
            review_note: `${s.review_note ? s.review_note + " · " : ""}decay_candidate @ ${now.toISOString().slice(0, 10)}`,
            updated_at: now.toISOString(),
          };
          updates.content = JSON.stringify(updatedSkill);
          skillsFlagged++;
        }
        await prisma.brainMemory
          .update({
            where: { category_key: { category: BRAIN_CATEGORIES.SKILL, key: r.key } },
            data: updates,
          })
          .catch(() => {});
        skillsDecayed++;
      }
    } catch {
      // skip
    }
  }

  // ── Beliefs ─────────────────────────────────────────────
  // v10.0.46 — added `deletedAt: null` filter (same class of bug as
  // the skills query above).
  const beliefRows = await prisma.brainMemory
    .findMany({
      where: { category: BRAIN_CATEGORIES.BELIEF, deletedAt: null },
      select: { id: true, key: true, content: true, confidence: true, updatedAt: true },
    })
    .catch(() => []);

  for (const r of beliefRows) {
    try {
      const b = JSON.parse(r.content) as Belief;
      // Skip manually-rewritten beliefs — they're pinned on purpose
      if (b.overridden) continue;

      const daysIdle = (now.getTime() - r.updatedAt.getTime()) / 86400_000;
      if (daysIdle <= 45) continue;

      const weeksOver = Math.floor((daysIdle - 45) / 7);
      const decayAmount = weeksOver * 0.03;
      const newConfidence = Math.max(0.2, r.confidence - decayAmount);
      if (newConfidence < r.confidence - 0.01) {
        await prisma.brainMemory
          .update({
            where: { category_key: { category: BRAIN_CATEGORIES.BELIEF, key: r.key } },
            data: { confidence: newConfidence, lastSeen: now },
          })
          .catch(() => {});
        beliefsDecayed++;
      }
    } catch {
      // skip
    }
  }

  return {
    skills_decayed: skillsDecayed,
    skills_flagged: skillsFlagged,
    beliefs_decayed: beliefsDecayed,
    evaluated_at: now.toISOString(),
  };
}
