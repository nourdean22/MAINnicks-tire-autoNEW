/**
 * Social publish queue door auth (/api/sync/queue): the pure decision, next-auth-free so
 * tests import the real function. Same shape as evidence-ledger-auth.ts.
 *
 *   STATENOUR_QUEUE_KEY        scoped: list, approve, schedule, reject, delete and PUBLISH.
 *                              Held by nickstire's Command Queue only.
 *   STATENOUR_SYNC_KEY         the cross-app bridge key (nickstire's server AND the worker).
 *                              Accepted here only until STATENOUR_QUEUE_KEY_STRICT=1, so the
 *                              rollout has no broken window. Strict closes the two-request
 *                              path "create a pending draft via /api/sync/events, publish it
 *                              here" for every bridge-key holder (audit 2026-10-10).
 * Env is read per call. Fail closed: no configured key, or no presented key, never
 * authenticates.
 */
import { same } from "./evidence-ledger-auth";

export type QueueKeyEnv = {
  STATENOUR_QUEUE_KEY?: string;
  STATENOUR_SYNC_KEY?: string;
  STATENOUR_QUEUE_KEY_STRICT?: string;
};

/** Which configured key, if any, the presented one matches. */
export function queueDoorAccepts(presented: string, env: QueueKeyEnv): "queue" | "bridge" | null {
  const queue = env.STATENOUR_QUEUE_KEY?.trim();
  const bridge = env.STATENOUR_SYNC_KEY?.trim();
  if (queue && same(presented, queue)) return "queue";
  const strict = env.STATENOUR_QUEUE_KEY_STRICT?.trim() === "1";
  if (!strict && bridge && same(presented, bridge)) return "bridge";
  return null;
}
