/**
 * GET /api/system/memory-decay
 *
 * Returns brain memories sorted by "freshness" — lowest confidence or
 * oldest lastSeen first. The UI shows these as a decay leaderboard so
 * Nour can manually reinforce memories that are about to rot out.
 *
 * POST /api/system/memory-decay
 *   { id: string, action: "reinforce" | "archive" | "delete" }
 * Mutations that let Nour curate the corpus directly.
 */

import { prisma } from "@/lib/prisma";
import { brainMemory } from "@/lib/brain/memory-manager";
import { recordError } from "@/lib/errors/record-error";
import { softDelete, restore } from "@/lib/db/soft-delete";

import { requireSession } from "@/lib/auth-guard";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  // v10.0.183 · brain memories (decaying + expiring + oldestSeen)
  // are private operator data. POST handler had auth, GET didn't.
  await requireSession(req);
  try {
    // v8.27 · soft-delete retrofit · already-deleted memories aren't
    // "decaying" — they're done. Skip them in all three queries.
    const [decaying, expiring, oldestSeen] = await Promise.all([
      // Lowest confidence — at risk of garbage collection (< 0.3)
      prisma.brainMemory.findMany({
        where: { confidence: { lt: 0.4 }, deletedAt: null },
        orderBy: [{ confidence: "asc" }, { lastSeen: "asc" }],
        take: 30,
        select: {
          id: true,
          category: true,
          key: true,
          content: true,
          confidence: true,
          seenCount: true,
          lastSeen: true,
          source: true,
          expiresAt: true,
        },
      }),
      // Expiring within 24h
      prisma.brainMemory.findMany({
        where: {
          expiresAt: {
            not: null,
            gte: new Date(),
            lte: new Date(Date.now() + 24 * 60 * 60 * 1000),
          },
          deletedAt: null,
        },
        orderBy: { expiresAt: "asc" },
        take: 20,
        select: {
          id: true,
          category: true,
          key: true,
          content: true,
          confidence: true,
          expiresAt: true,
          source: true,
        },
      }),
      // Permanent memories not seen in 30+ days (stale)
      prisma.brainMemory.findMany({
        where: {
          expiresAt: null,
          lastSeen: { lt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) },
          deletedAt: null,
        },
        orderBy: { lastSeen: "asc" },
        take: 20,
        select: {
          id: true,
          category: true,
          key: true,
          content: true,
          confidence: true,
          lastSeen: true,
          source: true,
        },
      }),
    ]);

    return Response.json({
      decaying,
      expiring,
      stale: oldestSeen,
    });
  } catch (err) {
    recordError("api:unknown", err, { route: "memory-decay:get" });
    return Response.json({ error: "failed" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  await requireSession(req);
  try {
    const body = (await req.json()) as { id: string; action: string };
    if (!body.id || !body.action) {
      return Response.json({ error: "missing id or action" }, { status: 400 });
    }

    switch (body.action) {
      case "reinforce": {
        // Manual reinforce — bumps confidence and seenCount, removes expiry
        const updated = await brainMemory.reinforce(body.id);
        return Response.json({ ok: true, memory: updated });
      }
      case "archive": {
        // Archive = drop confidence to 0.1 but keep the row
        const updated = await prisma.brainMemory.update({
          where: { id: body.id },
          data: { confidence: 0.1 },
        });
        return Response.json({ ok: true, memory: updated });
      }
      case "delete": {
        // v7.9: soft-delete preserves the row + supports undo from
        // the memory-decay UI. Use POST {action:"purge"} for hard.
        const result = await softDelete("brainMemory", { id: body.id });
        return Response.json({ ok: result.ok, deleted: body.id, soft: true });
      }
      case "restore": {
        const result = await restore("brainMemory", { id: body.id });
        return Response.json({ ok: result.ok, restored: body.id });
      }
      case "purge": {
        await prisma.brainMemory.delete({ where: { id: body.id } });
        return Response.json({ ok: true, purged: body.id });
      }
      default:
        return Response.json({ error: "unknown action" }, { status: 400 });
    }
  } catch (err) {
    recordError("api:unknown", err, { route: "memory-decay:post" });
    return Response.json({ error: "failed" }, { status: 500 });
  }
}
