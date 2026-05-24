/**
 * lib/services/ai-coach-goal.ts · scattered-components REST→tRPC slice
 * (2026-05-22 · legacy-modernizer · components/goals/* slice).
 *
 * The goal-level coach engine · lifted verbatim from
 * app/api/ai/coach-goal/route.ts so the legacy REST endpoint AND the new
 * `ai.coachGoal` tRPC procedure call the SAME function · drift between
 * consumers structurally impossible.
 *
 * Given a LifeGoal id, pulls the goal + its linked Tasks + brain memory,
 * asks the deep tier for a one-line read / next action / blocker / risks,
 * and appends the entry to LifeGoal.coachLog (last 20 kept).
 *
 * A missing goal throws `CoachGoalError(404)` — the calling tRPC
 * procedure maps it to a NOT_FOUND TRPCError so both transports reject
 * identically (the `PlanProjectError` pattern from ai-plan-project.ts).
 *
 * Returns the explicit flat `CoachGoalResult` — the `CoachEntry` it
 * carries is a flat object of scalars + a string array, no Prisma row or
 * Json column reaches the AppRouter (TS2589 firewall satisfied trivially).
 */

import { tracedAiChat } from "@/lib/ai/traced-aichat";
import { applyOperatorStyle } from "@/lib/ai/style-adapter";
import { prisma } from "@/lib/prisma";
import { sanitizeError } from "@/lib/utils/sanitize-error";
import { logger as rootLogger } from "@/lib/logger";

const log = rootLogger.withSurface("services/ai-coach-goal");

/** Thrown when the coached goal id resolves to no row. Carries a 404. */
export class CoachGoalError extends Error {
  constructor(
    message: string,
    public readonly status: 404,
  ) {
    super(message);
    this.name = "CoachGoalError";
  }
}

/** One coach-log entry · appended to LifeGoal.coachLog. */
export interface CoachEntry {
  at: string;
  read: string;
  nextAction: string;
  blocker: string | null;
  risks: string[];
  progressPct: number;
}

/** The coach-goal result · the appended entry + provider stamp. */
export interface CoachGoalResult {
  ok: true;
  entry: CoachEntry;
  provider?: string;
}

/**
 * Run the goal-level coach for one LifeGoal. The REST route and the
 * `ai.coachGoal` procedure both call this. Throws `CoachGoalError(404)`
 * when the goal id is unknown.
 */
export async function runCoachGoal(input: {
  goalId: string;
  currentState?: string;
}): Promise<CoachGoalResult> {
  const { goalId, currentState } = input;

  const goal = await prisma.lifeGoal.findUnique({ where: { id: goalId } });
  if (!goal) {
    throw new CoachGoalError("Goal not found", 404);
  }

  // Pull linked tasks to see actual progress.
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
    ["INBOX", "READY", "DOING"].includes(t.status),
  ).length;
  const progressPct =
    linkedTasks.length > 0 ? Math.round((done / linkedTasks.length) * 100) : 0;
  const totalMinutes = linkedTasks.reduce(
    (s, t) => s + (t.actualMinutes || 0),
    0,
  );

  // Brain memory context — pull the first meaningful keyword (longer
  // than 3 chars) or the first word regardless.
  const keywords = goal.title
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w.length > 3);
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
      memories
        .map((m) => `- [${m.category}] ${m.content.slice(0, 180)}`)
        .join("\n")
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
            }`,
        )
        .join("\n")
    : "\n\nNo loops linked to this goal yet.";

  const prompt = `Nour's goal: "${goal.title}" (${goal.domain}, ${
    goal.horizon || "no horizon"
  })
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

  // v10.0.250 · Strategic Frameworks lens injection. Goal coaching
  // benefits from framework reasoning.
  let lensBlock = "";
  try {
    const { pickFrameworks, composeStrategicLensBlock } = await import(
      "@/lib/ai/strategic-frameworks"
    );
    const { recordLensFire } = await import(
      "@/lib/ai/strategic-frameworks/record-lens-fire"
    );
    const lensInput = `${goal.title} ${goal.domain || ""} ${goal.why || ""} ${
      currentState || ""
    }`;
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

  // 2026-05-23 · Wave I · operator-state opt-in (4th surface).
  // Goal-level coaching matters most when state-aware · pushing harder
  // on a goal when mood=depleted is counterproductive · cutting back
  // when capacity is high is missed opportunity. State block helps
  // Nick calibrate the coaching pressure.
  let stateBlock = "";
  try {
    const { currentOperatorState, formatOperatorStateBlock } = await import(
      "@/lib/services/operator-state"
    );
    const snap = await currentOperatorState();
    if (snap.confidence > 0) {
      stateBlock = formatOperatorStateBlock(snap);
    }
  } catch {
    // best-effort
  }

  const baseSystem =
    "You are Nick, Nour's Chief of Staff. You give goal-level coaching in cold, specific, operator language. Return only valid JSON." +
    (lensBlock ? `\n\n${lensBlock}` : "") +
    (stateBlock ? `\n\n${stateBlock}` : "");
  const styledSystem = await applyOperatorStyle(baseSystem);
  const result = await tracedAiChat(
    { label: "coach-goal", source: "tool", metadata: { goalId } },
    [
      { role: "system", content: styledSystem },
      { role: "user", content: prompt },
    ],
    "deep",
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

  // Append to coachLog (keep last 20).
  const existing = Array.isArray(goal.coachLog)
    ? (goal.coachLog as unknown as CoachEntry[])
    : [];
  const nextLog = [...existing, entry].slice(-20);

  await prisma.lifeGoal
    .update({
      where: { id: goalId },
      data: { coachLog: JSON.parse(JSON.stringify(nextLog)) },
    })
    .catch((err) => log.warn("persist_failed", { err: sanitizeError(err) }));

  return { ok: true as const, entry, provider: result.provider };
}
