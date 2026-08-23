/**
 * AI task generation service · Phase SS.3 (2026-05-19 AM).
 *
 * Lifted from `app/api/ai/tasks/route.ts` so both the legacy REST
 * endpoint AND the new `trpc.task.aiGenerate` mutation call the
 * same function · drift between consumers structurally impossible.
 *
 * Composition:
 *   1. Hydrate brain context (missions · commitments · open loops ·
 *      identity snapshot · drift alerts) for grounded suggestions
 *   2. Inject Strategic Frameworks lens block when business-intent
 *      signal exists in the input
 *   3. Call tracedAiChat with the "extract" profile (low temp ·
 *      reasoning_effort: low) for deterministic JSON output
 *   4. Parse + validate per-task with Zod · drop invalid rows ·
 *      report droppedInvalid count so the client can surface partial-
 *      success
 *
 * Return shape · discriminated union so both transports can map to
 * their native error envelopes (HTTP status / TRPCError code) without
 * losing the structured-failure metadata.
 *
 * Rate-limiting · the REST route checks via `checkAiRateLimit(req)`
 * BEFORE calling this service · the tRPC procedure relies on
 * owner-only auth + low real abuse risk (single operator) for now ·
 * documented inline.
 */

import { z } from "zod";
import { tracedAiChat } from "@/lib/ai/traced-aichat";
import { extractJsonArray } from "@/lib/ai/extract-structured";
import { prisma } from "@/lib/prisma";
import { logger as rootLogger } from "@/lib/logger";
import { sanitizeError } from "@/lib/utils/sanitize-error";
import { BRAIN_CATEGORIES } from "@/lib/brain/categories";
import { priorityBandLabel } from "@/lib/scoring/task-priority";

const log = rootLogger.withSurface("services/ai-tasks");

const taskShape = z.object({
  title: z.string().min(1).max(500),
  missionId: z.string().nullable().optional(),
  priority: z.enum(["critical", "high", "medium", "low"]),
  nextAction: z.string().min(1).max(500),
  reasoning: z.string().max(800).optional().default(""),
});

export type AiTaskOut = z.infer<typeof taskShape>;

export type GenerateAiTasksResult =
  | {
      ok: true;
      tasks: AiTaskOut[];
      parseVia: string;
      droppedInvalid: number;
      provider: string;
      model: string;
    }
  | {
      ok: false;
      kind: "parse_failed";
      rawSnippet: string;
      provider: string;
      model: string;
    }
  | {
      ok: false;
      kind: "providers_failed";
      failures: Array<{ provider: string; failureClass?: string }>;
    };

export async function generateAiTasks(args: {
  existingTasks?: string[];
}): Promise<GenerateAiTasksResult> {
  const existingTasks = args.existingTasks ?? [];

  // Brain context for grounded suggestions
  const [missions, commitments, loopRows, identitySnap, alerts] = await Promise.all([
    prisma.mission.findMany({
      where: { status: "ACTIVE", deletedAt: null },
      include: {
        tasks: {
          where: { status: { in: ["INBOX", "READY", "DOING"] }, deletedAt: null },
        },
      },
    }),
    prisma.commitment.findMany({
      where: { status: { in: ["active", "in_progress"] }, deletedAt: null },
    }),
    prisma.task.findMany({
      where: { status: { in: ["INBOX", "READY"] }, deletedAt: null },
      orderBy: [{ autoPriority: { sort: "desc", nulls: "last" } }, { createdAt: "desc" }],
      take: 30,
      select: { title: true, autoPriority: true, autoPriorityExplanation: true },
    }),
    prisma.brainMemory
      .findUnique({
        where: {
          category_key: {
            category: BRAIN_CATEGORIES.IDENTITY_SNAPSHOT,
            key: "current",
          },
        },
        select: { content: true },
      })
      .catch(() => null),
    prisma.brainMemory
      .findMany({
        where: {
          category: "coach_event",
          key: { startsWith: "coach:drift-recovery:" },
        },
        orderBy: { createdAt: "desc" },
        take: 20,
        select: { content: true, metadata: true },
      })
      .then((rows) => {
        const unresolved = rows.filter((r) => {
          const meta = (r.metadata ?? {}) as Record<string, any>;
          return !meta.ackedAt;
        });
        return unresolved.map((r) => {
          const meta = (r.metadata ?? {}) as Record<string, any>;
          const severity = meta.priority === "P0" ? "critical" : meta.priority === "P1" ? "high" : "warning";
          return {
            severity,
            ruleName: r.content,
            message: typeof meta.body === "string" ? meta.body : "",
          };
        });
      })
      .catch((): never[] => []),
  ]);

  const loops = loopRows.map((t) => ({
    priority: priorityBandLabel(t.autoPriority),
    title: t.title,
    description: t.autoPriorityExplanation,
  }));

  const dbTasks = missions.flatMap((m) => m.tasks.map((t) => t.title));
  const allExisting = [...new Set([...dbTasks, ...existingTasks])];

  let maturitySummary = "not yet computed";
  if (identitySnap?.content) {
    try {
      const snap = JSON.parse(identitySnap.content) as {
        axes: Record<string, { value: number; manual: number | null; direction: string }>;
      };
      const axes = Object.entries(snap.axes ?? {});
      if (axes.length > 0) {
        const avg = Math.round(
          axes.reduce((s, [, a]) => s + (a.manual ?? a.value), 0) / axes.length,
        );
        const weakest = [...axes].sort(
          ([, a], [, b]) => (a.manual ?? a.value) - (b.manual ?? b.value),
        )[0];
        maturitySummary = `overall ${avg}/100 · weakest axis: ${weakest[0]} at ${
          weakest[1].manual ?? weakest[1].value
        }`;
      }
    } catch {
      /* fallback already set */
    }
  }

  // Strategic Frameworks lens injection
  let lensBlock = "";
  try {
    const { pickFrameworks, composeStrategicLensBlock } = await import(
      "@/lib/ai/strategic-frameworks"
    );
    const { recordLensFire } = await import(
      "@/lib/ai/strategic-frameworks/record-lens-fire"
    );
    const lensInput = [
      ...missions.map((m) => `${m.title} ${m.successMetric ?? ""}`),
      ...commitments.map((c) => c.description),
      ...loops.slice(0, 5).map((l) => l.title),
    ]
      .join(" · ")
      .slice(0, 1200);
    lensBlock = composeStrategicLensBlock(lensInput);
    if (lensBlock) {
      const matches = pickFrameworks(lensInput);
      recordLensFire({
        surface: "ai-tasks",
        matches,
        lensBlockLength: lensBlock.length,
      });
    }
  } catch (err) {
    log.warn("strategic_lens_failed", {
      surface: "ai-tasks",
      error: sanitizeError(err),
    });
  }

  // AI call · structured-extraction profile
  const result = await tracedAiChat(
    { label: "ai-tasks-generate", source: "tool" },
    [
      {
        role: "system",
        content:
          "You are Nick, an AI task planner inside NOUR OS. Generate prioritized daily tasks based on the data provided. Always return ONLY a valid JSON array — no markdown, no commentary. Be tactical and specific. NEVER suggest tasks that already exist — they are listed below." +
          (lensBlock ? `\n\n${lensBlock}` : ""),
      },
      {
        role: "user",
        content: `Based on Nour's current state, generate a prioritized daily task list. Return ONLY a JSON array.

## EXISTING TASKS (DO NOT REPEAT OR REPHRASE THESE)
${allExisting.length > 0 ? allExisting.map((t) => `- ${t}`).join("\n") : "None yet"}

## Active Missions
${missions.map((m) => `- ${m.title} (${m.domain}, priority ${m.priority}) — ${m.successMetric ?? "no metric"} — ${m.tasks.length} existing tasks`).join("\n") || "None"}

## Active Commitments (${commitments.length})
${commitments.map((c) => `- ${c.description}${c.deadline ? ` (due: ${c.deadline})` : ""}`).join("\n") || "None"}

## Open Loops (${loops.length})
${loops.map((l) => `- [${l.priority}] ${l.title}${l.description ? `: ${l.description}` : ""}`).join("\n") || "None"}

## Brain Maturity (live 8-axis self-model)
${maturitySummary}

## Active Drift Alerts
${alerts.map((a) => `[${a.severity}] ${a.ruleName}: ${a.message}`).join("\n") || "None"}

Generate 3-5 NEW specific, actionable tasks for today that are NOT already in the existing tasks list above.
- Have a clear title (what to do) — must be DIFFERENT from existing tasks
- Link to a mission if relevant (use the mission ID; otherwise null)
- Have a priority: critical (must do today), high (should do), medium (good to do), low (if time allows)
- Have a specific next physical action (the literal first step)
- Have reasoning (why this task matters today)

Order by priority. Focus on revenue-generating and commitment-keeping tasks first.
The CRM is called Auto Labor Guide at nickstire.org/admin — always reference it by name.

Return ONLY a JSON array, no commentary:
[{"title":"...","missionId":null,"priority":"high","nextAction":"...","reasoning":"..."}]`,
      },
    ],
    "extract",
  );

  // Graceful degradation if every provider failed
  if (result.provider === "none" || result.provider === "emergency") {
    log.error("all_providers_failed", {
      tried: result.failures?.map((f) => `${f.provider}/${f.failureClass}`).join(", "),
    });
    return {
      ok: false,
      kind: "providers_failed",
      failures: result.failures ?? [],
    };
  }

  // Parse + validate
  const parsedJson = extractJsonArray<unknown>(result.content);
  if (!parsedJson.ok) {
    log.warn("ai_parse_failed", {
      provider: result.provider,
      model: result.model,
      raw: parsedJson.raw,
    });
    return {
      ok: false,
      kind: "parse_failed",
      rawSnippet: parsedJson.raw,
      provider: result.provider,
      model: result.model,
    };
  }

  const tasks: AiTaskOut[] = [];
  let dropped = 0;
  for (const raw of parsedJson.value) {
    const v = taskShape.safeParse(raw);
    if (v.success) tasks.push(v.data);
    else dropped++;
  }

  if (dropped > 0) {
    log.info("ai_tasks_partial", {
      kept: tasks.length,
      dropped,
      provider: result.provider,
      via: parsedJson.via,
    });
  }

  return {
    ok: true,
    tasks,
    parseVia: parsedJson.via,
    droppedInvalid: dropped,
    provider: result.provider,
    model: result.model,
  };
}

// The contract the prompt cannot enforce on its own.
import { filterGeneratedSubtasks } from "@/lib/services/subtask-validator";

const subtaskShape = z.object({
  title: z.string().min(1).max(500),
  nextAction: z.string().min(1).max(500),
  effort: z.enum(["M5", "M15", "M30", "H1", "H2PLUS"]).default("M30"),
  context: z.enum(["DESK", "PHONE", "SHOP", "CAR", "HOME", "ANYWHERE"]).default("ANYWHERE"),
  // 2026-08-23 · energyRequired used to be HARDCODED "MEDIUM" at the insert and
  // never asked for here, so every AI-GENERATED subtask carried the same tag:
  // 12 of 12 MEDIUM, 0.00 bits. That is not a miscalibrated estimate, it is a
  // placeholder rendered as if it were a measurement. Now the model states it, so
  // the value is a claim that can be right or wrong instead of a constant.
  //
  // WITH ITS DENOMINATOR, because the figure above is computed inside a filtered
  // population and is worthless without one: across ALL tasks the column is
  // MEDIUM 82.7% / LOW 11.8% / HIGH 5.5%, about 0.82 bits. The COLUMN is alive
  // and genuinely varies — it was only the generator's rows that were constant.
  // Reading 0.00 bits as a fact about energyRequired would be the same error as
  // the 2026-08-08 call-failure call, where "72% of failed calls are short" was
  // quoted at an 18% base rate and aimed a week at working code.
  energy: z.enum(["LOW", "MEDIUM", "HIGH"]).default("MEDIUM"),
});

export type AiSubtaskOut = z.infer<typeof subtaskShape>;

/**
 * Decompose a task into subtasks.
 *
 * `{ ok: true, subtasksCount: 0 }` is returned on two DIFFERENT paths and
 * callers must distinguish them: the model legitimately planning nothing, and
 * the next-action gate refusing what it produced. `suppressed` marks the
 * second. Callers that act on success — flipping status, posting a coach event,
 * rendering "Successfully created N subtasks" — must check subtasksCount, not
 * ok alone.
 */
export async function decomposeTaskWithAi(taskId: string): Promise<{
  ok: boolean;
  subtasksCount: number;
  suppressed?: boolean;
  suppressedReason?: "none" | "too_few_actions" | "alternatives_not_steps";
}> {
  const task = await prisma.task.findUnique({
    where: { id: taskId },
    include: { mission: true },
  });
  if (!task) throw new Error("Task not found");

  const result = await tracedAiChat(
    { label: "task-decompose", source: "tool" },
    [
      {
        role: "system",
        content:
          "You are Nick, an AI task planner inside NOUR OS. Decompose the given parent task into smaller, highly actionable, specific physical steps (subtasks). Always return ONLY a valid JSON array — no markdown, no commentary. Be tactical and specific.",
      },
      {
        role: "user",
        content: `Parent Task: "${task.title}"
Estimated parent effort: ${task.effort || "not specified"}
Next physical action: ${task.nextPhysicalAction || "not specified"}
Context: ${task.context || "ANYWHERE"}
Mission: ${task.mission?.title || "none"}

Generate a list of 3-6 smaller subtasks that break this down.
Each subtask must have:
- title: clear, specific action (e.g., "Draft outline of section 1" instead of "Start document")
- nextAction: the immediate physical first step
- effort: M5, M15, M30, H1, or H2PLUS (estimate of time)
- context: DESK, PHONE, SHOP, CAR, HOME, or ANYWHERE
- energy: LOW, MEDIUM, or HIGH (mental energy the step demands, NOT its duration —
  a 5-minute phone call you are dreading is HIGH; 30 minutes of filing is LOW)

Every title must be a NEXT PHYSICAL ACTION — something you could watch someone do.
Do NOT emit steps that begin with Decide, Determine, Consider, Review, Evaluate,
Assess, or Figure out: those are decisions, and a decision restated as a subtask
leaves the original loop open. Do NOT emit steps about updating this tracker.
If the parent genuinely needs a DECISION before any physical action exists, return
an empty array [] rather than inventing steps.

Subtasks are CONJUNCTIVE: the operator will see a checklist and is expected to do
ALL of them. Never emit alternatives as siblings. "Close it", "Delegate it" and
"Schedule it" are three ways of resolving the same item, not three steps — offering
them together asks for three contradictory things at once. If the honest answer is
a choice between dispositions, return [] and let the operator choose.

Return ONLY a JSON array, no commentary:
[{"title":"...","nextAction":"...","effort":"M30","context":"DESK","energy":"MEDIUM"}]`,
      },
    ],
    "extract",
  );

  // Fail LOUDLY on error-shaped zero results — resolving `{ok:false,
  // subtasksCount:0}` let callers toast "Successfully created 0
  // subtasks!" on provider-down/unparseable output. A legitimately
  // empty plan (model returns `[]`) stays a success with 0.
  if (result.provider === "none" || result.provider === "emergency") {
    throw new Error("AI provider unavailable — no subtasks were created");
  }

  const parsedJson = extractJsonArray<unknown>(result.content);
  if (!parsedJson.ok) {
    throw new Error("AI returned unparseable output — no subtasks were created");
  }

  const subtasks: AiSubtaskOut[] = [];
  for (const raw of parsedJson.value) {
    const v = subtaskShape.safeParse(raw);
    if (v.success) subtasks.push(v.data);
  }

  if (subtasks.length === 0) {
    if (parsedJson.value.length > 0) {
      throw new Error("AI returned no valid subtasks — nothing was created");
    }
    // Model legitimately planned zero subtasks — success, nothing to do.
    return { ok: true, subtasksCount: 0 };
  }

  // THE GATE. A prompt is a request; this is the contract. The prompt above already
  // asked for "specific physical steps" and the live artefact that prompted this was
  // still "Decide on action for the open loop" — the original problem restated as a
  // child of itself, shipped as one of five children with a progress bar over them.
  //
  // Fewer, better, or nothing: if what survives validation is not a decomposition,
  // create NOTHING and let the operator decide. Five wrong checkboxes are worse than
  // zero — they bury the actual decision under busywork and render a bar that cannot
  // legitimately reach 100%. Two batch outcomes are possible: too few real actions
  // survived, or the survivors were mutually exclusive dispositions (a menu of exits
  // rather than a plan). Both create nothing; they are logged distinctly.
  const gate = filterGeneratedSubtasks(subtasks);
  for (const r of gate.rejected) {
    log.warn("subtask_rejected_not_a_next_action", { taskId, title: r.title, reason: r.reason });
  }
  // Distinct event: these PASSED the next-action check and were dropped because
  // of the company they kept. Logging them under the rejection event would
  // record the opposite of what was found.
  for (const d of gate.droppedByBatchRule) {
    log.warn("subtask_dropped_alternative_not_step", { taskId, title: d.title, reason: d.reason });
  }
  if (gate.suppressed) {
    log.warn("subtask_generation_suppressed", {
      taskId,
      generated: subtasks.length,
      rejected: gate.rejected.length,
      droppedAsAlternatives: gate.droppedByBatchRule.length,
      reason: gate.suppressedReason,
      note:
        gate.suppressedReason === "alternatives_not_steps"
          ? "the batch was a menu of mutually exclusive dispositions, not a plan; the choice is the operator's"
          : "too few real next actions survived; created none rather than shipping decisions as checkboxes",
    });
    return {
      ok: true,
      subtasksCount: 0,
      // The caller MUST be able to tell "the gate refused" from "the model
      // planned nothing" — they are the same shape otherwise, and
      // autonomic-orchestrator.ts:453 flips the parent to WAITING and posts a
      // P1 "Task Healed" on ok:true alone. A stalled task with zero children
      // then stops matching the healer's own selector (status: DOING) and is
      // parked forever, announced as fixed.
      suppressed: true as const,
      suppressedReason: gate.suppressedReason,
    };
  }

  // Create subtasks in the database
  const created = [];
  for (let i = 0; i < gate.kept.length; i++) {
    const st = gate.kept[i];
    const sub = await prisma.task.create({
      data: {
        title: st.title,
        missionId: task.missionId,
        parentTaskId: task.id,
        nextPhysicalAction: st.nextAction,
        effort: st.effort,
        context: st.context,
        status: "READY",
        roiScore: Math.max(10, (task.roiScore ?? 50) - 5 - i * 5),
        frictionScore: 30,
        energyRequired: st.energy,
        finishCondition: "",
      },
    });
    created.push(sub);
  }

  return { ok: true, subtasksCount: created.length };
}
