/**
 * Goal contract registry. TypeScript, not JSON, so the server (verdict
 * resolver), the tests and — if ever needed — the client compute the SAME
 * `contractHash` from the same object without a filesystem read at runtime.
 *
 * Evaluator path: a `darwin/*` / `night-shift/*` branch may not edit this
 * directory (config/agent-os/evaluator-paths.json).
 */
import { contractHash, parseGoalContract, type GoalContract } from "../shared/goalContract";
import { NICKS_PUBLIC_SHOP_STATE } from "./nicks-public-shop-state";
import { NICKS_PUBLIC_TIRES_ARRIVALS } from "./nicks-public-tires-arrivals";

export const GOAL_CONTRACTS: readonly GoalContract[] = [NICKS_PUBLIC_TIRES_ARRIVALS, NICKS_PUBLIC_SHOP_STATE].map(parseGoalContract);

/**
 * The contract that governs an experiment: covers every surface AND is judged
 * on the same primary metric. An experiment with no owning contract was never
 * pre-registered and must not produce a graded verdict.
 */
export function goalContractFor(experiment: { surfaces: readonly string[]; primaryMetric: string }): { contract: GoalContract; hash: string } | null {
  const contract = GOAL_CONTRACTS.find((c) => experiment.surfaces.every((s) => c.surfaces.includes(s)) && c.primaryMetric === experiment.primaryMetric);
  return contract ? { contract, hash: contractHash(contract) } : null;
}
