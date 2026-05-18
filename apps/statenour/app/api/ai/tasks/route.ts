/**
 * POST /api/ai/tasks · v10.0.226 · Nick generates 3-5 daily tasks
 *
 * Pre-226 this route was the last AI endpoint not on the modern
 * pattern · used raw `generateText`, no rate-limiting, no Zod, and
 * a regex-fallback that silently returned `[]` when JSON parsing
 * failed. Modernization brings it in line with the other 5 routes:
 *
 *   · tracedAiChat · gets per-provider failure capture (v10.0.212)
 *     so /system/agent-traces can show why a tier fell through
 *   · safeParseBody + Zod input schema
 *   · checkAiRateLimit · prevents accidental loops + abuse
 *   · extractJsonArray + Zod output schema · catches AI returning
 *     the wrong shape, surfaces parse failures to /system/errors
 *   · taskType: "extract" · structured-extraction profile (low temp,
 *     reasoning_effort: "low") instead of "fast" which was generic
 *   · Returns { tasks, parseVia } so the caller can see whether the
 *     output came from a clean parse, an extraction, or a repair
 */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { tracedAiChat } from "@/lib/ai/traced-aichat";
import { extractJsonArray } from "@/lib/ai/extract-structured";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth-guard";
import { logger as rootLogger } from "@/lib/logger";
import { safeParseBody } from "@/lib/utils/http";
import { checkAiRateLimit } from "@/lib/rate-limit";
import { sanitizeError } from "@/lib/utils/sanitize-error";
import { BRAIN_CATEGORIES } from "@/lib/brain/categories";

const log = rootLogger.withSurface("api/ai/tasks");

export const maxDuration = 60;

const inputSchema = z.object({
  action: z.enum(["generate"]).default("generate"),
  /** Existing task titles the client knows about, so the AI doesn't
   *  duplicate. Capped at 200 to keep prompts reasonable. */
  existingTasks: z.array(z.string().min(1).max(500)).max(200).optional(),
});

const taskShape = z.object({
  title: z.string().min(1).max(500),
  missionId: z.string().nullable().optional(),
  priority: z.enum(["critical", "high", "medium", "low"]),
  nextAction: z.string().min(1).max(500),
  reasoning: z.string().max(800).optional().default(""),
});

type AiTaskOut = z.infer<typeof taskShape>;

export async function POST(req: NextRequest) {
  await requireSession(req);

  // Rate-limit the same way the other AI routes do · returns a 429
  // Response when over budget, null when allowed.
  const rateLimited = checkAiRateLimit(req);
  if (rateLimited) return rateLimited;

  const parsed = await safeParseBody(inputSchema, req, "api/ai/tasks");
  if (!parsed.ok) return parsed.response;
  const { existingTasks = [] } = parsed.data;

  // ── Brain context for grounded suggestions ──────────────────────
  // Same data sources as before · we don't want a regression on
  // suggestion quality. Just the call mechanics get upgraded.
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
      orderBy: [{ autoPriority: "asc" }, { createdAt: "desc" }],
      take: 30,
      select: { title: true, autoPriority: true, autoPriorityExplanation: true },
    }),
    prisma.brainMemory
      .findUnique({
        where: { category_key: { category: BRAIN_CATEGORIES.IDENTITY_SNAPSHOT, key: "current" } },
        select: { content: true },
      })
      .catch(() => null),
    prisma.driftAlert.findMany({ where: { resolved: false } }),
  ]);

  const loops = loopRows.map((t) => ({
    priority:
      (t.autoPriority ?? 50) < 20 ? "critical"
      : (t.autoPriority ?? 50) < 40 ? "high"
      : (t.autoPriority ?? 50) < 60 ? "medium"
      : "low",
    title: t.title,
    description: t.autoPriorityExplanation,
  }));

  // Collect ALL existing tasks (DB + client) so AI never duplicates.
  const dbTasks = missions.flatMap((m) => m.tasks.map((t) => t.title));
  const allExisting = [...new Set([...dbTasks, ...existingTasks])];

  // 8-axis self-model summary · tucked behind a try so a malformed
  // identity snapshot can't take down the whole route.
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

  // v10.0.252 · Strategic Frameworks lens injection (6th surface).
  // Mission + commitment text often carries strong business intent
  // ("grow revenue", "hire technician", "launch new service") · the
  // lens injection shapes the kind of tasks Nick generates · ooda-loop
  // → tighten decision-cycle tasks · pareto → focus on top-20% · etc.
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

  // ── AI call · structured-extraction profile ─────────────────────
  // taskType "extract" maps in provider.ts to reasoning_effort: low
  // + temperature 0.1 + disable_thinking on Venice. The output is a
  // strict JSON array, so we want determinism over creativity.
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

  // ── Graceful degradation if every provider failed ───────────────
  if (result.provider === "none" || result.provider === "emergency") {
    log.error("all_providers_failed", {
      tried: result.failures?.map((f) => `${f.provider}/${f.failureClass}`).join(", "),
    });
    return NextResponse.json(
      {
        error: "all AI providers failed",
        providerFailures: result.failures ?? [],
        tasks: [],
      },
      { status: 503 },
    );
  }

  // ── Parse + validate ────────────────────────────────────────────
  const parsedJson = extractJsonArray<unknown>(result.content);
  if (!parsedJson.ok) {
    log.warn("ai_parse_failed", {
      provider: result.provider,
      model: result.model,
      raw: parsedJson.raw,
    });
    return NextResponse.json(
      {
        error: "could not parse AI output",
        rawSnippet: parsedJson.raw,
        provider: result.provider,
        tasks: [],
      },
      { status: 502 },
    );
  }

  // Validate each task against the Zod shape · drop invalid rows
  // rather than failing the whole response. Surfaces a count of
  // dropped rows so the client can show a partial-success message.
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

  return NextResponse.json({
    tasks,
    parseVia: parsedJson.via,
    droppedInvalid: dropped,
    provider: result.provider,
    model: result.model,
  });
}
