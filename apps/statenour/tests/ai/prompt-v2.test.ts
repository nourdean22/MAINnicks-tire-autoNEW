/**
 * Contract tests for the v9.0-beta prompt-v2 renderer.
 *
 * Verifies:
 *   1. Pure renderer turns a fixture NickPrimeContext into expected
 *      section strings.
 *   2. Section labels survive (downstream tools grep for them).
 *   3. Empty-state branches don't crash + produce sensible defaults.
 *   4. The feature flag entry-point routes correctly.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/ai/context/nick-prime-context", () => ({
  buildNickPrimeContext: vi.fn(),
}));

import { buildNickPrimeContext } from "@/lib/ai/context/nick-prime-context";
import { renderPromptV2 } from "@/lib/ai/prompt/v2/renderer";
import { buildSystemPromptV2, isPromptV2Enabled } from "@/lib/ai/prompt/v2";
import type { NickPrimeContext } from "@/lib/ai/context/nick-prime-context";

const FIXTURE: NickPrimeContext = {
  operatorState: { timeOfDay: "midday", todayScore: null },
  activeCommand: {
    id: "task-1",
    title: "Close out launch announcement",
    status: "DOING",
    priority: "high",
    domain: "business",
    effort: "M30",
    energyRequired: "MEDIUM",
    context: "DESK",
    startedAt: new Date(Date.now() - 30 * 60_000).toISOString(),
    lastTouchedAt: new Date(Date.now() - 5 * 60_000).toISOString(),
    dueDate: null,
  },
  openCommands: [
    {
      id: "task-2",
      title: "Quote follow-up: John D.",
      status: "READY",
      priority: "critical",
      domain: "business",
      effort: "M5",
      energyRequired: "LOW",
      context: "PHONE",
      startedAt: null,
      lastTouchedAt: null,
      dueDate: null,
    },
  ],
  activeCommitments: [
    {
      id: "c-1",
      description: "Send tire quote",
      toWhom: "John D.",
      status: "active",
      deadline: "2026-05-01",
      domain: "business",
    },
  ],
  scheduledActions: [
    {
      id: "s-1",
      actionType: "send_followup_sms",
      scheduledFor: new Date(Date.now() + 2 * 3_600_000).toISOString(),
      status: "pending",
    },
    {
      id: "s-2",
      actionType: "weekly_review",
      // 3 days out — should NOT render in 24h window
      scheduledFor: new Date(Date.now() + 3 * 86_400_000).toISOString(),
      status: "pending",
    },
    {
      id: "s-3",
      actionType: "missed_quote_callback",
      // 6 hours PAST — must surface in the OVERDUE bucket, not the
      // "Scheduled within 24h" bucket. v9.1.12 bug fix.
      scheduledFor: new Date(Date.now() - 6 * 3_600_000).toISOString(),
      status: "pending",
    },
  ],
  activeMissions: [
    {
      id: "m-1",
      title: "Launch v9 Command Spine",
      domain: "business",
      priority: 1,
      successMetric: "v9.0 shipped to bdnick.info",
    },
  ],
  activeGoals: [
    {
      id: "g-1",
      title: "Hit $40k revenue this month",
      domain: "business",
      metric: "revenue",
      targetValue: 40000,
      currentValue: 12500,
      unit: "$",
      progress: 31,
      horizon: "month",
      daysToDeadline: 14,
    },
  ],
  recentBrainDumps: [
    {
      id: "bd-1",
      date: "2026-04-29",
      summary: "Worried about churn signal in last 3 quotes lost to price",
      excerpt: "lost three quotes in a row, all on price...",
      moodBefore: "anxious",
      moodAfter: "focused",
      actionsTaken: 2,
      createdAt: new Date(Date.now() - 86_400_000).toISOString(),
    },
  ],
  recentReflections: [
    {
      id: "r-1",
      date: "2026-04-29",
      scope: "daily",
      category: "business",
      insight: "Price-loss pattern correlates with skipping financing pitch",
      confidence: 0.82,
      actionable: true,
      acknowledged: false,
      createdAt: new Date(Date.now() - 86_400_000).toISOString(),
    },
    {
      id: "r-2",
      date: "2026-04-28",
      scope: "weekly",
      category: "behavior",
      insight: "Better focus mornings when first action is brain dump",
      confidence: 0.74,
      actionable: false,
      acknowledged: true,
      createdAt: new Date(Date.now() - 2 * 86_400_000).toISOString(),
    },
  ],
  pinnedContext: [
    {
      key: "no_agents_rule",
      content: "Never spin up sub-agents — keep all logic inline and traceable",
      source: "feedback_work_style_v2",
      seenCount: 47,
      updatedAt: "2026-04-15T00:00:00.000Z",
    },
  ],
  brainRules: [
    {
      category: "identity",
      key: "communication_dna",
      content: "Direct, terse, action-first. No filler.",
      confidence: 0.95,
    },
  ],
  domainSnapshot: {
    business: {
      monthlyRevenueTarget: 20000,
      latestRevenue: 12500,
      asOf: "2026-04-29",
      savingsRatePct: 22.5,
      netWorthEstimate: 95000,
      moneyScore: 68,
    },
    mastery: [
      { domain: "business_ops", label: "Business Operations", score: 7, baseline: 6.5 },
      { domain: "sales", label: "Sales & Persuasion", score: 4, baseline: 3 },
    ],
  },
  temporal: {
    dayName: "Mon",
    dayNameLong: "Monday",
    todayISO: "2026-04-27",
    currentHour: 9,
    bucket: "morning",
    isWeekend: false,
    weekKey: "2026-04-27",
    weeklyTargets: {
      revenue: "$20K closed",
      personal: "Read 1 book this week",
      health: "4 workouts",
    },
    weeklyTargetsRaw: null,
  },
  todayProof: {
    tasksDone: 3,
    tasksDoneWithProof: 1,
    autonomousActionsOk: 2,
    cronRunsOk: 14,
    cronRunsFailed: 0,
  },
  activeRisks: {
    drift: [],
    brain: [
      {
        category: "decision_quality_drift",
        content: "Decision quality dropped 18% week-over-week",
        createdAt: new Date().toISOString(),
      },
    ],
    stale: [],
    noProofDay: { fired: false, tasksDone: 3, withProof: 1, reason: "" },
  },
  recentDecisions: [
    {
      id: 12,
      title: "Switch tire supplier to DK Tire B2B",
      date: "2026-04-22",
      domain: "business",
      grade: "A",
      reviewDate: null,
      hasOutcome: true,
    },
  ],
  decisionsNeedingReview: [],
  systemHealth: {
    crons: { active: 34, silent: 0, failures24h: 0 },
    ai: { recentCallCount: 47, recentErrorRate: 0 },
    memory: { lastBrainCycleAt: null, embeddingCoveragePct: 87.4 },
  },
  weeklyReview: "── WEEKLY REVIEWS (cross-week memory · last 14d) ──\nWins: Closed DK Tire",
  followUps: [],
  anticipatedQuestions: [],
  agendaItems: [],
};

const EMPTY_FIXTURE: NickPrimeContext = {
  operatorState: { timeOfDay: "morning", todayScore: null },
  activeCommand: null,
  openCommands: [],
  activeCommitments: [],
  scheduledActions: [],
  activeMissions: [],
  activeGoals: [],
  recentBrainDumps: [],
  recentReflections: [],
  pinnedContext: [],
  brainRules: [],
  domainSnapshot: {
    business: {
      monthlyRevenueTarget: 20000,
      latestRevenue: null,
      asOf: null,
      savingsRatePct: null,
      netWorthEstimate: null,
      moneyScore: null,
    },
    mastery: [],
  },
  temporal: {
    dayName: "Tue",
    dayNameLong: "Tuesday",
    todayISO: "2026-04-28",
    currentHour: 11,
    bucket: "midday",
    isWeekend: false,
    weekKey: "2026-04-27",
    weeklyTargets: null,
    weeklyTargetsRaw: null,
  },
  todayProof: { tasksDone: 0, tasksDoneWithProof: 0, autonomousActionsOk: 0, cronRunsOk: 0, cronRunsFailed: 0 },
  activeRisks: {
    drift: [],
    brain: [],
    stale: [],
    noProofDay: { fired: false, tasksDone: 0, withProof: 0, reason: "" },
  },
  recentDecisions: [],
  decisionsNeedingReview: [],
  systemHealth: {
    crons: { active: 34, silent: 0, failures24h: 0 },
    ai: { recentCallCount: 0, recentErrorRate: 0 },
    memory: { lastBrainCycleAt: null, embeddingCoveragePct: 0 },
  },
  followUps: [],
  anticipatedQuestions: [],
  agendaItems: [],
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("v9.0-beta · prompt-v2 renderer", () => {
  it("renders all sections from a populated context", () => {
    const sections = renderPromptV2(FIXTURE);

    expect(sections.anchors).toContain("Pinned by Nour");
    expect(sections.anchors).toContain("no_agents_rule");
    expect(sections.anchors).toContain("Hot Rules");
    expect(sections.anchors).toContain("[identity]");

    expect(sections.temporal).toContain("TODAY: Monday");
    expect(sections.temporal).toContain("MORNING (9:00 ET)");
    expect(sections.temporal).toContain("TIME-AWARE GUIDANCE");
    expect(sections.temporal).toContain("MONDAY PROTOCOL");
    expect(sections.temporal).toContain("THIS WEEK'S TARGETS");
    expect(sections.temporal).toContain("$20K closed");
    expect(sections.temporal).toContain("4 workouts");

    expect(sections.commands).toContain("ACTIVE: \"Close out launch announcement\"");
    expect(sections.commands).toContain("high · business · M30 · MEDIUM");
    expect(sections.commands).toContain("Open queue (1):");
    expect(sections.commands).toContain("[critical] Quote follow-up");
    expect(sections.commands).toContain("Active commitments (1):");
    expect(sections.commands).toContain("→ John D.: Send tire quote");
    expect(sections.commands).toContain("Scheduled within 24h (1):");
    expect(sections.commands).toContain("send_followup_sms in");
    // The 3-day-out scheduled action must NOT leak in.
    expect(sections.commands).not.toContain("weekly_review");
    // v9.1.12 · past-due actions land in the overdue bucket, NOT the
    // "within 24h" bucket. Crucial — if the bug returns this fails.
    expect(sections.commands).toContain("Overdue scheduled actions (1");
    expect(sections.commands).toContain("missed_quote_callback");
    expect(sections.commands).toContain("was due");
    // And the 24h count stays 1, not 2 — the past action is NOT
    // double-counted into "within 24h".
    expect(sections.commands).not.toContain("Scheduled within 24h (2)");

    expect(sections.whyBlock).toContain("Active Missions (1)");
    expect(sections.whyBlock).toContain("Launch v9 Command Spine");
    expect(sections.whyBlock).toContain("Active Goals (1)");
    expect(sections.whyBlock).toContain("Hit $40k revenue this month");
    expect(sections.whyBlock).toContain("31%");

    expect(sections.recentThinking).toContain("Recent Brain Dumps");
    expect(sections.recentThinking).toContain("anxious→focused");
    expect(sections.recentThinking).toContain("Unacknowledged Insights (1)");
    expect(sections.recentThinking).toContain("Price-loss pattern");
    // v9.1.13 · 3-bucket split: ack-actionable goes to "Resolved",
    // non-actionable goes to "Background". Fixture has 1 of each.
    expect(sections.recentThinking).toContain("Background Reflections (1)");
    expect(sections.recentThinking).toContain("Better focus mornings");
    expect(sections.recentThinking).toContain("── WEEKLY REVIEWS (cross-week memory · last 14d) ──");
    expect(sections.recentThinking).toContain("Wins: Closed DK Tire");

    expect(sections.domainSnapshot).toContain("LIVE DOMAIN SNAPSHOT");
    expect(sections.domainSnapshot).toContain("$20K/mo target");
    expect(sections.domainSnapshot).toContain("$12,500 latest (2026-04-29)");
    expect(sections.domainSnapshot).toContain("23% savings");
    expect(sections.domainSnapshot).toContain("money score 68/100");
    expect(sections.domainSnapshot).toContain("Mastery: Business Operations: 7/10");

    expect(sections.proof).toContain("TODAY'S PROOF");
    expect(sections.proof).toContain("tasks done 3");
    expect(sections.proof).toContain("1/3 with proof");
    expect(sections.proof).toContain("auto-actions ok 2");

    expect(sections.risks).toContain("ACTIVE RISKS (1)");
    expect(sections.risks).toContain("📉 decision drift");

    expect(sections.decisions).toContain("RECENT DECISIONS (1)");
    expect(sections.decisions).toContain("DK Tire");
    expect(sections.decisions).toContain("grade A");

    expect(sections.health).toContain("SYSTEM HEALTH");
    expect(sections.health).toContain("pgvector 87.4%");

    expect(sections.totalChars).toBeGreaterThan(0);
  });

  it("handles empty state without crashing or producing nonsense", () => {
    const sections = renderPromptV2(EMPTY_FIXTURE);

    expect(sections.anchors).toBe(""); // empty when no pins or rules
    // Empty domain snapshot still renders the target line — that's
    // the operating anchor, never null.
    expect(sections.domainSnapshot).toContain("LIVE DOMAIN SNAPSHOT");
    expect(sections.domainSnapshot).toContain("$20K/mo target");
    // Temporal still renders even without weekly targets — the day,
    // bucket, and "no targets set" warning are the value.
    expect(sections.temporal).toContain("TODAY: Tuesday");
    expect(sections.temporal).toContain("MIDDAY");
    expect(sections.temporal).toContain("NO WEEKLY TARGETS SET");
    expect(sections.commands).toContain("ACTIVE: none");
    expect(sections.proof).toContain("No proof yet today");
    expect(sections.risks).toContain("RISKS · CLEAR");
    expect(sections.decisions).toBe(""); // empty string when nothing to show
    expect(sections.whyBlock).toBe(""); // empty when no missions or goals
    expect(sections.recentThinking).toBe(""); // empty when no thinking activity
    expect(sections.health).toContain("SYSTEM HEALTH");
  });

  it("renders agenda items when present in the context", () => {
    const contextWithAgenda: NickPrimeContext = {
      ...EMPTY_FIXTURE,
      agendaItems: [
        {
          id: "agenda-1",
          title: "Verify tire supplier contract",
          description: "Follow up on financing options with DK Tire B2B",
          category: "WITNESSED_COMMITMENT",
          createdAt: new Date().toISOString(),
          dueDate: "2026-06-30T00:00:00.000Z",
        },
      ],
    };

    const sections = renderPromptV2(contextWithAgenda);
    expect(sections.agendaItems).toContain("## ACTIVE AGENDA ITEMS");
    expect(sections.agendaItems).toContain("[WITNESSED COMMITMENT] Verify tire supplier contract (Due: 2026-06-30)");
    expect(sections.agendaItems).toContain("Description: Follow up on financing options with DK Tire B2B");
  });

  it("renders weekly review, follow-ups, and anticipated questions when present in context", () => {
    const contextWithWeekly: NickPrimeContext = {
      ...EMPTY_FIXTURE,
      weeklyReview: "── WEEKLY REVIEWS (cross-week memory · last 14d) ──\nWeek of 2026-06-07:\n  Focus: build NOUR OS\n  Patterns: shiny-object syndrome",
      followUps: ["Verify dk-tire invoice on Monday"],
      anticipatedQuestions: ["What is the primary blocker for NOUR OS?"],
    };

    const sections = renderPromptV2(contextWithWeekly);
    expect(sections.recentThinking).toContain("── WEEKLY REVIEWS");
    expect(sections.recentThinking).toContain("Week of 2026-06-07:");
    expect(sections.recentThinking).toContain("## Follow-Ups Needed");
    expect(sections.recentThinking).toContain("Verify dk-tire invoice on Monday");
    expect(sections.recentThinking).toContain("## Anticipated Questions for Today");
    expect(sections.recentThinking).toContain("What is the primary blocker for NOUR OS?");
  });
});

describe("v9.0-beta · prompt-v2 entry point", () => {
  it("isPromptV2Enabled reads NICK_PRIME_PROMPT", () => {
    const original = process.env.NICK_PRIME_PROMPT;
    process.env.NICK_PRIME_PROMPT = "1";
    expect(isPromptV2Enabled()).toBe(true);
    process.env.NICK_PRIME_PROMPT = "0";
    expect(isPromptV2Enabled()).toBe(false);
    delete process.env.NICK_PRIME_PROMPT;
    expect(isPromptV2Enabled()).toBe(false);
    if (original !== undefined) process.env.NICK_PRIME_PROMPT = original;
  });

  it("buildSystemPromptV2 produces a non-empty prompt + meta", async () => {
    vi.mocked(buildNickPrimeContext).mockResolvedValue(FIXTURE);
    const out = await buildSystemPromptV2();
    // v9.2 · header now uses "# NICK · Nour Dean's Chief of Staff"
    // (middle-dot separator matches the rest of v2's section-heading
    // style). Pre-v9.2 stub used "# NICK — Nour's Chief of Staff" with
    // an em-dash; the change is in lib/ai/prompt/static.ts.
    expect(out.prompt).toContain("# NICK");
    expect(out.prompt).toContain("Chief of Staff");
    // v9.2 · Layer 1 includes the seven-block stable prefix now (vs the
    // old 6-line stub). Probe a few of the new sections.
    expect(out.prompt).toContain("## Nour's rules");
    expect(out.prompt).toContain("## Response style");
    expect(out.prompt).toContain("## Behavioral patterns");
    // Layer 2 sections (live data) still present.
    expect(out.prompt).toContain("ACTIVE:");
    expect(out.prompt).toContain("TODAY'S PROOF");
    expect(out.meta.builderVersion).toBe("v2");
    expect(out.meta.contextChars).toBeGreaterThan(0);
  });
});
