/**
 * Decision-Replay Coach · v10.0.528 · Arc B · Feature 3
 *
 * Every captured MasteryDecision gets a 30-day-out automatic review:
 *
 *   "30 days ago you decided X. Here's what happened: Y. A Naval /
 *    Munger / Buffett lens: Z. Would you decide differently now?"
 *
 * Flow:
 *   1. pickDueReplays(limit)
 *      · own date first: an unreviewed DecisionReplay whose reviewAt ≤
 *        now (Nour's forecast date), whatever the decision's age;
 *      · then the 30-day pool: createdAt + 30d ≤ now AND no
 *        DecisionReplay row at all (a future reviewAt blocks it).
 *      · DecisionReplay is the canonical queue (it already exists in
 *        schema.prisma · no new table, no MasteryDecision column).
 *   2. gatherOutcomeSignals(decision)
 *      · 30d-window scan of Tasks completed/missed · DriftAlerts ·
 *        topical BrainMemory updates · Commitment status delta.
 *      · Used as evidence in the coaching prompt, not graded yet.
 *   3. matchWisdom(decision, signals)
 *      · One wisdom from BrainMemory(category="wisdom") · ranked by
 *        keyword overlap + persona bias (Munger / Naval / Buffett).
 *      · Below similarity 0.3 → null · prompt falls back to a generic
 *        "what did this teach you" frame without citation.
 *   4. composeReplayPrompt(decision, signals, wisdom)
 *      · The operator-facing prompt · injected by morning-brief.
 *   5. markReplayed(decisionId, outcome)
 *      · Updates / inserts the DecisionReplay row with outcome.
 *      · Writes BrainMemory(category="decision_replay_outcome") so
 *        contextual recall can pull lessons forward into future
 *        decisions.
 *
 * NO new tables. No MasteryDecision schema change. The DecisionReplay
 * model already has every field we need (decisionId · reviewAt ·
 * reviewed · outcome · outcomeScore · lesson · reviewedAt).
 *
 * Idempotency contract:
 *   · pickDueReplays filters out decisions that already have a
 *     DecisionReplay row with reviewed=true · cron retries are safe.
 *     (No production caller exists yet · only tests call it.)
 *   · markReplayed upserts via idempotencyKey = "decision_<id>_30d"
 *     so two writes don't double-create the queue row.
 *
 * STATENOUR↔NICKSTIRE BOUNDARY:
 *   · Pure statenour-side feature. Reads BrainMemory + Task + Commitment
 *     + DriftAlert + MasteryDecision (all statenour-owned). Never
 *     touches nickstire tables.
 */

import { prisma } from "@/lib/prisma";
import { activeOnly } from "@/lib/db/soft-delete";
import { logger as rootLogger } from "@/lib/logger";
import { BRAIN_CATEGORIES } from "@/lib/brain/categories";
import { decisionBrier } from "@/lib/brain/decision-forecast";
import {
  matchWisdom as matchWisdomShared,
  extractKeywords,
  personaFromKey,
} from "@/lib/brain/wisdom-match";

const log = rootLogger.withSurface("services/decision-replay-coach");

// ── Constants ────────────────────────────────────────────────────────

/** 30-day replay horizon. Hard-coded · the whole feature's framing. */
const REPLAY_HORIZON_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;
const REPLAY_HORIZON_MS = REPLAY_HORIZON_DAYS * DAY_MS;

/** Maximum wisdoms scanned per decision. Cheap; 1.5K covers the corpus. */
const WISDOM_SCAN_LIMIT = 1500;

/** Similarity floor below which we drop the wisdom citation entirely. */
const WISDOM_SIM_FLOOR = 0.3;

/**
 * Wisdom prefixes that get a citation boost (operator's preferred lenses).
 * Passed into the shared matcher (lib/brain/wisdom-match.ts). The Jaccard
 * loop + helpers (extractKeywords/personaFromKey/isPreferredPersonaKey)
 * live there now, shared with auto-learn.ts. Stopwords = the shared
 * DEFAULT_WISDOM_STOPWORDS (identical set), so no local copy is needed.
 */
const PREFERRED_PERSONAS = ["munger", "naval", "buffett", "greene"] as const;

// ── Types ────────────────────────────────────────────────────────────

export interface DueDecision {
  id: number;
  title: string;
  domain: string | null;
  chosen: string | null;
  reasoning: string | null;
  predictedOutcome: string | null;
  createdAt: Date;
  ageDays: number;
  /** Set when due because its own stored review date passed; absent for the 30-day pool. */
  reviewAt?: Date;
}

export interface OutcomeSignals {
  /** Tasks created/completed in the 30d after the decision · capped at 50. */
  tasksCompleted: number;
  tasksAbandoned: number;
  /** Drift alerts (unresolved or resolved) raised in the window. */
  driftAlertCount: number;
  /** BrainMemory rows in the window referencing the decision's topic. */
  topicalMemoryCount: number;
  /** Commitments that flipped status post-decision (broken/completed). */
  commitmentStatusDelta: {
    broken: number;
    completed: number;
    stillActive: number;
  };
  /** Top-3 outcome bullets to feed into the prompt. */
  bullets: string[];
}

export interface MatchedWisdom {
  id: string;
  key: string;
  excerpt: string;
  similarity: number;
}

export interface ReplayPrompt {
  decisionId: number;
  title: string;
  text: string;
  wisdomKey: string | null;
  ageDays: number;
}

// ── 1. Pick due replays ──────────────────────────────────────────────

const DECISION_SELECT = {
  id: true,
  title: true,
  domain: true,
  chosen: true,
  reasoning: true,
  predictedOutcome: true,
  createdAt: true,
} as const;

/**
 * Returns MasteryDecisions due for replay, own-date rows first:
 *
 *   (a) own date · an unreviewed DecisionReplay whose reviewAt has passed
 *       (a Socratic forecast stores Nour's date; the journalDecision stub
 *       stores createdAt + 30d). Due whatever the decision's age, oldest
 *       reviewAt first, and carries `reviewAt` on the result.
 *   (b) 30-day pool · no DecisionReplay row at all and age ≥ 30d, oldest
 *       first. A decision whose unreviewed replay is dated in the future
 *       (or snoozed by the tutor) is NOT in the pool, even past 30d, and
 *       a reviewed decision is never due.
 *
 * Implementation note · Prisma's findMany has no clean NOT EXISTS without
 * raw SQL, so pool candidates are over-fetched (4x) and the replay rows
 * for them are read in one round trip and filtered in memory · the pool
 * is ≤ a few hundred. A failed read logs which query and never widens
 * the result: an unreadable replay lookup returns [] (it cannot tell a
 * reviewed decision from an unreviewed one).
 */
export async function pickDueReplays(
  limit: number = 5,
): Promise<DueDecision[]> {
  const now = Date.now();
  const over = Math.max(limit * 4, 20);
  const failed =
    (query: string) =>
    (err: unknown): null => {
      log.warn("pickDueReplays_query_failed", { query, err: String(err) });
      return null;
    };

  const [datedReplays, pool] = await Promise.all([
    prisma.decisionReplay
      .findMany({
        // Same predicate as the tutor's overdue review (lib/brain/tutor-pack.ts).
        where: { reviewed: false, reviewAt: { lte: new Date(now) }, decisionId: { not: null } },
        orderBy: { reviewAt: "asc" }, // oldest own date first
        select: { decisionId: true, reviewAt: true },
        take: over,
      })
      .catch(failed("own_date_replays")),
    prisma.masteryDecision
      .findMany({
        // v10.0.529.106 wave-77 · migrated to activeOnly() helper.
        where: activeOnly({ createdAt: { lte: new Date(now - REPLAY_HORIZON_MS) } }),
        orderBy: { createdAt: "asc" }, // oldest first · longest-overdue go first
        take: over,
        select: DECISION_SELECT,
      })
      .catch(failed("pool_decisions")),
  ]);

  // Rows arrive oldest reviewAt first; keep the first per decision so a
  // second unreviewed row cannot list it twice.
  const ownDate = new Map<number, Date>();
  for (const r of datedReplays ?? []) {
    if (r.decisionId != null && !ownDate.has(r.decisionId)) ownDate.set(r.decisionId, r.reviewAt);
  }
  const ownDecisions =
    ownDate.size > 0
      ? await prisma.masteryDecision
          .findMany({
            where: activeOnly({ id: { in: [...ownDate.keys()] } }),
            select: DECISION_SELECT,
          })
          .catch(failed("own_date_decisions"))
      : [];

  const ownById = new Map((ownDecisions ?? []).map((d) => [d.id, d]));
  const poolRows = pool ?? [];
  if (ownById.size === 0 && poolRows.length === 0) return [];

  // Which of these decisions have any replay row, and which are reviewed.
  const ids = [...new Set([...ownById.keys(), ...poolRows.map((d) => d.id)])];
  const replayRows = await prisma.decisionReplay
    .findMany({
      where: { decisionId: { in: ids } },
      select: { decisionId: true, reviewed: true },
    })
    .catch(failed("replay_status"));
  if (!replayRows) return [];
  const hasReplay = new Set<number>();
  const reviewed = new Set<number>();
  for (const r of replayRows) {
    if (r.decisionId == null) continue;
    hasReplay.add(r.decisionId);
    if (r.reviewed) reviewed.add(r.decisionId);
  }

  const ageOf = (d: { createdAt: Date }) => Math.floor((now - d.createdAt.getTime()) / DAY_MS);
  const due: DueDecision[] = [];
  for (const [id, reviewAt] of ownDate) {
    const d = ownById.get(id);
    if (!d || reviewed.has(id)) continue;
    due.push({ ...d, ageDays: ageOf(d), reviewAt });
  }
  for (const d of poolRows) {
    if (hasReplay.has(d.id)) continue;
    due.push({ ...d, ageDays: ageOf(d) });
  }
  return due.slice(0, limit);
}

// ── 2. Outcome signals ───────────────────────────────────────────────

/**
 * Gathers what-happened evidence in the 30d window following the
 * decision. All queries are catch-guarded · partial outcomes still
 * produce a useful prompt.
 *
 * Note on signal quality · the biggest assumption here is that the
 * decision's "title + chosen + reasoning" text overlaps with the
 * downstream evidence's content. For decisions like "ship more
 * features" → tasks completed/abandoned around shipping are easy to
 * match. For abstract decisions ("change my approach to X") the
 * overlap is weaker. We mitigate via topical-memory which scans the
 * BrainMemory corpus on the same window.
 */
export async function gatherOutcomeSignals(
  decision: DueDecision,
): Promise<OutcomeSignals> {
  const winStart = decision.createdAt;
  const winEnd = new Date(winStart.getTime() + REPLAY_HORIZON_MS);

  // Build a topic keyword set from the decision's text · used to
  // match BrainMemory + commitments. Cheap tokenization · we don't
  // need embedding-grade recall here · presence/absence is enough.
  const keywords = extractKeywords(
    [decision.title, decision.chosen, decision.reasoning, decision.predictedOutcome]
      .filter((s): s is string => !!s)
      .join(" "),
  );

  const [taskEvents, drifts, topicalMems, commitments] = await Promise.all([
    // Task events in the window · `kind` = created/completed/abandoned.
    // We only count completed + abandoned since they're terminal states.
    prisma.taskEvent
      .findMany({
        where: {
          createdAt: { gte: winStart, lte: winEnd },
          kind: { in: ["completed", "abandoned"] },
        },
        select: { kind: true },
        take: 200,
      })
      .catch((): never[] => []),
    prisma.brainMemory
      .findMany({
        where: {
          category: "coach_event",
          key: { startsWith: "coach:drift-recovery:" },
          createdAt: { gte: winStart, lte: winEnd },
        },
        select: { id: true, metadata: true },
        take: 50,
      })
      .then((rows) => {
        return rows.map((r) => {
          const meta = (r.metadata ?? {}) as Record<string, any>;
          const severity = meta.priority === "P0" ? "CRITICAL" : meta.priority === "P1" ? "HIGH" : "WARNING";
          return { id: r.id, severity };
        });
      })
      .catch((): never[] => []),
    // BrainMemory rows updated in window · narrow by keyword OR via
    // simple contains-clauses · capped to 30 to keep query light.
    keywords.length > 0
      ? prisma.brainMemory
          .findMany({
            // v10.0.529.106 wave-77 · migrated to activeOnly() helper.
            where: activeOnly({
              updatedAt: { gte: winStart, lte: winEnd },
              OR: keywords.slice(0, 5).map((k) => ({
                content: { contains: k, mode: "insensitive" as const },
              })),
            }),
            select: { id: true },
            take: 30,
          })
          .catch((): never[] => [])
      : Promise.resolve<never[]>([]),
    prisma.commitment
      .findMany({
        // v10.0.529.106 wave-77 · migrated to activeOnly() helper.
        where: activeOnly({
          OR: [
            { createdAt: { gte: winStart, lte: winEnd } },
            { updatedAt: { gte: winStart, lte: winEnd } },
          ],
        }),
        select: { status: true, description: true },
        take: 50,
      })
      .catch((): never[] => []),
  ]);

  const taskRows = taskEvents as Array<{ kind: string }>;
  const driftRows = drifts as Array<{ severity: string }>;
  const memRows = topicalMems as Array<{ id: string }>;
  const commitRows = commitments as Array<{ status: string; description: string }>;

  const tasksCompleted = taskRows.filter((t) => t.kind === "completed").length;
  const tasksAbandoned = taskRows.filter((t) => t.kind === "abandoned").length;

  // Commitments: filter to those whose description overlaps the
  // decision's keywords · prevents counting unrelated commitments
  // that happened to be active in the same 30d window.
  const relatedCommits = keywords.length > 0
    ? commitRows.filter((c) =>
        keywords.some((k) => c.description.toLowerCase().includes(k)),
      )
    : commitRows;
  const commitmentStatusDelta = {
    broken: relatedCommits.filter((c) => c.status === "broken").length,
    completed: relatedCommits.filter((c) => c.status === "completed").length,
    stillActive: relatedCommits.filter(
      (c) => c.status === "active" || c.status === "in_progress",
    ).length,
  };

  // Build human-readable bullets for the prompt · top-3 only.
  const bullets: string[] = [];
  if (tasksCompleted > 0 || tasksAbandoned > 0) {
    bullets.push(
      `${tasksCompleted} task${tasksCompleted === 1 ? "" : "s"} completed, ${tasksAbandoned} abandoned`,
    );
  }
  if (driftRows.length > 0) {
    const highSev = driftRows.filter(
      (d) => d.severity?.toUpperCase() === "HIGH" || d.severity?.toUpperCase() === "CRITICAL",
    ).length;
    bullets.push(
      `${driftRows.length} drift alert${driftRows.length === 1 ? "" : "s"}${
        highSev > 0 ? ` (${highSev} high/critical)` : ""
      }`,
    );
  }
  if (commitmentStatusDelta.broken > 0 || commitmentStatusDelta.completed > 0) {
    bullets.push(
      `Commitments: ${commitmentStatusDelta.completed} kept, ${commitmentStatusDelta.broken} broken, ${commitmentStatusDelta.stillActive} still active`,
    );
  }
  if (memRows.length > 0 && bullets.length < 3) {
    bullets.push(`${memRows.length} related brain memories surfaced`);
  }

  return {
    tasksCompleted,
    tasksAbandoned,
    driftAlertCount: driftRows.length,
    topicalMemoryCount: memRows.length,
    commitmentStatusDelta,
    bullets: bullets.slice(0, 3),
  };
}

// ── 3. Match wisdom ──────────────────────────────────────────────────

/**
 * Picks ONE wisdom from the corpus that best fits the decision +
 * outcome shape. Scoring:
 *
 *   keyword-overlap × persona-boost × confidence
 *
 * Where keyword overlap is a Jaccard-style numerator (# shared tokens
 * between decision/outcome bullets and wisdom content / size of
 * decision keywords). Persona-boost favors the operator's named
 * lenses (Munger, Naval, Buffett, Greene). Below a similarity floor
 * (0.3) we return null · the prompt then falls back to a generic
 * "what did this teach you" frame.
 *
 * Why not embedding similarity here · the wisdom corpus is small
 * (~1K rows · 991 today per memory) and the decision query is short ·
 * keyword Jaccard runs in-process with zero network cost. The
 * embedding path costs a Cohere rerank call per replay. With ≤5
 * replays/day that's nothing, but the keyword version is good enough
 * and removes a failure mode (embedding provider down → no wisdom).
 */
export async function matchWisdom(
  decision: DueDecision,
  signals: OutcomeSignals,
): Promise<MatchedWisdom | null> {
  const queryText = [
    decision.title,
    decision.chosen,
    decision.reasoning,
    decision.predictedOutcome,
    ...signals.bullets,
  ]
    .filter((s): s is string => !!s)
    .join(" ");
  // Shared Jaccard matcher (lib/brain/wisdom-match.ts) · this file's
  // own scan-limit + preferred personas passed in. The matcher returns
  // the top raw-scored match; we map it to MatchedWisdom and apply OUR
  // floor on the 3-decimal-rounded similarity (as the prior inline loop
  // did) so behavior is byte-identical.
  const match = await matchWisdomShared(queryText, {
    scanLimit: WISDOM_SCAN_LIMIT,
    preferredPersonas: PREFERRED_PERSONAS,
  });
  if (!match) return null;

  const best: MatchedWisdom = {
    id: match.id,
    key: match.key,
    excerpt: match.content.slice(0, 160),
    similarity: Number(match.score.toFixed(3)),
  };

  if (best.similarity < WISDOM_SIM_FLOOR) return null;
  return best;
}

// ── 4. Compose prompt ────────────────────────────────────────────────

/**
 * Formats the operator-facing replay prompt. Tight 4-5 line shape ·
 * fits the morning-brief budget. HTML-safe for Telegram.
 *
 * With wisdom citation:
 *   "30 days ago you decided X. Here's what happened: Y.
 *    A Munger lens: Z. Would you decide differently now?"
 *
 * Without wisdom (similarity floor not met):
 *   "30 days ago you decided X. Here's what happened: Y.
 *    What did this decision teach you?"
 */
export function composeReplayPrompt(
  decision: DueDecision,
  signals: OutcomeSignals,
  wisdom: MatchedWisdom | null,
): ReplayPrompt {
  const decisionText = decision.chosen?.trim() || decision.title.trim();
  const decisionShort = decisionText.slice(0, 120);

  // Outcome bullets · if none, fall back to a hint.
  const outcomeText =
    signals.bullets.length > 0
      ? signals.bullets.join("; ")
      : "no measurable signals in the 30d window";

  const lines: string[] = [];
  // An own-date decision may be 7 or 90 days old; "Nd ago" would misname why it is asked now.
  const when = decision.reviewAt ? "review date reached" : `${decision.ageDays}d ago`;
  lines.push(`<b>Decision replay · ${when}</b>`);
  lines.push(`You decided: ${escapeHtml(decisionShort)}`);
  lines.push(`What happened: ${escapeHtml(outcomeText)}`);

  if (wisdom) {
    const persona = personaFromKey(wisdom.key);
    const lensLabel = persona ? `${persona} lens` : "Wisdom";
    lines.push(
      `${lensLabel}: <i>${escapeHtml(wisdom.excerpt.slice(0, 140))}</i>`,
    );
    lines.push("<b>Would you decide differently now?</b>");
  } else {
    lines.push("<b>What did this decision teach you?</b>");
  }

  return {
    decisionId: decision.id,
    title: decision.title,
    text: lines.join("\n"),
    wisdomKey: wisdom?.key ?? null,
    ageDays: decision.ageDays,
  };
}

// ── 5. Mark replayed ─────────────────────────────────────────────────

export interface MarkReplayedInput {
  decisionId: number;
  outcome: string;
  outcomeScore?: number;
  lesson?: string;
}

/**
 * Records the operator's reply to the replay prompt. Upserts the
 * DecisionReplay row (one per decision · idempotency via
 * decisionId+reviewAt key) and writes a BrainMemory(category=
 * "decision_replay_outcome") so the lesson is recall-able the next
 * time a similar decision shows up.
 */
export async function markReplayed(input: MarkReplayedInput): Promise<{
  ok: boolean;
  replayId: string | null;
  lessonStored: boolean;
  /** Brain W3 · Brier of the stored forecast (decision-forecast.ts); null without a probability or outcome. */
  brier: number | null;
}> {
  const decision = await prisma.masteryDecision
    .findUnique({
      where: { id: input.decisionId },
      select: { id: true, title: true, chosen: true, reasoning: true, predictedOutcome: true },
    })
    .catch((): null => null);
  if (!decision) {
    return { ok: false, replayId: null, lessonStored: false, brier: null };
  }
  const brier = decisionBrier(decision.predictedOutcome, input.outcomeScore);

  // Idempotency key · stable across retries.
  const idemKey = `decision_${decision.id}_30d`;
  const reviewAt = new Date();

  // Find existing queue row (the replay may have been logged with
  // reviewed=false earlier) · update if it exists, create otherwise.
  // Brain W3 · a Socratic forecast row carries a "soc:" key, not idemKey.
  const existing = await prisma.decisionReplay
    .findFirst({
      where: {
        decisionId: decision.id,
        OR: [{ idempotencyKey: idemKey }, { idempotencyKey: { startsWith: "soc:" } }],
      },
      select: { id: true },
    })
    .catch((): null => null);

  let replayId: string | null = null;
  try {
    if (existing) {
      const updated = await prisma.decisionReplay.update({
        where: { id: existing.id },
        data: {
          outcome: input.outcome,
          outcomeScore: input.outcomeScore ?? null,
          lesson: input.lesson ?? null,
          reviewed: true,
          reviewedAt: new Date(),
        },
        select: { id: true },
      });
      replayId = updated.id;
    } else {
      const created = await prisma.decisionReplay.create({
        data: {
          decisionId: decision.id,
          title: decision.title,
          choiceMade: decision.chosen ?? "—",
          reasoning: decision.reasoning,
          reviewAt,
          reviewed: true,
          reviewedAt: new Date(),
          outcome: input.outcome,
          outcomeScore: input.outcomeScore ?? null,
          lesson: input.lesson ?? null,
          idempotencyKey: idemKey,
        },
        select: { id: true },
      });
      replayId = created.id;

      // Phase D · ADR-0013 · journal pattern-radar auto-join hook
      // for decision replays · the 4th and final journal source
      // wired (after BrainDump, Reflection, SituationLog). Combines
      // title + reasoning + lesson into the body the radar scores
      // against · fire-and-forget · errors swallowed because the
      // replay row already persisted successfully.
      void (async () => {
        try {
          const { tryJoinActiveThreads } = await import(
            "@/lib/services/journal-threads"
          );
          const text = [decision.title, decision.reasoning, input.lesson]
            .filter((s): s is string => Boolean(s && s.trim().length > 0))
            .join("\n")
            .trim();
          if (text) {
            await tryJoinActiveThreads("decision_replay", created.id, text);
          }
        } catch {
          // best-effort · silent
        }
      })();
    }
  } catch (err) {
    log.warn("markReplayed_db_write_failed", {
      decisionId: decision.id,
      err: String(err),
    });
    return { ok: false, replayId: null, lessonStored: false, brier: null };
  }

  // Persist the lesson as a brain memory · skip when blank.
  // Silo wave (audit 2026-07-15) · refresh the replay's recall embedding
  // with the outcome/lesson enriched text. storeGenericEmbedding skips
  // byte-identical content, so this is a no-op unless the text changed.
  if (replayId) {
    const embedText = [
      `[decision] ${decision.title} — chose: ${decision.chosen ?? "—"}`,
      decision.reasoning ? `why: ${decision.reasoning}` : null,
      `outcome: ${input.outcome}`,
      input.lesson ? `lesson: ${input.lesson}` : null,
    ]
      .filter(Boolean)
      .join("\n")
      .slice(0, 2000);
    void (async () => {
      try {
        const { storeGenericEmbedding } = await import("@/lib/brain/embedding-utils");
        await storeGenericEmbedding("decision_replay", replayId, embedText);
      } catch { /* embed-backfill retries */ }
    })();
  }

  let lessonStored = false;
  if (input.lesson && input.lesson.trim().length > 0) {
    try {
      await prisma.brainMemory.create({
        data: {
          category: "decision_replay_outcome",
          key: `replay_${decision.id}_${reviewAt.toISOString().slice(0, 10)}`,
          content: `Decision: ${decision.title}. Outcome: ${input.outcome.slice(0, 200)}. Lesson: ${input.lesson.slice(0, 300)}`,
          source: "decision_replay_coach",
          confidence: Math.min(
            0.95,
            0.7 + Math.abs(input.outcomeScore ?? 0) * 0.02,
          ),
        },
      });
      lessonStored = true;
    } catch (err) {
      log.warn("markReplayed_memory_write_failed", {
        decisionId: decision.id,
        err: String(err),
      });
    }
  }

  return { ok: true, replayId, lessonStored, brier };
}

// ── Helpers ──────────────────────────────────────────────────────────
// extractKeywords / isPreferredPersonaKey / personaFromKey now live in
// lib/brain/wisdom-match.ts (shared with auto-learn.ts). extractKeywords +
// personaFromKey are imported above.

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
