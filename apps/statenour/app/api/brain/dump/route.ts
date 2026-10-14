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

import { createHash } from "node:crypto";
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

  // The key is a hash of what was captured (or of the client's Idempotency-Key header
  // when one is sent), so a retry maps to the same row. The unique (category, key) index
  // rejects the repeat, and the catch below returns the row already stored.
  const idempotencyKey = req.headers.get("idempotency-key")?.trim() || null;
  const fingerprint = idempotencyKey
    ? `idem:${idempotencyKey}`
    : `content:${JSON.stringify([body.content, body.sourceUrl ?? null, body.selection ?? null])}`;
  const key = `ext_${createHash("sha256").update(fingerprint).digest("hex").slice(0, 40)}`;
  const now = new Date();

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
    if ((e as { code?: string }).code === "P2002") {
      // The same capture was stored by an earlier request: return that row, store nothing new.
      const existing = await prisma.brainMemory.findUnique({
        where: { category_key: { category: "brain_dump", key } },
        select: { id: true, key: true },
      });
      if (existing) return Response.json({ ok: true, id: existing.id, key: existing.key, duplicate: true });
    }
    log.warn("dump_persist_failed", {
      err: e instanceof Error ? e.message.slice(0, 200) : String(e),
    });
    return Response.json(
      { error: "persist failed" },
      { status: 500 },
    );
  }
}
