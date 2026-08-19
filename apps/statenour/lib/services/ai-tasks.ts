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

const subtaskShape = z.object({
  title: z.string().min(1).max(500),
  nextAction: z.string().min(1).max(500),
  effort: z.enum(["M5", "M15", "M30", "H1", "H2PLUS"]).default("M30"),
  context: z.enum(["DESK", "PHONE", "SHOP", "CAR", "HOME", "ANYWHERE"]).default("ANYWHERE"),
});

export type AiSubtaskOut = z.infer<typeof subtaskShape>;

export async function decomposeTaskWithAi(taskId: string): Promise<{ ok: boolean; subtasksCount: number }> {
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

Return ONLY a JSON array, no commentary:
[{"title":"...","nextAction":"...","effort":"M30","context":"DESK"}]`,
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

  // Create subtasks in the database
  const created = [];
  for (let i = 0; i < subtasks.length; i++) {
    const st = subtasks[i];
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
        energyRequired: "MEDIUM",
        finishCondition: "",
      },
    });
    created.push(sub);
  }

  return { ok: true, subtasksCount: created.length };
}
