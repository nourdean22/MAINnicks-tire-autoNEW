/**
 * Pinned-memory service · Phase YY (2026-05-19 AM).
 *
 * Nour's always-loaded context slots · pinned BrainMemory rows with
 * category="pinned_user" · confidence=1.0 · expiresAt=null.
 *
 * How many actually reach the model: `PINNED_PROMPT_CAP` pins, at
 * `PINNED_PROMPT_CHARS` each, both declared in lib/ai/prompt/v2/
 * renderer.ts. This header used to say "the system prompt at
 * lib/ai/system-prompt.ts reads pinned_user every turn and injects the
 * top-5" — wrong module and wrong number. The read is
 * lib/ai/context/command-center-state.ts, and it is the v2 renderer that
 * injects. `listPins` itself is the FULL roster (top 50), which is what
 * an operator surface should render; only the `stats` envelope below
 * speaks about injection, and it does so with the injector's numbers.
 *
 * Called by BOTH the legacy `/api/brain/pinned` endpoints AND the new
 * `trpc.brain.{pinned,createPin,updatePin,deletePin}` procedures ·
 * drift between consumers structurally impossible.
 */

import { prisma } from "@/lib/prisma";
import { storeMemoryEmbedding } from "@/lib/brain/embedding-utils";
import { softDelete } from "@/lib/db/soft-delete";
import { logCreate, logUpdate, stripNoise } from "@/lib/db/entity-audit";
import { BRAIN_CATEGORIES } from "@/lib/brain/categories";
import {
  PINNED_PROMPT_CAP,
  renderPinnedLine,
} from "@/lib/ai/prompt/v2/renderer";

interface PinMetadata {
  label?: string;
  pinnedAt?: string;
}

export class PinNotFoundError extends Error {
  constructor(public readonly id: string) {
    super("not a pin");
    this.name = "PinNotFoundError";
  }
}

export class PinContentRequiredError extends Error {
  constructor(message = "content required") {
    super(message);
    this.name = "PinContentRequiredError";
  }
}

export class PinContentTooLongError extends Error {
  constructor() {
    super("content too long (max 2000 chars)");
    this.name = "PinContentTooLongError";
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

export async function listPins(args: { withStats?: boolean } = {}): Promise<Record<string, unknown>> {
  const pins = await prisma.brainMemory.findMany({
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

  if (args.withStats) {
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

    // 2026-09-02 · this block used to invent its own injection numbers:
    // `Math.min(pins.length, 5)` and a 260-char-per-pin preview, neither of
    // which matched the renderer (no cap, 200 chars) or the query that fed
    // it (`take: 6`). The /pins page header (app/(mastery)/pins/page.tsx:
    // 291-292) prints both, so the operator read a fabricated cap and a
    // fabricated token cost on a second surface. Both now come from the
    // injector itself, and the cost is measured by rendering the actual
    // prompt line rather than by guessing at a preview width.
    const injected = pins.slice(0, PINNED_PROMPT_CAP);
    const injectedChars = injected.reduce(
      (sum, p) => sum + renderPinnedLine(p).length,
      0,
    );

    payload.stats = {
      freshPins,
      stalePins,
      veryStalePins,
      totalChars,
      avgChars: pins.length > 0 ? Math.round(totalChars / pins.length) : 0,
      bySource,
      injectedCount: injected.length,
      estimatedPromptTokens: Math.round(injectedChars / 4),
      oldestUpdatedAt: oldest ? oldest.updatedAt.toISOString() : null,
    };
  }

  return payload;
}

export async function createPin(args: {
  content: string;
  source?: string;
  label?: string;
}): Promise<{ pin: unknown; created: boolean }> {
  const content = (args.content || "").trim();
  if (!content) throw new PinContentRequiredError();
  if (content.length > 2000) throw new PinContentTooLongError();

  const key = slugifyKey(content);

  const existing = await prisma.brainMemory.findUnique({
    where: { category_key: { category: BRAIN_CATEGORIES.PINNED_USER, key } },
  });

  const metadata: PinMetadata = {
    label: args.label || undefined,
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
          metadata: metadata as never,
        },
      })
    : await prisma.brainMemory.create({
        data: {
          category: BRAIN_CATEGORIES.PINNED_USER,
          key,
          content: content.slice(0, 1200),
          confidence: 1.0,
          expiresAt: null,
          source: args.source || "pin:chat",
          metadata: metadata as never,
        },
      });

  // Entity-audit · distinguish create vs re-pin (bumped seenCount)
  if (existing) {
    void logUpdate(
      "brainMemory",
      row.id,
      stripNoise(existing as unknown as Record<string, unknown>),
      stripNoise(row as unknown as Record<string, unknown>),
      { source: "service:pins.createPin.repin" },
    );
  } else {
    void logCreate(
      "brainMemory",
      row.id,
      row as unknown as Record<string, unknown>,
      {
        source: "service:pins.createPin.create",
        reason: "user pin",
      },
    );
  }

  // Fire-and-forget embedding · pinned items semantically searchable
  storeMemoryEmbedding(
    row.id,
    `[pinned_user] ${key}: ${row.content}`,
  ).catch(() => {});

  return { pin: row, created: !existing };
}

export async function updatePin(args: {
  id: string;
  content?: string;
  label?: string;
  source?: string;
}): Promise<{ pin: unknown }> {
  const existing = await prisma.brainMemory.findUnique({
    where: { id: args.id },
  });
  if (!existing || existing.category !== "pinned_user") {
    throw new PinNotFoundError(args.id);
  }

  const prevMeta = (existing.metadata as PinMetadata | null) || {};
  const nextMeta: PinMetadata = {
    label: args.label !== undefined ? args.label : prevMeta.label,
    pinnedAt: prevMeta.pinnedAt || new Date().toISOString(),
  };

  const newContent =
    args.content !== undefined
      ? args.content.trim().slice(0, 1200)
      : existing.content;

  if (!newContent) {
    throw new PinContentRequiredError("content cannot be empty");
  }

  const updated = await prisma.brainMemory.update({
    where: { id: args.id },
    data: {
      content: newContent,
      source: args.source || existing.source,
      metadata: nextMeta as never,
    },
  });

  if (args.content !== undefined && args.content !== existing.content) {
    storeMemoryEmbedding(
      updated.id,
      `[pinned_user] ${updated.key}: ${updated.content}`,
    ).catch(() => {});
  }

  return { pin: updated };
}

export async function deletePin(args: {
  id: string;
}): Promise<{ deleted: boolean; soft: true; id: string; noop: boolean }> {
  // v7.9 · soft-delete · pins can be restored from the trash view
  const result = await softDelete("brainMemory", { id: args.id });
  return {
    deleted: result.ok,
    soft: true,
    id: args.id,
    noop: result.noop,
  };
}
