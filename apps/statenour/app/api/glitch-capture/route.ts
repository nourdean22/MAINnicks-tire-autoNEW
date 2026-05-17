// CP7 · force-dynamic · Railway build cannot reach Neon during static
// prerender. Runtime semantics unchanged (cached() makes these effectively
// dynamic on Vercel too).
export const dynamic = "force-dynamic";

/**
 * /api/glitch-capture · v10.0.338 · one-tap "this is broken" capture
 * from /chat. Cross-cutting prevention tool per docs/glitch-taxonomy.md.
 *
 * The compounding feedback loop: when Nour sees a glitch in chat, he
 * taps the button → this endpoint snapshots the conversation context +
 * his note + a category guess → writes a brainMemory row tagged
 * `category: glitch_capture`. Weekly digest pulls these, surfaces
 * patterns ("Cat 4 races spike on deploy days"), and seeds new test
 * fixtures. Every glitch becomes a regression test.
 *
 * Why brain memory not a dedicated table:
 *   · Reuses existing infrastructure (no migration)
 *   · Ties into nightly continuity loop (glitches show up in the
 *     "what happened in Nick's head" feed)
 *   · /system/coverage already surfaces brain categories — `/system/
 *     glitch-board` (future) just filters by category
 *
 * POST body:
 *   {
 *     conversationId: string,
 *     category: "contract-drift" | "output-leakage" | "nlu-miss" |
 *               "race" | "workflow-stall" | "data-integrity" |
 *               "quality-regression" | "operational-silence" | "other",
 *     note: string,             // operator's free-text note
 *     messageIds?: string[],    // optional · which specific messages
 *                               //   were broken
 *   }
 *
 * Response:
 *   { ok: true, memoryId: string, taskSpawned?: boolean }
 *
 * Auth: requireSession (operator-only).
 */

import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth-guard";
import { prisma } from "@/lib/prisma";
import { BRAIN_CATEGORIES } from "@/lib/brain/categories";
import { logger } from "@/lib/logger";

const log = logger.withSurface("api/glitch-capture");

const VALID_CATEGORIES = [
  "contract-drift",
  "output-leakage",
  "nlu-miss",
  "race",
  "workflow-stall",
  "data-integrity",
  "quality-regression",
  "operational-silence",
  "other",
] as const;
type GlitchCategory = (typeof VALID_CATEGORIES)[number];

interface CaptureBody {
  conversationId: string;
  category: GlitchCategory;
  note: string;
  messageIds?: string[];
}

export async function POST(req: Request) {
  try {
    await requireSession(req);
  } catch {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: CaptureBody;
  try {
    body = (await req.json()) as CaptureBody;
  } catch {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }

  const { conversationId, category, note, messageIds } = body;

  if (!conversationId || typeof conversationId !== "string") {
    return NextResponse.json(
      { error: "conversationId required" },
      { status: 400 },
    );
  }
  if (!VALID_CATEGORIES.includes(category)) {
    return NextResponse.json(
      {
        error: `category must be one of: ${VALID_CATEGORIES.join(", ")}`,
      },
      { status: 400 },
    );
  }
  if (typeof note !== "string" || note.trim().length === 0) {
    return NextResponse.json(
      { error: "note required (describe what went wrong)" },
      { status: 400 },
    );
  }

  // Snapshot the last 8 messages for context · gives the future fix-it
  // session a coherent transcript without bloating the row.
  const recentMessages = await prisma.chatMessage
    .findMany({
      where: { conversationId },
      orderBy: { createdAt: "desc" },
      take: 8,
      select: {
        id: true,
        role: true,
        content: true,
        model: true,
        provider: true,
        routerReason: true,
        streamingState: true,
        createdAt: true,
      },
    })
    .catch(() => []);

  // Reverse so transcript reads chronologically
  const transcript = recentMessages.reverse();

  // Build a key that's somewhat human-readable but unique-ish for
  // brain-recall queries · "glitch · <category> · <yyyy-mm-dd>"
  const key = `glitch · ${category} · ${new Date().toISOString().slice(0, 10)}`;

  const memory = await prisma.brainMemory.create({
    data: {
      category: BRAIN_CATEGORIES.GLITCH_CAPTURE,
      key,
      content: [
        `Operator-flagged glitch · category: ${category}`,
        ``,
        `Note: ${note}`,
        ``,
        `Conversation: ${conversationId}`,
        messageIds && messageIds.length > 0
          ? `Flagged messages: ${messageIds.join(", ")}`
          : "",
        ``,
        `Recent transcript (last ${transcript.length} messages):`,
        ...transcript.map(
          (m) =>
            `  [${m.role}/${m.model ?? m.provider ?? "unknown"}] ${(m.content ?? "").slice(0, 200).replace(/\n/g, " ")}`,
        ),
      ]
        .filter(Boolean)
        .join("\n"),
      confidence: 1, // operator-flagged · highest confidence
      seenCount: 1,
      source: "operator-tap",
      metadata: {
        conversationId,
        category,
        note,
        messageIds: messageIds ?? [],
        transcriptIds: transcript.map((m) => m.id),
        capturedAt: new Date().toISOString(),
      },
    },
  });

  log.info("glitch_captured", {
    memoryId: memory.id,
    category,
    conversationId,
    transcriptCount: transcript.length,
  });

  return NextResponse.json({
    ok: true,
    memoryId: memory.id,
    capturedAt: memory.createdAt,
  });
}

export async function GET(req: Request) {
  try {
    await requireSession(req);
  } catch {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // List recent glitch captures for the operator dashboard / weekly digest.
  const url = new URL(req.url);
  const take = Math.min(
    Math.max(parseInt(url.searchParams.get("take") ?? "25", 10), 1),
    100,
  );

  const captures = await prisma.brainMemory.findMany({
    where: { category: BRAIN_CATEGORIES.GLITCH_CAPTURE },
    orderBy: { createdAt: "desc" },
    take,
    select: {
      id: true,
      key: true,
      content: true,
      metadata: true,
      createdAt: true,
    },
  });

  // Roll up category counts for the dashboard tile
  const counts: Record<string, number> = {};
  for (const c of captures) {
    const cat = (c.metadata as { category?: string } | null)?.category ?? "other";
    counts[cat] = (counts[cat] ?? 0) + 1;
  }

  return NextResponse.json({
    captures,
    counts,
    total: captures.length,
  });
}
