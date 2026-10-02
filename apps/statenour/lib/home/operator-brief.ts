/**
 * lib/home/operator-brief.ts — the Home page's intelligence layer.
 *
 * Command Surface rewrite, 2026-09-01. The old Home did its reasoning in
 * React: ExecutiveActionMatrix mounted seven tRPC queries plus a raw fetch
 * and synthesized the briefing client-side, three verdict cards each ran
 * their own reads, and the header ran four more. This module moves ALL of
 * that composition server-side behind one typed contract: the page RENDERS
 * a brief; it no longer manufactures one.
 *
 * DOCTRINE (the whole file bends to these):
 *
 * 1 · UNKNOWN IS NOT ZERO. Every source is fetched behind its own guard.
 *     A failed read never renders as an empty queue or a green light — it
 *     renders as "unmeasured", named in `failedSources`. Same rule the
 *     2026-08-04 false-green sweep enforced on the hub payload.
 *
 * 2 · NO FABRICATED CONFIDENCE. The research thread that motivated this
 *     rewrite mocked an "86% confidence" badge. No calibrated probability
 *     model exists for the recommendation, so no percentage is shown —
 *     `why` and `reasoning` carry the scorer's REAL explanation strings
 *     (lib/scoring/task-priority.ts) and the arm-selection rationale
 *     instead. A number would be theater; a reason is a receipt.
 *
 * 3 · ATTENTION BUDGET. The page may expose at most ATTENTION_CAP
 *     actionable objects (lead CTA + alternatives + judgment rows). The
 *     builder enforces the cap and reports its own arithmetic in `budget`
 *     so a regression is visible in data, not just in pixels. Horizon
 *     slots are context pointers, not queue claims — they are deliberately
 *     outside the count (rationale: they assert "this exists on your
 *     timeline", never "act on this now").
 *
 * 4 · THE SELECTION CHAIN STAYS TESTED. Lead selection delegates to
 *     deriveBriefing (lib/home/derive-briefing.ts) — the pure chain with
 *     the habit guard and the decide arm, pinned by 16 tests including the
 *     literal water-bottle regression. This module only assembles its
 *     inputs server-side and maps its output onto the lead contract.
 */

import { prisma } from "@/lib/prisma";
import { deriveBriefing, type Briefing } from "@/lib/home/derive-briefing";
import { homeHealthState, type ChipState } from "@/lib/home/health-state";
import { buildNextMove, type NextMove } from "@/lib/services/next-move";
import { buildSystemHub } from "@/lib/services/system-hub";
import { buildTaskRescue } from "@/lib/services/task-rescue";
import { listPendingActions } from "@/lib/automation/approval-queue";
import { isApprovalRequestExpired } from "@/lib/automation/approval-freshness";
import { loadRecentContradictions } from "@/lib/brain/contradiction-surfacer";
import { listProposed } from "@/lib/services/commitments";
import { getMit } from "@/lib/services/mit";
import { recordShownBounded } from "@/lib/services/outcome-ledger";
import { HABIT_LOOPS } from "@/lib/scoring/task-priority";

// ── Contracts ───────────────────────────────────────────────────────────

/** Hard cap on simultaneously visible actionable objects (doctrine §3). */
export const ATTENTION_CAP = 7;

/** Judgment rows shown before the "n more" link. */
export const JUDGMENT_VISIBLE_CAP = 3;

export interface BriefStateSection {
  health: { state: ChipState; detail: string };
  /** One deterministic sentence of operator state. Never an LLM call —
   *  composed from measured signals only, so it is fast, free, and can
   *  never claim something no query returned. */
  summary: string;
  queues: {
    measured: boolean;
    clear: boolean;
    inbox: number | null;
    captures: number | null;
    approvals: number | null;
  };
}

export interface BriefAlternative {
  label: string;
  why: string;
  href: string;
}

export interface BriefLeadSection {
  /** deriveBriefing's actionType, minus client-only "loading". */
  kind: "error" | "execute" | "resume" | "decide" | "hygiene" | "triage" | "suggestions";
  headline: string;
  body: string;
  cta: { label: string; href: string } | null;
  /** Deep-link id when the lead is a concrete task. */
  taskId: string | null;
  /**
   * The IntelligenceOutcome row this lead was ledgered as (2026-10-02), so the
   * CTA and "different move" can record a decision against it. Null when the
   * lead is not a recommendation (kind "error", no CTA) or the bounded ledger
   * write did not answer in time — then nothing is recorded, honestly.
   */
  ledgerId: string | null;
  /** ≤ 2 quiet alternatives — real ranked candidates, never filler. */
  alternatives: BriefAlternative[];
  /** "Why this?" — the receipts. Real strings from the scorer/arms only. */
  reasoning: string[];
}

export type JudgmentItem =
  | {
      kind: "contradiction";
      key: string;
      nowExcerpt: string;
      beforeExcerpt: string;
      daysApart: number;
      href: string;
    }
  | {
      kind: "commitment";
      id: number;
      description: string;
      domain: string | null;
      evidence: string | null;
    }
  | { kind: "followup"; id: string; title: string }
  | {
      kind: "approvals";
      /** Live — still executable if approved now. */
      count: number;
      /** Authorization window passed: listed, not approvable (D12). */
      expired: number;
      oldestAgeMin: number | null;
      href: string;
    };

export interface BriefJudgmentSection {
  /** Every open item (bounded upstream). The page renders `visibleCap` of
   *  these by default; the rest sit behind an explicit "more" tap —
   *  presence in the PRIMARY view is the scarce resource, not existence. */
  items: JudgmentItem[];
  /** How many rows may render before the expander (budget-derived). */
  visibleCap: number;
  /** True queue size across all sources that COULD be read. */
  totalCount: number;
  /** Sources whose read failed — unknown ≠ zero, say which. */
  failedSources: string[];
}

export interface HorizonSlot {
  scope: "now" | "today" | "week" | "later";
  label: string;
  href: string;
  /** Where the label came from — a receipt, not decoration. */
  source: string;
}

export interface BriefHorizonSection {
  slots: HorizonSlot[];
  /** False when every horizon read failed. */
  measured: boolean;
}

export interface OperatorBrief {
  generatedAt: string;
  state: BriefStateSection;
  lead: BriefLeadSection;
  judgment: BriefJudgmentSection;
  horizon: BriefHorizonSection;
  budget: { visibleActionables: number; cap: number };
}

// ── Guarded fetch helper ────────────────────────────────────────────────

/** null = the read FAILED (unknown), never a default value. */
async function guarded<T>(p: Promise<T>): Promise<T | null> {
  try {
    return await p;
  } catch {
    return null;
  }
}

// ── Builder ─────────────────────────────────────────────────────────────

const isHabitKind = (k: string | null | undefined) =>
  HABIT_LOOPS.has((k ?? "").toUpperCase());

/** Non-habit DOING task older than this is an interrupted open loop. Same
 *  floor the old client used (executive-action-matrix BDN-001): a
 *  seconds-old DOING row is "just started", not "abandoned earlier". */
const RESUME_MIN_AGE_MS = 2 * 60_000;

interface DoingRow {
  id: string;
  title: string;
  loopKind: string | null;
  startedAt: Date | null;
  updatedAt: Date;
}

/**
 * ET-anchored day start as a true UTC instant. Railway runs UTC — a naive
 * setHours(0,0,0,0) would make "today" mean 8pm-yesterday→8pm-today ET.
 * Same anchoring discipline as command-center-state's timeOfDay and
 * morning-brief's date key. Both toLocaleString reads go through the same
 * parser, so its quirks cancel; DST transition days are ±1h at worst,
 * which a horizon pointer can absorb.
 */
function startOfEtDay(now: Date): Date {
  const ymd = now.toLocaleDateString("en-CA", { timeZone: "America/New_York" });
  const etWall = new Date(now.toLocaleString("en-US", { timeZone: "America/New_York" })).getTime();
  const utcWall = new Date(now.toLocaleString("en-US", { timeZone: "UTC" })).getTime();
  const offsetMs = utcWall - etWall; // e.g. 4h during EDT
  return new Date(new Date(`${ymd}T00:00:00Z`).getTime() + offsetMs);
}

export async function buildOperatorBrief(now = new Date()): Promise<OperatorBrief> {
  const nowMs = now.getTime();
  const startOfToday = startOfEtDay(now);
  const endOfToday = new Date(startOfToday.getTime() + 86_400_000);
  const endOfWeek = new Date(startOfToday.getTime() + 7 * 86_400_000);

  const [
    doingTasks,
    nextMove,
    pendingActions,
    approvalRequests,
    contradictions,
    followUps,
    proposals,
    mit,
    rescue,
    inboxCount,
    captureCount,
    hub,
    dueTasks,
    laterGoals,
    weekGoals,
    calendarUpcoming,
  ] = await Promise.all([
    // Active/resume candidates. Ordering mirrors command-center-state.ts's
    // activeTask pick (autoPriority desc nulls last, lastTouchedAt desc) so
    // this brief and Nick's context agree on what "active" means.
    guarded<DoingRow[]>(
      prisma.task.findMany({
        where: { status: "DOING", deletedAt: null },
        orderBy: [
          { autoPriority: { sort: "desc", nulls: "last" } },
          { lastTouchedAt: "desc" },
        ],
        take: 10,
        select: { id: true, title: true, loopKind: true, startedAt: true, updatedAt: true },
      }),
    ),
    guarded(buildNextMove()),
    guarded(listPendingActions()),
    guarded(
      prisma.approvalRequest.findMany({
        where: { status: "pending_approval" },
        orderBy: { createdAt: "asc" },
        select: { id: true, createdAt: true, expiresAt: true },
      }),
    ),
    // 14-day unresolved window — parity with the bottom ticker's
    // countUnresolved(14) and the retired ContradictionSlot.
    guarded(loadRecentContradictions(14, false)),
    guarded(
      prisma.agendaItem.findMany({
        where: { category: "FOLLOW_UP", status: "ACTIVE" },
        orderBy: { createdAt: "asc" },
        take: 20,
        select: { id: true, title: true },
      }),
    ),
    guarded(listProposed(10)),
    guarded(getMit()),
    guarded(buildTaskRescue()),
    guarded(prisma.task.count({ where: { status: "INBOX", deletedAt: null } })),
    guarded(
      prisma.captureInboxItem.count({
        where: { status: "active", triageStatus: "NEW" },
      }),
    ),
    guarded(buildSystemHub()),
    // Horizon: nearest dated open work in the next 7 days.
    guarded(
      prisma.task.findMany({
        where: {
          status: { in: ["INBOX", "READY", "DOING"] },
          deletedAt: null,
          dueDate: { gte: startOfToday, lt: endOfWeek },
        },
        orderBy: { dueDate: "asc" },
        take: 5,
        select: { id: true, title: true, dueDate: true },
      }),
    ),
    // Horizon LATER: the furthest-out declared direction. lifeGoal.status
    // uses lowercase "active" (see lib/services/goals.ts consumers).
    guarded(
      prisma.lifeGoal.findMany({
        where: {
          deletedAt: null,
          status: "active",
          horizon: { in: ["MONTH", "QUARTER", "YEAR", "LIFE"] },
        },
        orderBy: [{ deadline: { sort: "asc", nulls: "last" } }],
        take: 3,
        select: { id: true, title: true, horizon: true, deadline: true },
      }),
    ),
    guarded(
      prisma.lifeGoal.findMany({
        where: { deletedAt: null, status: "active", horizon: "WEEK" },
        orderBy: [{ deadline: { sort: "asc", nulls: "last" } }],
        take: 3,
        select: { id: true, title: true, deadline: true },
      }),
    ),
    // Calendar events land as BrainMemory rows via the daily ingest cron
    // (app/api/cron/ingest-calendar). metadata.start carries the ISO start.
    guarded(
      prisma.brainMemory.findMany({
        where: { category: "calendar_upcoming", deletedAt: null },
        orderBy: { updatedAt: "desc" },
        take: 40,
        select: { content: true, metadata: true },
      }),
    ),
  ]);

  // ── Lead (the tested chain, fed server-side) ──────────────────────────

  const activeRaw = doingTasks?.[0] ?? null;
  const resumeRaw =
    doingTasks
      ?.slice(1)
      .filter((t) => !isHabitKind(t.loopKind))
      .filter((t) => {
        const entered = (t.startedAt ?? t.updatedAt).getTime();
        return nowMs - entered > RESUME_MIN_AGE_MS;
      })
      .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())[0] ?? null;

  // 2026-09-07 (D12) · "23 approvals parked · oldest 330 h" counted expired
  // authorizations as decisions waiting on the operator. Live = still
  // executable if approved now; expired = the window passed, needs a
  // re-request or a dismissal. Both stay visible; only live is "waiting".
  const nowForExpiry = new Date(nowMs);
  const expiredDecisions =
    pendingActions === null || approvalRequests === null
      ? null
      : pendingActions.filter((a) => a.expired).length +
        approvalRequests.filter((r) => isApprovalRequestExpired(r, nowForExpiry)).length;
  const pendingDecisions =
    pendingActions === null || approvalRequests === null || expiredDecisions === null
      ? null
      : pendingActions.length + approvalRequests.length - expiredDecisions;

  const findingsCount = rescue?.findings.length ?? 0;

  const briefing = deriveBriefing({
    loading: false,
    // Core reads for the chain: DOING set + targets. A failed approvals
    // read flows through as pendingDecisions:null (unknown ≠ 0 inside the
    // chain); a failed rescue/inbox read can only under-warn, never lie
    // about a decision, so it does not hard-fail the board.
    unreadable: doingTasks === null || nextMove === null,
    // Habits pass through — the chain's own guard (the water test) owns
    // that rule; duplicating it here would fork the truth.
    doingTask: activeRaw ? { title: activeRaw.title, loopKind: activeRaw.loopKind } : null,
    resumeTask: resumeRaw ? { title: resumeRaw.title, loopKind: resumeRaw.loopKind } : null,
    pendingDecisions,
    expiredDecisions: expiredDecisions ?? 0,
    findingsCount,
    inboxCount: inboxCount ?? 0,
    criticalFew: nextMove?.criticalFew ?? [],
  });

  const lead = mapLead(briefing, {
    activeRaw,
    resumeRaw,
    nextMove,
    pendingDecisions,
  });
  // 2026-10-02 · the lead is a recommendation the operator is SHOWN; without
  // this row Home was the highest-frequency surface recording nothing in the
  // outcome ledger (docs/design/outcome-ledger-coverage-2026-10-02.md §5).
  lead.ledgerId = await ledgerLeadShown(lead);

  // ── Judgment queue ────────────────────────────────────────────────────

  const failedSources: string[] = [];
  if (contradictions === null) failedSources.push("contradictions");
  if (proposals === null) failedSources.push("commitments");
  if (followUps === null) failedSources.push("follow-ups");
  if (pendingActions === null || approvalRequests === null) failedSources.push("approvals");

  const judgmentAll: JudgmentItem[] = [];

  // Approvals roll up to ONE row: their verdicts need payload review, which
  // lives at /system/actions — Home states the queue, it does not re-host it.
  if (pendingDecisions !== null && (pendingDecisions > 0 || (expiredDecisions ?? 0) > 0)) {
    const oldest = [
      ...(pendingActions ?? []).map((r) => r.createdAt.getTime()),
      ...(approvalRequests ?? []).map((r) => r.createdAt.getTime()),
    ].sort((a, b) => a - b)[0];
    judgmentAll.push({
      kind: "approvals",
      count: pendingDecisions,
      expired: expiredDecisions ?? 0,
      oldestAgeMin: oldest ? Math.round((nowMs - oldest) / 60_000) : null,
      href: "/system/actions",
    });
  }

  for (const c of contradictions ?? []) {
    judgmentAll.push({
      kind: "contradiction",
      key: c.key,
      nowExcerpt: c.new_excerpt,
      beforeExcerpt: c.old_excerpt,
      daysApart: c.days_apart,
      href: `/brain?tab=memory&resolve=${encodeURIComponent(c.key)}`,
    });
  }

  for (const p of proposals ?? []) {
    judgmentAll.push({
      kind: "commitment",
      id: p.id,
      description: p.description,
      domain: p.domain ?? null,
      evidence: p.evidenceTier
        ? `${p.evidenceTier.toLowerCase()}${p.evidenceConfidence ? ` · ${p.evidenceConfidence.toLowerCase()} confidence` : ""}`
        : null,
    });
  }

  for (const f of followUps ?? []) {
    judgmentAll.push({ kind: "followup", id: f.id, title: f.title });
  }

  // ── Attention budget (doctrine §3) ────────────────────────────────────
  // lead CTA (1) + alternatives + default-visible judgment rows must fit
  // ATTENTION_CAP. All items ship (they're bounded upstream); the cap
  // governs the PRIMARY view — the rest are an explicit tap away.
  const leadActionables = (lead.cta ? 1 : 0) + lead.alternatives.length;
  const judgmentVisibleCap = Math.max(
    0,
    Math.min(JUDGMENT_VISIBLE_CAP, ATTENTION_CAP - leadActionables),
  );

  // ── Horizon ───────────────────────────────────────────────────────────

  const horizon = buildHorizon({
    lead,
    mitText: mit?.text ?? null,
    dueTasks: dueTasks ?? [],
    weekGoals: weekGoals ?? [],
    laterGoals: laterGoals ?? [],
    calendarUpcoming: calendarUpcoming ?? [],
    startOfToday,
    endOfToday,
    measured:
      dueTasks !== null ||
      weekGoals !== null ||
      laterGoals !== null ||
      calendarUpcoming !== null ||
      mit !== null,
  });

  // ── State line ────────────────────────────────────────────────────────

  const health = hub
    ? homeHealthState(hub)
    : { state: "unknown" as ChipState, detail: "hub read failed" };

  const queuesMeasured =
    inboxCount !== null && captureCount !== null && pendingDecisions !== null;
  const queuesClear =
    queuesMeasured &&
    inboxCount === 0 &&
    captureCount === 0 &&
    pendingDecisions === 0 &&
    judgmentAll.length === 0;

  const state: BriefStateSection = {
    health,
    queues: {
      measured: queuesMeasured,
      clear: queuesClear,
      inbox: inboxCount,
      captures: captureCount,
      approvals: pendingDecisions,
    },
    summary: composeStateSummary({
      briefing,
      health,
      queuesMeasured,
      queuesClear,
      judgmentCount: judgmentAll.length,
      // status (not actionType) — "execute" is shared by ACTIVE ENGAGEMENT
      // and SYSTEMS NOMINAL; only the former means something is in motion.
      activeTitle: briefing.status === "executing" && activeRaw ? activeRaw.title : null,
    }),
  };

  return {
    generatedAt: now.toISOString(),
    state,
    lead,
    judgment: {
      items: judgmentAll,
      visibleCap: judgmentVisibleCap,
      totalCount: judgmentAll.length,
      failedSources,
    },
    horizon,
    budget: {
      visibleActionables:
        leadActionables + Math.min(judgmentAll.length, judgmentVisibleCap),
      cap: ATTENTION_CAP,
    },
  };
}

// ── Lead mapping ────────────────────────────────────────────────────────

/**
 * Ledger what the lead recommends. The summary pairs the headline with the CTA
 * label because headlines repeat day to day ("Finish what's in motion") while
 * the task behind them changes — the 24 h content dedup must see the task.
 * Not a recommendation: an unreadable board ("error") or a lead with no CTA.
 */
export function leadLedgerSummary(lead: Pick<BriefLeadSection, "headline" | "cta">): string {
  return lead.cta ? `${lead.headline}: ${lead.cta.label}` : lead.headline;
}

async function ledgerLeadShown(lead: BriefLeadSection): Promise<string | null> {
  if (lead.kind === "error" || !lead.cta) return null;
  return recordShownBounded({
    kind: "suggestion",
    sourceEngine: `operator-brief:${lead.kind}`,
    summary: leadLedgerSummary(lead),
    shownSurface: "home",
    evidenceRefs: { taskId: lead.taskId, href: lead.cta.href, kind: lead.kind },
  });
}

function mapLead(
  b: Briefing,
  ctx: {
    activeRaw: DoingRow | null;
    resumeRaw: DoingRow | null;
    nextMove: NextMove | null;
    pendingDecisions: number | null;
  },
): BriefLeadSection {
  const critical = ctx.nextMove?.criticalFew ?? [];
  const reasoning: string[] = [];

  // The chain's ordering, stated as a receipt the "Why this?" panel shows.
  reasoning.push(
    "Selection order: unreadable board → active engagement → interrupted loop → waiting decisions → hygiene → inbox overflow → ranked targets. Habits (DAILY/WEEKLY loops) never claim the lead.",
  );
  if (ctx.nextMove?.rationale) reasoning.push(`Weakest axis: ${ctx.nextMove.rationale}`);

  const altFromCritical = (skipTitle: string | null, take: number): BriefAlternative[] =>
    critical
      .filter((t) => t.title !== skipTitle)
      .slice(0, take)
      .map((t) => ({
        label: t.title,
        why: `${t.lane} lane · ${t.reason}`,
        href: `/missions#task-${t.id}`,
      }));

  switch (b.actionType) {
    case "error":
      return {
        kind: "error",
        headline: b.title,
        body: b.message,
        cta: { label: "Open system", href: "/system" },
        taskId: null,
        ledgerId: null,
        alternatives: [],
        reasoning: ["One or more core reads failed — the chain refuses to recommend off an unreadable board."],
      };
    case "execute": {
      // Two execute shapes share the actionType: ACTIVE ENGAGEMENT (a DOING
      // task) and SYSTEMS NOMINAL (top ranked target). Disambiguate on status.
      if (b.status === "executing" && ctx.activeRaw) {
        const t = ctx.activeRaw;
        reasoning.push("A non-habit task is in DOING — finishing it outranks anything new.");
        return {
          kind: "execute",
          headline: "Finish what's in motion",
          body: b.message,
          cta: { label: `Continue · ${t.title}`, href: `/missions#task-${t.id}` },
          taskId: t.id,
          ledgerId: null,
          alternatives: altFromCritical(t.title, 2),
          reasoning,
        };
      }
      const top = critical[0];
      if (top) {
        reasoning.push(`Ranked #1 by the task scorer: ${top.reason}`);
        return {
          kind: "execute",
          headline: top.title,
          body: b.message,
          cta: { label: "Start", href: `/missions#task-${top.id}` },
          taskId: top.id,
          ledgerId: null,
          alternatives: altFromCritical(top.title, 2),
          reasoning,
        };
      }
      return {
        kind: "execute",
        headline: b.title,
        body: b.message,
        cta: { label: "Open missions", href: "/missions" },
        taskId: null,
        ledgerId: null,
        alternatives: [],
        reasoning,
      };
    }
    case "resume": {
      const t = ctx.resumeRaw;
      reasoning.push(
        "This task entered DOING earlier and nothing is actively executing — close the open loop before opening a new one.",
      );
      return {
        kind: "resume",
        headline: "Resume the open loop",
        body: b.message,
        cta: t
          ? { label: `Resume · ${t.title}`, href: `/missions#task-${t.id}` }
          : { label: "Open missions", href: "/missions" },
        taskId: t?.id ?? null,
        ledgerId: null,
        alternatives: altFromCritical(t?.title ?? null, 2),
        reasoning,
      };
    }
    case "decide":
      reasoning.push(
        `${ctx.pendingDecisions} deferred side effect${ctx.pendingDecisions === 1 ? " is" : "s are"} parked until you rule — downstream automation is blocked on you, which outranks new work.`,
      );
      return {
        kind: "decide",
        headline: "Decisions are blocking the system",
        body: b.message,
        cta: { label: "Review approvals", href: "/system/actions" },
        taskId: null,
        ledgerId: null,
        alternatives: altFromCritical(null, 1),
        reasoning,
      };
    case "hygiene":
      reasoning.push("Rescue findings compound quietly; clearing them is cheap now and expensive later.");
      return {
        kind: "hygiene",
        headline: b.title,
        body: b.message,
        cta: { label: "Open missions", href: "/missions" },
        taskId: null,
        ledgerId: null,
        alternatives: altFromCritical(null, 1),
        reasoning,
      };
    case "triage":
      reasoning.push("Unclassified inbox items hide real bottlenecks — triage reveals them.");
      return {
        kind: "triage",
        headline: "Inbox needs triage",
        body: b.message,
        cta: { label: "Triage inbox", href: "/missions" },
        taskId: null,
        ledgerId: null,
        alternatives: altFromCritical(null, 1),
        reasoning,
      };
    case "suggestions":
    default: {
      const s = ctx.nextMove?.suggestions ?? [];
      reasoning.push("Every queue is clear and no ranked target came back — direction is yours to set.");
      return {
        kind: "suggestions",
        headline: b.title,
        body: b.message,
        cta: { label: "Open missions", href: "/missions" },
        taskId: null,
        ledgerId: null,
        alternatives: s.slice(0, 2).map((x) => ({
          label: x.title,
          why: x.reason,
          href: x.taskId ? `/missions#task-${x.taskId}` : "/missions",
        })),
        reasoning,
      };
    }
  }
}

// ── State summary ───────────────────────────────────────────────────────

function composeStateSummary(i: {
  briefing: Briefing;
  health: { state: ChipState; detail: string };
  queuesMeasured: boolean;
  queuesClear: boolean;
  judgmentCount: number;
  activeTitle: string | null;
}): string {
  // Ordered by what the operator must know first. Every clause maps to a
  // measured signal; absence of measurement is said out loud.
  if (i.briefing.status === "error") {
    return "Parts of the board are unreadable — treat this view as incomplete.";
  }
  const parts: string[] = [];
  if (i.health.state === "broken") parts.push(`System needs attention — ${i.health.detail}.`);
  else if (i.health.state === "degraded") parts.push(`System degraded — ${i.health.detail}.`);

  if (i.activeTitle) parts.push(`You're mid-execution on “${i.activeTitle}”.`);
  else if (i.judgmentCount > 0)
    parts.push(
      `${i.judgmentCount} item${i.judgmentCount === 1 ? "" : "s"} need${i.judgmentCount === 1 ? "s" : ""} your judgment.`,
    );
  else if (i.queuesClear && i.health.state === "healthy") parts.push("You're operationally clear.");
  else if (i.queuesClear && i.health.state === "unknown")
    parts.push("Queues are clear; system health is not yet measured.");
  else if (!i.queuesMeasured) parts.push("Some queues could not be read — clear is not a claim on offer.");
  else parts.push("Queues are quiet.");

  return parts.join(" ");
}

// ── Horizon ─────────────────────────────────────────────────────────────

function buildHorizon(i: {
  lead: BriefLeadSection;
  mitText: string | null;
  dueTasks: Array<{ id: string; title: string; dueDate: Date | null }>;
  weekGoals: Array<{ id: string; title: string; deadline: Date | null }>;
  laterGoals: Array<{ id: string; title: string; horizon: string | null; deadline: Date | null }>;
  calendarUpcoming: Array<{ content: string; metadata: unknown }>;
  startOfToday: Date;
  endOfToday: Date;
  measured: boolean;
}): BriefHorizonSection {
  const slots: HorizonSlot[] = [];
  const used = new Set<string>();
  const claim = (label: string) => used.add(label.toLowerCase());
  const isUsed = (label: string) => used.has(label.toLowerCase());

  // The lead already owns "now" — a slot repeating its subject would be
  // noise. Claim both the headline (the nominal arm puts the task title
  // there) and the CTA label sans verb (the active/resume arms put it there).
  if (i.lead.taskId && i.lead.cta) {
    claim(i.lead.headline);
    claim(i.lead.cta.label.replace(/^(Continue|Resume|Start) · /, ""));
  }

  // TODAY — MIT first (an explicit operator anchor beats inference), then
  // the first calendar event starting today, then the first task due today.
  const todayEvent = firstCalendarEventToday(i.calendarUpcoming, i.startOfToday, i.endOfToday);
  const todayTask = i.dueTasks.find(
    (t) => t.dueDate && t.dueDate < i.endOfToday && !isUsed(t.title),
  );
  if (i.mitText) {
    slots.push({ scope: "today", label: i.mitText, href: "/missions", source: "MIT" });
    claim(i.mitText);
  } else if (todayEvent) {
    slots.push({ scope: "today", label: todayEvent.label, href: "/journal", source: "calendar" });
    claim(todayEvent.label);
  } else if (todayTask) {
    slots.push({
      scope: "today",
      label: todayTask.title,
      href: `/missions#task-${todayTask.id}`,
      source: "due today",
    });
    claim(todayTask.title);
  }

  // WEEK — nearest dated task after today, else a WEEK-horizon goal.
  const weekTask = i.dueTasks.find(
    (t) => t.dueDate && t.dueDate >= i.endOfToday && !isUsed(t.title),
  );
  const weekGoal = i.weekGoals.find((g) => !isUsed(g.title));
  if (weekTask) {
    slots.push({
      scope: "week",
      label: weekTask.title,
      href: `/missions#task-${weekTask.id}`,
      source: `due ${weekTask.dueDate!.toLocaleDateString("en-US", { weekday: "short", timeZone: "America/New_York" })}`,
    });
    claim(weekTask.title);
  } else if (weekGoal) {
    slots.push({ scope: "week", label: weekGoal.title, href: "/goals", source: "week goal" });
    claim(weekGoal.title);
  }

  // LATER — the furthest declared direction still alive.
  const later = i.laterGoals.find((g) => !isUsed(g.title));
  if (later) {
    slots.push({
      scope: "later",
      label: later.title,
      href: "/goals",
      source: (later.horizon ?? "later").toLowerCase(),
    });
  }

  return { slots, measured: i.measured };
}

/** Pure internals pinned by tests/home/operator-brief.test.ts — the house
 *  precedent (operator-state.ts __testInternals): decisions you cannot
 *  import without side effects are decisions you cannot canary. */
export const __testInternals = { mapLead, composeStateSummary, buildHorizon, startOfEtDay, ledgerLeadShown };

function firstCalendarEventToday(
  rows: Array<{ content: string; metadata: unknown }>,
  startOfToday: Date,
  endOfToday: Date,
): { label: string } | null {
  const todays: Array<{ startMs: number; label: string }> = [];
  for (const r of rows) {
    const meta = r.metadata as { start?: string } | null;
    if (!meta?.start) continue;
    const t = new Date(meta.start).getTime();
    if (!Number.isFinite(t) || t < startOfToday.getTime() || t >= endOfToday.getTime()) continue;
    // Content's first line is `Event: <summary>` (ingest-calendar cron).
    const firstLine = r.content.split("\n", 1)[0] ?? "";
    const summary = firstLine.replace(/^Event:\s*/, "").trim();
    if (!summary) continue;
    const hhmm = new Date(meta.start).toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
      timeZone: "America/New_York",
    });
    todays.push({ startMs: t, label: `${summary} · ${hhmm}` });
  }
  todays.sort((a, b) => a.startMs - b.startMs);
  return todays[0] ?? null;
}

// ── Since-last-visit semantic diff ──────────────────────────────────────

export interface BriefChangePart {
  label: string;
  count: number;
}

export interface BriefChanges {
  /** Clamped window start actually used (ms epoch). */
  since: number;
  /** True when the requested cursor was older than the clamp window. */
  clamped: boolean;
  parts: BriefChangePart[];
  /** Sources that could not be read — named, not zeroed. */
  failedSources: string[];
  /** "no recorded errors" is only claimable when the read succeeded. */
  errors: { measured: boolean; count: number };
}

/** Don't scan unbounded history — a cursor from a month-old visit clamps
 *  to 7 days and says so. */
const CHANGES_MAX_WINDOW_MS = 7 * 86_400_000;

/**
 * The "what changed" line, computed from REAL domain queries — not from
 * eyeballing an audit firehose. Each count is a claim a query returned;
 * each failed query is named. Replaces SinceLastVisitCard's 20-row
 * timeline (the operator shouldn't inspect history to discover change).
 */
export async function buildBriefChanges(
  sinceMsRaw: number,
  now = new Date(),
): Promise<BriefChanges> {
  const nowMs = now.getTime();
  const clamped = nowMs - sinceMsRaw > CHANGES_MAX_WINDOW_MS;
  const sinceMs = clamped ? nowMs - CHANGES_MAX_WINDOW_MS : sinceMsRaw;
  const since = new Date(sinceMs);

  const [tasksClosed, tasksNew, memories, proposalsNew, followupsNew, errors] =
    await Promise.all([
      guarded(
        prisma.task.count({
          where: { status: "DONE", deletedAt: null, lastCompletedAt: { gte: since } },
        }),
      ),
      guarded(prisma.task.count({ where: { deletedAt: null, createdAt: { gte: since } } })),
      guarded(
        prisma.brainMemory.count({
          where: {
            createdAt: { gte: since },
            deletedAt: null,
            // Machine telemetry is not "memory" in the operator sense —
            // memory_gateway_shadow is the shadow-write channel (see the
            // 2026-09-01 brain-deletion postmortem).
            category: { notIn: ["memory_gateway_shadow"] },
          },
        }),
      ),
      guarded(
        prisma.commitment.count({
          where: { status: "proposed", deletedAt: null, createdAt: { gte: since } },
        }),
      ),
      guarded(
        prisma.agendaItem.count({
          where: { category: "FOLLOW_UP", status: "ACTIVE", createdAt: { gte: since } },
        }),
      ),
      guarded(prisma.errorLog.count({ where: { level: "error", createdAt: { gte: since } } })),
    ]);

  const failedSources: string[] = [];
  const parts: BriefChangePart[] = [];
  const push = (label: string, v: number | null, source: string) => {
    if (v === null) failedSources.push(source);
    else if (v > 0) parts.push({ label, count: v });
  };

  push("closed", tasksClosed, "tasks closed");
  push("new tasks", tasksNew, "tasks created");
  push("memory writes", memories, "memories");
  const judgmentNew = (proposalsNew ?? 0) + (followupsNew ?? 0);
  if (proposalsNew === null && followupsNew === null) failedSources.push("judgment items");
  else if (judgmentNew > 0) parts.push({ label: "awaiting judgment", count: judgmentNew });

  return {
    since: sinceMs,
    clamped,
    parts,
    failedSources,
    errors: { measured: errors !== null, count: errors ?? 0 },
  };
}
