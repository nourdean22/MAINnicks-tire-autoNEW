/**
 * /api/cron/suggestion-outcome-rollup · v10.0.529.98
 *
 * Daily cron that closes the suggestion-loop end-to-end · pairs each
 * `acted` action signal with downstream business events and writes
 * the corresponding `outcome_observed` signal back to brain_memory.
 *
 * Why this exists (Ilya thesis · continued):
 *   - Today (e9fe26b3 + 0dda5695 + b41022a9) we shipped the
 *     suggestion-loop capture · operator chip taps and dismisses
 *     are now persisted as brain_memory rows.
 *   - That gives REACTION + ACTION signals · but ACTION alone
 *     is intent, not validated truth.
 *   - This cron is the OUTCOME stage: did the downstream event
 *     that the suggestion was about actually happen?
 *
 * Conservative heuristic (v1 · only matches task-related kinds):
 *   For each "acted" signal on kind in {broken-promise · stuck-task ·
 *   overdue}, look for a Task.completedAt within 24h after the action
 *   signal's lastSeen timestamp. If found → write outcome:neutral
 *   (NOT positive · because completion alone doesn't mean the
 *   suggestion was correct · operator can manually upgrade to
 *   positive/negative via POST /api/brain/suggestion-loop with
 *   type=outcome).
 *
 *   Other kinds (stalled-goal · unresolved-reflection · stale-pin ·
 *   weak-axis · pattern · contradiction · drift · orphan-nudge ·
 *   broken-promise meta) deferred to v2 once we have event tables
 *   for each.
 *
 * Why NEUTRAL by default:
 *   Auto-tagged positives are the highest poison risk for downstream
 *   DPO fine-tuning · false positives bias the model toward "yes that
 *   was right" when the truth is "operator did SOMETHING in that
 *   24h window unrelated to Nick's suggestion." Neutral preserves the
 *   action record but doesn't claim validation. Operator upgrades the
 *   genuinely-positive ones through the chat interface (manual
 *   correction is the strongest training signal).
 *
 * Idempotent: outcome rows use key `sugg:<id>:outcome:neutral` so
 * re-running same day rewrites the same row. seenCount increments on
 * each pass · useful for "how many days has Nick been seeing this
 * outcome but operator hasn't corrected it" debugging.
 *
 * Auth · CRON_SECRET bearer (matches the v10.0.370 agent-eval pattern).
 */

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { recordSuggestionOutcome, listSuggestionSignals } from "@/lib/brain/suggestion-loop";

export const maxDuration = 120;
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function authorizeCron(req: Request): boolean {
  const auth = req.headers.get("authorization") ?? "";
  const expected = process.env.CRON_SECRET;
  if (!expected) return false;
  return auth === `Bearer ${expected}`;
}

const TASK_LINKED_KINDS = new Set([
  "broken-promise",
  "stuck-task",
  "overdue",
]);

const OUTCOME_WINDOW_MS = 24 * 60 * 60 * 1000;

export async function GET(req: Request) {
  if (!authorizeCron(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const startedAt = Date.now();
  const errors: string[] = [];

  let actionsScanned = 0;
  let taskKindActions = 0;
  let alreadyHasOutcome = 0;
  let matchedCompletions = 0;
  let neutralsWritten = 0;

  try {
    // 1 · Pull last 7d of suggestion-loop signals.
    //     listSuggestionSignals returns BOTH action + outcome rows ·
    //     filter to action rows of kinds we know how to map.
    const signals = await listSuggestionSignals(7);
    actionsScanned = signals.length;

    const actedTaskKinds = signals.filter(
      (s) => s.event === "acted" && TASK_LINKED_KINDS.has(s.suggestionKind),
    );
    taskKindActions = actedTaskKinds.length;

    for (const action of actedTaskKinds) {
      // 1a · For broken-promise · the suggestionId encodes the taskId:
      //     id format = "broken-promise-<taskId>" (per the wave-30 wiring
      //     in chat/page.tsx that extracts lastTaskId from this prefix).
      //     stuck-task and overdue use a similar prefix pattern.
      const taskIdMatch =
        /^(broken-promise-|stuck-task-|overdue-)(.+)$/.exec(action.suggestionId);
      if (!taskIdMatch) continue;
      const taskId = taskIdMatch[2];

      // 1b · Check if this suggestion already has an outcome row · skip if so.
      //     Avoids re-classifying the same action every day forever.
      const existingOutcome = signals.find(
        (s) => s.suggestionId === action.suggestionId && s.polarity !== null,
      );
      if (existingOutcome) {
        alreadyHasOutcome++;
        continue;
      }

      // 1c · Look up the task · check if completed within 24h after the
      //     operator's "acted" action. Task has TWO completion signals:
      //       · ONCE loops · status === DONE · updatedAt = completion ts
      //       · DAILY loops · lastCompletedAt set explicitly
      //     Use whichever fires within the window.
      const actionAt = action.capturedAt.getTime();
      const task = await prisma.task.findUnique({
        where: { id: taskId },
        select: { id: true, status: true, lastCompletedAt: true, updatedAt: true, loopKind: true },
      });

      if (!task) continue;

      let completionAt: number | null = null;
      // DAILY loop · explicit lastCompletedAt
      if (task.lastCompletedAt) {
        completionAt = task.lastCompletedAt.getTime();
      } else if (task.status === "DONE") {
        // ONCE loop · status flipped + updatedAt is the transition time
        completionAt = task.updatedAt.getTime();
      }
      if (completionAt === null) continue;

      const deltaMs = completionAt - actionAt;
      if (deltaMs < 0 || deltaMs > OUTCOME_WINDOW_MS) continue;

      matchedCompletions++;

      // 1d · Write a NEUTRAL outcome row. The operator can upgrade to
      //     positive via the chat interface · this cron just establishes
      //     that the suggested-about task was completed in the window.
      try {
        await recordSuggestionOutcome({
          suggestionId: action.suggestionId,
          suggestionKind: action.suggestionKind,
          polarity: "neutral",
          delaySeconds: Math.floor(deltaMs / 1000),
          notes: `auto · task ${taskId} completed ${Math.floor(deltaMs / 60000)}min after action`,
        });
        neutralsWritten++;
      } catch (err) {
        errors.push(
          `record outcome failed for ${action.suggestionId}: ${err instanceof Error ? err.message.slice(0, 120) : String(err)}`,
        );
      }
    }
  } catch (err) {
    errors.push(`scan failed: ${err instanceof Error ? err.message.slice(0, 200) : String(err)}`);
  }

  const durationMs = Date.now() - startedAt;

  return NextResponse.json({
    ok: errors.length === 0,
    durationMs,
    actionsScanned,
    taskKindActions,
    alreadyHasOutcome,
    matchedCompletions,
    neutralsWritten,
    errors,
    notes: [
      "v1 heuristic · only task-linked kinds (broken-promise · stuck-task · overdue)",
      "outcomes auto-tagged NEUTRAL · operator upgrades to positive/negative manually",
      "extends to other kinds (stalled-goal · unresolved-reflection · stale-pin) when event tables wired",
    ],
  });
}
