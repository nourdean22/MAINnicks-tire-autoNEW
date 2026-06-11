/**
 * System-prompt v2 renderer · v9.0-beta · Apr 30.
 *
 * Takes a `NickPrimeContext` and produces the LIVE-OPERATING-STATE
 * sections of the system prompt — the parts that depend on real-time
 * data. Identity / voice / permanent principles still come from
 * `lib/ai/system-prompt.ts`'s static composition; v2 replaces only the
 * data-driven sections so the migration is partial-and-safe.
 *
 * The output is plain string sections — caller decides how to splice
 * them with the static prompt. Returning structured pieces (instead of
 * one big string) lets the entry-point in `lib/ai/prompt/v2/index.ts`
 * compare v1 vs v2 line-by-line during shadow runs.
 *
 * Why renderer + builder split (this file vs ./index.ts):
 *   · renderer = pure function (NickPrimeContext → string sections)
 *   · builder  = orchestrates: pulls context, renders, optionally
 *                falls back to v1 for sections we haven't migrated.
 *
 * Pure rendering = trivial unit tests on tiny fixtures.
 */

import type { NickPrimeContext } from "@/lib/ai/context/nick-prime-context";
import { sanitizeForPrompt } from "@/lib/ai/prompt/sanitize";
import { ALERT_LABEL } from "@/lib/ai/prompt/policy/operator-rules";

/** Shorter alias used per-leaf — every operator-supplied string runs
 *  through this before concatenation. v9.1.13 prompt-injection guard. */
const safe = sanitizeForPrompt;

export interface PromptV2Sections {
  /** v9.1.8 · Pinned context + top brain rules (sits near top of prompt). */
  anchors: string;
  /** v9.1.10 · "TODAY" + time-aware guidance + weekly rhythm + targets. */
  temporal: string;
  /** "Active commands" + "Open queue" + "Commitments". */
  commands: string;
  /** v9.1.4 · "Active Missions" + "Active Goals" — the WHY block. */
  whyBlock: string;
  /** v9.1.5 · "Recent thinking" — brain dumps + reflections. */
  recentThinking: string;
  /** v9.1.9 · "Live domain snapshot" — business + mastery one-liners. */
  domainSnapshot: string;
  /** "Today's proof" rollup. */
  proof: string;
  /** Combined drift + brain alerts + stale commands. */
  risks: string;
  /** Recent decisions + decisions awaiting review. */
  decisions: string;
  /** Crons / AI / memory health one-liner. */
  health: string;
  /** Total length sanity for budget tests. */
  totalChars: number;
}

export function renderPromptV2(ctx: NickPrimeContext): PromptV2Sections {
  const anchors = renderAnchors(ctx);
  const temporal = renderTemporal(ctx);
  const commands = renderCommands(ctx);
  const whyBlock = renderWhyBlock(ctx);
  const recentThinking = renderRecentThinking(ctx);
  const domainSnapshot = renderDomainSnapshot(ctx);
  const proof = renderProof(ctx);
  const risks = renderRisks(ctx);
  const decisions = renderDecisions(ctx);
  const health = renderHealth(ctx);

  const totalChars =
    anchors.length +
    temporal.length +
    commands.length +
    whyBlock.length +
    recentThinking.length +
    domainSnapshot.length +
    proof.length +
    risks.length +
    decisions.length +
    health.length;

  return {
    anchors,
    temporal,
    commands,
    whyBlock,
    recentThinking,
    domainSnapshot,
    proof,
    risks,
    decisions,
    health,
    totalChars,
  };
}

/**
 * v9.1.8 · "Anchors" — permanent context that overrides everything
 * else. Pinned by Nour himself + the highest-confidence hard-rule
 * brain memories. Renders at the very top of the prompt because if
 * NICK forgets these, nothing else matters.
 *
 * Two subsections:
 *   · "Pinned by Nour" — operator-curated permanent slots. Never
 *     drop. If a pin feels stale, NICK should ask before assuming.
 *   · "Hot Rules" — top 8 hard-rule memories from identity / feedback
 *     / brand_rules / business_context categories.
 *
 * Section omits each subsection cleanly when empty so the test
 * harness doesn't need fixtures to populate both.
 */
function renderAnchors(ctx: NickPrimeContext): string {
  const pinned = ctx.pinnedContext ?? [];
  const rules = ctx.brainRules ?? [];
  if (pinned.length === 0 && rules.length === 0) return "";

  const lines: string[] = [];

  if (pinned.length > 0) {
    lines.push(`## Pinned by Nour (permanent context — never drop)`);
    lines.push(
      `Nour pinned these himself. They override guesses and stay every turn until he unpins them. If one feels stale, ask — don't assume.`,
    );
    for (const p of pinned) {
      const src = p.source ? ` [${safe(p.source, 40)}]` : "";
      lines.push(`- ${safe(p.key, 60)}${src}: ${safe(p.content, 200)}`);
    }
  }

  if (rules.length > 0) {
    if (lines.length > 0) lines.push("");
    lines.push(`## Hot Rules (${rules.length} hard-rule memories)`);
    lines.push(
      `Highest-confidence rules across identity, feedback, brand, and business context. For deeper recall use \`searchColdMemory()\`.`,
    );
    for (const r of rules) {
      const conf = `${Math.round(r.confidence * 100)}%`;
      lines.push(`- [${safe(r.category, 30)}] (${conf}) ${safe(r.content, 140)}`);
    }
  }

  return lines.join("\n");
}

/**
 * v9.1.10 · Temporal context block. Replaces v1's "TODAY", "TIME-
 * AWARE GUIDANCE", "WEEKLY RHYTHM", and "THIS WEEK'S TARGETS"
 * sections with one typed render driven by NickPrimeContext.temporal.
 *
 * Time bucket rules (ET-anchored):
 *   · 0-5    → late
 *   · 6-10   → morning
 *   · 11-13  → midday
 *   · 14-17  → afternoon
 *   · 18-21  → evening
 *   · 22-23  → late
 *
 * Weekday rhythm overrides only on Mon/Wed/Fri/Sun. Any other
 * weekday gets a generic "execute the week's targets" line.
 */
function renderTemporal(ctx: NickPrimeContext): string {
  const t = ctx.temporal;
  if (!t) return "";

  const lines: string[] = [];
  // v9.1.12 · single source of truth — bucket comes from the typed
  // context, not re-computed here. Guarantees this section and
  // ctx.operatorState.timeOfDay agree.
  const bucket = t.bucket;
  lines.push(
    `## TODAY: ${t.dayNameLong}, ${t.todayISO} — ${bucket.toUpperCase()} (${t.currentHour}:00 ET)`,
  );

  // ── Time-aware guidance ──
  // v9.1.12 · every (bucket × isWeekend) combination has a branch so
  // the section never renders empty under the header.
  lines.push(``, `### TIME-AWARE GUIDANCE`);
  if (bucket === "morning" && !t.isWeekend) {
    lines.push(
      `Morning — Adderall peak window. HARDEST, highest-leverage work happens now.`,
      `What's the MIT (Most Important Task) that moves revenue? Do it before energy drops.`,
      `If Nour opens with low-priority chatter, redirect: "Good morning. Your MIT today is [X]. Let's do that first."`,
    );
  } else if (bucket === "morning" && t.isWeekend) {
    lines.push(
      `Weekend morning. Two modes only: BODY (workout, recovery) or FAMILY (Dania, personal).`,
      `If he pivots to work talk: "It's ${t.dayNameLong}. The shop is handled. What are you doing for yourself today?"`,
    );
  } else if (bucket === "midday" && !t.isWeekend) {
    lines.push(
      `Midday — peak operations window. Calls, customer follow-ups, deal closes.`,
      `Ask: "What's the highest-leverage call you haven't made yet today?"`,
    );
  } else if (bucket === "midday" && t.isWeekend) {
    lines.push(
      `Weekend midday. Family + body window. Don't open the shop in your head.`,
      `If he drifts to work talk: "What's the actual non-work move for the next two hours?"`,
    );
  } else if (bucket === "afternoon" && !t.isWeekend) {
    lines.push(
      `Afternoon — Adderall fading. Operations mode: follow-up, email, admin, callbacks.`,
      `Do NOT start creative projects or big decisions. Execute this morning's plan.`,
      `If energy is low: "Your afternoons consistently produce lower-quality decisions. If this can wait until tomorrow morning, let it."`,
    );
  } else if (bucket === "afternoon" && t.isWeekend) {
    lines.push(
      `Weekend afternoon. Recovery + family time. Resist the late-day work pull.`,
      `If he tries to "just check one thing" — push back: "Closing the laptop is the move."`,
    );
  } else if (bucket === "evening") {
    lines.push(
      `Evening — REVIEW ONLY, no new decisions. Nour over-commits when tired.`,
      `Permitted: review what got done today, plan tomorrow's MIT, journal.`,
      `NOT permitted: starting new projects, financial decisions, new commitments.`,
      `If he says "I had a new idea..." → "Write it down. We'll evaluate it at 9am with a fresh brain."`,
    );
  } else {
    // bucket === "late"
    lines.push(
      `Late night — circadian danger zone. Nour should be sleeping.`,
      `Surface the cost: "Sleep before midnight is one of your tracked habits. What's keeping you up?"`,
    );
  }

  // ── Weekly rhythm ──
  lines.push(``, `### WEEKLY RHYTHM — ${t.dayNameLong.toUpperCase()}`);
  if (t.dayNameLong === "Monday") {
    lines.push(
      `MONDAY PROTOCOL: Set 3 targets for this week (1 revenue, 1 personal, 1 health). Review last week's targets.`,
      `If Nour hasn't set targets → lead: "It's Monday. Before anything else: what are your 3 targets this week?"`,
    );
  } else if (t.dayNameLong === "Wednesday") {
    lines.push(
      `WEDNESDAY PROTOCOL: Mid-week pulse. On pace for the week's targets? What needs course correction?`,
      `Check: estimates sent but not followed up? Workouts on schedule? Active tasks growing or shrinking?`,
    );
  } else if (t.dayNameLong === "Friday") {
    lines.push(
      `FRIDAY PROTOCOL: Revenue close. What deals can we pull forward before the weekend? Lock weekend workout plan.`,
      `Ask: "Revenue number for this week? Hits the target? If not, what closes in the next 4 hours?"`,
    );
  } else if (t.dayNameLong === "Sunday") {
    lines.push(
      `SUNDAY PROTOCOL: Reflection + planning. What worked, what didn't, what's the insight? Set Monday's launch pad.`,
      `Not a work day. Reflection only. Body, family, strategic thinking.`,
    );
  } else {
    lines.push(`Execute day. Head down on the week's 3 targets. Check: am I on pace?`);
  }

  // ── This week's targets ──
  lines.push(``);
  if (t.weeklyTargets) {
    lines.push(`### THIS WEEK'S TARGETS (set for week of ${t.weekKey})`);
    lines.push(`1. REVENUE: ${safe(t.weeklyTargets.revenue, 200) || "not set"}`);
    lines.push(`2. PERSONAL: ${safe(t.weeklyTargets.personal, 200) || "not set"}`);
    lines.push(`3. HEALTH: ${safe(t.weeklyTargets.health, 200) || "not set"}`);
    lines.push(`Reference these in every response where relevant. Hold Nour accountable.`);
  } else if (t.weeklyTargetsRaw) {
    lines.push(`### THIS WEEK'S TARGETS (set for week of ${t.weekKey})`);
    lines.push(safe(t.weeklyTargetsRaw, 500));
    lines.push(`Reference these in every response where relevant.`);
  } else {
    lines.push(`### ⚠️ NO WEEKLY TARGETS SET`);
    if (t.dayNameLong === "Monday") {
      lines.push(
        `It's Monday. FORCE target-setting before anything else: "It's Monday. 3 targets: revenue, personal, health. Go."`,
      );
    } else {
      lines.push(`Mid-week without a scoreboard. Surface this as a flag: "You're operating without a scoreboard this week."`);
    }
  }

  return lines.join("\n");
}

/**
 * v9.1.4 · "WHY block" — strategic context behind active tasks. Active
 * Missions + Active Goals + their progress. Closes the missions
 * coverage gap from v1's prompt.
 */
function renderWhyBlock(ctx: NickPrimeContext): string {
  const lines: string[] = [];
  const missions = ctx.activeMissions ?? [];
  const goals = ctx.activeGoals ?? [];
  const hasMissions = missions.length > 0;
  const hasGoals = goals.length > 0;
  if (!hasMissions && !hasGoals) return "";

  if (hasMissions) {
    lines.push(`## Active Missions (${missions.length})`);
    for (const m of missions) {
      const metric = m.successMetric
        ? ` — ${safe(m.successMetric, 120)}`
        : " — no metric";
      lines.push(
        `- ${safe(m.title, 100)} (${safe(m.domain, 30)}, P${m.priority})${metric}`,
      );
    }
  }

  if (hasGoals) {
    if (hasMissions) lines.push("");
    lines.push(`## Active Goals (${goals.length})`);
    for (const g of goals) {
      const horizon = g.horizon ? `[${safe(g.horizon, 20)}] ` : "";
      const value = `${Math.round(g.currentValue * 10) / 10}/${g.targetValue}${safe(g.unit, 8)}`;
      const dl =
        g.daysToDeadline != null ? ` · ${g.daysToDeadline}d left` : "";
      lines.push(
        `- ${horizon}${safe(g.title, 100)} (${safe(g.domain, 30)}) · ${g.progress}% · ${value}${dl}`,
      );
    }
  }

  return lines.join("\n");
}

/**
 * v9.1.5 · "Recent Thinking" — last 7d of brain dumps + reflections.
 * The connective tissue between WHY (missions/goals) and WHAT
 * (commands). Surfaces what Nour was chewing on, what mood he was in,
 * and any unacknowledged actionable insights Nick already flagged.
 */
function renderRecentThinking(ctx: NickPrimeContext): string {
  const dumps = ctx.recentBrainDumps ?? [];
  const reflections = ctx.recentReflections ?? [];
  if (
    dumps.length === 0 &&
    reflections.length === 0 &&
    !ctx.weeklyReview &&
    (!ctx.followUps || ctx.followUps.length === 0) &&
    (!ctx.anticipatedQuestions || ctx.anticipatedQuestions.length === 0)
  ) {
    return "";
  }

  const lines: string[] = [];

  if (dumps.length > 0) {
    lines.push(`## Recent Brain Dumps (${dumps.length}, last 7d)`);
    for (const d of dumps) {
      const mood =
        d.moodBefore || d.moodAfter
          ? ` · mood ${safe(d.moodBefore ?? "?", 20)}→${safe(d.moodAfter ?? "?", 20)}`
          : "";
      const actions = d.actionsTaken > 0 ? ` · ${d.actionsTaken} action(s) taken` : "";
      const text = d.summary?.trim() || d.excerpt;
      lines.push(`- [${safe(d.date, 12)}${mood}${actions}] ${safe(text, 240)}`);
    }
  }

  // v9.1.13 · split reflections into THREE buckets, not two. Previous
  // "Recent Reflections" mislabeled acknowledged-actionable items as
  // background context. Now: unack-actionable (loud), ack-actionable
  // (resolved/quiet), and non-actionable (background).
  const unack = reflections.filter((r) => r.actionable && !r.acknowledged);
  const resolved = reflections.filter((r) => r.actionable && r.acknowledged);
  const background = reflections.filter((r) => !r.actionable);

  if (unack.length > 0) {
    if (lines.length > 0) lines.push("");
    lines.push(`## Unacknowledged Insights (${unack.length})`);
    for (const r of unack) {
      const conf = `${Math.round(r.confidence * 100)}%`;
      lines.push(
        `- ⚠️ [${safe(r.scope, 20)}/${safe(r.category, 30)}, ${conf}] ${safe(r.insight, 240)}`,
      );
    }
    lines.push(`Surface these proactively if related context comes up.`);
  }

  if (resolved.length > 0) {
    if (lines.length > 0) lines.push("");
    lines.push(`## Resolved Insights (${resolved.length}, ack'd — don't re-raise)`);
    for (const r of resolved) {
      const conf = `${Math.round(r.confidence * 100)}%`;
      lines.push(
        `- ✓ [${safe(r.scope, 20)}/${safe(r.category, 30)}, ${conf}] ${safe(r.insight, 200)}`,
      );
    }
  }

  if (background.length > 0) {
    if (lines.length > 0) lines.push("");
    lines.push(`## Background Reflections (${background.length})`);
    for (const r of background) {
      const conf = `${Math.round(r.confidence * 100)}%`;
      lines.push(
        `- [${safe(r.scope, 20)}/${safe(r.category, 30)}, ${conf}] ${safe(r.insight, 200)}`,
      );
    }
  }

  if (ctx.weeklyReview) {
    if (lines.length > 0) lines.push("");
    lines.push(cap(ctx.weeklyReview, 800));
  }

  if (ctx.followUps && ctx.followUps.length > 0) {
    if (lines.length > 0) lines.push("");
    lines.push(`## Follow-Ups Needed`);
    for (const item of ctx.followUps) {
      lines.push(`- ${item}`);
    }
  }

  if (ctx.anticipatedQuestions && ctx.anticipatedQuestions.length > 0) {
    if (lines.length > 0) lines.push("");
    lines.push(`## Anticipated Questions for Today`);
    for (const q of ctx.anticipatedQuestions) {
      lines.push(`- ${q}`);
    }
  }

  return lines.join("\n");
}

/**
 * v9.1.9 · "Live domain snapshot" — the shop-facing operational state.
 * Replaces v1's "Live domain snapshot" + "Mastery" + "LIVE METRICS"
 * inline blocks with a single typed section.
 *
 * Two subsections:
 *   · Business one-liner — monthly target, latest revenue, savings
 *     rate, money score (each only included if non-null)
 *   · Mastery scoreboard — one row per domain, "label: score/10"
 *     joined by " | " for compact rendering
 */
function renderDomainSnapshot(ctx: NickPrimeContext): string {
  const ds = ctx.domainSnapshot;
  if (!ds) return "";

  const lines: string[] = [];

  // Business sub-line. Always render the target so the prompt always
  // anchors the conversation to the goal; everything else is optional.
  const b = ds.business;
  const bizParts: string[] = [
    `$${(b.monthlyRevenueTarget / 1000).toFixed(0)}K/mo target`,
  ];
  if (b.latestRevenue != null) {
    bizParts.push(
      `$${Math.round(b.latestRevenue).toLocaleString()} latest${b.asOf ? ` (${b.asOf})` : ""}`,
    );
  }
  if (b.savingsRatePct != null) {
    bizParts.push(`${Math.round(b.savingsRatePct)}% savings`);
  }
  if (b.moneyScore != null) {
    bizParts.push(`money score ${b.moneyScore}/100`);
  }

  lines.push(`## LIVE DOMAIN SNAPSHOT`);
  lines.push(`Business: ${bizParts.join(" · ")}`);

  // Mastery scoreboard. Compact "label: n/10" pipes.
  const mastery = ds.mastery ?? [];
  if (mastery.length > 0) {
    const summary = mastery
      .map((m) => `${m.label}: ${m.score}/10`)
      .join(" | ");
    lines.push(`Mastery: ${summary}`);
  }

  return lines.join("\n");
}

function renderCommands(ctx: NickPrimeContext): string {
  const lines: string[] = ["## COMMAND STATE"];
  if (ctx.activeCommand) {
    const c = ctx.activeCommand;
    const meta = [c.priority, c.domain, c.effort, c.energyRequired]
      .filter(Boolean)
      .map((v) => safe(String(v), 30))
      .join(" · ");
    lines.push(`▶ ACTIVE: "${safe(c.title, 120)}" (${meta})`);
    if (c.startedAt) {
      lines.push(`  started ${relTime(c.startedAt)} · last touched ${relTime(c.lastTouchedAt)}`);
    }
  } else {
    lines.push(`▶ ACTIVE: none — Nour is between commands`);
  }

  if (ctx.openCommands.length > 0) {
    lines.push(``, `Open queue (${ctx.openCommands.length}):`);
    for (const cmd of ctx.openCommands.slice(0, 8)) {
      lines.push(`  [${safe(cmd.priority, 20)}] ${safe(cmd.title, 100)}`);
    }
  }

  // v9.1.7 · commitments to other people. These outrank queued tasks
  // for surfacing — Nour's word is on the line.
  const commitments = ctx.activeCommitments ?? [];
  if (commitments.length > 0) {
    lines.push(``, `Active commitments (${commitments.length}):`);
    for (const c of commitments.slice(0, 6)) {
      const dl = c.deadline ? ` — by ${safe(c.deadline, 20)}` : "";
      const dom = c.domain ? ` · ${safe(c.domain, 30)}` : "";
      lines.push(
        `  → ${safe(c.toWhom, 60)}: ${safe(c.description, 120)}${dl}${dom}`,
      );
    }
  }

  // v9.1.7 · scheduled future actions (cron-fired plans). Render only
  // those firing FROM NOW through the next 24h. Past-due never-
  // executed actions get a separate "overdue" surface — surfacing
  // them as "within 24h" with relFromNow="now" was a silent lie
  // (v9.1.12 fix from code review).
  const scheduled = ctx.scheduledActions ?? [];
  const now = Date.now();
  const soon: typeof scheduled = [];
  const overdue: typeof scheduled = [];
  for (const s of scheduled) {
    const delta = new Date(s.scheduledFor).getTime() - now;
    if (delta < 0) overdue.push(s);
    else if (delta < 86_400_000) soon.push(s);
  }
  if (soon.length > 0) {
    lines.push(``, `Scheduled within 24h (${soon.length}):`);
    for (const s of soon.slice(0, 6)) {
      lines.push(`  ${safe(s.actionType, 40)} ${relFromNow(s.scheduledFor)}`);
    }
  }
  if (overdue.length > 0) {
    lines.push(``, `⚠️ Overdue scheduled actions (${overdue.length} past their fire time, never executed):`);
    for (const s of overdue.slice(0, 4)) {
      lines.push(`  ${safe(s.actionType, 40)} — was due ${relTime(s.scheduledFor)}`);
    }
  }

  return lines.join("\n");
}

function renderProof(ctx: NickPrimeContext): string {
  const p = ctx.todayProof;
  const proofRatio =
    p.tasksDone > 0 ? `${p.tasksDoneWithProof}/${p.tasksDone}` : "0/0";
  const parts = [
    `tasks done ${p.tasksDone} (${proofRatio} with proof)`,
    `auto-actions ok ${p.autonomousActionsOk}`,
    `cron ok ${p.cronRunsOk}`,
  ];
  if (p.cronRunsFailed > 0) parts.push(`cron failed ${p.cronRunsFailed}`);

  let line = `## TODAY'S PROOF\n${parts.join(" · ")}`;
  if (p.tasksDone === 0 && p.autonomousActionsOk === 0) {
    line += `\nNo proof yet today — surface this if Nour is asking what got done.`;
  }
  return line;
}

function renderRisks(ctx: NickPrimeContext): string {
  const lines: string[] = [];
  const totalRisks =
    ctx.activeRisks.drift.length +
    ctx.activeRisks.brain.length +
    ctx.activeRisks.stale.length +
    (ctx.activeRisks.noProofDay.fired ? 1 : 0);

  if (totalRisks === 0) {
    return `## RISKS · CLEAR`;
  }

  lines.push(`## ACTIVE RISKS (${totalRisks})`);

  if (ctx.activeRisks.noProofDay.fired) {
    lines.push(``, `📎 No-proof day: ${ctx.activeRisks.noProofDay.reason}`);
  }

  if (ctx.activeRisks.drift.length > 0) {
    lines.push(``, `Drift alerts (${ctx.activeRisks.drift.length}):`);
    for (const a of ctx.activeRisks.drift) {
      lines.push(
        `  [${safe(a.severity, 20).toUpperCase()}] ${safe(a.ruleName, 60)}: ${safe(a.message, 200)}`,
      );
    }
  }

  if (ctx.activeRisks.brain.length > 0) {
    lines.push(``, `Brain alerts (last 7d, ${ctx.activeRisks.brain.length}):`);
    for (const a of ctx.activeRisks.brain) {
      const label = ALERT_LABEL[a.category] ?? safe(a.category, 30);
      lines.push(`  ${label}: ${safe(a.content, 200)}`);
    }
    lines.push(`If Nour's question relates to one of these alerts, surface the connection unprompted.`);
  }

  if (ctx.activeRisks.stale.length > 0) {
    lines.push(``, `Stale commands (>7d untouched, ${ctx.activeRisks.stale.length}):`);
    for (const t of ctx.activeRisks.stale) {
      lines.push(`  "${safe(t.title, 100)}" — last touched ${relTime(t.lastTouchedAt)}`);
    }
  }

  return lines.join("\n");
}

function renderDecisions(ctx: NickPrimeContext): string {
  const lines: string[] = [];
  if (ctx.recentDecisions.length === 0 && ctx.decisionsNeedingReview.length === 0) {
    return ``;
  }

  if (ctx.recentDecisions.length > 0) {
    lines.push(`## RECENT DECISIONS (${ctx.recentDecisions.length})`);
    for (const d of ctx.recentDecisions.slice(0, 5)) {
      const grade = d.grade ? ` · grade ${safe(d.grade, 4)}` : "";
      const status = d.hasOutcome ? "" : " · no outcome yet";
      lines.push(`- "${safe(d.title, 120)}" (${safe(d.date, 12)}${grade}${status})`);
    }
  }

  if (ctx.decisionsNeedingReview.length > 0) {
    lines.push(
      ``,
      `## DECISIONS PAST REVIEW DATE (${ctx.decisionsNeedingReview.length})`,
    );
    for (const d of ctx.decisionsNeedingReview) {
      lines.push(
        `- "${safe(d.title, 120)}" — review was ${safe(d.reviewDate ?? "?", 12)}, no outcome filed`,
      );
    }
    lines.push(`Surface these proactively if it's review time or related context comes up.`);
  }

  return lines.join("\n");
}

function renderHealth(ctx: NickPrimeContext): string {
  const h = ctx.systemHealth;
  const cron = `${h.crons.failures24h > 0 ? "⚠️" : "✓"} crons (${h.crons.failures24h} failures/24h)`;
  const ai = `${h.ai.recentErrorRate > 5 ? "⚠️" : "✓"} ai (${h.ai.recentErrorRate}% err)`;
  const mem = `pgvector ${h.memory.embeddingCoveragePct}%`;
  return `## SYSTEM HEALTH · ${cron} · ${ai} · ${mem}`;
}

function relTime(iso: string | null): string {
  if (!iso) return "never";
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000) return "just now";
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m ago`;
  if (ms < 86_400_000) return `${Math.round(ms / 3_600_000)}h ago`;
  return `${Math.round(ms / 86_400_000)}d ago`;
}

/**
 * v9.1.7 · "in 12m / in 2h / in 3d" formatter for future timestamps.
 * Mirrors relTime but for the other direction of the time arrow.
 */
function relFromNow(iso: string | null): string {
  if (!iso) return "never";
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return "now";
  if (ms < 60_000) return "in <1m";
  if (ms < 3_600_000) return `in ${Math.round(ms / 60_000)}m`;
  if (ms < 86_400_000) return `in ${Math.round(ms / 3_600_000)}h`;
  return `in ${Math.round(ms / 86_400_000)}d`;
}

function cap(text: string | undefined | null, n: number): string {
  if (!text) return "";
  if (text.length <= n) return text;
  return text.slice(0, n - 3) + "...";
}
