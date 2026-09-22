/**
 * Strict-Done calibration — the readout the receipt-based promotion is gated on.
 *
 * THE GAP THIS CLOSES. `persist-assistant-message.ts` has persisted a
 * per-turn `tokenUsage.claimDoneShadow` on every tool-bearing assistant turn
 * since 2026-09-15 — legacy-vs-strict verdict, consequential count, and the
 * exact receipts strict refuses. As of 2026-09-22 NOTHING read it: no
 * `build*` here, no digest procedure, no panel. Same shape the evidence gate
 * had (evidence-gate-calibration.ts), and the same consequence — the number
 * strict-Done's promotion rests on was obtainable only by writing a throwaway
 * script, which is how it was obtained today: 132 turns, 2 with tool calls,
 * 1 consequential, 1 gap (`createTask:PROVIDER_ACCEPTED`).
 *
 * A decision permanently gated on a number nobody can cheaply compute does
 * not get made. This makes it computable, and it reads the NEW per-turn
 * `tokenUsage.toolReceipts` too, so a turn's verification state can be
 * replayed after the fact instead of reconstructed from offenders alone.
 *
 * THREE RULES, inherited from the evidence-gate reader where each was learned
 * by getting it wrong first:
 *
 * 1 · COHORT AT THE FIX. The verifier→receipt join (#2483) changes what
 *     PROVIDER_ACCEPTED means: before it, a read-back could run and the
 *     receipt still said PROVIDER_ACCEPTED, so every pre-join "gap" on a tool
 *     the verifier covers is an artifact of the missing join, not a finding
 *     about Nick. Turns before JOIN_COHORT_SINCE are context, never evidence.
 *
 * 2 · REFUSE TO STATE A RATE ON A THIN SAMPLE. The denominator for a gap rate
 *     is CONSEQUENTIAL turns (a gap can only occur where something mutated),
 *     and below MIN_SAMPLE of those the rate is null — deliberately not 0.
 *
 * 3 · SPLIT BY OFFENDER. "Gap" is not one thing: `createTask:PROVIDER_ACCEPTED`
 *     (a verifier exists, the join was missing) and `sendTelegram:
 *     PROVIDER_ACCEPTED` (no verifier can exist for a sent message) need
 *     different fixes. The offender tally is what tells a promotion decision
 *     which tools need a read-back before strict-Done is honest for them.
 *
 * Read-only. No LLM. Pure assembly is exported for tests.
 */
import { MIN_SAMPLE } from "./evidence-gate-calibration";

export { MIN_SAMPLE };

/**
 * The deploy of the verifier→receipt join (#2483, main b43fccd4a): the
 * production container's `startedAt` read from /api/version after the uptime
 * drop (2044s → 164s), 2026-09-22 16:22:47Z. Verdicts recorded before it
 * describe receipts that could not be promoted by a read-back and are context,
 * never the promotion cohort. Was provisionally "2026-09-23T00:00Z" (erring
 * late) until the deploy was observed.
 */
export const JOIN_COHORT_SINCE = "2026-09-22T16:22:47.464Z";

/** The persisted shape of `tokenUsage.claimDoneShadow` (summarizeClaimDoneShadow). */
export interface PersistedClaimDoneShadow {
  legacyOk?: boolean;
  strictOk?: boolean;
  gap?: boolean;
  receipts?: number;
  consequential?: number;
  strictOffenders?: Array<{
    toolName?: string;
    category?: string;
    status?: string;
    verificationState?: string | null;
  }>;
}

/**
 * The persisted shape of `tokenUsage.toolReceipts` — the minimal projection of
 * an ActionReceipt that replay needs: what ran, whether it mutates, how far it
 * was verified. Deliberately no args and no results; both can carry secrets.
 */
export interface PersistedToolReceipt {
  toolName: string;
  category: string;
  sideEffecting: boolean;
  verifiable: boolean;
  status: string;
  verificationState: string | null;
  entityType: string | null;
  entityId: string | null;
}

export interface ClaimDoneTurn {
  createdAt: Date;
  shadow: PersistedClaimDoneShadow;
  /** Present only for turns persisted after receipts started being written. */
  receipts?: PersistedToolReceipt[];
}

export interface ClaimDoneCohort {
  /** Turns that carried a shadow verdict at all (tool-bearing turns). */
  turns: number;
  /** Turns with at least one consequential receipt — the rate's denominator. */
  consequentialTurns: number;
  /** Consequential turns where legacy would say Done and strict would not. */
  gapTurns: number;
  /** null when consequentialTurns < MIN_SAMPLE — deliberately not 0. */
  gapPct: number | null;
  /** Turns with receipts persisted (replayable), and how many of those had a VERIFIED mutation. */
  turnsWithReceipts: number;
  verifiedMutationTurns: number;
  /** `tool:verificationState` → count, over strict offenders. Worst first. */
  byOffender: Record<string, number>;
}

export interface ClaimDoneCalibration {
  generatedAt: string;
  cohortSince: string;
  minSample: number;
  /** False when the post-join consequential sample cannot support a rate. */
  sufficient: boolean;
  /** Turns recorded before the join — context, not evidence. */
  beforeJoin: ClaimDoneCohort;
  /** The only cohort a promotion decision may use. */
  afterJoin: ClaimDoneCohort;
  caveat: string;
}

function cohort(turns: ReadonlyArray<ClaimDoneTurn>): ClaimDoneCohort {
  let consequentialTurns = 0;
  let gapTurns = 0;
  let turnsWithReceipts = 0;
  let verifiedMutationTurns = 0;
  const byOffender = new Map<string, number>();

  for (const t of turns) {
    const consequential = (t.shadow.consequential ?? 0) > 0;
    if (consequential) consequentialTurns += 1;
    if (consequential && t.shadow.gap === true) gapTurns += 1;
    for (const o of t.shadow.strictOffenders ?? []) {
      const key = `${o.toolName ?? "?"}:${o.verificationState ?? "none"}`;
      byOffender.set(key, (byOffender.get(key) ?? 0) + 1);
    }
    if (t.receipts && t.receipts.length > 0) {
      turnsWithReceipts += 1;
      if (t.receipts.some((r) => r.sideEffecting && r.verificationState === "VERIFIED")) {
        verifiedMutationTurns += 1;
      }
    }
  }

  const sorted = [...byOffender.entries()].sort((a, b) => b[1] - a[1]);
  return {
    turns: turns.length,
    consequentialTurns,
    gapTurns,
    gapPct:
      consequentialTurns >= MIN_SAMPLE
        ? Number(((gapTurns / consequentialTurns) * 100).toFixed(1))
        : null,
    turnsWithReceipts,
    verifiedMutationTurns,
    byOffender: Object.fromEntries(sorted),
  };
}

/** Pure — exported for tests. */
export function assembleClaimDoneCalibration(
  turns: ReadonlyArray<ClaimDoneTurn>,
  opts: { cohortSince?: string; now?: Date } = {},
): ClaimDoneCalibration {
  const since = new Date(opts.cohortSince ?? JOIN_COHORT_SINCE);
  const before = turns.filter((t) => t.createdAt < since);
  const after = turns.filter((t) => t.createdAt >= since);
  const afterCohort = cohort(after);
  const sufficient = afterCohort.consequentialTurns >= MIN_SAMPLE;
  return {
    generatedAt: (opts.now ?? new Date()).toISOString(),
    cohortSince: since.toISOString(),
    minSample: MIN_SAMPLE,
    sufficient,
    beforeJoin: cohort(before),
    afterJoin: afterCohort,
    caveat: sufficient
      ? "Gap rate is measured over consequential turns since the join. It is NOT a false-positive rate — whether strict was RIGHT to refuse needs the offender tally: a tool with no possible read-back can never satisfy strict, and that is a verifier gap, not a Nick gap."
      : `Only ${afterCohort.consequentialTurns} consequential turns since the join (${MIN_SAMPLE} needed). No rate is stated. Pre-join figures describe receipts a read-back could not promote and must not be used for promotion.`,
  };
}

/** Live readout. Read-only. */
export async function buildClaimDoneCalibration(): Promise<ClaimDoneCalibration> {
  const { prisma } = await import("@/lib/prisma");
  const { Prisma } = await import("@prisma/client");
  // Filter on the JSON KEY, not merely on tokenUsage being present (review on
  // #2484): every assistant turn carries tokenUsage, but only tool-bearing
  // turns carry claimDoneShadow — measured 1 consequential turn per 132
  // assistant turns. A 2,000-row cap over ALL turns held ~15 consequential
  // samples and could never reach MIN_SAMPLE = 40 however much history
  // accumulated. Same `path` + `not: DbNull` shape lib/brain/blind-spot-identity.ts
  // uses for its metadata key; the JS guard below stays as the belt.
  const rows = await prisma.chatMessage.findMany({
    where: {
      role: "assistant",
      tokenUsage: { path: ["claimDoneShadow"], not: Prisma.DbNull },
    },
    select: { createdAt: true, tokenUsage: true },
    orderBy: { createdAt: "desc" },
    take: 2000,
  });
  const turns: ClaimDoneTurn[] = [];
  for (const r of rows) {
    const tu = r.tokenUsage as {
      claimDoneShadow?: PersistedClaimDoneShadow;
      toolReceipts?: PersistedToolReceipt[];
    } | null;
    const shadow = tu?.claimDoneShadow;
    if (!shadow || typeof shadow !== "object") continue;
    turns.push({
      createdAt: r.createdAt,
      shadow,
      receipts: Array.isArray(tu?.toolReceipts) ? tu.toolReceipts : undefined,
    });
  }
  return assembleClaimDoneCalibration(turns);
}
