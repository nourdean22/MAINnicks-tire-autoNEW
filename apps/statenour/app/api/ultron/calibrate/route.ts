import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { daysAgo } from "@/lib/utils/datetime";

import { requireSession } from "@/lib/auth-guard";
/**
 * GET /api/ultron/calibrate
 *
 * Picks 1-3 high-confidence aging brain memories for Nour to verify. The
 * selection strategy deliberately biases toward memories that could plausibly
 * be stale:
 *   - createdAt > 30d ago OR lastSeen > 14d ago
 *   - confidence > 0.6 (we don't want to re-verify weak memories)
 *   - category in: pattern, insight, preference, feedback, wisdom, rule
 *   - exclude category="tomorrow_note" (those are tied to dates, auto-rotate)
 *
 * PATCH /api/ultron/calibrate
 *   Body: { id, action: "verify" | "update" | "retire", newContent?: string }
 *     verify → confidence += 0.1 (max 1.0), lastSeen = now, seenCount++
 *     update → content replaced, confidence = 0.8, lastSeen = now
 *     retire → expiresAt = now (soft-delete — memory stops surfacing)
 */

interface MemorySample {
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

export async function GET() {
  try {
    const now = Date.now();
    // Two candidate pools — combine and pick 3 diverse ones
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

    // Dedupe + pick up to 3 with category diversity
    const seenIds = new Set<string>();
    const all = [...agedMemories, ...staleSeen].filter((m) => {
      if (seenIds.has(m.id)) return false;
      seenIds.add(m.id);
      return true;
    });

    // Shuffle lightly (deterministic per-day so refresh doesn't churn)
    const todaySeed = Math.floor(Date.now() / 86_400_000);
    all.sort((a, b) => {
      // Stable pseudo-random using id hash + day
      const ah = (a.id + todaySeed).split("").reduce((s, c) => s + c.charCodeAt(0), 0);
      const bh = (b.id + todaySeed).split("").reduce((s, c) => s + c.charCodeAt(0), 0);
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
    // Fill remaining slots without category dedup if needed
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
      ageDays: Math.floor((now - m.createdAt.getTime()) / 86400000),
      seenCount: m.seenCount,
      source: m.source,
    }));

    return NextResponse.json({
      data: {
        samples,
        generatedAt: new Date().toISOString(),
      },
    });
  } catch (err) {
    return NextResponse.json(
      {
        data: { samples: [], generatedAt: new Date().toISOString() },
        error: String(err),
      },
      { status: 500 },
    );
  }
}

export async function PATCH(req: Request) {
  await requireSession(req);
  try {
    const body = (await req.json()) as {
      id?: string;
      action?: "verify" | "update" | "retire";
      newContent?: string;
    };
    if (!body.id || !body.action) {
      return NextResponse.json({ error: "id + action required" }, { status: 400 });
    }

    const existing = await prisma.brainMemory
      .findUnique({ where: { id: body.id } })
      .catch(() => null);
    if (!existing) {
      return NextResponse.json({ error: "not found" }, { status: 404 });
    }

    if (body.action === "verify") {
      await prisma.brainMemory.update({
        where: { id: body.id },
        data: {
          confidence: Math.min(1.0, existing.confidence + 0.1),
          seenCount: existing.seenCount + 1,
          lastSeen: new Date(),
        },
      });
      return NextResponse.json({ data: { ok: true, action: "verified" } });
    }
    if (body.action === "update") {
      const newContent = (body.newContent ?? "").trim();
      if (!newContent) {
        return NextResponse.json({ error: "newContent required for update" }, { status: 400 });
      }
      await prisma.brainMemory.update({
        where: { id: body.id },
        data: {
          content: newContent,
          confidence: 0.8,
          seenCount: existing.seenCount + 1,
          lastSeen: new Date(),
        },
      });
      return NextResponse.json({ data: { ok: true, action: "updated" } });
    }
    if (body.action === "retire") {
      await prisma.brainMemory.update({
        where: { id: body.id },
        data: {
          expiresAt: new Date(),
        },
      });
      return NextResponse.json({ data: { ok: true, action: "retired" } });
    }

    return NextResponse.json({ error: "unknown action" }, { status: 400 });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
