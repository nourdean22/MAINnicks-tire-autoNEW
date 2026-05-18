/**
 * Wisdom Violation Scoring · v10.0.399
 *
 * Per direction B5 · which wisdoms does the operator most often act
 * AGAINST. The advice you keep ignoring is often the advice you most
 * need surfaced. Anders Ericsson's deliberate-practice principle ·
 * the gap between knowing and doing is where growth lives.
 *
 * APPROACH
 *   1. For each wisdom · extract action-shape (don't X / always Y / never Z / threshold ≥N)
 *   2. Pull the operator's recent action stream:
 *      · ChatMessage · last 7 days · all user turns
 *      · Task creates / completions · last 7 days
 *      · Decisions · last 7 days
 *      · Journal entries · last 7 days
 *   3. Run wisdom-distiller's violationRate() helper against the corpus
 *   4. Rank wisdoms by violation rate · top 10 surfaced
 *
 * The result · "wisdoms I keep ignoring" surfaced as callouts on the
 * /brain/wisdom dashboard. Operator can either re-internalize or
 * deprecate (this advice doesn't fit your situation).
 */

import { prisma } from "@/lib/prisma";
import { violationRate } from "@/lib/brain/wisdom-distiller";
import { BRAIN_CATEGORIES } from "@/lib/brain/categories";

export interface WisdomViolation {
  id: string;
  key: string;
  content: string;
  origin: string;
  violationRate: number;
  matches: string[];
  source: string;
  confidence: number;
  /** Total checks the violation detector ran (denominator for rate). */
  totalChecks: number;
}

interface ActionWindow {
  since: Date;
  text: string;
}

async function buildActionWindow(daysBack: number): Promise<ActionWindow> {
  const since = new Date(Date.now() - daysBack * 86_400_000);

  const [chats, tasks, decisions, journals] = await Promise.all([
    prisma.chatMessage.findMany({
      where: { createdAt: { gte: since }, role: "user" },
      select: { content: true },
      take: 200,
    }).catch((): Array<{ content: string }> => []),
    prisma.task.findMany({
      where: { createdAt: { gte: since } },
      select: { title: true, nextPhysicalAction: true, status: true },
      take: 100,
    }).catch((): Array<{ title: string; nextPhysicalAction: string; status: string }> => []),
    prisma.brainMemory.findMany({
      where: {
        category: { in: ["decision_manual", "decision_log"] },
        createdAt: { gte: since },
        deletedAt: null,
      },
      select: { content: true },
      take: 50,
    }).catch((): Array<{ content: string }> => []),
    prisma.brainMemory.findMany({
      where: {
        category: { in: ["journal", "brain_dump", "reflection"] },
        createdAt: { gte: since },
        deletedAt: null,
      },
      select: { content: true },
      take: 50,
    }).catch((): Array<{ content: string }> => []),
  ]);

  const parts: string[] = [];
  for (const c of chats) parts.push(c.content);
  for (const t of tasks) {
    parts.push(`${t.title} · ${t.nextPhysicalAction} · status:${t.status}`);
  }
  for (const d of decisions) parts.push(d.content);
  for (const j of journals) parts.push(j.content);

  return {
    since,
    text: parts.join(" · ").slice(0, 50_000), // cap so violationRate stays fast
  };
}

interface MetadataLike {
  origin?: string;
}

/**
 * Compute violation rates for all wisdoms vs the operator's recent
 * action stream. Returns wisdoms ranked by rate descending.
 */
export async function computeWisdomViolations(opts: { daysBack?: number; limit?: number } = {}): Promise<WisdomViolation[]> {
  const daysBack = opts.daysBack ?? 7;
  const limit = opts.limit ?? 10;

  const window = await buildActionWindow(daysBack);
  if (window.text.length < 100) return [];

  const wisdoms = await prisma.brainMemory.findMany({
    where: { category: BRAIN_CATEGORIES.WISDOM, deletedAt: null, confidence: { gte: 0.5 } },
    select: { id: true, key: true, content: true, source: true, confidence: true, metadata: true },
    take: 500, // upper bound · ~241 curated + plenty of headroom
  });

  const violations: WisdomViolation[] = [];
  for (const w of wisdoms) {
    const result = violationRate(w.content, window.text);
    if (result.matches.length === 0) continue;
    const meta = (w.metadata ?? {}) as MetadataLike;
    violations.push({
      id: w.id,
      key: w.key,
      content: w.content,
      origin: meta.origin ?? inferOriginFromKey(w.key),
      violationRate: result.rate,
      matches: result.matches,
      source: w.source,
      confidence: w.confidence,
      totalChecks: result.matches.length, // matches IS the count of detected violations
    });
  }

  violations.sort((a, b) => b.violationRate - a.violationRate);
  return violations.slice(0, limit);
}

function inferOriginFromKey(key: string): string {
  if (key.startsWith("wisdom_jobs_")) return "steve-jobs";
  if (key.startsWith("wisdom_satori_")) return "satori";
  if (key.startsWith("wisdom_buffett_")) return "warren-buffett";
  if (key.startsWith("wisdom_gates_")) return "bill-gates";
  if (key.startsWith("wisdom_musk_")) return "elon-musk";
  if (key.startsWith("wisdom_greene_")) return "greene-laws";
  if (key.startsWith("wisdom_distilled_")) return "distiller";
  if (key.startsWith("wisdom_from_")) return "consolidation";
  return "uncategorized";
}
