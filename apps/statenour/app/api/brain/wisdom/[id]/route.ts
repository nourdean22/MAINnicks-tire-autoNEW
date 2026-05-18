/**
 * /api/brain/wisdom/[id] · v10.0.383
 *
 * Curation actions on a single brain wisdom memory:
 *   · PATCH  · update content / confidence / origin metadata
 *   · POST { action: "deprecate" }   · soft-delete (sets deletedAt)
 *   · POST { action: "promote" }     · wisdom_candidate → wisdom
 *
 * Auth · session required (operator-only).
 *
 * The wisdom layer is high-stakes (top-3 always-on slot per chat turn ·
 * source-trust 1.5x boost). Operator-curated edits get confidence=1.0
 * automatically. Re-runs are idempotent.
 */

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { requireSession } from "@/lib/auth-guard";
import { prisma } from "@/lib/prisma";
import { withTracing } from "@/lib/utils/with-tracing";
import { BRAIN_CATEGORIES } from "@/lib/brain/categories";

interface UpdateBody {
  content?: string;
  confidence?: number;
}

interface ActionBody {
  action: "deprecate" | "promote" | "restore";
}

async function patchHandler(req: NextRequest, ctx?: unknown): Promise<Response> {
  // Auth: requireSession invoked below
  try { await requireSession(req); } catch { return NextResponse.json({ error: "unauthorized" }, { status: 401 }); }

  const params = await (ctx as { params?: Promise<{ id: string }> } | undefined)?.params;
  const id = params?.id;
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  const body = (await req.json().catch(() => ({}))) as UpdateBody;

  const update: { content?: string; confidence?: number; lastSeen?: Date; createdBy?: string } = {};
  if (typeof body.content === "string" && body.content.trim().length >= 30) {
    update.content = body.content.trim().slice(0, 2000);
  }
  if (typeof body.confidence === "number" && body.confidence >= 0 && body.confidence <= 1) {
    update.confidence = body.confidence;
  }
  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: "no valid fields to update" }, { status: 400 });
  }

  update.lastSeen = new Date();
  update.createdBy = "user";

  try {
    const updated = await prisma.brainMemory.update({
      where: { id },
      data: update,
      select: { id: true, content: true, confidence: true, category: true },
    });
    return NextResponse.json({ ok: true, memory: updated });
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message?.slice(0, 200) ?? "update failed" },
      { status: 500 },
    );
  }
}

async function postHandler(req: NextRequest, ctx?: unknown): Promise<Response> {
  // Auth: requireSession invoked below
  try { await requireSession(req); } catch { return NextResponse.json({ error: "unauthorized" }, { status: 401 }); }

  const params = await (ctx as { params?: Promise<{ id: string }> } | undefined)?.params;
  const id = params?.id;
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  const body = (await req.json().catch(() => ({}))) as ActionBody;
  if (!body.action) return NextResponse.json({ error: "action required" }, { status: 400 });

  try {
    if (body.action === "deprecate") {
      const updated = await prisma.brainMemory.update({
        where: { id },
        data: { deletedAt: new Date() },
        select: { id: true, deletedAt: true },
      });
      return NextResponse.json({ ok: true, action: "deprecated", id: updated.id });
    }

    if (body.action === "restore") {
      const updated = await prisma.brainMemory.update({
        where: { id },
        data: { deletedAt: null },
        select: { id: true, deletedAt: true },
      });
      return NextResponse.json({ ok: true, action: "restored", id: updated.id });
    }

    if (body.action === "promote") {
      // wisdom_candidate → wisdom · clear gateReject metadata
      const existing = await prisma.brainMemory.findUnique({
        where: { id },
        select: { id: true, category: true, metadata: true },
      });
      if (!existing) return NextResponse.json({ error: "not found" }, { status: 404 });
      if (existing.category !== "wisdom_candidate") {
        return NextResponse.json(
          { error: `cannot promote · category is ${existing.category} not wisdom_candidate` },
          { status: 400 },
        );
      }
      // Strip gateReject from metadata to mark this as promoted
      const meta = (existing.metadata ?? {}) as Record<string, unknown>;
      delete meta.gateReject;
      delete meta.gateDetail;
      meta.promotedFromCandidate = new Date().toISOString();

      const updated = await prisma.brainMemory.update({
        where: { id },
        data: {
          category: BRAIN_CATEGORIES.WISDOM,
          confidence: 0.9, // promoted but conservative
          createdBy: "user",
          metadata: meta as never,
        },
        select: { id: true, category: true, confidence: true },
      });
      return NextResponse.json({ ok: true, action: "promoted", memory: updated });
    }

    return NextResponse.json({ error: `unknown action: ${body.action}` }, { status: 400 });
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message?.slice(0, 200) ?? "action failed" },
      { status: 500 },
    );
  }
}

// Auth: handlers above invoke requireSession on first line.
export const PATCH = withTracing(patchHandler, { name: "/api/brain/wisdom/[id]" });
export const POST = withTracing(postHandler, { name: "/api/brain/wisdom/[id]" });
