/**
 * Nick's daily relationship picks · Wave AB Phase 1B · 2026-05-28.
 *
 * The killer feature. Reads:
 *
 *   · PersonProfile active rows (operator-curated)
 *   · RelationshipLedger trailing 30d deltas (who's net-positive
 *     for the operator, who's net-negative)
 *   · KEPT_WORD BrainMemory rows (open promises by either party)
 *   · PersonProfile.birthday within next 14d
 *   · lastInteraction · staleness signal
 *
 * Hybrid scoring · cheap heuristics first (deterministic · zero AI
 * cost), then a single tracedAiChat call ranks the top 6 candidates
 * into the final top 3 with rationale strings.
 *
 * Cached daily in BrainMemory(category=relationships_picks_today,
 * key=YYYY-MM-DD) so navigation back to /relationships doesn't burn
 * tokens. Cron invalidates when ledger entries land (the picks
 * become stale fast when the operator actually executes outreach).
 *
 * Cost target · <$0.003 per call. Failure mode · returns the
 * top 3 heuristic candidates with templated rationale so the page
 * always has something to render.
 */

import "server-only";

import { prisma } from "@/lib/prisma";
import { BRAIN_CATEGORIES } from "@/lib/brain/categories";
import { tracedAiChat } from "@/lib/ai/traced-aichat";
import { logger as rootLogger } from "@/lib/logger";
import { contactRowsOnly } from "@/lib/services/people/contact-rows";
import { daysUntilBirthday } from "@/lib/services/people/birthday";
import { toDateString } from "@/lib/utils/datetime";

const log = rootLogger.withSurface("ai/relationships-pick-today");

export interface RelationshipPick {
  personId: string;
  personName: string;
  rationale: string;
  draft?: string;
  /** People W3: one maxim from his books fitted to this pick's situation. */
  maxim?: { text: string; source: string };
  /** People W4 S1: "today", "tomorrow" or a weekday when an event in the next 3 days names them. */
  seeingOn?: string;
}

export interface PicksResult {
  picks: RelationshipPick[];
  generatedAt: string;
  source: "cache" | "fresh" | "heuristic_fallback";
  /** People W4 S1: "unknown" when the calendar read failed, so "nobody coming up" is not claimed. */
  calendar?: "ok" | "unknown";
}

const DAY_MS = 1000 * 60 * 60 * 24;

interface Candidate {
  personId: string;
  personName: string;
  role: string;
  daysSilent: number | null;
  ledgerDelta30d: number;
  ledgerTouches30d: number;
  brokenPromises: number;
  birthdayInDays: number | null;
  signals: string[];
  heuristicScore: number;
  seeingOn: string | null;
}

/**
 * The picks cache key: the New York date (people W2b, 2026-10-30). It was the
 * UTC date, so from 20:00 ET the evening read a fresh "tomorrow" row. Every
 * reader of the cache (log-outreach, home-moves, propose-actions) uses this.
 */
export function picksDayKey(now: Date = new Date()): string {
  return toDateString(now);
}

export async function pickRelationshipsForToday(): Promise<PicksResult> {
  const today = picksDayKey();

  // ── Cache check ──
  try {
    const cached = await prisma.brainMemory.findFirst({
      where: {
        category: BRAIN_CATEGORIES.RELATIONSHIPS_PICKS_TODAY,
        key: today,
      },
      select: { metadata: true, createdAt: true },
    });
    if (cached?.metadata) {
      const meta = cached.metadata as Record<string, unknown>;
      const picks = meta.picks as RelationshipPick[] | undefined;
      if (Array.isArray(picks) && picks.length > 0) {
        return {
          picks,
          generatedAt: cached.createdAt.toISOString(),
          source: "cache",
          ...(meta.calendar === "ok" || meta.calendar === "unknown" ? { calendar: meta.calendar } : {}),
        };
      }
    }
  } catch (err) {
    log.warn("cache_read_failed", {
      err: err instanceof Error ? err.message : String(err),
    });
  }

  // ── Gather candidates ──
  let candidates: Candidate[];
  let calendar: "ok" | "unknown" = "unknown";
  try {
    ({ candidates, calendar } = await buildCandidatePool());
  } catch (err) {
    log.error("candidate_pool_failed", {
      err: err instanceof Error ? err.message : String(err),
    });
    return { picks: [], generatedAt: new Date().toISOString(), source: "heuristic_fallback" };
  }

  if (candidates.length === 0) {
    return { picks: [], generatedAt: new Date().toISOString(), source: "heuristic_fallback" };
  }

  // Heuristic shortlist · top 6 by score · feed only this to the AI.
  const shortlist = candidates
    .sort((a, b) => b.heuristicScore - a.heuristicScore)
    .slice(0, 6);

  // ── AI rank the top 3 ──
  let picks: RelationshipPick[] = [];
  try {
    picks = await aiRankPicks(shortlist);
  } catch (err) {
    log.warn("ai_rank_failed_falling_back_heuristic", {
      err: err instanceof Error ? err.message : String(err),
    });
  }

  // ── Heuristic fallback if AI returned empty ──
  if (picks.length === 0) {
    picks = shortlist.slice(0, 3).map((c) => ({
      personId: c.personId,
      personName: c.personName,
      rationale: heuristicRationale(c),
    }));
  }

  // People W3: the right maxim under each pick (no model call; see maxim-for-pick.ts).
  {
    const { maximForPick } = await import("@/lib/services/people/maxim-for-pick");
    const day = picksDayKey();
    const byId = new Map(shortlist.map((c) => [c.personId, c] as const));
    picks = picks.map((p) => {
      const c = byId.get(p.personId);
      const m = c ? maximForPick(c, day) : null;
      const withMaxim = m ? { ...p, maxim: { text: m.text, source: m.source } } : p;
      return c?.seeingOn ? { ...withMaxim, seeingOn: c.seeingOn } : withMaxim;
    });
  }

  // ── Cache write ──
  try {
    const existing = await prisma.brainMemory.findFirst({
      where: {
        category: BRAIN_CATEGORIES.RELATIONSHIPS_PICKS_TODAY,
        key: today,
      },
      select: { id: true },
    });
    const data = {
      content: `Picks for ${today} · ${picks.map((p) => p.personName).join(", ")}`,
      confidence: 0.9,
      source: "tool:relationships-pick-today",
      createdBy: "ai" as const,
      metadata: {
        picks,
        candidateCount: candidates.length,
        calendar,
        generatedAt: new Date().toISOString(),
      } as never,
    };
    if (existing) {
      await prisma.brainMemory.update({
        where: { id: existing.id },
        data: { ...data, lastSeen: new Date() },
      });
    } else {
      await prisma.brainMemory.create({
        data: {
          category: BRAIN_CATEGORIES.RELATIONSHIPS_PICKS_TODAY,
          key: today,
          ...data,
        },
      });
    }
  } catch (err) {
    log.warn("cache_write_failed", {
      err: err instanceof Error ? err.message : String(err),
    });
  }

  return {
    picks,
    generatedAt: new Date().toISOString(),
    source: "fresh",
    calendar,
  };
}

async function buildCandidatePool(): Promise<{ candidates: Candidate[]; calendar: "ok" | "unknown" }> {
  const people = await prisma.personProfile.findMany({
    where: {
      deletedAt: null,
      status: { not: "blown_up" },
    },
    select: {
      id: true,
      name: true,
      role: true,
      lastInteraction: true,
      birthday: true,
    },
    take: 200,
  });

  if (people.length === 0) return { candidates: [], calendar: "ok" };

  // Pull last-30d ledger movement per person.
  const since30d = new Date(Date.now() - 30 * DAY_MS);
  // CONTACT rows only (W8): `touches` below is literally a contact count.
  const ledger = contactRowsOnly(
    await prisma.relationshipLedger.findMany({
      where: { createdAt: { gte: since30d } },
      select: { personId: true, amount: true, metadata: true },
    }),
  );
  const ledgerByPerson = new Map<string, { delta: number; touches: number }>();
  for (const row of ledger) {
    const bucket = ledgerByPerson.get(row.personId) ?? { delta: 0, touches: 0 };
    bucket.delta += row.amount;
    bucket.touches += 1;
    ledgerByPerson.set(row.personId, bucket);
  }

  // Open promises (KEPT_WORD with status="open" or "broken")
  const promiseRows = await prisma.brainMemory.findMany({
    where: { category: BRAIN_CATEGORIES.KEPT_WORD },
    select: { metadata: true },
    take: 500,
  });
  const brokenByPerson = new Map<string, number>();
  for (const row of promiseRows) {
    const meta = (row.metadata as Record<string, unknown> | null) ?? {};
    const status = String(meta.status ?? "open");
    const personId = String(meta.personId ?? "");
    if (!personId) continue;
    if (status === "broken" || status === "open") {
      brokenByPerson.set(personId, (brokenByPerson.get(personId) ?? 0) + 1);
    }
  }

  const now = Date.now();
  const nowDate = new Date(now);

  // People W4 S1: who he is about to see (read-only; never creates events). A failed read
  // changes no pick and says "unknown", so a dead calendar never reads as "nobody coming up".
  let seeing = new Map<string, Date>();
  let calendar: "ok" | "unknown" = "ok";
  try {
    const { listEvents } = await import("@/lib/services/calendar-api");
    const { nextEventByPerson } = await import("@/lib/services/people/calendar-mentions");
    seeing = nextEventByPerson(await listEvents({ daysAhead: 3 }), people, nowDate);
  } catch (err) {
    calendar = "unknown";
    log.warn("calendar_read_failed", { err: err instanceof Error ? err.message : String(err) });
  }
  const { seeingLabel } = await import("@/lib/services/people/calendar-mentions");

  const candidates = people.map((p): Candidate => {
    const daysSilent = p.lastInteraction
      ? Math.floor((now - p.lastInteraction.getTime()) / DAY_MS)
      : null;
    const ledgerStats = ledgerByPerson.get(p.id);
    const ledgerDelta30d = ledgerStats?.delta ?? 0;
    const ledgerTouches30d = ledgerStats?.touches ?? 0;
    const brokenPromises = brokenByPerson.get(p.id) ?? 0;

    // America/New_York day count (people W0): the UTC month-day ran a day ahead after 20:00 ET.
    const birthdayInDays = daysUntilBirthday(p.birthday, nowDate);

    const seeingAt = seeing.get(p.id);
    const seeingOn = seeingAt ? seeingLabel(seeingAt, nowDate) : null;

    const signals: string[] = [];
    if (seeingOn) signals.push(`seeing them ${seeingOn} (calendar)`);
    if (brokenPromises > 0) signals.push(`${brokenPromises} open promise(s)`);
    if (birthdayInDays !== null && birthdayInDays <= 14)
      signals.push(`birthday in ${birthdayInDays}d`);
    // Someone he is about to see has not gone quiet, so no silence signal either (Codex on 3432).
    if (!seeingOn) {
      if (daysSilent !== null && daysSilent >= 90) signals.push(`90d+ silent`);
      else if (daysSilent !== null && daysSilent >= 30) signals.push(`${daysSilent}d silent`);
    }
    if (ledgerDelta30d <= -2) signals.push(`ledger -${Math.abs(ledgerDelta30d)} last 30d`);
    if (!seeingOn && ledgerTouches30d === 0 && (daysSilent ?? 999) < 60)
      signals.push("no recent touchpoints");

    // Heuristic score (higher = more urgent · roughly calibrated).
    let score = 0;
    score += brokenPromises * 30;
    if (birthdayInDays !== null && birthdayInDays <= 14) score += 25 - birthdayInDays;
    // Someone he is about to see has not gone quiet: their silence stops counting (W4 S1).
    if (daysSilent !== null && !seeingOn) {
      if (daysSilent >= 90) score += 20;
      else if (daysSilent >= 60) score += 12;
      else if (daysSilent >= 30) score += 6;
    }
    score += Math.max(0, -ledgerDelta30d) * 2;
    // Active social roles weight slightly higher · mentors / close friends.
    if (
      ["mentor", "close_friend", "friend", "family", "romantic"].includes(
        p.role.toLowerCase(),
      )
    ) {
      score += 4;
    }

    return {
      personId: p.id,
      personName: p.name,
      role: p.role,
      daysSilent,
      ledgerDelta30d,
      ledgerTouches30d,
      brokenPromises,
      birthdayInDays,
      signals,
      heuristicScore: score,
      seeingOn,
    };
  });
  return { candidates, calendar };
}

function heuristicRationale(c: Candidate): string {
  if (c.signals.length === 0) {
    return `${c.role.replace("_", " ")} · worth a check-in`;
  }
  // Keep it concise · 1 line.
  return c.signals.slice(0, 3).join(" · ");
}

const SYSTEM_PROMPT = `You are an operator's personal-OS coach picking the
top 3 relationships for outreach TODAY. You will receive a shortlist of
up to 6 candidates with signals (silence days, broken promises, birthday
proximity, ledger imbalance). Return JSON:

{
  "picks": [
    {
      "personId": "<id from input>",
      "personName": "<name from input>",
      "rationale": "<one sentence, max 90 chars, plain language, no preamble>"
    }
  ]
}

RULES:
  · Exactly 3 picks unless fewer candidates are provided.
  · Use only personIds present in the input.
  · Rationale is operator-readable, calls out the specific signal,
    references one concrete past action when present.
  · Order by urgency (most urgent first).
  · Return ONLY the JSON object · no preamble, no markdown fences.`;

async function aiRankPicks(shortlist: Candidate[]): Promise<RelationshipPick[]> {
  const userBlock = [
    `SHORTLIST (${shortlist.length} candidates):`,
    ...shortlist.map(
      (c, i) =>
        `${i + 1}. id="${c.personId}" name="${c.personName}" role="${c.role}" signals=[${c.signals.join(", ")}]`,
    ),
  ].join("\n");

  const result = await tracedAiChat(
    { label: "relationships-pick-today", source: "tool" },
    [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: userBlock },
    ],
    "reason",
  );

  const text = (result.content ?? "").trim();
  if (!text) return [];

  const cleaned = text
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "");
  let parsed: { picks?: RelationshipPick[] };
  try {
    parsed = JSON.parse(cleaned) as { picks?: RelationshipPick[] };
  } catch {
    return [];
  }
  if (!parsed.picks || !Array.isArray(parsed.picks)) return [];

  const validIds = new Set(shortlist.map((c) => c.personId));
  return parsed.picks
    .filter((p) => typeof p?.personId === "string" && validIds.has(p.personId))
    .map((p) => ({
      personId: p.personId,
      personName: String(p.personName ?? ""),
      rationale: String(p.rationale ?? "").slice(0, 200),
    }))
    .slice(0, 3);
}
