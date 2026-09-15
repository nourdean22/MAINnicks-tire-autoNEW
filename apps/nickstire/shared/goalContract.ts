/**
 * GoalContract — what winning means, what cannot move, and how much evidence
 * a change needs before it is believed. Frozen BEFORE any result exists.
 *
 * WHY FROZEN. An agent that can rewrite the goal after the data comes in will
 * eventually report "calls didn't move but scroll depth did, so it worked".
 * The contract hash is written next to every verdict and every evidence
 * claim; a verdict whose hash does not match the contract it was judged
 * against is not a verdict.
 *
 * EVALUATOR SEPARATION. Contracts live in `goals/*.json` — an evaluator
 * path. A candidate change (a `darwin/*` branch) may not touch them in the
 * same PR as the product change it wants judged; see
 * scripts/agent-os/check-evaluator-separation.mjs.
 *
 * Pure and browser-safe: `shared/` is bundled into the client.
 */
import { z } from "zod";

export const EVIDENCE_LEVELS = ["offline", "observational", "randomized", "physical_outcome"] as const;
export type MinimumEvidence = (typeof EVIDENCE_LEVELS)[number];

export const GoalContractSchema = z.object({
  goalId: z.string().regex(/^[a-z0-9][a-z0-9-]{2,63}$/, "kebab-case id"),
  product: z.enum(["nicks-public", "nicks-admin", "statenour"]),
  /** Routes the goal is allowed to change. Must be registered routes (tested). */
  surfaces: z.array(z.string().regex(/^\//)).min(1),
  desiredOutcome: z.string().min(10),
  /** Where truth comes from. Copy that contradicts one is a protected-claim violation. */
  truthSources: z.array(z.string().min(1)).min(1),
  /** Things no candidate may do. Stated in plain language; enforced by tests + review. */
  protectedInvariants: z.array(z.string().min(5)).min(1),
  /** The ONLY dimensions a candidate may vary. One per experiment. */
  mutationAxes: z.array(z.string().min(1)).min(1),
  /** customer_events eventName the goal is judged on. */
  primaryMetric: z.string().min(1),
  /** Held-out metrics a candidate may not worsen. */
  guardrails: z.array(z.string().min(1)),
  minimumEvidence: z.enum(EVIDENCE_LEVELS),
  killCriteria: z.array(z.string().min(5)).min(1),
  rollbackPlan: z.string().min(10),
  frozenAt: z.string().datetime(),
});

export type GoalContract = z.infer<typeof GoalContractSchema>;

/** Stable key order so the hash does not depend on how a file was written. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    const o = value as Record<string, unknown>;
    return `{${Object.keys(o)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonicalJson(o[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

/** FNV-1a 64-bit, hex. A freeze fingerprint, not a security primitive. */
export function fnv1a64(input: string): string {
  let h = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  for (let i = 0; i < input.length; i++) {
    h ^= BigInt(input.charCodeAt(i));
    h = (h * prime) & 0xffffffffffffffffn;
  }
  return h.toString(16).padStart(16, "0");
}

/** The pre-registration fingerprint written beside every verdict. */
export function contractHash(contract: GoalContract): string {
  return fnv1a64(canonicalJson(contract));
}

export function parseGoalContract(raw: unknown): GoalContract {
  return GoalContractSchema.parse(raw);
}

/**
 * Evidence thermostat — authority rises with evidence and falls with risk.
 * The strongest grade still ends at a RECOMMENDATION: customer-facing changes
 * keep human authority at every level.
 */
export type Authority = "research_only" | "draft_pr" | "experiment_proposal" | "promotion_recommendation";

export type EvidenceGrade = "H0" | "H1" | "H2" | "H3" | "H4" | "H5";

export function authorityFor(grade: EvidenceGrade): Authority {
  switch (grade) {
    case "H0":
    case "H1":
      return "research_only";
    case "H2":
      return "draft_pr";
    case "H3":
      return "experiment_proposal";
    case "H4":
    case "H5":
      return "promotion_recommendation";
  }
}

/** Which evidence grades satisfy a contract's minimum. */
export function gradeSatisfies(grade: EvidenceGrade, minimum: MinimumEvidence): boolean {
  const rank: Record<EvidenceGrade, number> = { H0: 0, H1: 1, H2: 2, H3: 3, H4: 4, H5: 5 };
  const need: Record<MinimumEvidence, number> = { offline: 2, observational: 3, randomized: 4, physical_outcome: 5 };
  return rank[grade] >= need[minimum];
}
