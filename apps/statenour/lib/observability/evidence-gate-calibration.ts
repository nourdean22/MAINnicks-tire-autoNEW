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
 * 4 · THE PRE-FLUSH SHADOW GETS THE SAME RULES (2026-09-22). Enforcement can
 *     only happen on the BUFFERED lane, and `NICK_EVIDENCE_PREFLUSH` decides
 *     which turns buffer. Since 8e3a4a14a every assistant turn carries
 *     `evidenceGate.turnRisk` - "would the lane have buffered this turn" - and
 *     nothing read it either. `assembleBufferShadow` reads the COST (share of
 *     turns that would stop streaming) against the BENEFIT (share of turns that
 *     ended up wearing the L2 verifier banner and would have been repairable
 *     before flush), per classifier reason. First reading, 2026-09-22: 84/128
 *     turns would buffer (65.6%); 6 of 7 banner turns were in that share; and
 *     the reason behind 77 of the 84 was also the reason behind all 6 - the
 *     classifier's own reasons do NOT separate banner turns from the rest, so
 *     a narrower predicate cannot be read off them. The recall denominator is
 *     banner turns, which arrive at ~7 a week: it has its own floor, and 6/7
 *     is reported as 6 of 7, never as 85.7%.
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

/**
 * First write of `evidenceGate.turnRisk` - commit 8e3a4a14a (#2335), which
 * added the pre-flush lane and its shadow in the same change. Turns before it
 * have no shadow for a trivial reason and must not count as "the shadow
 * skipped this turn". The deploy landed minutes after the commit, so a handful
 * of turns right after this instant can still legitimately lack the field.
 */
export const BUFFER_SHADOW_SINCE = "2026-09-15T17:29:16.000Z";

/** What persist-assistant-turn writes at `evidenceGate.turnRisk` (E3 shadow). */
export interface TurnRiskShadow {
  buffer?: boolean;
  risk?: string;
  register?: string;
  reasons?: string[];
  toolsFired?: number;
}

export interface GateVerdict {
  verdict?: string;
  severity?: number | string;
  blockingReasons?: unknown[];
  namedClaims?: number;
  unreceipted?: string[];
  turnRisk?: TurnRiskShadow | null;
}

export interface GateTurn {
  createdAt: Date;
  gate: GateVerdict;
  /** Short reply excerpt, for the judgement sample only. */
  excerpt?: string;
  /** The reply opens with the L2 verifier banner (`isVerifierRewritten`). */
  verifierBanner?: boolean;
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

/** One classifier reason: how many buffered turns cited it, and how many of those wore the banner. */
export interface BufferReasonRow {
  reason: string;
  buffered: number;
  bannered: number;
}

export interface BufferShadow {
  /** Cohort start - the shadow's first write. */
  since: string;
  /** Assistant turns in the cohort. */
  turns: number;
  /** Turns carrying `evidenceGate.turnRisk`; the denominator of the buffer rate. */
  withShadow: number;
  wouldBuffer: number;
  wouldStream: number;
  /** null below MIN_SAMPLE shadowed turns - deliberately not 0. */
  wouldBufferPct: number | null;
  /** Buffered turns by reason, each reason counted once per turn, most-cited first. */
  byReason: BufferReasonRow[];
  /** Turns that ended up wearing the L2 verifier banner, split by what the lane would have done. */
  banner: {
    turns: number;
    wouldHaveBuffered: number;
    wouldHaveStreamed: number;
    /** Banner turns with no shadow at all - a silent-instrument signal inside the cohort. */
    noShadow: number;
    /** null below MIN_SAMPLE banner turns; the recall's own floor. */
    recallPct: number | null;
  };
  /** True when the shadowed sample supports a buffer rate. Says nothing about the recall. */
  sufficient: boolean;
  caveat: string;
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
  /** The pre-flush lane's shadow: what turning NICK_EVIDENCE_PREFLUSH on would cost and catch. */
  bufferShadow: BufferShadow;
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

const pct = (num: number, den: number): number | null =>
  den >= MIN_SAMPLE ? Number(((num / den) * 100).toFixed(1)) : null;

/**
 * Pure - exported for tests. Reads the E3 pre-flush shadow: for every turn in
 * the cohort, would the lane have buffered it, for which reasons, and did the
 * turn end up wearing the L2 verifier banner. Two independent floors: the
 * buffer rate needs MIN_SAMPLE shadowed turns, the recall needs MIN_SAMPLE
 * banner turns. Counts are always reported; rates only above their floor.
 */
export function assembleBufferShadow(
  turns: ReadonlyArray<GateTurn>,
  opts: { since?: string } = {},
): BufferShadow {
  const since = new Date(opts.since ?? BUFFER_SHADOW_SINCE);
  const cohortTurns = turns.filter((t) => t.createdAt >= since);

  let withShadow = 0;
  let wouldBuffer = 0;
  let wouldStream = 0;
  const banner = { turns: 0, wouldHaveBuffered: 0, wouldHaveStreamed: 0, noShadow: 0 };
  const byReason = new Map<string, BufferReasonRow>();

  for (const t of cohortTurns) {
    const shadow = t.gate.turnRisk;
    const bannered = t.verifierBanner === true;
    if (bannered) banner.turns++;
    if (!shadow) {
      if (bannered) banner.noShadow++;
      continue;
    }
    withShadow++;
    if (shadow.buffer) {
      wouldBuffer++;
      if (bannered) banner.wouldHaveBuffered++;
      // A turn cites a reason once, however many times the classifier listed it.
      // JSON off the row is untyped: a non-array here must not be iterated
      // (a string would spread into characters).
      const reasons = Array.isArray(shadow.reasons) ? shadow.reasons.filter((r) => typeof r === "string") : [];
      for (const reason of new Set(reasons)) {
        const row = byReason.get(reason) ?? { reason, buffered: 0, bannered: 0 };
        row.buffered++;
        if (bannered) row.bannered++;
        byReason.set(reason, row);
      }
    } else {
      wouldStream++;
      if (bannered) banner.wouldHaveStreamed++;
    }
  }

  const rows = [...byReason.values()].sort(
    (a, b) => b.buffered - a.buffered || b.bannered - a.bannered || a.reason.localeCompare(b.reason),
  );
  const wouldBufferPct = pct(wouldBuffer, withShadow);
  const recallPct = pct(banner.wouldHaveBuffered, banner.turns);
  const sufficient = withShadow >= MIN_SAMPLE;

  const parts: string[] = [
    sufficient
      ? `Buffer rate is measured over ${withShadow} shadowed turns: this is the share of turns that would stop streaming with NICK_EVIDENCE_PREFLUSH on.`
      : `Only ${withShadow} turns carry the pre-flush shadow (${MIN_SAMPLE} needed). No buffer rate is stated.`,
  ];
  if (banner.turns === 0) {
    parts.push("No verifier-banner turn in the cohort yet, so the lane's recall cannot be read.");
  } else if (recallPct === null) {
    parts.push(
      `${banner.wouldHaveBuffered} of ${banner.turns} verifier-banner turns would have buffered - too few banner turns (${MIN_SAMPLE} needed) to state a recall rate.`,
    );
  } else {
    parts.push(`${banner.wouldHaveBuffered} of ${banner.turns} verifier-banner turns (${recallPct}%) would have buffered.`);
  }
  const top = rows[0];
  if (top) {
    parts.push(
      `Top reason "${top.reason}": ${top.buffered}/${wouldBuffer} buffered turns` +
        (banner.turns > 0 ? `, ${top.bannered}/${banner.wouldHaveBuffered} buffered banner turns.` : "."),
    );
  }

  return {
    since: since.toISOString(),
    turns: cohortTurns.length,
    withShadow,
    wouldBuffer,
    wouldStream,
    wouldBufferPct,
    byReason: rows,
    banner: { ...banner, recallPct },
    sufficient,
    caveat: parts.join(" "),
  };
}

/** Pure — exported for tests. */
export function assembleGateCalibration(
  turns: ReadonlyArray<GateTurn>,
  opts: { cohortSince?: string; bufferShadowSince?: string; now?: Date; sampleSize?: number } = {},
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
    bufferShadow: assembleBufferShadow(turns, { since: opts.bufferShadowSince }),
  };
}

/** Live readout. Read-only. */
export async function buildEvidenceGateCalibration(): Promise<EvidenceGateCalibration> {
  const { prisma } = await import("@/lib/prisma");
  const { Prisma } = await import("@prisma/client");
  // The SAME predicate L3 uses to spot a verifier-rewritten turn in history -
  // one definition of "wears the banner", not a second regex that can drift.
  const { isVerifierRewritten } = await import("@/lib/ai/chat/fabrication-rewriter");
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
    const content = r.content ?? "";
    turns.push({ createdAt: r.createdAt, gate, excerpt: content, verifierBanner: isVerifierRewritten(content) });
  }
  return assembleGateCalibration(turns);
}
