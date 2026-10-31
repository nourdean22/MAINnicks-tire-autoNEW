/**
 * People W1 --plan loop that survives a failure (2026-10-30). Pure: the model call, the save
 * and the pause arrive as arguments.
 *
 * The first full --plan run digested 24 conversations, then a DB connect timed out
 * ("Connection terminated due to connection timeout") and the process exited with no plan
 * file. So: the script reads every candidate's messages BEFORE this loop (no DB read sits
 * between model calls), this loop saves progress after every conversation, a rerun with
 * --resume <progress file> skips what is done, and only a complete run is handed back as
 * "complete" (the script writes the plan file and its token only then).
 *
 * The progress file holds ids, kind and times only, like the plan file: no names, no notes.
 */
import { deserializePlan, serializePlan } from "./backfill-apply";
import type { PlannedChatRow } from "./backfill-plan";

export interface Skipped {
  mentionOnly: number;
  unmatched: number;
  alreadyLogged: number;
  duplicate: number;
}

export interface PlanProgress {
  /** Conversations digested (or too short to digest); a failed one is NOT here, so a resume retries it. */
  done: string[];
  rows: PlannedChatRow[];
  digestFailed: number;
  skipped: Skipped;
}

export const emptyProgress = (): PlanProgress => ({
  done: [],
  rows: [],
  digestFailed: 0,
  skipped: { mentionOnly: 0, unmatched: 0, alreadyLogged: 0, duplicate: 0 },
});

export type DigestOutcome = "too_short" | "failed" | { rows: PlannedChatRow[]; skipped: Skipped };

export interface PlanLoopResult {
  status: "complete" | "partial";
  /** Why a partial run stopped, in plain words. */
  reason?: string;
  progress: PlanProgress;
  total: number;
}

const FAIL_STREAK_MAX = 3;

export async function runPlanLoop(args: {
  candidates: ReadonlyArray<{ conversationId: string; firstMatchAt: Date }>;
  progress: PlanProgress;
  digestOne(c: { conversationId: string; firstMatchAt: Date }): Promise<DigestOutcome>;
  save(p: PlanProgress): void;
  pause(): Promise<void>;
}): Promise<PlanLoopResult> {
  const p: PlanProgress = {
    ...args.progress,
    done: [...args.progress.done],
    rows: [...args.progress.rows],
    skipped: { ...args.progress.skipped },
  };
  const done = new Set(p.done);
  const total = args.candidates.length;
  let failStreak = 0;
  let failedThisRun = 0;
  let calls = 0;
  for (const c of args.candidates) {
    if (done.has(c.conversationId)) continue;
    if (failStreak >= FAIL_STREAK_MAX) {
      return { status: "partial", reason: `stopped: ${FAIL_STREAK_MAX} digest failures in a row (provider busy or down)`, progress: p, total };
    }
    if (calls++ > 0) await args.pause();
    let outcome: DigestOutcome;
    try {
      outcome = await args.digestOne(c);
    } catch (err) {
      // Progress was saved after the last conversation that finished, so nothing is lost here.
      return { status: "partial", reason: err instanceof Error ? err.message : String(err), progress: p, total };
    }
    if (outcome === "failed") {
      p.digestFailed++;
      failedThisRun++;
      failStreak++;
      continue;
    }
    failStreak = 0;
    if (outcome !== "too_short") {
      p.rows.push(...outcome.rows);
      for (const k of Object.keys(p.skipped) as (keyof Skipped)[]) p.skipped[k] += outcome.skipped[k];
    }
    p.done.push(c.conversationId);
    done.add(c.conversationId);
    args.save(p);
  }
  if (failStreak >= FAIL_STREAK_MAX) {
    return { status: "partial", reason: `stopped: ${FAIL_STREAK_MAX} digest failures in a row (provider busy or down)`, progress: p, total };
  }
  if (failedThisRun > 0) {
    const s = failedThisRun === 1 ? "" : "s";
    return { status: "partial", reason: `${failedThisRun} conversation${s} could not be digested`, progress: p, total };
  }
  return { status: "complete", progress: p, total };
}

export function serializeProgress(p: PlanProgress): string {
  return JSON.stringify({
    version: 1,
    done: p.done,
    rows: JSON.parse(serializePlan(p.rows)),
    digestFailed: p.digestFailed,
    skipped: p.skipped,
  });
}

export function parseProgress(text: string): PlanProgress {
  const o = JSON.parse(text) as Record<string, unknown> | null;
  const s = (o?.skipped ?? null) as Record<string, unknown> | null;
  const counts = ["mentionOnly", "unmatched", "alreadyLogged", "duplicate"] as const;
  if (
    !o ||
    o.version !== 1 ||
    !Array.isArray(o.done) ||
    !o.done.every((d) => typeof d === "string") ||
    !Array.isArray(o.rows) ||
    typeof o.digestFailed !== "number" ||
    !s ||
    !counts.every((k) => typeof s[k] === "number")
  ) {
    throw new Error("not a people backfill progress file");
  }
  return {
    done: o.done as string[],
    rows: deserializePlan(JSON.stringify(o.rows)),
    digestFailed: o.digestFailed,
    skipped: Object.fromEntries(counts.map((k) => [k, s[k] as number])) as unknown as Skipped,
  };
}
