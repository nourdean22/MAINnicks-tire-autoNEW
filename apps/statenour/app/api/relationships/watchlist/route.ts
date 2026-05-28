/**
 * /api/relationships/watchlist · Wave AB Phase 1A · 2026-05-28.
 *
 * Heuristic watchlist · no AI, deterministic, fast. Returns items
 * across 4 kinds (promise_broken · stale_90d · power_imbalance ·
 * birthday_2w) ranked by urgency. The /relationships page renders
 * these as a tight watchlist below Today's Picks.
 */

import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth-guard";
import { prisma } from "@/lib/prisma";
import { BRAIN_CATEGORIES } from "@/lib/brain/categories";
import { logger as rootLogger } from "@/lib/logger";

const log = rootLogger.withSurface("api/relationships/watchlist");

const DAY_MS = 1000 * 60 * 60 * 24;

type WatchlistKind =
  | "promise_broken"
  | "stale_90d"
  | "power_imbalance"
  | "birthday_2w";

interface WatchlistItem {
  kind: WatchlistKind;
  personId: string;
  personName: string;
  summary: string;
  rank: number;
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    await requireSession(req);
  } catch {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const items = await buildWatchlist();
    return NextResponse.json({ items, generatedAt: new Date().toISOString() });
  } catch (err) {
    log.error("watchlist_failed", {
      err: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json({ items: [], generatedAt: new Date().toISOString() });
  }
}

async function buildWatchlist(): Promise<WatchlistItem[]> {
  const people = await prisma.personProfile.findMany({
    where: { deletedAt: null, status: { not: "blown_up" } },
    select: { id: true, name: true, lastInteraction: true, birthday: true },
    take: 200,
  });
  if (people.length === 0) return [];

  const peopleMap = new Map(people.map((p) => [p.id, p] as const));

  // Stale 90d
  const items: WatchlistItem[] = [];
  const now = Date.now();
  for (const p of people) {
    if (!p.lastInteraction) continue;
    const days = Math.floor((now - p.lastInteraction.getTime()) / DAY_MS);
    if (days >= 90) {
      items.push({
        kind: "stale_90d",
        personId: p.id,
        personName: p.name,
        summary: `${days}d since last touch`,
        rank: 100 - Math.min(99, days - 90),
      });
    }
  }

  // Birthday in 14d
  const todayMD = new Date().toISOString().slice(5, 10);
  for (const p of people) {
    if (!p.birthday || !/^\d{4}-\d{2}-\d{2}$/.test(p.birthday)) continue;
    const days = daysUntilMMDD(todayMD, p.birthday.slice(5, 10));
    if (days >= 0 && days <= 14) {
      items.push({
        kind: "birthday_2w",
        personId: p.id,
        personName: p.name,
        summary: days === 0 ? "birthday today" : `birthday in ${days}d`,
        rank: 50 + days, // sooner = lower rank = more urgent
      });
    }
  }

  // Promises (broken or open)
  const promiseRows = await prisma.brainMemory.findMany({
    where: { category: BRAIN_CATEGORIES.KEPT_WORD },
    select: { metadata: true },
    take: 500,
  });
  const promisesByPerson = new Map<
    string,
    { broken: number; open: number; recentNote?: string }
  >();
  for (const row of promiseRows) {
    const meta = (row.metadata as Record<string, unknown> | null) ?? {};
    const status = String(meta.status ?? "open");
    const personId = String(meta.personId ?? "");
    if (!personId) continue;
    const bucket = promisesByPerson.get(personId) ?? { broken: 0, open: 0 };
    if (status === "broken") bucket.broken++;
    else if (status === "open") bucket.open++;
    if (!bucket.recentNote && typeof meta.promise === "string") {
      bucket.recentNote = String(meta.promise).slice(0, 60);
    }
    promisesByPerson.set(personId, bucket);
  }
  for (const [personId, bucket] of promisesByPerson) {
    const p = peopleMap.get(personId);
    if (!p) continue;
    if (bucket.broken > 0) {
      items.push({
        kind: "promise_broken",
        personId,
        personName: p.name,
        summary: bucket.recentNote
          ? `${bucket.broken} broken · "${bucket.recentNote}"`
          : `${bucket.broken} broken promise(s)`,
        rank: 1 - bucket.broken, // most broken = lowest rank = most urgent
      });
    }
  }

  // Power imbalance · last 30d ledger
  const since30 = new Date(now - 30 * DAY_MS);
  const ledger = await prisma.relationshipLedger.findMany({
    where: { createdAt: { gte: since30 } },
    select: { personId: true, amount: true },
  });
  const ledgerByPerson = new Map<string, number>();
  for (const l of ledger) {
    ledgerByPerson.set(l.personId, (ledgerByPerson.get(l.personId) ?? 0) + l.amount);
  }
  for (const [personId, delta] of ledgerByPerson) {
    if (delta >= -2) continue;
    const p = peopleMap.get(personId);
    if (!p) continue;
    items.push({
      kind: "power_imbalance",
      personId,
      personName: p.name,
      summary: `ledger ${delta} last 30d`,
      rank: 40 + delta, // more-negative = lower rank = more urgent
    });
  }

  // De-dupe per person · keep the most-urgent kind only.
  const byPerson = new Map<string, WatchlistItem>();
  for (const item of items) {
    const prev = byPerson.get(item.personId);
    if (!prev || item.rank < prev.rank) byPerson.set(item.personId, item);
  }

  return Array.from(byPerson.values()).sort((a, b) => a.rank - b.rank).slice(0, 12);
}

function daysUntilMMDD(todayMD: string, targetMD: string): number {
  const year = new Date().getFullYear();
  const today = new Date(`${year}-${todayMD}`);
  let target = new Date(`${year}-${targetMD}`);
  if (target.getTime() < today.getTime()) {
    target = new Date(`${year + 1}-${targetMD}`);
  }
  return Math.round((target.getTime() - today.getTime()) / DAY_MS);
}
