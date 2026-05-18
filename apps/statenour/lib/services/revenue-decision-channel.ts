/**
 * Revenue-Decision Channel · v10.0.526 · Arc C · Feature 1
 *
 * Daily engine that turns nickstire business signals into 1-3 concrete
 * operator moves, sealed against statenour ever WRITING to nickstire.
 *
 * Flow:
 *   1. pullBusinessSignals() · read-only · stitches the latest
 *      ceo_business_context AuditEvent + the live shop snapshot
 *      (bridge), surfaces the 5 signal axes used by drafting.
 *   2. matchWisdom(signals) · contextual recall against the
 *      operator's wisdom corpus (BrainMemory category="wisdom"),
 *      lightly biased toward Munger / Bezos / Naval keys.
 *   3. draftMoves(signals, wisdoms) · single tracedAiChat call
 *      ("reason" task) → structured JSON · 1-3 moves.
 *   4. formatTelegramApproval(moves) · tight 5-line message ·
 *      operator replies /approve_N · /reject_N · /approve_all ·
 *      /reject_all to the telegram webhook.
 *
 * Storage model · NO new tables. Each daily decision is a
 * BrainMemory row:
 *   · category="revenue_move"
 *   · key="move_YYYY-MM-DD_<n>" · n = 1..3
 *   · content = "WHAT: ... WHY: ... IMPACT: ..."
 *   · metadata = { what, why, expectedImpact, oneWayDoor,
 *                  wisdomCited[], status, date, moveIndex }
 *   · source = "cron:revenue-decision"
 *
 * Why a service module (not inlined in the cron): the chat tool
 * getPendingRevenueMoves reads the same row shape and the
 * /api/system/revenue-decisions surface uses the same shape, so the
 * format contract has exactly ONE producer.
 *
 * What this module DOES NOT do (statenour↔nickstire boundary):
 *   · Never POSTs to nickstire. Read-only via queryNick + bridge.
 *   · Never mutates a row in the nickstire DB. Approval flips the
 *     status field on the statenour BrainMemory · the actual move
 *     happens on the operator's side after seeing the Telegram.
 */

import { prisma } from "@/lib/prisma";
import { activeOnly } from "@/lib/db/soft-delete";
import { logger as rootLogger } from "@/lib/logger";
import { fetchShopSnapshot, type ShopSnapshot } from "@/lib/services/bridge";
import { tracedAiChat } from "@/lib/ai/traced-aichat";
import { extractJsonArray } from "@/lib/ai/extract-structured";
import { BRAIN_CATEGORIES } from "@/lib/brain/categories";
import {
  sendTelegram,
  formatTelegramNotification,
} from "@/lib/services/telegram";

const log = rootLogger.withSurface("services/revenue-decision-channel");

const TZ = "America/New_York";

// ─────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────

export interface BusinessSignals {
  /** Bookings observed today (the "line of cars" proxy). */
  lineOfCars: number;
  /** Number of unconverted estimates dangling in the pipeline. */
  declinedWorkDelta: number;
  /** Open callbacks · proxy for pipeline-aging. */
  pipelineAging: number;
  /** Reviews this week vs. baseline. Positive = improving. */
  gbpReviewDelta: number;
  /** Inverse of stale-estimate ratio · higher = healthier funnel. */
  algConversionRate: number;
  /** Total active alerts surfaced in ceo_business_context. */
  alertCount: number;
  /** Snapshot freshness · ISO timestamp · null when both sources stale. */
  source: "ceo_context" | "bridge" | "merged" | "empty";
  contextAt: string | null;
  bridgeAt: string | null;
}

export interface WisdomCitation {
  /** BrainMemory.id · for downstream verification. */
  id: string;
  /** BrainMemory.key — e.g. "wisdom_munger_inversion". */
  key: string;
  /** First-90 of the wisdom content · cited inline in moves. */
  excerpt: string;
}

export interface RevenueMove {
  /** Index in today's batch · 1-3. */
  moveIndex: number;
  /** One-sentence concrete action · operator can execute on their own. */
  what: string;
  /** Reasoning grounded in the wisdom citations. */
  why: string;
  /** Expected impact · $$, hours saved, or "qualitative". */
  expectedImpact: string;
  /** Bezos one-way-door: reversible? · operator sees this on phone. */
  oneWayDoor: boolean;
  /** Wisdom keys cited by the move · e.g. ["wisdom_munger_inversion"]. */
  wisdomCited: string[];
}

export interface MoveRow {
  date: string;
  moveIndex: number;
  move: RevenueMove;
  status: "pending" | "approved" | "rejected";
  createdAt: Date;
  decidedAt: Date | null;
}

// ─────────────────────────────────────────────────────────────────
// Step 1 · pull signals
// ─────────────────────────────────────────────────────────────────

function num(v: unknown): number {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

/**
 * Read-only signal stitching. Tries the latest ceo_business_context
 * AuditEvent first (richer · already normalized by
 * buildCeoContextFromNickSyncPayload). Falls back to the live bridge
 * snapshot. Returns an `empty` shape · never throws · so the cron can
 * decide whether to skip.
 */
export async function pullBusinessSignals(): Promise<BusinessSignals> {
  // a) Latest normalized CEO context · the cron payload Nick prompts read.
  const ceoCtx = await prisma.auditEvent
    .findFirst({
      where: { eventType: "ceo_business_context" },
      orderBy: { createdAt: "desc" },
      select: { payload: true, createdAt: true },
    })
    .catch(() => null);

  // b) Live shop snapshot · bridge or live-query fallback.
  const snap = await fetchShopSnapshot().catch(() => null);

  if (!ceoCtx && !snap) {
    log.warn("no_signals_available", {});
    return {
      lineOfCars: 0,
      declinedWorkDelta: 0,
      pipelineAging: 0,
      gbpReviewDelta: 0,
      algConversionRate: 0,
      alertCount: 0,
      source: "empty",
      contextAt: null,
      bridgeAt: null,
    };
  }

  const payload = (ceoCtx?.payload ?? null) as Record<string, unknown> | null;
  const revenue = (payload?.revenue ?? null) as Record<string, unknown> | null;
  const declined = (payload?.declinedWork ?? null) as Record<string, unknown> | null;
  const callbacks = (payload?.callbacks ?? null) as Record<string, unknown> | null;
  const leads = (payload?.leads ?? null) as Record<string, unknown> | null;
  const funnel = (payload?.estimateLeadFunnel ?? null) as Record<string, unknown> | null;
  const last7 = (funnel?.last7d ?? null) as Record<string, unknown> | null;

  // declinedWorkDelta · prefer declined.count · fall back to safetyItemCount.
  const declinedWorkDelta = num(
    declined?.count ?? declined?.totalCount ?? declined?.safetyItemCount ?? 0,
  );

  // pipelineAging · pending callbacks (oldest unresolved) · fall back to
  // stale-7d new estimates from the funnel.
  const pipelineAging = num(
    callbacks?.pendingCount ??
      callbacks?.new ??
      last7?.staleNewEstimates ??
      snap?.callbacks?.pendingCount ??
      0,
  );

  // lineOfCars · bookings today · proxy for "cars on the lot".
  const lineOfCars = num(
    payload?.workOrders && (payload.workOrders as Record<string, unknown>).activeToday
      ? (payload.workOrders as Record<string, unknown>).activeToday
      : snap?.bookings?.todayCount ?? 0,
  );

  // gbpReviewDelta · GBP review counter from the bridge intelligence
  // section · falls back to 0 (cron treats 0 as "no new signal").
  const intel = (payload?.intelligence ?? null) as Record<string, unknown> | null;
  const gbpReviewDelta = num(intel?.gbpReviewsThisWeek ?? intel?.reviewDelta7d ?? 0);

  // algConversionRate · derived from stale-estimate ratio · higher is
  // healthier. Fallback: revenue.todayEstimate / (revenue.todayEstimate
  // + declinedWorkDelta·avg-ticket-proxy). We keep it simple here · the
  // exact formula lives downstream when the prompt asks for math.
  const stale = num(last7?.staleNewEstimates ?? 0);
  const totalLeads = num(leads?.total ?? leads?.totalActive ?? snap?.leads?.totalActive ?? 0);
  const algConversionRate =
    totalLeads > 0 ? Math.max(0, 1 - stale / totalLeads) : 0;

  // alertCount · prioritizedActions surfaced by the CEO context builder.
  const alertCount = Array.isArray(payload?.prioritizedActions)
    ? (payload!.prioritizedActions as unknown[]).length
    : 0;

  return {
    lineOfCars,
    declinedWorkDelta,
    pipelineAging,
    gbpReviewDelta,
    algConversionRate: Number(algConversionRate.toFixed(3)),
    alertCount,
    source: ceoCtx && snap ? "merged" : ceoCtx ? "ceo_context" : "bridge",
    contextAt: ceoCtx?.createdAt?.toISOString?.() ?? null,
    bridgeAt: (snap as ShopSnapshot | null)?.timestamp ?? null,
  };
}

// ─────────────────────────────────────────────────────────────────
// Step 2 · wisdom recall
// ─────────────────────────────────────────────────────────────────

const PREFERRED_WISDOM_KEY_PREFIXES = [
  "wisdom_munger_",
  "wisdom_bezos_",
  "wisdom_naval_",
];

/**
 * Pull 2-3 wisdoms from BrainMemory(category="wisdom") most relevant
 * to today's signals.
 *
 * Implementation note · contextual-recall.ts has a heavier embedding
 * pipeline tuned for chat context · we use a leaner direct query here
 * because the cron runs once daily, the candidate pool is small
 * (curated wisdom rows · ~300 rows in prod), and a simple keyword +
 * preferred-prefix bias gives stable picks day over day. The chat
 * tool path uses the recall pipeline for the heavier semantic step.
 */
export async function matchWisdom(
  signals: BusinessSignals,
  limit = 3,
): Promise<WisdomCitation[]> {
  // Build a small set of keyword signals from the today-shape · feeds
  // the BrainMemory LIKE search and the prefix bias.
  const keywords: string[] = [];
  if (signals.declinedWorkDelta > 0) keywords.push("estimate", "lost", "follow");
  if (signals.pipelineAging > 0) keywords.push("speed", "follow-up", "callback");
  if (signals.lineOfCars > 0) keywords.push("flow", "capacity", "lot");
  if (signals.gbpReviewDelta !== 0) keywords.push("review", "reputation");
  if (signals.algConversionRate < 0.5) keywords.push("conversion", "funnel");
  keywords.push("invert", "leverage", "irreversible"); // always-on lenses

  // Pull a wider pool · we re-rank in memory below.
  // v10.0.529.106 wave-77 · inlined the where + migrated to activeOnly() helper.
  const pool = await prisma.brainMemory
    .findMany({
      where: activeOnly({
        category: BRAIN_CATEGORIES.WISDOM,
        confidence: { gte: 0.4 },
      }),
      orderBy: { confidence: "desc" },
      take: 60,
      select: { id: true, key: true, content: true, confidence: true, source: true },
    })
    .catch(() => [] as Array<{ id: string; key: string; content: string; confidence: number; source: string }>);

  if (pool.length === 0) return [];

  // Score · keyword overlap + preferred-prefix bias + confidence floor.
  const scored = pool.map((row) => {
    const lc = row.content.toLowerCase();
    let kwScore = 0;
    for (const k of keywords) {
      if (lc.includes(k)) kwScore += 1;
    }
    const prefixBoost = PREFERRED_WISDOM_KEY_PREFIXES.some((p) =>
      row.key.startsWith(p),
    )
      ? 1.4
      : 1.0;
    const score = (kwScore + 0.5) * prefixBoost * row.confidence;
    return { row, score };
  });

  scored.sort((a, b) => b.score - a.score);

  return scored.slice(0, limit).map(({ row }) => ({
    id: row.id,
    key: row.key,
    excerpt: row.content.slice(0, 220),
  }));
}

// ─────────────────────────────────────────────────────────────────
// Step 3 · draft moves
// ─────────────────────────────────────────────────────────────────

const MOVE_DRAFT_SYSTEM = `You are Nick, drafting 1-3 specific revenue moves for Nour the operator.

CONSTRAINTS:
- ALWAYS specific and concrete. Never "monitor the funnel" or "review pipeline".
- Each move is something Nour can execute in <30 min on the nickstire side.
- Each move cites at least one wisdom-key from the provided corpus.
- Be honest about oneWayDoor: TRUE only if the move is hard/expensive to reverse (firing, big spend, public commitment). Most ops moves are FALSE.
- expectedImpact is dollar-precise when you can, qualitative when you can't.

OUTPUT: a JSON array of 1 to 3 objects. Each object has:
  what: string (one sentence, action verb first)
  why: string (1-2 sentences, references at least one wisdom)
  expectedImpact: string (dollars or "qualitative")
  oneWayDoor: boolean
  wisdomCited: string[] (wisdom keys you cited)

Return ONLY the JSON array · no prose around it.`;

/**
 * Call the model once · parse to RevenueMove[] · clamp to 1-3 entries.
 * Failures return [] and the cron exits cleanly without paging Telegram.
 */
export async function draftMoves(
  signals: BusinessSignals,
  wisdoms: WisdomCitation[],
): Promise<RevenueMove[]> {
  if (wisdoms.length === 0) {
    log.info("draft_skip_no_wisdom", {});
    return [];
  }
  if (signals.source === "empty") {
    log.info("draft_skip_empty_signals", {});
    return [];
  }

  const userPayload = {
    signals,
    wisdomCorpus: wisdoms.map((w) => ({ key: w.key, excerpt: w.excerpt })),
    instructions:
      "Draft 1-3 concrete moves. Each cites a wisdom key by name. JSON array only.",
  };

  let result;
  try {
    result = await tracedAiChat(
      {
        label: "revenue-decision-draft",
        source: "cron",
        metadata: { signalSource: signals.source, wisdomCount: wisdoms.length },
      },
      [
        { role: "system", content: MOVE_DRAFT_SYSTEM },
        { role: "user", content: JSON.stringify(userPayload) },
      ],
      "reason",
    );
  } catch (err) {
    log.warn("draft_aichat_threw", {
      error: err instanceof Error ? err.message : String(err),
    });
    return [];
  }

  if (result.provider === "none" || result.provider === "emergency") {
    log.warn("draft_provider_chain_failed", { provider: result.provider });
    return [];
  }

  const parsed = extractJsonArray<unknown>(result.content);
  if (!parsed.ok) {
    log.warn("draft_json_parse_failed", { snippet: result.content.slice(0, 200) });
    return [];
  }

  const arr = parsed.value as unknown[];
  const moves: RevenueMove[] = [];
  for (let i = 0; i < Math.min(arr.length, 3); i++) {
    const raw = arr[i] as Record<string, unknown> | null;
    if (!raw || typeof raw !== "object") continue;
    const what = typeof raw.what === "string" ? raw.what.trim() : "";
    const why = typeof raw.why === "string" ? raw.why.trim() : "";
    const expectedImpact =
      typeof raw.expectedImpact === "string" ? raw.expectedImpact.trim() : "qualitative";
    const oneWayDoor =
      typeof raw.oneWayDoor === "boolean" ? raw.oneWayDoor : false;
    const wisdomCitedRaw = Array.isArray(raw.wisdomCited) ? raw.wisdomCited : [];
    const wisdomCited = wisdomCitedRaw
      .filter((x): x is string => typeof x === "string")
      .slice(0, 5);

    if (!what || !why) continue;
    moves.push({
      moveIndex: i + 1,
      what: what.slice(0, 400),
      why: why.slice(0, 600),
      expectedImpact: expectedImpact.slice(0, 200),
      oneWayDoor,
      wisdomCited,
    });
  }

  return moves;
}

// ─────────────────────────────────────────────────────────────────
// Step 4 · format Telegram approval message
// ─────────────────────────────────────────────────────────────────

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * Tight 5-line format. Per spec:
 *   line 1 · header with date + count
 *   line 2-N · "N) what · ($impact, reversible|one-way)"
 *   final line · how to reply (/approve_N · /reject_N · /approve_all)
 *
 * Returns the rendered string · sendTelegram delivers it.
 */
export function formatTelegramApproval(
  moves: RevenueMove[],
  date: string,
): string {
  if (moves.length === 0) {
    return `<b>Revenue moves · ${date}</b>\nNo moves drafted.`;
  }
  const lines: string[] = [
    `<b>Revenue moves · ${date} (${moves.length})</b>`,
  ];
  for (const m of moves) {
    const door = m.oneWayDoor ? "one-way" : "reversible";
    lines.push(
      `${m.moveIndex}) ${escapeHtml(m.what.slice(0, 140))} · <i>${escapeHtml(m.expectedImpact.slice(0, 60))} · ${door}</i>`,
    );
  }
  lines.push(
    `Reply: /approve_1..${moves.length} · /reject_N · /approve_all · /reject_all`,
  );
  return lines.join("\n");
}

// ─────────────────────────────────────────────────────────────────
// Persistence helpers
// ─────────────────────────────────────────────────────────────────

/** YYYY-MM-DD ET-day key used for idempotency + BrainMemory `key`. */
export function etDateKey(at: Date = new Date()): string {
  return at.toLocaleDateString("en-CA", { timeZone: TZ });
}

export function moveKey(date: string, moveIndex: number): string {
  return `move_${date}_${moveIndex}`;
}

/**
 * Persist a single move as BrainMemory · `category="revenue_move"`,
 * `key=move_YYYY-MM-DD_<n>`. Idempotent · upserts by (category, key).
 */
export async function persistMove(
  date: string,
  move: RevenueMove,
  signals: BusinessSignals,
  wisdoms: WisdomCitation[],
): Promise<void> {
  const key = moveKey(date, move.moveIndex);
  const content = `WHAT: ${move.what}\nWHY: ${move.why}\nIMPACT: ${move.expectedImpact}`;
  const metadata = {
    what: move.what,
    why: move.why,
    expectedImpact: move.expectedImpact,
    oneWayDoor: move.oneWayDoor,
    wisdomCited: move.wisdomCited,
    wisdomExcerpts: wisdoms
      .filter((w) => move.wisdomCited.includes(w.key))
      .map((w) => ({ key: w.key, excerpt: w.excerpt })),
    signalsSnapshot: signals,
    status: "pending" as const,
    date,
    moveIndex: move.moveIndex,
  };

  await prisma.brainMemory
    .upsert({
      where: { category_key: { category: "revenue_move", key } },
      update: {
        content,
        metadata: metadata as unknown as Parameters<
          typeof prisma.brainMemory.upsert
        >[0]["update"]["metadata"],
      },
      create: {
        category: "revenue_move",
        key,
        content,
        confidence: 0.85,
        source: "cron:revenue-decision",
        metadata: metadata as unknown as Parameters<
          typeof prisma.brainMemory.upsert
        >[0]["create"]["metadata"],
      },
    })
    .catch((err) => {
      log.warn("persist_move_failed", {
        date,
        moveIndex: move.moveIndex,
        error: err instanceof Error ? err.message : String(err),
      });
    });
}

// ─────────────────────────────────────────────────────────────────
// Read helpers · used by chat tool + /api/system/revenue-decisions
// ─────────────────────────────────────────────────────────────────

interface BrainMemoryRow {
  id: string;
  category: string;
  key: string;
  content: string;
  metadata: unknown;
  createdAt: Date;
  updatedAt: Date;
}

function rowToMoveRow(row: BrainMemoryRow): MoveRow | null {
  const meta = (row.metadata ?? null) as Record<string, unknown> | null;
  if (!meta) return null;
  const moveIndex = typeof meta.moveIndex === "number" ? meta.moveIndex : 1;
  const date = typeof meta.date === "string" ? meta.date : etDateKey(row.createdAt);
  const status =
    meta.status === "approved" || meta.status === "rejected"
      ? meta.status
      : "pending";
  const decidedAtRaw = meta.decidedAt;
  const decidedAt =
    typeof decidedAtRaw === "string" || decidedAtRaw instanceof Date
      ? new Date(decidedAtRaw as string)
      : null;

  return {
    date,
    moveIndex,
    move: {
      moveIndex,
      what: String(meta.what ?? ""),
      why: String(meta.why ?? ""),
      expectedImpact: String(meta.expectedImpact ?? "qualitative"),
      oneWayDoor: Boolean(meta.oneWayDoor),
      wisdomCited: Array.isArray(meta.wisdomCited)
        ? (meta.wisdomCited as unknown[]).filter(
            (x): x is string => typeof x === "string",
          )
        : [],
    },
    status,
    createdAt: row.createdAt,
    decidedAt,
  };
}

/** Pull all pending moves for today (or a given date). */
export async function listPendingMovesForDate(date: string): Promise<MoveRow[]> {
  const rows = await prisma.brainMemory
    .findMany({
      // v10.0.529.106 wave-77 · migrated to activeOnly() helper.
      where: activeOnly({
        category: "revenue_move",
        key: { startsWith: `move_${date}_` },
      }),
      orderBy: { key: "asc" },
    })
    .catch(() => [] as BrainMemoryRow[]);
  return rows
    .map((r) => rowToMoveRow(r as BrainMemoryRow))
    .filter((r): r is MoveRow => r !== null && r.status === "pending");
}

/** Pull all moves for the last N days · used by the system route. */
export async function listMovesSince(daysBack = 30): Promise<MoveRow[]> {
  const since = new Date(Date.now() - daysBack * 86_400_000);
  const rows = await prisma.brainMemory
    .findMany({
      // v10.0.529.106 wave-77 · migrated to activeOnly() helper.
      where: activeOnly({
        category: "revenue_move",
        createdAt: { gte: since },
      }),
      orderBy: { createdAt: "desc" },
    })
    .catch(() => [] as BrainMemoryRow[]);
  return rows
    .map((r) => rowToMoveRow(r as BrainMemoryRow))
    .filter((r): r is MoveRow => r !== null);
}

/**
 * Flip a single move's status. Used by the Telegram callback. Idempotent ·
 * a second `/approve_1` after the first one already approved is a no-op
 * (returns the pre-existing decision in `alreadyDecided`).
 */
export async function decideMove(
  date: string,
  moveIndex: number,
  decision: "approved" | "rejected",
): Promise<
  | { ok: true; alreadyDecided: boolean; status: "approved" | "rejected" }
  | { ok: false; reason: string }
> {
  const key = moveKey(date, moveIndex);
  const existing = await prisma.brainMemory
    .findUnique({
      where: { category_key: { category: "revenue_move", key } },
      select: { id: true, metadata: true },
    })
    .catch(() => null);

  if (!existing) {
    return { ok: false, reason: "move_not_found" };
  }

  const meta = (existing.metadata ?? {}) as Record<string, unknown>;
  const currentStatus = meta.status === "approved" || meta.status === "rejected"
    ? meta.status
    : "pending";

  if (currentStatus !== "pending") {
    return {
      ok: true,
      alreadyDecided: true,
      status: currentStatus as "approved" | "rejected",
    };
  }

  const nextMeta = {
    ...meta,
    status: decision,
    decidedAt: new Date().toISOString(),
  };

  await prisma.brainMemory
    .update({
      where: { category_key: { category: "revenue_move", key } },
      data: {
        metadata: nextMeta as unknown as Parameters<
          typeof prisma.brainMemory.update
        >[0]["data"]["metadata"],
      },
    })
    .catch((err) => {
      log.warn("decide_update_failed", {
        date,
        moveIndex,
        decision,
        error: err instanceof Error ? err.message : String(err),
      });
    });

  return { ok: true, alreadyDecided: false, status: decision };
}

/** Bulk approve/reject for the day · used by /approve_all · /reject_all. */
export async function decideAllForDate(
  date: string,
  decision: "approved" | "rejected",
): Promise<{ updated: number; alreadyDecided: number }> {
  const pending = await listPendingMovesForDate(date);
  let updated = 0;
  let alreadyDecided = 0;
  for (const m of pending) {
    const r = await decideMove(date, m.moveIndex, decision);
    if (r.ok && !r.alreadyDecided) updated += 1;
    else if (r.ok && r.alreadyDecided) alreadyDecided += 1;
  }
  return { updated, alreadyDecided };
}

// ─────────────────────────────────────────────────────────────────
// Cron orchestration · single entry point the cron route calls
// ─────────────────────────────────────────────────────────────────

export interface RunResult {
  ok: true;
  date: string;
  skipped?: boolean;
  reason?: string;
  signals?: BusinessSignals;
  movesDrafted?: number;
  movesPersisted?: number;
  telegramPushed?: boolean;
}

/**
 * Single end-to-end run. Idempotent: if today's row already exists,
 * skips both drafting and the Telegram push.
 *
 * On bridge failure (signals.source === "empty"), logs and exits cleanly ·
 * no Telegram noise (per spec).
 */
export async function runRevenueDecisionChannel(): Promise<RunResult> {
  const date = etDateKey();

  // Idempotency · use the first move key as the "already-pushed today"
  // sentinel. If move_<date>_1 exists, we drafted today already.
  const existing = await prisma.brainMemory
    .findUnique({
      where: {
        category_key: { category: "revenue_move", key: moveKey(date, 1) },
      },
      select: { id: true },
    })
    .catch(() => null);

  if (existing) {
    return {
      ok: true,
      date,
      skipped: true,
      reason: "already_drafted_today",
    };
  }

  const signals = await pullBusinessSignals();
  if (signals.source === "empty") {
    log.warn("bridge_down_no_signals", { date });
    return {
      ok: true,
      date,
      skipped: true,
      reason: "bridge_down",
      signals,
    };
  }

  const wisdoms = await matchWisdom(signals);
  const moves = await draftMoves(signals, wisdoms);

  if (moves.length === 0) {
    log.info("no_moves_drafted", { date, source: signals.source });
    return {
      ok: true,
      date,
      skipped: true,
      reason: "no_moves_drafted",
      signals,
      movesDrafted: 0,
    };
  }

  // Persist · upserts so a retry within the same day doesn't duplicate.
  let persisted = 0;
  for (const move of moves) {
    await persistMove(date, move, signals, wisdoms);
    persisted += 1;
  }

  // Telegram · single-shot push of the approval message.
  const text = formatTelegramApproval(moves, date);
  let pushed = false;
  try {
    pushed = await sendTelegram(text, undefined, "HTML");
  } catch (err) {
    log.warn("telegram_push_threw", {
      error: err instanceof Error ? err.message : String(err),
    });
    pushed = false;
  }
  // formatTelegramNotification kept available for future variants ·
  // (referenced once so the import isn't pruned by lint).
  void formatTelegramNotification;

  return {
    ok: true,
    date,
    signals,
    movesDrafted: moves.length,
    movesPersisted: persisted,
    telegramPushed: pushed,
  };
}
