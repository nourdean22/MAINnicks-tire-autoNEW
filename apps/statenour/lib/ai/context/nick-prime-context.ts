/**
 * NickPrimeContext · v9.0-alpha · Apr 30.
 *
 * The typed contract every NICK reply consumes BEFORE composing a
 * response. Replaces the ad-hoc 15-piece assembly that lives inside
 * `lib/ai/system-prompt.ts` today.
 *
 * Why a separate type: the command-center state is a "kitchen sink"
 * read; NICK only needs a subset (operator state, active commands,
 * recent risks, decisions, system health). Splitting the type makes
 * both surfaces — operator dashboard and AI prompt — explicit about
 * what they actually need.
 *
 * Phase plan:
 *   v9.0-alpha · this file lands; NO consumers wired.
 *   v9.0-beta  · system-prompt-v2 reads from buildNickPrimeContext()
 *                behind a feature flag; old assembly stays as fallback.
 *   v9.0-rc    · proof attachments surface in the context.
 *   v9.0-final · old ad-hoc assembly deleted once shadow-run parity
 *                holds 7+ days.
 */

import {
  buildCommandCenterState,
  type CommandCenterState,
  type TaskSummary,
  type MasteryDecisionSummary,
  type DriftAlertSummary,
  type BrainAlertSummary,
  type SystemHealthSummary,
  type ProofRollup,
  type NoProofDayRisk,
  type MissionSummary,
  type GoalSummary,
  type BrainDumpSummary,
  type ReflectionSummary,
  type CommitmentSummary,
  type ScheduledActionSummary,
  type PinnedMemorySummary,
  type BrainRuleSummary,
  type DomainSnapshot,
  type TemporalContext,
} from "./command-center-state";
import { prisma } from "@/lib/prisma";
import { getTodaysAnticipated } from "@/lib/brain/anticipated-questions";

/**
 * 2026-08-25 · agenda rows the prompt carries per turn. Chosen against
 * the measured 71-row / 2,646-tok unbounded block: 18 deadline-first
 * rows keep the accountability surface (~680 tok) and the renderer
 * names the overflow. Tune here, not in the renderer.
 */
export const AGENDA_PROMPT_CAP = 18;

export interface AgendaItemSummary {
  id: string;
  title: string;
  description: string | null;
  category: "WITNESSED_COMMITMENT" | "STANDING_INTENTION" | "CONTRADICTION" | "NEGLECT_ALERT";
  createdAt: string;
  dueDate: string | null;
}

export interface NickPrimeContext {
  operatorState: CommandCenterState["operator"];
  activeCommand: TaskSummary | null;
  openCommands: TaskSummary[];
  /** v9.1.7 · active commitments to other people. */
  activeCommitments: CommitmentSummary[];
  /** v9.1.7 · scheduled future actions (cron-fired or operator-set). */
  scheduledActions: ScheduledActionSummary[];
  /** v9.1.4 · active missions + goals — the WHY behind tasks. */
  activeMissions: MissionSummary[];
  activeGoals: GoalSummary[];
  /** v9.1.5 · recent brain dumps + reflections — the recent thinking. */
  recentBrainDumps: BrainDumpSummary[];
  recentReflections: ReflectionSummary[];
  /** v9.1.8 · Nour-pinned permanent context + top hard-rule memories. */
  pinnedContext: PinnedMemorySummary[];
  brainRules: BrainRuleSummary[];
  /** v9.1.9 · Live domain snapshot — business + mastery scores. */
  domainSnapshot: DomainSnapshot;
  /** v9.1.10 · Temporal context — day, time bucket, weekly targets. */
  temporal: TemporalContext;
  todayProof: ProofRollup;
  activeRisks: {
    drift: DriftAlertSummary[];
    brain: BrainAlertSummary[];
    stale: TaskSummary[];
    noProofDay: NoProofDayRisk;
  };
  recentDecisions: MasteryDecisionSummary[];
  decisionsNeedingReview: MasteryDecisionSummary[];
  systemHealth: SystemHealthSummary;
  weeklyReview?: string;
  followUps: string[];
  anticipatedQuestions: string[];
  agendaItems: AgendaItemSummary[];
  /** Total ACTIVE/SNOOZED rows — the renderer's overflow denominator. */
  agendaItemsTotal: number;
}

/**
 * Direct server-side build. Pulls from the command-center-state module,
 * which goes straight to Prisma — no HTTP round-trip when called from
 * within the app.
 *
 * For client-side use, fetch `/api/command-center/state` and project
 * into the same shape (the projection is cheap; see `nickContextFromState`).
 */
export async function buildNickPrimeContext(): Promise<NickPrimeContext> {
  const state = await buildCommandCenterState();
  const ctx = nickContextFromState(state);
  
  const { getWeeklyReviewContext } = await import("@/lib/brain/weekly-review-context");
  
  const [weeklyReview, recentDigests, anticipated, agendaItems, agendaItemsTotal] = await Promise.all([
    getWeeklyReviewContext().catch((): string => ""),
    prisma.auditEvent.findMany({
      where: { eventType: "conversation_digest" },
      orderBy: { createdAt: "desc" },
      take: 5,
      select: { payload: true },
    }).catch((): any[] => []),
    getTodaysAnticipated().catch(() => null),
    // 2026-08-25 · BOUNDED (was unbounded — the #1 prompt line item).
    // Measured: 71 ACTIVE rows (oldest 2026-06-28) all rendered into
    // EVERY turn = 10,583 chars / ~2,646 tok, 21% of the built prompt,
    // growing monotonically (docs/audits/PROMPT-COST-MEASUREMENT-
    // 2026-08-25.md). The jit-sections A/B proved the SECTION earns its
    // place on grounded turns — unbounded SIZE was never part of that
    // result. Deadline-soonest first (nulls last), then newest; the
    // renderer discloses the overflow count so nothing silently
    // disappears.
    prisma.agendaItem.findMany({
      where: { status: { in: ["ACTIVE", "SNOOZED"] } },
      orderBy: [{ dueDate: { sort: "asc", nulls: "last" } }, { createdAt: "desc" }],
      take: AGENDA_PROMPT_CAP,
      select: { id: true, title: true, description: true, category: true, createdAt: true, dueDate: true }
    }).catch(() => []),
    prisma.agendaItem.count({
      where: { status: { in: ["ACTIVE", "SNOOZED"] } },
    }).catch(() => 0),
  ]);

  ctx.weeklyReview = weeklyReview;
  ctx.agendaItems = agendaItems.map(item => ({
    id: item.id,
    title: item.title,
    description: item.description,
    category: item.category as any,
    createdAt: item.createdAt.toISOString(),
    dueDate: item.dueDate ? item.dueDate.toISOString() : null,
  }));
  ctx.agendaItemsTotal = agendaItemsTotal;

  const followUps: string[] = [];
  for (const row of recentDigests) {
    if (row.payload && typeof row.payload === "object") {
      const payload = row.payload as Record<string, any>;
      if (typeof payload.followUpNeeded === "string" && payload.followUpNeeded.trim().length > 0) {
        followUps.push(payload.followUpNeeded.trim());
      }
    }
  }
  ctx.followUps = followUps;

  ctx.anticipatedQuestions = anticipated
    ? anticipated.questions.map((q) => q.question)
    : [];

  return ctx;
}

/**
 * Pure projection — useful for tests + client-side consumers that
 * already have the state.
 */
export function nickContextFromState(state: CommandCenterState): NickPrimeContext {
  return {
    operatorState: state.operator,
    activeCommand: state.commands.active,
    openCommands: state.commands.open,
    activeCommitments: state.commands.commitments,
    scheduledActions: state.commands.scheduled,
    activeMissions: state.missions,
    activeGoals: state.goals,
    recentBrainDumps: state.recentThinking.brainDumps,
    recentReflections: state.recentThinking.reflections,
    pinnedContext: state.brainAnchors.pinned,
    brainRules: state.brainAnchors.rules,
    domainSnapshot: state.domainSnapshot,
    temporal: state.temporal,
    todayProof: state.proof.today,
    activeRisks: {
      drift: state.risks.driftAlerts,
      brain: state.risks.brainAlerts,
      stale: state.risks.staleCommands,
      noProofDay: state.risks.noProofDay,
    },
    recentDecisions: state.decisions.recent,
    decisionsNeedingReview: state.decisions.needsReview,
    systemHealth: state.systemHealth,
    followUps: [],
    anticipatedQuestions: [],
    agendaItems: [],
    agendaItemsTotal: 0,
  };
}
