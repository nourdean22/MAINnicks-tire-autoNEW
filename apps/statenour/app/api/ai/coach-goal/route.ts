/**
 * POST /api/ai/coach-goal
 *
 * Goal-level coach. Given a LifeGoal id, Nick pulls the goal's
 * current state + all linked Tasks + recent progress data and
 * returns a one-line read, one next action, current blocker, and
 * risks. Appends the response to LifeGoal.coachLog so the goal's
 * coaching history is visible in Plan mode.
 *
 * Think of this as /api/ai/plan-project mode=guide but at the
 * goal level — one rung higher in the lineage.
 *
 * Body: { goalId: string, currentState?: string }
 */
import { NextRequest, NextResponse } from "next/server";
import { tracedAiChat } from "@/lib/ai/traced-aichat";
// v10.0.529.37 · Arc B F7 expansion · operator-style mimicry on
// coach-goal · the JSON's prose fields (feedback · suggestions) get
// styled to match the operator's preferences. The "Return only valid
// JSON" rule stays authoritative · the addendum only biases prose
// values within the schema.
import { applyOperatorStyle } from "@/lib/ai/style-adapter";
import { prisma } from "@/lib/prisma";
import { logger as rootLogger } from "@/lib/logger";

const log = rootLogger.withSurface("api/ai/coach-goal");
import { z } from "zod";
import { safeParseBody, aiRouteError } from "@/lib/utils/http";

import { requireSession } from "@/lib/auth-guard";
import { sanitizeError } from "@/lib/utils/sanitize-error";
import { checkAiRateLimit } from "@/lib/rate-limit";
export const maxDuration = 120;

const schema = z.object({
  goalId: z.string().min(1),
  currentState: z.string().max(2000).optional(),
});

interface CoachEntry {
  at: string;
  read: string;
  nextAction: string;
  blocker: string | null;
  risks: string[];
  progressPct: number;
}

export async function POST(req: NextRequest) {
  await requireSession(req);
  const __aiLimit = checkAiRateLimit(req);
  if (__aiLimit) return __aiLimit; // v9.1.19 · cost-bomb guard
  try {
    // v8.0.1 — safeParse so bad input lands as 400 (not 500 + alert).
    const parsed_in = await safeParseBody(schema, req, "coach-goal");
    if (!parsed_in.ok) return parsed_in.response;
    const { goalId, currentState } = parsed_in.data;

    const goal = await prisma.lifeGoal.findUnique({ where: { id: goalId } });
    if (!goal) {
      return NextResponse.json({ error: "Goal not found" }, { status: 404 });
    }

    // Pull linked tasks to see actual progress
    const linkedTasks = await prisma.task.findMany({
      where: { goalId, deletedAt: null },
      select: {
        title: true,
        status: true,
        loopKind: true,
        lastCompletedAt: true,
        streakCount: true,
        dueDate: true,
        actualMinutes: true,
      },
    });

    const done = linkedTasks.filter((t) => t.status === "DONE").length;
    const activeCount = linkedTasks.filter((t) =>
      ["INBOX", "READY", "DOING"].includes(t.status)
    ).length;
    const progressPct =
      linkedTasks.length > 0 ? Math.round((done / linkedTasks.length) * 100) : 0;
    const totalMinutes = linkedTasks.reduce((s, t) => s + (t.actualMinutes || 0), 0);

    // Brain memory context — pull the first meaningful keyword
    // (longer than 3 chars) or the first word regardless. Don't
    // fall back to the full title, which would trigger a broad LIKE
    // match that returns nothing useful.
    const keywords = goal.title.toLowerCase().split(/\s+/).filter((w) => w.length > 3);
    const searchTerm = keywords[0] || goal.title.split(/\s+/)[0] || goal.title;
    const memories = await prisma.brainMemory
      .findMany({
        where: {
          content: { contains: searchTerm, mode: "insensitive" as const },
        },
        orderBy: { confidence: "desc" },
        take: 5,
        select: { category: true, content: true },
      })
      .catch(() => []);

    const memoryBlock = memories.length
      ? "\n\nBRAIN MEMORIES:\n" +
        memories.map((m) => `- [${m.category}] ${m.content.slice(0, 180)}`).join("\n")
      : "";

    const linkedBlock = linkedTasks.length
      ? "\n\nLINKED LOOPS (" +
        linkedTasks.length +
        "):\n" +
        linkedTasks
          .slice(0, 15)
          .map(
            (t) =>
              `- [${t.status}] ${t.title}${
                t.streakCount ? ` 🔥${t.streakCount}` : ""
              }`
          )
          .join("\n")
      : "\n\nNo loops linked to this goal yet.";

    const prompt = `Nour's goal: "${goal.title}" (${goal.domain}, ${goal.horizon || "no horizon"})
${goal.why ? `Why: ${goal.why}` : ""}
${
  goal.targetValue
    ? `Target: ${goal.currentValue}/${goal.targetValue} ${goal.unit} (${progressPct}% done via ${done}/${linkedTasks.length} tasks, ${activeCount} still open, ${totalMinutes}m invested)`
    : `Progress: ${done} tasks done, ${activeCount} still open, ${totalMinutes}m invested`
}

${linkedBlock}
${memoryBlock}

${currentState ? `Nour's current state: ${currentState}` : ""}

You're coaching Nour on this goal. Cold, specific, no fluff. Return ONLY valid JSON:
{
  "read": "One sentence — what's actually going on with this goal right now",
  "nextAction": "The ONE next physical move — 5-min version if possible",
  "blocker": "Most likely thing standing in the way, or null",
  "risks": ["Active risks to watch in the next 7 days"]
}`;

    // v10.0.250 · Strategic Frameworks lens injection (3rd surface ·
    // mirrors chat + assist). Goal coaching benefits from framework
    // reasoning · pricing-power on revenue goals, OODA on speed goals,
    // power-law on prioritization, etc.
    let lensBlock = "";
    try {
      const { pickFrameworks, composeStrategicLensBlock } = await import(
        "@/lib/ai/strategic-frameworks"
      );
      const { recordLensFire } = await import(
        "@/lib/ai/strategic-frameworks/record-lens-fire"
      );
      const lensInput = `${goal.title} ${goal.domain || ""} ${goal.why || ""} ${currentState || ""}`;
      lensBlock = composeStrategicLensBlock(lensInput);
      if (lensBlock) {
        const matches = pickFrameworks(lensInput);
        recordLensFire({
          surface: "coach-goal",
          matches,
          lensBlockLength: lensBlock.length,
          metadata: { goalId },
        });
      }
    } catch (err) {
      log.warn("strategic_lens_failed", {
        surface: "coach-goal",
        error: sanitizeError(err),
      });
    }

    const baseSystem =
      "You are Nick, Nour's Chief of Staff. You give goal-level coaching in cold, specific, operator language. Return only valid JSON." +
      (lensBlock ? `\n\n${lensBlock}` : "");
    const styledSystem = await applyOperatorStyle(baseSystem);
    const result = await tracedAiChat(
      { label: "coach-goal", source: "tool", metadata: { goalId } },
      [
        { role: "system", content: styledSystem },
        { role: "user", content: prompt },
      ],
      "deep"
    );

    let parsed: Record<string, unknown> = {};
    try {
      parsed = JSON.parse(result.content.replace(/```json|```/g, "").trim());
    } catch {
      parsed = { read: "Parse failed", nextAction: "", blocker: null, risks: [] };
    }

    const entry: CoachEntry = {
      at: new Date().toISOString(),
      read: typeof parsed.read === "string" ? parsed.read : "",
      nextAction: typeof parsed.nextAction === "string" ? parsed.nextAction : "",
      blocker: typeof parsed.blocker === "string" ? parsed.blocker : null,
      risks: Array.isArray(parsed.risks) ? (parsed.risks as string[]) : [],
      progressPct,
    };

    // Append to coachLog (keep last 20)
    const existing = Array.isArray(goal.coachLog) ? (goal.coachLog as unknown as CoachEntry[]) : [];
    const nextLog = [...existing, entry].slice(-20);

    await prisma.lifeGoal
      .update({
        where: { id: goalId },
        data: { coachLog: JSON.parse(JSON.stringify(nextLog)) },
      })
      .catch((err) => log.warn("persist_failed", { err: sanitizeError(err) }));

    return NextResponse.json({ ok: true, entry, provider: result.provider });
  } catch (err) {
    return aiRouteError(err, "coach-goal", "coach failed");
  }
}
