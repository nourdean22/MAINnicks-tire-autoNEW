/**
 * GET /api/cron/relationship-weekly-synthesis · Wave AB Phase 3 · 2026-05-28.
 *
 * Sunday-night cron · DIFFERENT from relationship-digest (which is the
 * Greene-voiced Telegram push). This one writes a 3-paragraph synthesis
 * of the week's relationship MOVEMENT (deposits · withdrawals · alpha
 * moments · stalled) to:
 *
 *   1. BrainMemory(RELATIONSHIPS_WEEKLY_SYNTHESIS, key=YYYY-WNN) ·
 *      the canonical record · feeds Nick's future picks/brief
 *   2. BrainMemory(JOURNAL, key=relationships_synthesis_<week>) so the
 *      /journal surface picks it up automatically
 *
 * Idempotent · already-written ISO week skips silently.
 */

import { cronHandler } from "@/lib/utils/http";
import { prisma } from "@/lib/prisma";
import { BRAIN_CATEGORIES } from "@/lib/brain/categories";
import { tracedAiChat } from "@/lib/ai/traced-aichat";

const DAY_MS = 1000 * 60 * 60 * 24;

function isoWeek(d: Date): string {
  // YYYY-WNN · ISO week number with leading zero. wave-AB-audit · use
  // UTC accessors throughout so the result doesn't shift by timezone
  // (pre-fix `d.getFullYear/Month/Date` read LOCAL · a Jan 5 UTC input
  // in a US-East runner reported as Jan 4 → wrong week).
  const date = new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()),
  );
  const dayNum = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil(
    ((date.getTime() - yearStart.getTime()) / DAY_MS + 1) / 7,
  );
  return `${date.getUTCFullYear()}-W${String(weekNo).padStart(2, "0")}`;
}

const SYSTEM_PROMPT = `You are an operator's personal-OS coach. Write a
3-paragraph synthesis of the past WEEK in their relationship life. Use
ONLY the data in the user block.

PARAGRAPH 1: where the operator stood at the start vs end of the week.
   Cite specific people + concrete deltas.
PARAGRAPH 2: the strongest pattern Nick noticed (e.g. 3 missions stalled
   on the same kind of friction, or one mentor showed up disproportionately).
PARAGRAPH 3: the single most-important relationship to focus on next week
   + why + the concrete first move.

CONSTRAINTS:
  · 3 paragraphs · separated by a blank line
  · ~120 words total max
  · No headers, no lists, no markdown
  · No "this week we" filler · be direct
  · Return ONLY the synthesis`;

export const GET = cronHandler(async () => {
  const now = new Date();
  const weekKey = isoWeek(now);

  const already = await prisma.brainMemory.findFirst({
    where: {
      category: BRAIN_CATEGORIES.RELATIONSHIPS_WEEKLY_SYNTHESIS,
      key: weekKey,
    },
    select: { id: true },
  });
  if (already) {
    return { skipped: true, reason: "already_sent_this_week", weekKey };
  }

  // Pull the week's signal.
  const weekStart = new Date(now.getTime() - 7 * DAY_MS);

  const [ledgerEntries, alphaRows, outreachRows, people] = await Promise.all([
    prisma.relationshipLedger.findMany({
      where: { createdAt: { gte: weekStart } },
      select: {
        amount: true,
        note: true,
        source: true,
        createdAt: true,
        person: { select: { id: true, name: true, role: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 200,
    }),
    prisma.brainMemory.findMany({
      where: {
        category: BRAIN_CATEGORIES.ALPHA_MOMENT,
        createdAt: { gte: weekStart },
      },
      select: { metadata: true, createdAt: true },
      take: 30,
    }),
    prisma.brainMemory.findMany({
      where: {
        category: BRAIN_CATEGORIES.RELATIONSHIPS_OUTREACH,
        createdAt: { gte: weekStart },
      },
      select: { metadata: true, createdAt: true },
      take: 50,
    }),
    prisma.personProfile.findMany({
      where: { deletedAt: null, status: { not: "blown_up" } },
      select: { id: true, name: true, role: true, lastInteraction: true },
      take: 80,
    }),
  ]);

  if (
    ledgerEntries.length === 0 &&
    alphaRows.length === 0 &&
    outreachRows.length === 0
  ) {
    return { skipped: true, reason: "no_signal_this_week", weekKey };
  }

  // Aggregate by person for the prompt.
  const byPerson = new Map<
    string,
    { name: string; role: string; delta: number; touches: number; notes: string[] }
  >();
  for (const e of ledgerEntries) {
    if (!e.person) continue;
    const bucket = byPerson.get(e.person.id) ?? {
      name: e.person.name,
      role: e.person.role,
      delta: 0,
      touches: 0,
      notes: [],
    };
    bucket.delta += e.amount;
    bucket.touches += 1;
    if (e.note && bucket.notes.length < 3) {
      bucket.notes.push(`${e.amount > 0 ? "+" : ""}${e.amount} · ${e.note.slice(0, 60)}`);
    }
    byPerson.set(e.person.id, bucket);
  }

  const peopleLines = Array.from(byPerson.values())
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
    .slice(0, 12)
    .map(
      (p, i) =>
        `${i + 1}. ${p.name} (${p.role}) · ${p.delta > 0 ? "+" : ""}${p.delta} net (${p.touches} touches) ${p.notes.length ? "· " + p.notes.join(" · ") : ""}`,
    );

  const alphaLines = alphaRows
    .map((r) => {
      const meta = (r.metadata as Record<string, unknown> | null) ?? {};
      return `· ${String(meta.moment ?? "alpha moment").slice(0, 80)}`;
    })
    .slice(0, 5);

  const outreachLines = outreachRows
    .map((r) => {
      const meta = (r.metadata as Record<string, unknown> | null) ?? {};
      return `· ${meta.personName ?? "(?)"}: ${String(meta.message ?? "").slice(0, 80)}`;
    })
    .slice(0, 8);

  const userBlock = [
    `WEEK · ${weekKey}`,
    `ACTIVE PEOPLE: ${people.length}`,
    "",
    `WEEK'S LEDGER MOVEMENT (top 12 by abs delta):`,
    peopleLines.join("\n") || "(none)",
    "",
    `ALPHA MOMENTS LOGGED:`,
    alphaLines.join("\n") || "(none)",
    "",
    `OUTREACH SENT (Nick-drafted):`,
    outreachLines.join("\n") || "(none)",
  ].join("\n");

  let synthesis = "";
  try {
    const result = await tracedAiChat(
      { label: "relationship-weekly-synthesis", source: "cron" },
      [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userBlock },
      ],
      "reason",
    );
    synthesis = (result.content ?? "").trim();
  } catch (err) {
    return {
      skipped: true,
      reason: "ai_synthesis_failed",
      error: err instanceof Error ? err.message : String(err),
      weekKey,
    };
  }

  if (!synthesis) {
    return { skipped: true, reason: "empty_synthesis", weekKey };
  }

  // Single-row write · BRAIN_CATEGORIES has no JOURNAL constant (the
  // mastery surface reads multiple BrainMemory categories) · syntheses
  // surface via /relationships morning brief which already reads this
  // category as the "what compounded last week" anchor.
  await prisma.brainMemory.create({
    data: {
      category: BRAIN_CATEGORIES.RELATIONSHIPS_WEEKLY_SYNTHESIS,
      key: weekKey,
      content: synthesis,
      confidence: 0.9,
      source: "cron:relationship-weekly-synthesis",
      createdBy: "ai",
      metadata: {
        weekKey,
        peopleCount: people.length,
        ledgerEntryCount: ledgerEntries.length,
        alphaCount: alphaRows.length,
        outreachCount: outreachRows.length,
        generatedAt: new Date().toISOString(),
      } as never,
    },
  });

  return {
    sent: true,
    weekKey,
    synthesisLength: synthesis.length,
    peopleScanned: people.length,
  };
});
