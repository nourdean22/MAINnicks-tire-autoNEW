/**
 * /api/ai/relationships-morning-brief · Wave AB Phase 2 · 2026-05-28.
 *
 * 1-paragraph synthesis across the operator's active relationships ·
 * cached daily in BrainMemory(relationships_morning_brief). Mirrors
 * the /api/ai/missions-morning-brief shape from Wave AA.
 */

import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth-guard";
import { prisma } from "@/lib/prisma";
import { BRAIN_CATEGORIES } from "@/lib/brain/categories";
import { logger as rootLogger } from "@/lib/logger";

const log = rootLogger.withSurface("api/ai/relationships-morning-brief");

const SYSTEM_PROMPT = `You write a ONE PARAGRAPH morning relationships brief
for a personal-OS operator (3-5 sentences, max ~280 chars). Use ONLY the
data in the user block.

STRUCTURE:
  · sentence 1: where the operator stands across all their relationships
  · sentence 2-4: 2-3 specific people who need attention + why
  · final sentence: one concrete next move

CONSTRAINTS:
  · No headers, no lists, no markdown
  · Mention people by name · no generic phrasing
  · No motivational fluff
  · Return ONLY the paragraph`;

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    await requireSession(req);
  } catch {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const today = new Date().toISOString().slice(0, 10);

  // Cache read/write is owned by composeBrief below (AG-40).

  // Compose the user block from real data.
  const DAY_MS = 1000 * 60 * 60 * 24;
  let userBlock = "";
  try {
    const people = await prisma.personProfile.findMany({
      where: { deletedAt: null, status: { not: "blown_up" } },
      select: { id: true, name: true, role: true, lastInteraction: true, birthday: true },
      take: 30,
    });
    if (people.length === 0) {
      return NextResponse.json({ brief: "" });
    }

    const since30 = new Date(Date.now() - 30 * DAY_MS);
    const ledger = await prisma.relationshipLedger.findMany({
      where: { createdAt: { gte: since30 } },
      select: { personId: true, amount: true },
    });
    const ledgerByPerson = new Map<string, number>();
    for (const l of ledger) {
      ledgerByPerson.set(
        l.personId,
        (ledgerByPerson.get(l.personId) ?? 0) + l.amount,
      );
    }

    const promiseRows = await prisma.brainMemory.findMany({
      where: { category: BRAIN_CATEGORIES.KEPT_WORD },
      select: { metadata: true },
      take: 200,
    });
    const promisesByPerson = new Map<string, number>();
    for (const row of promiseRows) {
      const meta = (row.metadata as Record<string, unknown> | null) ?? {};
      const status = String(meta.status ?? "open");
      const pid = String(meta.personId ?? "");
      if (!pid || (status !== "open" && status !== "broken")) continue;
      promisesByPerson.set(pid, (promisesByPerson.get(pid) ?? 0) + 1);
    }

    const now = Date.now();
    const lines = people.slice(0, 30).map((p, i) => {
      const days = p.lastInteraction
        ? Math.floor((now - p.lastInteraction.getTime()) / DAY_MS)
        : null;
      const delta = ledgerByPerson.get(p.id) ?? 0;
      const open = promisesByPerson.get(p.id) ?? 0;
      const parts = [`${p.name} (${p.role})`];
      if (days !== null) parts.push(`silent:${days}d`);
      if (delta !== 0) parts.push(`ledger30:${delta > 0 ? "+" : ""}${delta}`);
      if (open > 0) parts.push(`promises:${open}`);
      if (p.birthday) parts.push(`bday:${p.birthday.slice(5)}`);
      return `${i + 1}. ${parts.join(" · ")}`;
    });
    userBlock = `ACTIVE PEOPLE (${people.length}):\n${lines.join("\n")}`;
  } catch (err) {
    log.warn("data_gather_failed", {
      err: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json({ brief: "" });
  }

  // AG-40 · compose + cache via the shared brief-composer.
  const { composeBrief } = await import("@/lib/ai/brief-composer");
  const brief = await composeBrief({
    label: "relationships-morning-brief",
    cacheCategory: BRAIN_CATEGORIES.RELATIONSHIPS_MORNING_BRIEF,
    cacheKey: today,
    systemPrompt: SYSTEM_PROMPT,
    signalBlock: userBlock,
    taskType: "reason",
    maxChars: 320,
  });

  return NextResponse.json({ brief });
}
