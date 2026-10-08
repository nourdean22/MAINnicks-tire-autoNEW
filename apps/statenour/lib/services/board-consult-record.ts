/**
 * lib/services/board-consult-record.ts · persist + read board
 * consultations (task #24).
 *
 * Composition layer over `lib/ai/board/consult.ts` (the pure
 * consultation service) + `brainMemory.remember` (the storage). Keeps
 * the tRPC procedure thin · keeps the service unit-testable without a
 * tRPC harness.
 *
 * Why a separate file (not folded into consult.ts) · the consult
 * service is the PURE pattern · no Prisma · no brainMemory imports.
 * Adding persistence to it would couple the strategic pattern to the
 * storage layer. This file is the COMPOSITION · it knows about both.
 *
 * Read-side helper `listRecentBoardConsultations` is the equivalent
 * of `listRecentReflections` (#13 ADR) · returns flat projected views
 * so the metadata Json never crosses the tRPC boundary (TS2589
 * firewall).
 */

import { prisma } from "@/lib/prisma";
import { brainMemory } from "@/lib/brain/memory-manager";
import { BRAIN_CATEGORIES } from "@/lib/brain/categories";
import { logger as rootLogger } from "@/lib/logger";
import { consultBoard as runConsultBoard } from "@/lib/ai/board/consult";
import type {
  AdvisorTake,
  BoardConsultation,
  BoardId,
  BoardSynthesis,
} from "@/lib/ai/board/types";

const log = rootLogger.withSurface("services/board-consult-record");

/**
 * AG-19 · live-business context for the advisors. consultBoard used to
 * receive ONLY the question text — "should I raise alignment prices"
 * got answered without the shop's actual numbers. This composition
 * layer (allowed to touch services/Prisma; consult.ts is not) builds a
 * capped block from the meta-scoreboard, plus revenue + the latest
 * pricing advisory when the question smells like pricing/revenue.
 * Best-effort: any failure returns "" → the old context-blind consult.
 *
 * Exported for its test only. 2026-10-08: revenue went in as "live numbers"
 * without checking `bridgeAvailable`, so during a shop-bridge outage the
 * advisors were handed `"totalRevenue":"0.00"` as the month's revenue. An
 * unreadable month is now stated as unknown, never as zero.
 */
export async function buildBusinessContextBlock(question: string): Promise<string> {
  try {
    const parts: string[] = [];
    const { buildMetaScoreboard } = await import("@/lib/services/meta-scoreboard");
    const board = await buildMetaScoreboard();
    parts.push(JSON.stringify(board).slice(0, 900));

    if (/\b(pric(e|ing)|revenue|margin|cost|charge|discount|rate)\b/i.test(question)) {
      const { getRevenueStats } = await import("@/lib/services/business-intel");
      const rev = await getRevenueStats("month").catch(() => null);
      if (rev?.bridgeAvailable) {
        parts.push(`Revenue (month): ${JSON.stringify(rev).slice(0, 300)}`);
      } else if (rev) {
        parts.push(
          "Revenue (month): UNKNOWN, the shop bridge could not be read. Do not state or assume a figure.",
        );
      }
      const advisory = await prisma.brainMemory
        .findFirst({
          where: { category: "pricing_advisory" },
          orderBy: { createdAt: "desc" },
          select: { content: true },
        })
        .catch(() => null);
      if (advisory?.content) parts.push(`Latest pricing advisory: ${advisory.content.slice(0, 240)}`);
    }

    const body = parts.join("\n").slice(0, 1500);
    return body
      ? `CURRENT BUSINESS STATE (live numbers · cite when relevant):\n${body}`
      : "";
  } catch {
    return "";
  }
}

/**
 * Run a consultation AND persist it. Returns the full consultation
 * + the BrainMemory.id of the persisted record (so the caller can
 * link to it · `/brain/board/<id>` deep-links land later).
 */
export async function consultBoardAndPersist(
  boardId: BoardId,
  question: string,
): Promise<{ consultation: BoardConsultation; recordId: string }> {
  const contextBlock = await buildBusinessContextBlock(question);
  const consultation = await runConsultBoard(boardId, question, contextBlock);

  // Persist as a BrainMemory row · key encodes the (board, time)
  // tuple so re-running the same board on the same instant collides
  // intentionally (idempotency via the (category, key) unique index ·
  // same pattern as reflection rows · #12 ADR).
  const key = `board:${consultation.boardId}:${consultation.ranAt}`;
  // Content is a short human-readable summary · what an operator
  // sees in /brain/recall when this row surfaces in unrelated chat.
  // 200-char cap on the recommendation keeps the row content scannable.
  const recoPreview = consultation.synthesis.recommendation.slice(0, 240);
  const questionPreview = consultation.question.slice(0, 120);
  const content =
    `${consultation.boardName} on "${questionPreview}" → ${recoPreview}`.slice(0, 800);

  const row = await brainMemory.remember(
    BRAIN_CATEGORIES.BOARD_CONSULTATION,
    key,
    content,
    "board",
    {
      boardId: consultation.boardId,
      boardName: consultation.boardName,
      question: consultation.question,
      ranAt: consultation.ranAt,
      durationMs: consultation.durationMs,
      // 2026-09-02 · the mood gate's verdict, persisted.
      //
      // `lib/ai/board/consult.ts` MOOD_DROP_RULES silently removes up to
      // 3 of 5 advisors when mood=depleted and 4 when mood=scattered, on
      // the one surface whose stated premise is that it "preserves
      // divergence rather than fusing lenses into one answer". Until now
      // the only trace outside the live response was prose inside the
      // synthesizer's raw prompt, so a consultation could never be
      // re-inspected: an operator reading a three-advisor row in history
      // had no way to learn that two lenses were withheld, or why.
      //
      // Both fields are written unconditionally (empty array / null when
      // no gating ran) so a reader can tell "no advisors were dropped"
      // apart from "this row predates the field".
      droppedAdvisorIds: consultation.droppedAdvisorIds,
      operatorState: consultation.operatorState,
      // Compact projection of takes · keeps Json column under a few KB
      // even for full boards. Full take detail can be re-derived from
      // the BoardConsultation that the caller still holds in memory
      // (tRPC returns it alongside the recordId).
      takes: consultation.takes.map((t) => ({
        advisorId: t.advisorId,
        advisorName: t.advisorName,
        lensOneLine: t.lensOneLine,
        recommendation: t.recommendation,
        confidence: t.confidence,
        divergenceFlag: t.divergenceFlag ?? null,
        provider: t.provider,
        error: t.error ?? null,
      })),
      synthesis: {
        consensus: consultation.synthesis.consensus,
        divergences: consultation.synthesis.divergences,
        tension: consultation.synthesis.tension ?? null,
        recommendation: consultation.synthesis.recommendation,
        confidence: consultation.synthesis.confidence,
      },
    },
  );

  return { consultation, recordId: row.id };
}

// ── Read-side projection ─────────────────────────────────────────

/** Flat, shallow projection of a board_consultation BrainMemory row. */
export interface BoardConsultationView {
  id: string;
  boardId: string;
  boardName: string;
  question: string;
  ranAt: string;
  /** Synthesis recommendation · the highest-signal field for a list view. */
  recommendation: string;
  /** Convergence count · derived from synthesis.consensus.length. */
  consensusCount: number;
  /** Divergence count · 0 means board agreed, ≥1 means real tension. */
  divergenceCount: number;
  /** Synthesis confidence · 0-1. */
  confidence: number;
  /** Optional tension axis · null when board agreed cleanly. */
  tension: string | null;
  /**
   * Number of advisors who actually produced takes (vs errored).
   *
   * 2026-09-02 · this now MEANS that. It was `arrLen(meta.takes)`, which
   * counts every take including the errored ones — the doc comment and
   * the arithmetic had disagreed since the field shipped. Nothing rendered
   * it, so nothing was visibly wrong; the first consumer would simply have
   * inherited the wrong number with a comment vouching for it.
   */
  advisorCount: number;
  /**
   * Advisors that answered with an `error` instead of a take. Split out
   * rather than deleted: fixing `advisorCount` to match its own
   * documentation would otherwise have made errored advisors vanish from
   * the projection entirely, trading a wrong number for a missing one.
   */
  erroredCount: number;
  /**
   * Advisor ids the mood gate removed BEFORE the fan-out — they never ran,
   * so they appear in neither count above. Empty when no gating happened.
   * Empty is also what an old row (persisted before 2026-09-02) projects
   * to; `moodAtConsult` is the field that distinguishes them.
   */
  droppedAdvisorIds: string[];
  /**
   * Operator mood recorded at consult time, or null when the state read
   * failed or the row predates persistence of it. This is the WHY behind
   * `droppedAdvisorIds` — a drop list without it is an unexplained absence.
   */
  moodAtConsult: string | null;
  /** Created timestamp (the row's createdAt). */
  createdAt: string;
}

/**
 * Loose shape of the persisted metadata · the read helper validates
 * each field before projecting so an old/malformed row degrades
 * instead of crashing the dashboard.
 */
interface PersistedMetadata {
  boardId?: unknown;
  boardName?: unknown;
  question?: unknown;
  ranAt?: unknown;
  takes?: unknown;
  synthesis?: unknown;
  droppedAdvisorIds?: unknown;
  operatorState?: unknown;
}

interface PersistedSynthesisShape {
  consensus?: unknown;
  divergences?: unknown;
  tension?: unknown;
  recommendation?: unknown;
  confidence?: unknown;
}

function arrLen(raw: unknown): number {
  return Array.isArray(raw) ? raw.length : 0;
}

/** Persisted takes carry `error: string | null`. Anything else in the
 *  array is a malformed row, counted as errored rather than as a take —
 *  an unreadable entry is not evidence an advisor answered. */
function countTakes(raw: unknown): { answered: number; errored: number } {
  if (!Array.isArray(raw)) return { answered: 0, errored: 0 };
  let answered = 0;
  let errored = 0;
  for (const t of raw) {
    const err = (t as { error?: unknown } | null)?.error;
    if (t && typeof t === "object" && (err === null || err === undefined)) answered += 1;
    else errored += 1;
  }
  return { answered, errored };
}

/** String ids only — the metadata Json is untyped at rest, and a row
 *  written by an older shape must degrade to "no drops recorded" rather
 *  than render `[object Object]` in the operator's gating strip. */
function stringList(raw: unknown): string[] {
  return Array.isArray(raw) ? raw.filter((v): v is string => typeof v === "string") : [];
}

function coerceBoardConsultationView(row: {
  id: string;
  createdAt: Date;
  metadata: unknown;
}): BoardConsultationView | null {
  const meta = (row.metadata ?? {}) as PersistedMetadata;
  if (typeof meta.boardId !== "string" || meta.boardId.length === 0) return null;
  if (typeof meta.boardName !== "string" || meta.boardName.length === 0) return null;
  if (typeof meta.question !== "string") return null;

  const synth = (meta.synthesis ?? {}) as PersistedSynthesisShape;
  const recommendation =
    typeof synth.recommendation === "string"
      ? synth.recommendation
      : "(no recommendation)";
  const consensusCount = arrLen(synth.consensus);
  const divergenceCount = arrLen(synth.divergences);
  const confidence =
    typeof synth.confidence === "number" && Number.isFinite(synth.confidence)
      ? Math.max(0, Math.min(1, synth.confidence))
      : 0;
  const tension = typeof synth.tension === "string" && synth.tension.length > 0
    ? synth.tension
    : null;
  const { answered: advisorCount, errored: erroredCount } = countTakes(meta.takes);
  const droppedAdvisorIds = stringList(meta.droppedAdvisorIds);
  const state = meta.operatorState as { mood?: unknown } | null | undefined;
  const moodAtConsult =
    state && typeof state === "object" && typeof state.mood === "string" && state.mood.length > 0
      ? state.mood
      : null;
  const ranAt =
    typeof meta.ranAt === "string" ? meta.ranAt : row.createdAt.toISOString();

  return {
    id: row.id,
    boardId: meta.boardId,
    boardName: meta.boardName,
    question: meta.question,
    ranAt,
    recommendation,
    consensusCount,
    divergenceCount,
    confidence,
    tension,
    advisorCount,
    erroredCount,
    droppedAdvisorIds,
    moodAtConsult,
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * List the N most recent board consultations · flat projection ·
 * newest first. The metadata Json is opened INSIDE this function so
 * the recursive Prisma `JsonValue` type never reaches the AppRouter
 * — same TS2589 firewall pattern as `listRecentReflections` (#13).
 */
export async function listRecentBoardConsultations(
  input: { limit?: number } = {},
): Promise<{ consultations: BoardConsultationView[]; unreadable: number }> {
  const limit = Math.max(1, Math.min(50, input.limit ?? 20));

  const rows = await prisma.brainMemory.findMany({
    where: {
      category: BRAIN_CATEGORIES.BOARD_CONSULTATION,
      deletedAt: null,
    },
    orderBy: { createdAt: "desc" },
    take: limit,
    select: {
      id: true,
      createdAt: true,
      metadata: true,
    },
  });

  const projected: BoardConsultationView[] = [];
  for (const row of rows) {
    const view = coerceBoardConsultationView(row);
    if (view) projected.push(view);
  }
  // A row that fails projection used to disappear with no count anywhere:
  // the list simply came back shorter, which reads identically to "you
  // have consulted the board fewer times". Malformed rows are the exact
  // signal that a persistence shape drifted, so they get a number and a
  // log line rather than silence.
  const unreadable = rows.length - projected.length;
  if (unreadable > 0) {
    log.warn("board_consultations_unreadable", {
      unreadable,
      fetched: rows.length,
    });
  }
  return { consultations: projected, unreadable };
}

// ── Re-export helpers the tRPC layer needs ─────────────────────

export type { AdvisorTake, BoardSynthesis };
