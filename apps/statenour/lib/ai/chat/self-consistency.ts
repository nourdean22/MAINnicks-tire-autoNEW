/**
 * DIFFICULTY-ADAPTIVE SELF-CONSISTENCY · gated by NICK_SELF_CONSISTENCY.
 *
 * Self-consistency (arXiv 2203.11171) for HIGH-STAKES factual turns:
 * sample the SAME answer N times, extract the checkable facts (dollar
 * amounts, counts, percentages, dates) from each, and keep the sample
 * whose facts agree with the majority. A fabricated number is unlikely
 * to repeat verbatim across independent samples — the consensus answer
 * is the one whose numbers the other samples corroborate.
 *
 * Cost-aware · this is N× model calls, so the CALLER gates it (the chat
 * route fires it only on high-stakes factual turns, behind the flag).
 * This module is pure orchestration — it takes a `generate` thunk and
 * never imports a provider client, exactly like maybePreStreamRegen in
 * pre-stream-regen.ts. That keeps it LLM-agnostic + unit-testable.
 *
 * Failure philosophy · mirrors chain-of-verification.ts: this sits in
 * the user-facing chat path, so it NEVER throws. Any failure (a thrown
 * thunk, an empty sample, all samples blank) degrades to "return the
 * first usable sample". Worst case is "self-consistency was a no-op",
 * never "the chat turn broke".
 *
 * Fact extraction reuses fact-check.ts's `factCheck` extractors so the
 * notion of "a checkable claim" is identical to the surfacing tool.
 */
import "server-only";

import { factCheck, type FactClaim } from "@/lib/ai/fact-check";
import { logger as rootLogger } from "@/lib/logger";

const log = rootLogger.withSurface("ai/self-consistency");

const DEFAULT_SAMPLES = 3;
const MAX_SAMPLES = 5;
// Only these claim kinds vote — they're the fabrication-prone, exactly-
// comparable ones. Names/time-windows are too loose to majority-vote on.
const VOTING_KINDS: ReadonlySet<FactClaim["kind"]> = new Set([
  "dollar",
  "count",
  "percent",
  "date",
]);

export interface SelfConsistencyResult {
  /** The consensus answer (or the first sample when there's nothing to vote on / on failure). */
  answer: string;
  /** True only when ≥2 samples agreed on the same numeric-fact signature. */
  agreed: boolean;
  /** How many usable (non-empty) samples were actually drawn. */
  samples: number;
}

/**
 * Canonical, order-independent signature of a sample's voting-relevant
 * facts. We normalize each claim's value (lowercase, strip `$ , space`)
 * and sort so "$3,709 · 4 leads" and "4 leads · $3709" hash identically.
 * Empty signature ("") = the sample carried no numeric claim → it can't
 * vote and can't be voted against.
 */
function factSignature(answer: string): string {
  // factCheck's 2nd arg is the brain context used only to set `verified`;
  // we don't care about verification here, only extraction, so pass "".
  const claims = factCheck(answer, "");
  const tokens = claims
    .filter((c) => VOTING_KINDS.has(c.kind))
    .map((c) => `${c.kind}:${c.value.toLowerCase().replace(/[,$\s]+/g, "")}`);
  if (tokens.length === 0) return "";
  return Array.from(new Set(tokens)).sort().join("|");
}

/**
 * Draw N samples from `generate`, extract numeric facts from each, and
 * return the sample whose fact-signature is the plurality winner.
 *
 * Pure orchestration · no LLM calls inside — the caller supplies the
 * `generate` thunk (one model call per invocation). Graceful on every
 * path: any failure returns the first usable sample with agreed:false.
 */
export async function selfConsistentAnswer(opts: {
  generate: () => Promise<string>;
  samples?: number;
}): Promise<SelfConsistencyResult> {
  const n = Math.max(2, Math.min(MAX_SAMPLES, opts.samples ?? DEFAULT_SAMPLES));

  try {
    // Draw all samples in parallel — they're independent. A single
    // thrown thunk doesn't sink the batch; it just yields no sample.
    const drawn = await Promise.all(
      Array.from({ length: n }, async () => {
        try {
          const text = await opts.generate();
          return typeof text === "string" ? text.trim() : "";
        } catch {
          return "";
        }
      }),
    );

    const usable = drawn.filter((t) => t.length > 0);
    if (usable.length === 0) {
      // Nothing came back — let the caller's outer try/catch fall through.
      return { answer: "", agreed: false, samples: 0 };
    }
    // Only one sample survived (or only one requested) → nothing to vote.
    if (usable.length === 1) {
      return { answer: usable[0], agreed: false, samples: usable.length };
    }

    // Tally fact-signatures. Empty signatures (no numeric claim) don't
    // participate in the vote — there's nothing to corroborate.
    const tally = new Map<string, { count: number; firstIdx: number }>();
    const signatures = usable.map(factSignature);
    signatures.forEach((sig, idx) => {
      if (sig === "") return;
      const cur = tally.get(sig);
      if (cur) cur.count += 1;
      else tally.set(sig, { count: 1, firstIdx: idx });
    });

    // No numeric claims anywhere → self-consistency can't help. Honor the
    // contract: "if no numeric claims, return the first".
    if (tally.size === 0) {
      return { answer: usable[0], agreed: false, samples: usable.length };
    }

    // Plurality winner — highest count, ties broken by earliest sample.
    let bestSig = "";
    let best = { count: 0, firstIdx: Number.MAX_SAFE_INTEGER };
    for (const [sig, info] of tally) {
      if (
        info.count > best.count ||
        (info.count === best.count && info.firstIdx < best.firstIdx)
      ) {
        bestSig = sig;
        best = info;
      }
    }

    const agreed = best.count >= 2;
    const answer = usable[best.firstIdx];
    if (agreed) {
      log.info("self_consistency_consensus", {
        samples: usable.length,
        votes: best.count,
        distinctSignatures: tally.size,
      });
    } else {
      // Every signature was unique → no majority. Keep the first sample
      // (no evidence any one is more trustworthy than another).
      return { answer: usable[0], agreed: false, samples: usable.length };
    }
    return { answer, agreed, samples: usable.length };
  } catch (err) {
    // Never break the chat path — a self-consistency failure is a no-op.
    log.warn("self_consistency_failed", {
      error: err instanceof Error ? err.message.slice(0, 200) : String(err).slice(0, 200),
    });
    return { answer: "", agreed: false, samples: 0 };
  }
}
