/**
 * Evidence-gate calibration — the readout the promotion decision is blocked on.
 *
 * AGENTS.md §4 L6: the evidence gate "runs in SHADOW … Enforcement goes live on
 * the buffered path once the shadow false-positive rate is known." Verdicts have
 * been persisted at `tokenUsage.evidenceGate` since 2026-09-10 and NOTHING read
 * them: no `build*` in this directory, no procedure in the system digest, no
 * panel. Answering "what is the block rate" required writing a throwaway script.
 *
 * A decision permanently gated on a number nobody can cheaply compute does not
 * get made. This makes it computable.
 *
 * TWO RULES ENCODED HERE, both learned by getting them wrong first:
 *
 * 1 · COHORT AT THE FIX. A first pass over ALL persisted verdicts reported a
 *     36.9% would-block rate with a sample full of itinerary and advice false
 *     positives ("Eat clean tomorrow morning", "Walk Brooklyn Bridge → DUMBO").
 *     But `isResourceTitle()` — five rules aimed at exactly those shapes —
 *     shipped in 8ee86eb3b at 2026-09-16 08:56, and most of that sample
 *     predates it. The number measured the FIX'S ABSENCE, not the gate. Split
 *     at the last precision change or the figure is worse than no figure.
 *
 * 2 · REFUSE TO REPORT A RATE ON A THIN SAMPLE. Post-fix there were 12 turns.
 *     "4 of 12" is not a block rate, and rendering it as 33.3% invites a
 *     promotion decision the data cannot support. Below MIN_SAMPLE this returns
 *     `sufficient: false` and the counts, and states no rate at all — the same
 *     discipline the tool census applies when `turns === 0` ("an absent
 *     instrument must not read as a measured zero").
 *
 * 3 · SPLIT BY DRIVER. "Would block" is not one thing. Named-resource claims,
 *     fact-check-unverified and LENGTH are different components with different
 *     precision, and the dominant driver CHANGED after the fix (named-claim
 *     blocks fell 21/91 → 1/12, leaving fact-check as the main blocker).
 *     Promoting on an aggregate would promote whichever component happens to be
 *     loudest. Length in particular is not an evidence signal at all.
 *
 * Read-only. No LLM. Pure assembly is exported for tests.
 */

/** Minimum post-cohort turns before a rate is meaningful enough to state. */
export const MIN_SAMPLE = 40;

/**
 * The last change that materially altered gate PRECISION. Verdicts recorded
 * before it describe a gate that no longer exists. Update this when a
 * precision fix ships, and say which commit in the comment.
 *
 * 2026-09-16T08:56Z · 8ee86eb3b — isResourceTitle() added five rules that
 * reject sentence-enders, "x = y" assertions, "a → b" itinerary legs and
 * short-left-side label colons.
 */
export const PRECISION_COHORT_SINCE = "2026-09-16T08:56:00.000Z";

export interface GateVerdict {
  verdict?: string;
  severity?: number | string;
  blockingReasons?: unknown[];
  namedClaims?: number;
  unreceipted?: string[];
}

export interface GateTurn {
  createdAt: Date;
  gate: GateVerdict;
  /** Short reply excerpt, for the judgement sample only. */
  excerpt?: string;
}

export type BlockDriver = "named_claim" | "fact_check" | "length" | "other";

export interface GateCohort {
  turns: number;
  wouldBlock: number;
  /** null when the sample is too thin to state a rate — deliberately not 0. */
  wouldBlockPct: number | null;
  byDriver: Record<BlockDriver, number>;
  sample: Array<{ at: string; driver: BlockDriver; unreceipted: string[]; excerpt: string }>;
}

export interface EvidenceGateCalibration {
  generatedAt: string;
  cohortSince: string;
  minSample: number;
  /** False when the post-cohort sample cannot support a rate. */
  sufficient: boolean;
  /** Turns recorded before the last precision change — context, not evidence. */
  beforeFix: GateCohort;
  /** The only cohort a promotion decision may use. */
  afterFix: GateCohort;
  /** Plain-language statement of what this does and does not establish. */
  caveat: string;
}

const PASSING = new Set(["pass", "ok", "allow", ""]);

export function isBlockingVerdict(verdict: unknown): boolean {
  return !PASSING.has(String(verdict ?? "").toLowerCase());
}

/**
 * Which component caused the block. Checked in precedence order: a named-claim
 * block is the fabrication case the gate exists for; length is not an evidence
 * signal at all and is classified last so it can be SEEN rather than folded in.
 */
export function classifyDriver(gate: GateVerdict): BlockDriver {
  const reasons = (gate.blockingReasons ?? []).map((r) =>
    (typeof r === "string" ? r : JSON.stringify(r)).toLowerCase(),
  );
  if ((gate.namedClaims ?? 0) > 0 || reasons.some((r) => r.includes("named"))) return "named_claim";
  if (reasons.some((r) => r.includes("fact-check"))) return "fact_check";
  if (reasons.some((r) => r.includes("length") || r.includes("ceiling"))) return "length";
  return "other";
}

function cohort(turns: GateTurn[], sampleSize: number): GateCohort {
  const blocking = turns.filter((t) => isBlockingVerdict(t.gate.verdict));
  const byDriver: Record<BlockDriver, number> = { named_claim: 0, fact_check: 0, length: 0, other: 0 };
  for (const t of blocking) byDriver[classifyDriver(t.gate)]++;

  return {
    turns: turns.length,
    wouldBlock: blocking.length,
    // A rate on a thin sample is worse than no rate: it invites a decision the
    // data cannot support. Null is the honest value.
    wouldBlockPct:
      turns.length >= MIN_SAMPLE ? Number(((blocking.length / turns.length) * 100).toFixed(1)) : null,
    byDriver,
    sample: blocking.slice(0, sampleSize).map((t) => ({
      at: t.createdAt.toISOString().slice(0, 16),
      driver: classifyDriver(t.gate),
      unreceipted: (t.gate.unreceipted ?? []).slice(0, 5),
      excerpt: (t.excerpt ?? "").replace(/\s+/g, " ").slice(0, 180),
    })),
  };
}

/** Pure — exported for tests. */
export function assembleGateCalibration(
  turns: ReadonlyArray<GateTurn>,
  opts: { cohortSince?: string; now?: Date; sampleSize?: number } = {},
): EvidenceGateCalibration {
  const since = new Date(opts.cohortSince ?? PRECISION_COHORT_SINCE);
  const sampleSize = opts.sampleSize ?? 6;
  const before = turns.filter((t) => t.createdAt < since);
  const after = turns.filter((t) => t.createdAt >= since);
  const afterCohort = cohort([...after], sampleSize);
  const sufficient = afterCohort.turns >= MIN_SAMPLE;

  return {
    generatedAt: (opts.now ?? new Date()).toISOString(),
    cohortSince: since.toISOString(),
    minSample: MIN_SAMPLE,
    sufficient,
    beforeFix: cohort([...before], sampleSize),
    afterFix: afterCohort,
    caveat: sufficient
      ? "Block rate is measured. It is NOT a false-positive rate — deciding whether a block was correct needs human judgement on the sample below."
      : `Only ${afterCohort.turns} turns since the last precision change (${MIN_SAMPLE} needed). No rate is stated. Pre-fix figures describe a gate that no longer exists and must not be used for promotion.`,
  };
}

/** Live readout. Read-only. */
export async function buildEvidenceGateCalibration(): Promise<EvidenceGateCalibration> {
  const { prisma } = await import("@/lib/prisma");
  const { Prisma } = await import("@prisma/client");
  const rows = await prisma.chatMessage.findMany({
    where: { role: "assistant", tokenUsage: { not: Prisma.DbNull } },
    select: { createdAt: true, content: true, tokenUsage: true },
    orderBy: { createdAt: "desc" },
    take: 2000,
  });

  const turns: GateTurn[] = [];
  for (const r of rows) {
    const gate = (r.tokenUsage as { evidenceGate?: GateVerdict } | null)?.evidenceGate;
    if (!gate) continue;
    turns.push({ createdAt: r.createdAt, gate, excerpt: r.content ?? "" });
  }
  return assembleGateCalibration(turns);
}
