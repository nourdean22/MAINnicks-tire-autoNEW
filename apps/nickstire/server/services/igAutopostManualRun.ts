/**
 * Manual image autopost run: start in the background, one at a time.
 *
 * A run (generate, evaluate, render, publish) takes 332-342 s, longer than
 * Railway's gateway waits, so a request that awaited it showed an error while
 * the server kept going to a live post, and a retry could post a duplicate.
 * The start returns at once; the outcome is the ig_autopost_log row the run
 * writes (source "admin"), which instagramAdmin.autopostLaneStatus shows.
 *
 * The in-flight claim is in memory on purpose, as in imageProviderCircuit.ts:
 * one process, one replica. The check and the set run in the same synchronous
 * turn with no await between them, so two starts cannot both win in-process.
 * shortcut: a second replica would need a DB claim row; add one if the service scales out.
 */
import { createLogger } from "../lib/logger";
import type { IgArchetype } from "./igAutopost";

const log = createLogger("ig-autopost-manual-run");

let inFlightSince: Date | null = null;

export type StartAutopostRunResult =
  | { started: true; startedAt: Date }
  | { started: false; refusal: string };

export function readManualRunState(): { inFlight: boolean; startedAt: Date | null } {
  return { inFlight: inFlightSince !== null, startedAt: inFlightSince };
}

export function startManualAutopostRun(
  forceArchetype?: IgArchetype,
  run: (forceArchetype?: IgArchetype) => Promise<unknown> = async (a) =>
    (await import("./igAutopost")).runIgAutopostOneOff(a),
): StartAutopostRunResult {
  if (inFlightSince) {
    return { started: false, refusal: `a manual autopost run is already in flight (started ${inFlightSince.toISOString()})` };
  }
  const startedAt = new Date();
  inFlightSince = startedAt;
  void Promise.resolve()
    .then(() => run(forceArchetype))
    .catch((err) => log.error("manual autopost run failed", { error: err instanceof Error ? err.message : String(err) }))
    .finally(() => {
      if (inFlightSince === startedAt) inFlightSince = null;
    });
  return { started: true, startedAt };
}
