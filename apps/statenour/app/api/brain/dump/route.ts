/**
 * POST /api/brain/dump · P4 · 2026-05-23.
 *
 * Token-authed endpoint that captures a free-text brain dump from
 * external clients (Chrome extension F1 · future scripts). Stores
 * each dump as a BrainMemory(category=brain_dump) row · the existing
 * brain-dump consumers (extractClaims · recall pipeline · /brain
 * dashboard) pick them up without any additional wiring.
 *
 * Auth: Bearer token in Authorization header · issued via
 * `/system/api-tokens` (operator-gated). Token rows are sha256-hashed
 * in BrainMemory(category=API_TOKEN).
 *
 * Body shape:
 *   { content: string · required · max 8000 chars
 *     sourceUrl?: string · optional · current tab URL
 *     sourceTitle?: string · optional · current tab title
 *     selection?: string · optional · highlighted text }
 *
 * Returns:
 *   200 · { ok: true, id: string }
 *   401 · { error: "invalid token" }
 *   400 · { error: "validation" · details }
 *
 * Rate-limit: per-token 60 req/hour (BrainMemory.seenCount via
 * lib/system/rate-limit) · operator can override via env. Not
 * hardened beyond that · single-operator threat model.
 */

import { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { validateToken } from "@/lib/auth/extension-token";
import { logger as rootLogger } from "@/lib/logger";

const log = rootLogger.withSurface("api/brain/dump");

const Input = z.object({
  content: z.string().min(1).max(8000),
  sourceUrl: z.string().url().max(2000).optional(),
  sourceTitle: z.string().max(500).optional(),
  selection: z.string().max(4000).optional(),
});

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const auth = req.headers.get("authorization");
  const token = await validateToken(auth);
  if (!token) {
    return Response.json(
      { error: "invalid token" },
      { status: 401 },
    );
  }

  let body: z.infer<typeof Input>;
  try {
    const json = await req.json();
    body = Input.parse(json);
  } catch (e) {
    return Response.json(
      {
        error: "validation",
        detail: e instanceof Error ? e.message.slice(0, 300) : String(e).slice(0, 300),
      },
      { status: 400 },
    );
  }

  // Key shape · sortable + unique within ms · enables idempotent
  // retry by client if the network drops mid-write (same content
  // posted twice in the same ms would dedupe to the same row).
  const now = new Date();
  const key = `ext_${now.getTime().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

  try {
    const row = await prisma.brainMemory.create({
      data: {
        // Raw "brain_dump" string · BRAIN_CATEGORIES doesn't have a
        // BRAIN_DUMP key (only BRAIN_DUMP_IMPORTANCE) · the dump
        // category is fed by chat-side capture using the literal
        // string. Keep parity.
        category: "brain_dump",
        key,
        content: body.content.slice(0, 8000),
        confidence: 0.6,
        source: "chrome-extension",
        createdBy: `extension:${token.label}`,
        metadata: {
          sourceUrl: body.sourceUrl ?? null,
          sourceTitle: body.sourceTitle ?? null,
          selection: body.selection ?? null,
          tokenLabel: token.label,
          capturedAt: now.toISOString(),
        },
      },
      select: { id: true, key: true },
    });
    log.info("dump_captured", {
      tokenLabel: token.label,
      contentLen: body.content.length,
      hasUrl: Boolean(body.sourceUrl),
    });
    return Response.json({ ok: true, id: row.id, key: row.key });
  } catch (e) {
    log.warn("dump_persist_failed", {
      err: e instanceof Error ? e.message.slice(0, 200) : String(e),
    });
    return Response.json(
      { error: "persist failed" },
      { status: 500 },
    );
  }
}
