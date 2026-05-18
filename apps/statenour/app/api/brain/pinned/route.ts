// CP7 · force-dynamic · Railway build cannot reach Neon during static
// prerender. Runtime semantics unchanged (cached() makes these effectively
// dynamic on Vercel too).
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { storeMemoryEmbedding } from "@/lib/brain/embedding-utils";
import { softDelete } from "@/lib/db/soft-delete";
import { logCreate, logUpdate, stripNoise } from "@/lib/db/entity-audit";

import { requireSession } from "@/lib/auth-guard";
import { BRAIN_CATEGORIES } from "@/lib/brain/categories";
export const runtime = "nodejs";

/**
 * PINNED MEMORY API — Nour's always-loaded context slots.
 *
 * A pin is a BrainMemory row with:
 *   category: BRAIN_CATEGORIES.PINNED_USER
 *   confidence:  1.0 (max — survives every pruning pass)
 *   expiresAt:   null (permanent)
 *   source:      "pin:chat" | "pin:command" | "pin:manual" | etc.
 *
 * System prompt (lib/ai/system-prompt.ts) reads category=pinned_user
 * every turn and injects the top 5 into a "Pinned by Nour" block
 * above the rolling memory window. This is the user-controlled
 * equivalent of the hard-coded permanent-principles block.
 *
 * Routes:
 *   GET    — list current pins with stats (?withStats=1)
 *   POST   — pin content ({ content, source?, label? })
 *   PATCH  — edit pin ({ id, content?, label?, source? })
 *   DELETE — unpin by id (?id=)
 */

type PinCreateBody = {
  content?: string;
  source?: string;
  label?: string;
};

type PinPatchBody = {
  id?: string;
  content?: string;
  label?: string;
  source?: string;
};

type PinMetadata = { label?: string; pinnedAt?: string };

export async function GET(req: NextRequest) {
  // v10.0.183 · auth was guarded on PATCH/POST/DELETE elsewhere in
  // this file but the GET path was open. Pins contain private
  // memory snapshots Nour selected to keep top-of-mind.
  await requireSession(req);
  try {
    const url = new URL(req.url);
    const withStats = url.searchParams.get("withStats") === "1";

    const pins = await prisma.brainMemory.findMany({
      // v8.24 · soft-delete retrofit. Without `deletedAt: null`, archived
      // pins would resurface on the user's pin board after deletion.
      where: { category: BRAIN_CATEGORIES.PINNED_USER, deletedAt: null },
      orderBy: { updatedAt: "desc" },
      take: 50,
      select: {
        id: true,
        key: true,
        content: true,
        source: true,
        confidence: true,
        seenCount: true,
        createdAt: true,
        updatedAt: true,
        metadata: true,
      },
    });

    const payload: Record<string, unknown> = {
      pins,
      count: pins.length,
    };

    if (withStats) {
      const now = Date.now();
      const WEEK = 7 * 86400_000;
      const FORTNIGHT = 14 * 86400_000;
      const MONTH = 30 * 86400_000;
      let stalePins = 0;
      let freshPins = 0;
      let veryStalePins = 0;
      const bySource: Record<string, number> = {};
      let totalChars = 0;
      let oldest: { updatedAt: Date; content: string } | null = null;

      for (const p of pins) {
        const age = now - p.updatedAt.getTime();
        if (age < WEEK) freshPins++;
        if (age >= FORTNIGHT) stalePins++;
        if (age >= MONTH) veryStalePins++;
        totalChars += p.content.length;
        const src = p.source || "unknown";
        bySource[src] = (bySource[src] ?? 0) + 1;
        if (!oldest || p.updatedAt < oldest.updatedAt) {
          oldest = { updatedAt: p.updatedAt, content: p.content };
        }
      }

      // Approximate prompt-token cost: ~4 chars per token. Top-5 only
      // make it into the prompt, but showing full cost helps Nour
      // decide when to prune.
      const top5Chars = pins
        .slice(0, 5)
        .reduce((sum, p) => sum + Math.min(p.content.length, 260), 0);

      payload.stats = {
        freshPins,
        stalePins,
        veryStalePins,
        totalChars,
        avgChars: pins.length > 0 ? Math.round(totalChars / pins.length) : 0,
        bySource,
        injectedCount: Math.min(pins.length, 5),
        estimatedPromptTokens: Math.round(top5Chars / 4),
        oldestUpdatedAt: oldest ? oldest.updatedAt.toISOString() : null,
      };
    }

    return NextResponse.json(payload);
  } catch (err) {
    // Error shape: {error, code}. Deliberately NO `pins: []` here —
    // returning empty data on 500 lets clients silently treat failure
    // as "no pins exist" which hides real bugs. Clients already check
    // res.ok before reading the body.
    return NextResponse.json(
      {
        error: err instanceof Error ? err.message : "fetch failed",
        code: "PINS_FETCH_FAILED",
      },
      { status: 500 }
    );
  }
}

function slugifyKey(content: string): string {
  const raw = content
    .slice(0, 80)
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .slice(0, 60);
  return raw || `pin-${Date.now()}`;
}

export async function POST(req: NextRequest) {
  await requireSession(req);
  try {
    const body = (await req.json()) as PinCreateBody;
    const content = (body.content || "").trim();
    if (!content) {
      return NextResponse.json({ error: "content required" }, { status: 400 });
    }
    if (content.length > 2000) {
      return NextResponse.json(
        { error: "content too long (max 2000 chars)" },
        { status: 400 }
      );
    }

    const key = slugifyKey(content);

    const existing = await prisma.brainMemory.findUnique({
      where: { category_key: { category: BRAIN_CATEGORIES.PINNED_USER, key } },
    });

    const metadata: PinMetadata = {
      label: body.label || undefined,
      pinnedAt: new Date().toISOString(),
    };

    const row = existing
      ? await prisma.brainMemory.update({
          where: { id: existing.id },
          data: {
            content: content.slice(0, 1200),
            confidence: 1.0,
            expiresAt: null,
            seenCount: existing.seenCount + 1,
            metadata: metadata as any,
          },
        })
      : await prisma.brainMemory.create({
          data: {
            category: BRAIN_CATEGORIES.PINNED_USER,
            key,
            content: content.slice(0, 1200),
            confidence: 1.0,
            expiresAt: null,
            source: body.source || "pin:chat",
            metadata: metadata as any,
          },
        });

    // v8.0 — entity-audit. Differentiate pin-created vs pin-update
    // (re-pin existing key bumps seenCount + reasserts content).
    if (existing) {
      void logUpdate(
        "brainMemory",
        row.id,
        stripNoise(existing as unknown as Record<string, unknown>),
        stripNoise(row as unknown as Record<string, unknown>),
        { source: "api:brain/pinned.POST.repin" },
      );
    } else {
      void logCreate("brainMemory", row.id, row as unknown as Record<string, unknown>, {
        source: "api:brain/pinned.POST.create",
        reason: "user pin",
      });
    }

    // Fire-and-forget embedding so pinned items are semantically
    // searchable alongside the rest of the brain.
    storeMemoryEmbedding(row.id, `[pinned_user] ${key}: ${row.content}`).catch(() => {});

    return NextResponse.json({ pin: row, created: !existing });
  } catch (err) {
    return NextResponse.json(
      {
        error: err instanceof Error ? err.message : "pin failed",
        code: "PIN_WRITE_FAILED",
      },
      { status: 500 }
    );
  }
}

export async function PATCH(req: NextRequest) {
  await requireSession(req);
  try {
    const body = (await req.json()) as PinPatchBody;
    if (!body.id) {
      return NextResponse.json({ error: "id required" }, { status: 400 });
    }
    const existing = await prisma.brainMemory.findUnique({
      where: { id: body.id },
    });
    if (!existing || existing.category !== "pinned_user") {
      return NextResponse.json({ error: "not a pin" }, { status: 404 });
    }

    const prevMeta = (existing.metadata as PinMetadata | null) || {};
    const nextMeta: PinMetadata = {
      label: body.label !== undefined ? body.label : prevMeta.label,
      pinnedAt: prevMeta.pinnedAt || new Date().toISOString(),
    };

    const newContent =
      body.content !== undefined
        ? body.content.trim().slice(0, 1200)
        : existing.content;

    if (!newContent) {
      return NextResponse.json({ error: "content cannot be empty" }, { status: 400 });
    }

    const updated = await prisma.brainMemory.update({
      where: { id: body.id },
      data: {
        content: newContent,
        source: body.source || existing.source,
        metadata: nextMeta as any,
        // Touch updatedAt by keeping the same row — prisma auto-bumps
        // @updatedAt.
      },
    });

    // Re-embed on content change so semantic search stays accurate.
    if (body.content !== undefined && body.content !== existing.content) {
      storeMemoryEmbedding(
        updated.id,
        `[pinned_user] ${updated.key}: ${updated.content}`
      ).catch(() => {});
    }

    return NextResponse.json({ pin: updated });
  } catch (err) {
    return NextResponse.json(
      {
        error: err instanceof Error ? err.message : "patch failed",
        code: "PIN_PATCH_FAILED",
      },
      { status: 500 }
    );
  }
}

export async function DELETE(req: NextRequest) {
  await requireSession(req);
  try {
    const url = new URL(req.url);
    const id = url.searchParams.get("id");
    if (!id) {
      return NextResponse.json({ error: "id required" }, { status: 400 });
    }
    // v7.9: soft-delete — pins can be restored from the trash view.
    const result = await softDelete("brainMemory", { id });
    return NextResponse.json({ deleted: result.ok, soft: true, id, noop: result.noop });
  } catch (err) {
    return NextResponse.json(
      {
        error: err instanceof Error ? err.message : "unpin failed",
        code: "PIN_DELETE_FAILED",
      },
      { status: 500 }
    );
  }
}
