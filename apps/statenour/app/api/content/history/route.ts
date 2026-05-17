/**
 * /api/content/history — search past content scored by the 7-axis critic.
 *
 * v6 · BATCH 3 · Apr 28. Query interface for the brain_memory rows
 * written by the chat post-process critic (category=nick_quality).
 * Lets Nour search "all 80+ scoring brake-related posts last 30 days"
 * or "lowest-scoring story copy this week" — pattern-mining on
 * shipped content quality.
 *
 * Query params:
 *   q       — free-text search across content snippet
 *   minScore — only show posts with overall ≥ N (default 0)
 *   maxScore — only show posts with overall ≤ N (default 100)
 *   shape   — filter by output shape (prose/email/sms/list/...)
 *   intent  — filter by turn intent (content/work/personal/...)
 *   contentMode — boolean, only 7-axis content scores
 *   days    — last N days (default 30)
 *
 * Auth: session.
 */

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth-guard";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface QualityMetadata {
  conversationId?: string;
  overall?: number;
  specificity?: number;
  cliche?: number;
  antiNour?: number;
  length?: number;
  brandElement?: number;
  cta?: number;
  hashtagQuality?: number;
  contentMode?: boolean;
  shouldRegen?: boolean;
  wordCount?: number;
  turnIntent?: string;
  turnShape?: string;
  persona?: string;
}

export async function GET(req: Request) {
  try { await requireSession(req); } catch { return NextResponse.json({ error: "unauthorized" }, { status: 401 }); }

  const { searchParams } = new URL(req.url);
  const q = searchParams.get("q")?.trim() ?? "";
  const minScore = Math.max(0, Math.min(100, Number(searchParams.get("minScore") ?? "0")));
  const maxScore = Math.max(0, Math.min(100, Number(searchParams.get("maxScore") ?? "100")));
  const shape = searchParams.get("shape") ?? "";
  const intent = searchParams.get("intent") ?? "";
  const contentModeOnly = searchParams.get("contentMode") === "true";
  const days = Math.max(1, Math.min(365, Number(searchParams.get("days") ?? "30")));

  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  const rows = await prisma.brainMemory
    .findMany({
      where: {
        category: "nick_quality",
        createdAt: { gte: since },
        ...(q && { content: { contains: q, mode: "insensitive" } }),
      },
      orderBy: { createdAt: "desc" },
      take: 500,
      select: {
        id: true,
        content: true,
        createdAt: true,
        metadata: true,
      },
    })
    .catch(() => [] as Array<{ id: string; content: string; createdAt: Date; metadata: unknown }>);

  // Filter in-memory by metadata fields (Prisma JSON path filters can be
  // finicky across DB versions; 500-row JS filter is fast enough).
  const filtered = rows.filter((r) => {
    const meta = (r.metadata as QualityMetadata | null) ?? {};
    if (typeof meta.overall === "number") {
      if (meta.overall < minScore || meta.overall > maxScore) return false;
    }
    if (shape && meta.turnShape !== shape) return false;
    if (intent && meta.turnIntent !== intent) return false;
    if (contentModeOnly && !meta.contentMode) return false;
    return true;
  });

  // Aggregate stats — quality trend, axis-by-axis avg, regen-rate
  const stats = aggregateStats(filtered);

  return NextResponse.json({
    ok: true,
    window: { days, since: since.toISOString() },
    filters: { q, minScore, maxScore, shape, intent, contentModeOnly },
    count: filtered.length,
    rows: filtered.slice(0, 200).map((r) => ({
      id: r.id,
      content: r.content,
      createdAt: r.createdAt.toISOString(),
      metadata: r.metadata,
    })),
    stats,
  });
}

function aggregateStats(rows: Array<{ metadata: unknown }>): {
  avgOverall: number;
  avgSpecificity: number;
  avgCliche: number;
  avgAntiNour: number;
  avgLength: number;
  avgBrand: number;
  avgCTA: number;
  avgHashtag: number;
  regenRate: number;
  contentModeRate: number;
  byShape: Record<string, number>;
  byIntent: Record<string, number>;
} {
  if (rows.length === 0) {
    return {
      avgOverall: 0, avgSpecificity: 0, avgCliche: 0, avgAntiNour: 0,
      avgLength: 0, avgBrand: 0, avgCTA: 0, avgHashtag: 0,
      regenRate: 0, contentModeRate: 0, byShape: {}, byIntent: {},
    };
  }
  const sum = (k: keyof QualityMetadata): number => {
    let total = 0;
    let count = 0;
    for (const r of rows) {
      const meta = (r.metadata as QualityMetadata | null) ?? {};
      const v = meta[k];
      if (typeof v === "number") {
        total += v;
        count++;
      }
    }
    return count > 0 ? Math.round(total / count) : 0;
  };

  const byShape: Record<string, number> = {};
  const byIntent: Record<string, number> = {};
  let regen = 0;
  let contentMode = 0;
  for (const r of rows) {
    const meta = (r.metadata as QualityMetadata | null) ?? {};
    if (meta.turnShape) byShape[meta.turnShape] = (byShape[meta.turnShape] ?? 0) + 1;
    if (meta.turnIntent) byIntent[meta.turnIntent] = (byIntent[meta.turnIntent] ?? 0) + 1;
    if (meta.shouldRegen) regen++;
    if (meta.contentMode) contentMode++;
  }

  return {
    avgOverall: sum("overall"),
    avgSpecificity: sum("specificity"),
    avgCliche: sum("cliche"),
    avgAntiNour: sum("antiNour"),
    avgLength: sum("length"),
    avgBrand: sum("brandElement"),
    avgCTA: sum("cta"),
    avgHashtag: sum("hashtagQuality"),
    regenRate: Math.round((regen / rows.length) * 100) / 100,
    contentModeRate: Math.round((contentMode / rows.length) * 100) / 100,
    byShape,
    byIntent,
  };
}
