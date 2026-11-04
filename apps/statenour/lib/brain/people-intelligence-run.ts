/**
 * The people engine's run marker (W8b, 2026-11-03): claimed BEFORE the run, settled after it.
 *
 * One `people_intelligence_run` audit row per run, for both callers (the chat path every ~6 h, the nightly cron).
 * The claim is one transaction under the house advisory lock (lib/services/people/record-interaction.ts:148 shape):
 * read the newest row, refuse or create the "running" row. The lock ends at that commit, so the running row is what
 * keeps a second run out for the length of the run, for every caller, whatever its window. A running row older than
 * PEOPLE_RUN_STALE_MS is a dead process: a compare-and-swap closes it as failed and the claim goes on. The row is
 * then updated with the outcome, and /people reads the newest row as the engine line (app/api/people/route.ts).
 */
import { prisma } from "@/lib/prisma";
import { logError } from "@/lib/utils/error-log";
import type { runPeopleIntelligence } from "./people-intelligence";

export const PEOPLE_RUN_EVENT = "people_intelligence_run";
export const PEOPLE_RUN_ACTOR = "people_intelligence";
const PEOPLE_RUN_RUNNING = "running";
/** A "running" row older than this never settled: the process died. */
export const PEOPLE_RUN_STALE_MS = 30 * 60_000;

export type PeopleRunState = "ok" | "failed" | "nothing_to_propose" | "running";

type RunResult = Awaited<ReturnType<typeof runPeopleIntelligence>>;

type PeopleRunRefusal = "running" | "recent_run";

export async function claimPeopleIntelligenceRun(opts: {
  windowMs: number;
}): Promise<{ claimed: true; runId: string } | { claimed: false; reason: PeopleRunRefusal; lastRunAt: Date }> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${PEOPLE_RUN_EVENT}))`;
    // The newest row is enough: no row is created while a fresh one is running, so none can sit beneath it.
    const last = await tx.auditEvent.findFirst({
      where: { eventType: PEOPLE_RUN_EVENT },
      orderBy: { createdAt: "desc" },
      select: { id: true, createdAt: true, detail: true },
    });
    const ageMs = last ? Date.now() - last.createdAt.getTime() : Infinity;
    if (last?.detail === PEOPLE_RUN_RUNNING) {
      if (ageMs <= PEOPLE_RUN_STALE_MS) return { claimed: false as const, reason: "running" as const, lastRunAt: last.createdAt };
      const closed = await tx.auditEvent.updateMany({
        where: { id: last.id, detail: PEOPLE_RUN_RUNNING, createdAt: last.createdAt },
        data: { detail: "failed", payload: { state: "failed", reason: "did not finish" } },
      });
      if (closed.count !== 1) return { claimed: false as const, reason: "running" as const, lastRunAt: last.createdAt };
    } else if (last && ageMs < opts.windowMs) {
      return { claimed: false as const, reason: "recent_run" as const, lastRunAt: last.createdAt };
    }
    const row = await tx.auditEvent.create({
      data: { actor: PEOPLE_RUN_ACTOR, eventType: PEOPLE_RUN_EVENT, detail: PEOPLE_RUN_RUNNING, payload: { state: "running" } },
      select: { id: true },
    });
    return { claimed: true as const, runId: row.id };
  });
}

/** The state one finished run earns: a failed read is failed even when something was written. */
export function peopleRunStateOf(r: RunResult): { state: PeopleRunState; reason: string | null } {
  const reason = r.enrich ?? r.cadence ?? null;
  if (reason) return { state: "failed", reason };
  if (r.profilesUpdated === 0 && (r.cadenceProposed ?? 0) === 0) return { state: "nothing_to_propose", reason: null };
  return { state: "ok", reason: null };
}

export async function runPeopleIntelligenceClaimed(opts: {
  windowMs: number;
  /** Test seam; production passes nothing and gets the real engine. */
  run?: () => Promise<RunResult>;
}): Promise<RunResult | { skipped: PeopleRunRefusal; lastRunAt: Date }> {
  const claim = await claimPeopleIntelligenceRun({ windowMs: opts.windowMs });
  if (!claim.claimed) return { skipped: claim.reason, lastRunAt: claim.lastRunAt };
  const run = opts.run ?? (async () => (await import("./people-intelligence")).runPeopleIntelligence());
  const settle = (data: { detail: string; payload: Record<string, unknown> }) =>
    prisma.auditEvent
      .update({ where: { id: claim.runId }, data: { ...data, payload: { ...data.payload, finishedAt: new Date().toISOString() } } })
      .catch((err) => logError("brain.people-intelligence", err, { fn: "runPeopleIntelligenceClaimed.settle" }));
  let result: RunResult;
  try {
    result = await run();
  } catch (err) {
    await settle({ detail: "failed", payload: { state: "failed", reason: err instanceof Error ? err.message : String(err) } });
    throw err;
  }
  const { state, reason } = peopleRunStateOf(result);
  await settle({
    detail: `Updated ${result.profilesUpdated} profiles, ${result.cadenceProposed ?? 0} cadence proposed, ${result.alerts.length} alerts, ${result.enrichDeferred ?? 0} enrich deferred`,
    payload: {
      state,
      reason,
      profilesUpdated: result.profilesUpdated,
      cadenceProposed: result.cadenceProposed ?? 0,
      alerts: result.alerts.length,
      enrichDeferred: result.enrichDeferred ?? 0,
    },
  });
  return result;
}
