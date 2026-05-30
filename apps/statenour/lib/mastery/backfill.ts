/**
 * Mastery XP backfill · Slice 2 · 2026-05-30
 *
 * One-time (re-runnable) pass that credits XP from the operator's recent
 * UNSTRUCTURED history — chat messages, brain captures, logged decisions —
 * so the leveling board lights up from its honest zero instead of only
 * counting forward. Idempotent via creditStatXp's sourceKey, so re-running
 * never double-counts.
 *
 * Cost-bounded: `perSource` caps each source, so at most perSource×3 cheap
 * gpt-4o-mini calls. Sequential (no thundering herd on the AI provider).
 */
import "server-only";

import { prisma } from "@/lib/prisma";
import { attributeText } from "./attribution";
import { creditStatXp } from "./credit";
import type { MasterySignal } from "./leveling";

export interface BackfillResult {
  scanned: number;
  credited: number;
  xpAdded: number;
  byStat: Record<string, number>;
}

export async function backfillStatXp(perSource = 25): Promise<BackfillResult> {
  const res: BackfillResult = { scanned: 0, credited: 0, xpAdded: 0, byStat: {} };

  const [chats, captures, decisions] = await Promise.all([
    prisma.chatMessage
      .findMany({
        where: { role: "user" },
        orderBy: { createdAt: "desc" },
        take: perSource,
        select: { id: true, content: true },
      })
      .catch(() => [] as { id: string; content: string }[]),
    prisma.captureInboxItem
      .findMany({
        orderBy: { createdAt: "desc" },
        take: perSource,
        select: { id: true, title: true, summary: true },
      })
      .catch(() => [] as { id: string; title: string; summary: string }[]),
    prisma.masteryDecision
      .findMany({
        orderBy: { id: "desc" },
        take: perSource,
        select: { id: true, title: true, reasoning: true },
      })
      .catch(() => [] as { id: number; title: string; reasoning: string | null }[]),
  ]);

  const jobs: { text: string; signal: MasterySignal; sourceKey: string }[] = [
    ...chats.map((c) => ({ text: c.content, signal: "chat" as const, sourceKey: `chat:${c.id}` })),
    ...captures.map((c) => ({
      text: `${c.title}\n${c.summary}`,
      signal: "journal" as const,
      sourceKey: `capture:${c.id}`,
    })),
    ...decisions.map((d) => ({
      text: `${d.title}\n${d.reasoning ?? ""}`,
      signal: "decision" as const,
      sourceKey: `decision:${d.id}`,
    })),
  ];

  for (const j of jobs) {
    res.scanned++;
    const attr = await attributeText(j.text, j.signal);
    if (!attr) continue;
    const isNew = await creditStatXp({
      stat: attr.stat,
      xp: attr.xp,
      signal: j.signal,
      evidence: attr.evidence,
      sourceKey: j.sourceKey,
    });
    if (isNew) {
      res.credited++;
      res.xpAdded = Math.round((res.xpAdded + attr.xp) * 10) / 10;
      res.byStat[attr.stat] = Math.round(((res.byStat[attr.stat] ?? 0) + attr.xp) * 10) / 10;
    }
  }
  return res;
}
