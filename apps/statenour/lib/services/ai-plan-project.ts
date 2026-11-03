/**
 * lib/services/ai-plan-project.ts · actions-surface REST→tRPC slice
 * (2026-05-22 · legacy-modernizer · components/actions/* slice).
 *
 * The project-intelligence engine · lifted verbatim from
 * app/api/ai/plan-project/route.ts so the legacy REST endpoint AND the
 * new `ai.planProject` tRPC procedure call the SAME function · drift
 * between consumers structurally impossible.
 *
 * Five modes — clarify · plan · milestones · learn · guide. All pull
 * brain memory + past-decision context so the plan is informed by
 * Nour's actual situation, not generic advice. `plan` / `learn` /
 * `guide` persist to `Mission.planData` when a `missionId` is supplied.
 *
 * The service throws `PlanProjectError` for the route's 400/404 cases
 * (mission-not-found · missing title · unknown mode · guide-without-
 * mission) so the REST route and the tRPC procedure can both map them
 * to the matching status / code.
 *
 * The result is `PlanProjectResult` — a discriminated union keyed on
 * `mode`. Every variant is an explicit, flat shape; the AI payload is a
 * heterogeneous JSON blob projected into known fields, and the only
 * Prisma touch (`Mission.planData`) is a WRITE — no Prisma Json row is
 * ever returned. The TS2589 firewall is satisfied trivially.
 */

import { tracedAiChat } from "@/lib/ai/traced-aichat";
import { spawnProjectTasks } from "@/lib/services/spawn-tasks";
import { prisma } from "@/lib/prisma";
import { logger as rootLogger } from "@/lib/logger";
import {
  normalizeRawPlan,
  isProjectPlanData,
  type ProjectPlanData,
  type LearningPath,
  type CoachEntry,
} from "@/lib/ai/project-plan";
import { extractJsonObject } from "@/lib/ai/extract-structured";
import { isAiSentinel } from "@/lib/ai/provider";
import { AiUnavailableError } from "@/lib/ai/structured";
import { logError } from "@/lib/utils/error-log";

const log = rootLogger.withSurface("service/ai-plan-project");

export type PlanProjectMode =
  | "clarify"
  | "plan"
  | "milestones"
  | "learn"
  | "guide";

/** The full input the engine accepts · mirrors the legacy POST body. */
export interface PlanProjectInput {
  title?: string;
  description?: string;
  domain?: string;
  answers?: string;
  missionId?: string;
  currentState?: string;
  mode?: PlanProjectMode;
  milestones?: string[];
  goalTarget?: number;
  goalUnit?: string;
  goalDeadline?: string;
  goalMetric?: string;
}

/** A suggested milestone from the `milestones` mode. */
export interface SuggestedMilestone {
  label: string;
  metric: string | null;
  estimatedDate: string | null;
}

/** Discriminated result · one variant per mode. */
export type PlanProjectResult =
  | {
      mode: "clarify";
      questions?: unknown;
      initialThoughts?: string;
      redFlags?: string[];
      quickWin?: string;
      provider?: string;
    }
  | {
      mode: "milestones";
      milestones: SuggestedMilestone[];
      rationale: string;
      provider?: string;
      model?: string;
    }
  | {
      mode: "plan";
      plan: ProjectPlanData;
      flatSteps: Array<Record<string, unknown>>;
      provider?: string;
      model?: string;
      /** "skeleton": every provider failed, so the confirmed milestones became the plan (one checkpoint step each). */
      fallback?: "skeleton";
      /** Round 1 P2-16: why the skeleton was used. */
      fallbackReason?: SkeletonReason;
      /** Round 1 P0-2: this mission already had a plan with phase 0 spawned (a retry); nothing was asked or written. */
      alreadyPlanned?: boolean;
      /** W8a: tasks created for phase 0 right after the save (undefined when no missionId was given). */
      spawned?: number;
      /** W8a: the phase-0 spawn threw; the plan is saved, the tasks are not. */
      spawnFailed?: string;
    }
  | { mode: "learn"; learning: LearningPath; provider?: string }
  | { mode: "guide"; entry: CoachEntry; provider?: string };

/**
 * Thrown for the engine's expected 4xx cases. `status` mirrors the
 * legacy route's HTTP status so the REST route can rethrow it directly
 * and the tRPC procedure can map it to NOT_FOUND / BAD_REQUEST.
 */
export class PlanProjectError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 404,
  ) {
    super(message);
    this.name = "PlanProjectError";
  }
}

/**
 * Parse a possibly-fenced JSON blob back into an object. Uses the
 * shared extractStructured helper for robustness. Returns `{}` on
 * irrecoverable parse failure.
 */
/** An outage apology parses to {} — an empty plan that would overwrite
 *  Mission.planData. Fail the call instead. */
function assertAiAvailable(result: { provider?: string; content?: string }): void {
  if (isAiSentinel(result)) throw new AiUnavailableError("plan-project: provider sentinel", "provider_unavailable");
}

/** Under the tRPC route's 180 s maxDuration, with room for the brain-context reads. */
const PLAN_WITH_MILESTONES_TIMEOUT_MS = 170_000;

/**
 * W8a (audit A9): every confirmed milestone is a phase, in order, NAMED by the milestone (the ladder and the
 * spawner key phases by name). A phase the model left out is filled from the skeleton (one checkpoint step);
 * extra phases keep their steps, appended to the last milestone, so no step the model wrote is lost.
 */
function alignPhasesToMilestones(plan: ProjectPlanData, milestones: readonly string[], title: string): ProjectPlanData {
  if (milestones.length === 0) return plan;
  const skeleton = skeletonPlan(milestones, title);
  const phases = milestones.map((m, i) => {
    const got = plan.phases[i];
    return got ? { ...got, name: m, milestone: got.milestone || m } : skeleton.phases[i];
  });
  const extra = plan.phases.slice(milestones.length).flatMap((p) => p.steps ?? []);
  if (extra.length > 0) phases[phases.length - 1] = { ...phases[phases.length - 1], steps: [...(phases[phases.length - 1].steps ?? []), ...extra] };
  return { ...plan, phases };
}

/** Why the plan is a skeleton (round 1 P2-16: a budget stop used to read as "the planner did not answer"). */
type SkeletonReason = "no_answer" | "budget";

/** The confirmed milestones as a plan: one phase each, its single step the checkpoint. */
function skeletonPlan(milestones: readonly string[], title: string, reason: SkeletonReason = "no_answer"): ProjectPlanData {
  return normalizeRawPlan(
    {
      summary: `Plan skeleton from your confirmed milestones: ${reason === "budget" ? "today's AI budget is used up" : "the AI planner did not answer in time"}. Each milestone is one checkpoint; add steps as you go.`,
      phases: milestones.map((m) => ({
        name: m,
        milestone: m,
        steps: [{ title: m, nextAction: m, effort: "M30", who: "Nour", isCheckpoint: true }],
      })),
    },
    title,
  );
}

function parseJson(text: string): Record<string, unknown> {
  const result = extractJsonObject<Record<string, unknown>>(text);
  if (result.ok) return result.value;
  log.warn("plan_parse_failed", {
    rawSnippet: result.raw,
    error: result.error,
  });
  return {};
}

async function loadBrainContext(title: string): Promise<{
  memoryContext: string;
  decisionContext: string;
}> {
  let memoryContext = "";
  try {
    const keywords = title
      .toLowerCase()
      .split(/\s+/)
      .filter((w) => w.length > 3)
      .slice(0, 5);
    if (keywords.length > 0) {
      const memories = await prisma.brainMemory.findMany({
        where: {
          OR: keywords.map((k) => ({
            content: { contains: k, mode: "insensitive" as const },
          })),
        },
        orderBy: { confidence: "desc" },
        take: 8,
        select: { content: true, category: true },
      });
      if (memories.length > 0) {
        memoryContext =
          "\n\nNOUR'S BRAIN CONTEXT:\n" +
          memories
            .map((m) => `- [${m.category}] ${m.content.slice(0, 200)}`)
            .join("\n");
      }
    }
  } catch (e) {
    logError("services.ai-plan-project", e, { stage: "recall-memories" }, "warn");
  }

  let decisionContext = "";
  try {
    const firstWord = title.split(" ")[0];
    if (firstWord && firstWord.length > 2) {
      const rd = await prisma.masteryDecision.findMany({
        where: {
          title: { contains: firstWord, mode: "insensitive" },
          deletedAt: null,
        },
        take: 3,
        select: { title: true, chosen: true, reasoning: true },
      });
      if (rd.length > 0) {
        decisionContext =
          "\n\nPAST DECISIONS:\n" +
          rd
            .map(
              (d) =>
                `- ${d.title}: chose "${d.chosen}" (${d.reasoning?.slice(0, 80)})`,
            )
            .join("\n");
      }
    }
  } catch (e) {
    logError("services.ai-plan-project", e, { stage: "recall-decisions" }, "warn");
  }

  return { memoryContext, decisionContext };
}

/**
 * Run the project-intelligence engine. The REST route and the
 * `ai.planProject` procedure both call this. `mode` defaults to "plan".
 */
export async function runPlanProject(
  input: PlanProjectInput,
): Promise<PlanProjectResult> {
  const mode: PlanProjectMode = input.mode ?? "plan";
  const { missionId, answers, description, currentState } = input;
  let title = input.title;

  // For learn + guide modes we need an existing mission.
  let mission: { id: string; title: string; planData: unknown } | null = null;
  if ((mode === "learn" || mode === "guide") && missionId) {
    mission = await prisma.mission.findUnique({
      where: { id: missionId },
      select: { id: true, title: true, planData: true },
    });
    if (!mission) {
      throw new PlanProjectError("Mission not found", 404);
    }
    title = mission.title;
  }
  if (!title) {
    throw new PlanProjectError("title or missionId required", 400);
  }

  const { memoryContext, decisionContext } = await loadBrainContext(title);

  // Strategic Frameworks lens injection (15th surface). Compose
  // lensBlock once from common context and append to every mode.
  let lensBlock = "";
  try {
    const { pickFrameworks, composeStrategicLensBlock } = await import(
      "@/lib/ai/strategic-frameworks"
    );
    const { recordLensFire } = await import(
      "@/lib/ai/strategic-frameworks/record-lens-fire"
    );
    const lensInput =
      `${title} · ${description ?? ""} · ${memoryContext} · ${decisionContext}`.slice(
        0,
        1200,
      );
    lensBlock = composeStrategicLensBlock(lensInput);
    if (lensBlock) {
      const matches = pickFrameworks(lensInput);
      recordLensFire({
        surface: "plan-project",
        matches,
        lensBlockLength: lensBlock.length,
        metadata: { mode },
      });
    }
  } catch {
    // best-effort · lens injection failures shouldn't break the AI call
  }

  // ─── MODE 1: CLARIFY ─────────────────────────────────────────────
  if (mode === "clarify") {
    const prompt = `You are a world-class project strategist advising Nour (business owner, Cleveland OH).

PROJECT: ${title}
${description ? `DETAILS: ${description}` : ""}
${memoryContext}
${decisionContext}

Ask 5-8 STRATEGIC questions that would dramatically change the plan. Think like a $500/hr consultant.

Categories to cover:
1. SCOPE — What exactly does "done" look like? What's in vs out of scope?
2. BUDGET — What's the real budget? Is there a hard ceiling?
3. TIMELINE — Is there a deadline? What's driving the urgency?
4. EXECUTION — DIY vs hire? Who's doing what? Skills available?
5. QUALITY — Good enough vs. premium? What matters most?
6. DEPENDENCIES — What else is affected? Any blockers?
7. PAST EXPERIENCE — Done anything similar before? What went wrong?
8. SUCCESS CRITERIA — How will you know it's truly done and done RIGHT?

For each question, provide 3-4 clickable options that represent common choices.
Also give an "initialThoughts" section with 2-3 sentences of instant insight.
If you see any red flags or common mistakes for this type of project, call them out.

Respond with JSON:
{
  "questions": [
    { "question": "Strategic question", "why": "Why this dramatically changes the plan", "options": ["Option A", "Option B", "Option C", "Option D"], "category": "SCOPE|BUDGET|TIMELINE|EXECUTION|QUALITY" }
  ],
  "initialThoughts": "2-3 sentences of instant strategic insight",
  "redFlags": ["Common mistake 1", "Hidden cost 2"],
  "quickWin": "One thing Nour can do RIGHT NOW while planning"
}`;

    const result = await tracedAiChat(
      {
        label: "plan-project:clarify",
        source: "tool",
        metadata: { missionId },
      },
      [
        {
          role: "system",
          content:
            "You are a $500/hr project strategist. You've managed 1000+ projects across home renovation, business, and personal domains. Return only valid JSON. Be brutally specific and insightful — no generic advice. Every question should be one that, if answered differently, would produce a completely different plan." +
            (lensBlock ? `\n\n${lensBlock}` : ""),
        },
        { role: "user", content: prompt },
      ],
      "deep",
    );
    assertAiAvailable(result);
    return {
      mode: "clarify",
      ...parseJson(result.content),
      provider: result.provider,
    } as PlanProjectResult;
  }

  // ─── MODE: MILESTONES ────────────────────────────────────────────
  if (mode === "milestones") {
    const goalCtx = input.goalTarget
      ? `\nGOAL TARGET: ${input.goalTarget}${input.goalUnit ? " " + input.goalUnit : ""}${input.goalMetric ? ` (${input.goalMetric})` : ""}`
      : "";
    const deadlineCtx = input.goalDeadline
      ? `\nDEADLINE: ${input.goalDeadline}`
      : "";
    const prompt = `You are a strategic planner helping Nour break a goal/project into 3-5 confirmable milestones.

PROJECT/GOAL: ${title}
${description ? `DETAILS: ${description}` : ""}${goalCtx}${deadlineCtx}
${memoryContext}
${decisionContext}

Generate 3-5 MILESTONES that bracket the journey from start to done.

Each milestone should be:
- Concrete and verifiable (not "make progress")
- Spaced to mark real progress (e.g. quartile checkpoints by metric or date)
- A clear "we are here" signal Nour can hit
- Ordered chronologically (earliest first)

Examples of good milestones:
  Goal: "Become a Thought Leader · 50K interactions"
    1. First 1K — establish presence, find voice
    2. 5K — first viral piece, audience forming
    3. 15K — consistent engagement, brand identity clear
    4. 50K — recognized authority, network effect compounding

  Project: "Finish home garage cave by end of summer"
    1. Demolition + cleanout complete
    2. Walls + electrical + insulation done
    3. Floor + ceiling finished
    4. Furniture + outfitting in
    5. First weekend hangout hosted

Respond ONLY with valid JSON:
{
  "milestones": [
    { "label": "Milestone description", "metric": "Optional measurable threshold like '5K interactions' or 'Phase 1 complete'", "estimatedDate": "YYYY-MM-DD or null" }
  ],
  "rationale": "1-2 sentences why these specific milestones"
}`;

    const result = await tracedAiChat(
      {
        label: "plan-project:milestones",
        source: "tool",
        metadata: { missionId },
      },
      [
        {
          role: "system",
          content:
            "You break ambitious goals into a clean ladder of 3-5 verifiable milestones. Spaced for momentum + measurable. Return only valid JSON." +
            (lensBlock ? `\n\n${lensBlock}` : ""),
        },
        { role: "user", content: prompt },
      ],
      "deep",
    );
    assertAiAvailable(result);

    const parsed = parseJson(result.content);
    const rawMilestones = Array.isArray(parsed.milestones)
      ? (parsed.milestones as Array<Record<string, unknown>>)
      : [];
    const milestones = rawMilestones
      .filter((m) => typeof m.label === "string")
      .map((m) => ({
        label: String(m.label).slice(0, 200),
        metric: typeof m.metric === "string" ? m.metric.slice(0, 200) : null,
        estimatedDate:
          typeof m.estimatedDate === "string" ? m.estimatedDate : null,
      }))
      .slice(0, 5);

    return {
      mode: "milestones",
      milestones,
      rationale: typeof parsed.rationale === "string" ? parsed.rationale : "",
      provider: result.provider,
      model: result.model,
    };
  }

  // ─── MODE 2: PLAN ────────────────────────────────────────────────
  if (mode === "plan") {
    const confirmedMilestones = (input.milestones ?? []).map((m) => m.trim()).filter(Boolean);
    // W8a (audit A12): the only caller is Plan it with confirmed milestones. The old 15-30-step
    // "ultimate plan" prompt (costs, tools, risks, a weekend schedule, ~8,000 output tokens) had
    // no caller and never finished on a local model; it is gone. 2026-11-02: with confirmed
    // milestones the ladder is already decided, so the plan is small: 2-4 steps per milestone.
    if (confirmedMilestones.length === 0) {
      throw new PlanProjectError("plan mode needs the confirmed milestones (use mode=milestones first)", 400);
    }
    // Round 1 P0-2: a retried Plan it (the phone timed out while the 170 s server call finished) must not re-ask the
    // model, overwrite the saved plan with steps that carry no task ids, and spawn phase 0 a second time. Read first;
    // the write below is a compare-and-swap on this read's updatedAt.
    const read = missionId
      ? await prisma.mission.findUnique({ where: { id: missionId }, select: { planData: true, updatedAt: true } })
      : null;
    if (missionId && !read) throw new PlanProjectError("Mission not found", 404);
    const alreadyPlanned = (pd: unknown) => isProjectPlanData(pd) && (pd.phases[0]?.steps ?? []).some((st) => st.taskId);
    const existingResult = (pd: ProjectPlanData) => ({
      mode: "plan" as const,
      plan: pd,
      flatSteps: pd.phases.flatMap((ph) => (ph.steps ?? []).map((st) => ({ ...st, phase: ph.name, title: `[${ph.name}] ${st.title}` }))),
      alreadyPlanned: true,
      spawned: 0,
    });
    if (read && alreadyPlanned(read.planData)) return existingResult(read.planData as unknown as ProjectPlanData);
    const compactPrompt = `You are a project planner turning Nour's confirmed milestones into a short, concrete plan.

PROJECT: ${title}
${description ? `DETAILS: ${description}` : ""}
${memoryContext}
${decisionContext}

CONFIRMED MILESTONES (Nour approved these; one phase per milestone, in order, the milestone text as the phase name):
${confirmedMilestones.map((m, i) => `${i + 1}. ${m}`).join("\n")}

REQUIREMENTS:
- EXACTLY ${confirmedMilestones.length} phases, one per confirmed milestone, in order
- 2-4 steps per phase; each step is a PHYSICAL action Nour can start right now
- Time estimates using: M5, M15, M30, H1, H2PLUS
- The last step of each phase is the checkpoint that proves the milestone is done (isCheckpoint: true)
- No costs, tools, schedules or risk sections

Respond ONLY with valid JSON:
{
  "summary": "1-2 sentence summary of the plan",
  "phases": [
    {
      "name": "Milestone text",
      "milestone": "What is true when this phase is done",
      "steps": [
        { "title": "Specific step", "nextAction": "The literal first physical thing to do", "effort": "M30", "who": "Nour", "isCheckpoint": false }
      ]
    }
  ]
}`;

    let plan: ProjectPlanData;
    let fallback: "skeleton" | undefined;
    let fallbackReason: SkeletonReason | undefined;
    let provider: string | undefined;
    let model: string | undefined;
    try {
      const result = await tracedAiChat(
        { label: "plan-project:plan", source: "tool", metadata: { missionId } },
        [
          {
            role: "system",
            content:
              "You are the world's best project planner. Return only valid JSON. Be specific: every step is a physical action Nour can start now." +
              (lensBlock ? `\n\n${lensBlock}` : ""),
          },
          { role: "user", content: compactPrompt },
        ],
        "deep",
        // The tRPC route allows 180 s (app/api/trpc/[trpc]/route.ts maxDuration); the 100 s default is for chat.
        { timeoutMs: PLAN_WITH_MILESTONES_TIMEOUT_MS },
      );
      provider = result.provider;
      model = result.model;
      if (isAiSentinel(result)) {
        // Every provider failed. The milestones are Nour's own reviewed input, so they become the
        // plan: one phase each, one checkpoint step each. A plan with no steps blocks spawnTasks
        // (400) and leaves the goal with a mission that does nothing; this never dead-ends.
        plan = skeletonPlan(confirmedMilestones, title);
        fallback = "skeleton";
      } else {
        plan = normalizeRawPlan(parseJson(result.content), title);
        // A reply that parsed to no phases (prose, broken JSON) is the same dead end as no reply.
        if (plan.phases.length === 0) {
          plan = skeletonPlan(confirmedMilestones, title);
          fallback = "skeleton";
        }
      }
    } catch (err) {
      // W8a (audit A10): a budget stop is the same dead end as an outage for Nour; the skeleton saves his
      // milestones. Any other error is a real failure and still throws.
      if (!(err instanceof Error && err.name === "BudgetExceededError")) throw err;
      log.warn("plan_budget_exceeded_skeleton", { missionId, err: err.message });
      plan = skeletonPlan(confirmedMilestones, title, "budget");
      fallback = "skeleton";
      fallbackReason = "budget";
    }
    plan = alignPhasesToMilestones(plan, confirmedMilestones, title);
    if (answers) plan.strategicAnswers = answers;

    // Flatten phases into steps for backward-compat with callers that
    // expect flatSteps (the tasks page inserts them as DB tasks).
    const flatSteps: Array<Record<string, unknown>> = [];
    for (const phase of plan.phases) {
      for (const step of phase.steps || []) {
        flatSteps.push({
          ...step,
          phase: phase.name,
          title: `[${phase.name}] ${step.title}`,
        });
      }
    }

    // Persist the plan data if a missionId was provided. A failed write used to be a warn
    // and a "success" to the caller, which then spawned from a plan that did not exist.
    // W8a (audit A4): phase 0 spawns HERE, after the save, so a backgrounded PWA cannot skip it and
    // a retry (same mission id) spawns nothing twice (spawnProjectTasks writes task ids into the plan).
    let spawned: number | undefined;
    let spawnFailed: string | undefined;
    if (missionId) {
      const swap = await prisma.mission.updateMany({
        where: { id: missionId, updatedAt: read!.updatedAt },
        data: { planData: JSON.parse(JSON.stringify(plan)) },
      });
      if (swap.count !== 1) {
        // Another Plan it on this mission saved first: return what it saved and spawn nothing (it spawns its own).
        const winner = await prisma.mission.findUnique({ where: { id: missionId }, select: { planData: true } });
        log.warn("plan_swap_lost", { missionId });
        if (winner && isProjectPlanData(winner.planData)) return existingResult(winner.planData);
        throw new PlanProjectError("The project changed while the plan was written; open it and try Plan it again", 400);
      }
      try {
        spawned = (await spawnProjectTasks({ missionId, phaseIndex: 0 })).spawned;
      } catch (err) {
        spawned = 0;
        spawnFailed = err instanceof Error ? err.message.slice(0, 200) : String(err);
        log.warn("plan_phase0_spawn_failed", { missionId, err: spawnFailed });
      }
    }

    return {
      mode: "plan",
      plan,
      flatSteps,
      provider,
      model,
      ...(fallback ? { fallback, fallbackReason: fallbackReason ?? "no_answer" } : {}),
      ...(spawned !== undefined ? { spawned } : {}),
      ...(spawnFailed ? { spawnFailed } : {}),
    };
  }

  // ─── MODE 3: LEARN ───────────────────────────────────────────────
  if (mode === "learn") {
    const existingPlan = isProjectPlanData(mission?.planData)
      ? mission!.planData
      : null;

    const prompt = `Nour is tackling a project: "${title}".

${
  existingPlan
    ? `Existing plan summary: ${existingPlan.summary || "(no summary)"}\nPhases: ${existingPlan.phases.map((p) => p.name).join(" → ")}`
    : "No existing plan yet — treat this as a fresh project."
}
${memoryContext}

Before he starts executing, teach him what he needs to KNOW.

Return ONLY valid JSON in this shape:
{
  "keyConcepts": ["5-8 concepts Nour needs to understand before starting"],
  "prerequisites": ["Skills or knowledge he needs to already have or pick up fast"],
  "mvuRead": "Minimum-viable-understanding write-up. 3-5 paragraphs. Teach Nour the 20% of this domain that handles 80% of the decisions he'll face. Write in second person, plain English, no fluff. Include specific numbers and rules of thumb.",
  "resources": [
    { "title": "Resource name", "url": "optional https://...", "note": "why this is worth 15 minutes" }
  ],
  "practiceExercises": ["Dry-run tasks Nour can do to rehearse before committing real money or time"]
}`;

    const result = await tracedAiChat(
      { label: "plan-project:learn", source: "tool", metadata: { missionId } },
      [
        {
          role: "system",
          content:
            "You are a world-class teacher who specializes in adult learning for busy operators. You cut straight to what they need to know and nothing more. Return only valid JSON. Write at a practical operator level — Nour runs a real business and doesn't have time for theory." +
            (lensBlock ? `\n\n${lensBlock}` : ""),
        },
        { role: "user", content: prompt },
      ],
      "deep",
    );
    assertAiAvailable(result);

    const learning = parseJson(result.content) as unknown as LearningPath;

    // Merge into existing planData (or create a minimal plan wrapper).
    if (mission) {
      const next: ProjectPlanData = existingPlan
        ? { ...existingPlan, updatedAt: new Date().toISOString(), learning }
        : {
            v: 1,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            title,
            phases: [],
            learning,
          };
      await prisma.mission
        .update({
          where: { id: mission.id },
          data: { planData: JSON.parse(JSON.stringify(next)) },
        })
        .catch((err) =>
          log.warn("persist_learning_failed", {
            err: err instanceof Error ? err.message : String(err),
          }),
        );
    }

    return { mode: "learn", learning, provider: result.provider };
  }

  // ─── MODE 4: GUIDE (coach) ───────────────────────────────────────
  if (mode === "guide") {
    if (!mission) {
      throw new PlanProjectError("missionId required for guide mode", 400);
    }
    const existingPlan = isProjectPlanData(mission.planData)
      ? mission.planData
      : null;

    // Load the mission's tasks so the coach has real progress data.
    const tasks = await prisma.task.findMany({
      where: { missionId: mission.id, deletedAt: null },
      orderBy: { createdAt: "asc" },
      select: { title: true, status: true, nextPhysicalAction: true },
    });
    const doneCount = tasks.filter((t) => t.status === "DONE").length;
    const doingTask = tasks.find((t) => t.status === "DOING");
    const nextReady = tasks.find(
      (t) => t.status === "INBOX" || t.status === "READY",
    );

    const prompt = `Nour is mid-execution on a project called "${title}".

${existingPlan?.summary ? `Plan summary: ${existingPlan.summary}` : ""}
${existingPlan?.phases?.length ? `Phases: ${existingPlan.phases.map((p) => p.name).join(" → ")}` : ""}
${existingPlan?.keyRisks?.length ? `Known risks: ${existingPlan.keyRisks.map((r) => r.risk).join("; ")}` : ""}

Progress so far:
- ${doneCount}/${tasks.length} tasks complete
- Currently doing: ${doingTask?.title || "(nothing)"}
- Next ready task: ${nextReady?.title || "(none queued)"}

${currentState ? `Nour's self-reported current state: ${currentState}` : ""}

${memoryContext}

Coach him. Return ONLY valid JSON:
{
  "read": "One sentence — what's actually going on with this project right now. Cold, specific, no fluff.",
  "nextAction": "The ONE next physical thing Nour should do. 5-minute version if possible.",
  "blocker": "The most likely thing standing in his way right now, or null if nothing obvious",
  "risks": ["Active risks to call out — things to watch in the next 48h"]
}`;

    const result = await tracedAiChat(
      { label: "plan-project:guide", source: "tool", metadata: { missionId } },
      [
        {
          role: "system",
          content:
            "You are Nour's project coach. You've read his full plan, his progress, and his brain. You give cold, specific advice — no pep talks, no fluff. One read, one action, blockers, risks. Return only valid JSON." +
            (lensBlock ? `\n\n${lensBlock}` : ""),
        },
        { role: "user", content: prompt },
      ],
      "deep",
    );
    assertAiAvailable(result);

    const raw = parseJson(result.content);
    const entry: CoachEntry = {
      at: new Date().toISOString(),
      read: typeof raw.read === "string" ? raw.read : "",
      nextAction: typeof raw.nextAction === "string" ? raw.nextAction : "",
      blocker: typeof raw.blocker === "string" ? raw.blocker : null,
      risks: Array.isArray(raw.risks) ? (raw.risks as string[]) : [],
    };

    // Persist coach entry to planData.coachLog.
    if (existingPlan) {
      const nextPlan: ProjectPlanData = {
        ...existingPlan,
        updatedAt: new Date().toISOString(),
        coachLog: [...(existingPlan.coachLog || []), entry].slice(-20),
      };
      await prisma.mission
        .update({
          where: { id: mission.id },
          data: { planData: JSON.parse(JSON.stringify(nextPlan)) },
        })
        .catch((err) =>
          log.warn("persist_coach_entry_failed", {
            err: err instanceof Error ? err.message : String(err),
          }),
        );
    }

    return { mode: "guide", entry, provider: result.provider };
  }

  throw new PlanProjectError("Unknown mode", 400);
}
