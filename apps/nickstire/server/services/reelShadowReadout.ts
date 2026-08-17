/**
 * Reader for the reel lane's shadow-judge corpus.
 *
 * WHY THIS EXISTS. `dailyReelPost.ts` has called `judgeSingleConcept` on every
 * about-to-publish reel since 2026-08-13 (NT-001) and written the verdict to
 * `shop_settings` under `reel_shadow_judge_<jobId>`. Nothing ever read it. Grep
 * found exactly two references to that key, both in the file that writes it, and
 * the only read is `if (!alreadyJudged)` — a boolean dedupe marker, not a
 * measurement. The image lane's equivalent corpus HAS a reader
 * (`scripts/ig-dual-judge-readout.ts`), whose opening line names this exact
 * failure mode: a dataset nothing reads.
 *
 * The decision this must inform: the image lane went shadow (2026-08-05) to gate
 * (2026-08-07) on a measured 5/25 blind-spot readout. The reel lane cannot walk
 * that path without the same statistic, so the judge call is currently being
 * paid for and discarded.
 *
 * TWO PROPERTIES OF THE CORPUS THAT CHANGE HOW IT MUST BE READ:
 *
 * 1. IT IS CONDITIONED, NOT A BASE RATE. The judge runs AFTER
 *    `evaluateReelPublishGate` has already allowed the reel — a held reel never
 *    reaches the judge at all. So every row is "a reel rendered-QA approved for
 *    autonomous publish". That is the right conditioning for a blind-spot
 *    measurement and the WRONG conditioning for "how good are our reels" — the
 *    readout must say so out loud or the number will be misread as the latter.
 *
 * 2. A MISSING VERDICT IS NOT A BLOCK. `shadowJudgeGate` fails CLOSED (no
 *    verdict means block) because it guards an unattended publisher. The reel
 *    shadow lane fails OPEN on purpose: a judge error must not hold a reel that
 *    rendered-QA already passed. Reusing the gate predicate directly would
 *    therefore score every Ollama timeout as a quality blind spot and inflate
 *    the very statistic the flip decision rests on. Errored/absent rows get
 *    their own bucket and are never folded into either side.
 */
import { JUDGE_GATE_MIN_TOTAL, shadowJudgeGate } from "./igJudgeGate";

/** One parsed `reel_shadow_judge_<jobId>` row. */
export interface ReelShadowJudgeRow {
  jobId: number;
  /** Present from the enrichment onward; rows written before it lack these. */
  briefId?: string | null;
  topic?: string | null;
  total: number;
  rejected: boolean;
  note?: string | null;
  at?: string | null;
}

/** One parsed `reel_qc_checklist_<jobId>` row. */
export interface ReelShadowQcRow {
  jobId: number;
  passCount: number;
  failCount: number;
  at?: string | null;
}

/** Outcome for a judged job, read from `reel_jobs` — never copied into KV. */
export interface ReelJobOutcome {
  jobId: number;
  status: string;
  igPostId?: string | null;
  /** Required for coverage: it is what proves the reel was judge-ELIGIBLE. */
  briefId?: string | null;
}

/**
 * NT-001 shipped the reel shadow judge on 2026-08-13. A reel posted before that
 * could never carry a verdict, so counting it as a coverage gap invents one.
 */
export const SHADOW_JUDGE_ROLLOUT_DATE = "2026-08-13";

/**
 * `dailyReelPost` publishes ONLY the job it enqueued for the day:
 * `where(eq(reelJobs.briefId, "autopost-" + date))`. The shadow judge lives
 * inside that same function, so this prefix IS the eligibility test — a reel
 * published through any other path (`routes/adminRoutes.ts` operator publish,
 * `routers/content.ts`) never reaches the judge, and `contentManufacturing` also
 * enqueues with source "cron" while publishing elsewhere, which is why `source`
 * is NOT the right signal here.
 *
 * The date is parsed from the briefId rather than a timestamp column on purpose:
 * `updatedAt` is `onUpdateNow` and would drift if anything touched the row, and
 * `createdAt` is enqueue time, not publish time. The briefId's date is immutable
 * and is the reel's own calendar day.
 */
const AUTOPOST_BRIEF_ID = /^autopost-(\d{4}-\d{2}-\d{2})$/;

export type EligibilityReason =
  | "eligible"
  | "not_posted"
  | "other_publish_path"
  | "before_rollout";

/**
 * Was this posted reel ever capable of carrying a shadow verdict? Returns the
 * REASON as well as the verdict so the readout can show what it filtered out —
 * a silent filter on a coverage denominator is the same class of defect as the
 * silent gap coverage exists to expose.
 */
export function shadowJudgeEligibility(
  outcome: ReelJobOutcome,
  rolloutDate: string = SHADOW_JUDGE_ROLLOUT_DATE,
): { eligible: boolean; reason: EligibilityReason } {
  if (isPublished(outcome) !== true) return { eligible: false, reason: "not_posted" };
  const m = AUTOPOST_BRIEF_ID.exec(outcome.briefId ?? "");
  if (!m) return { eligible: false, reason: "other_publish_path" };
  if (m[1] < rolloutDate) return { eligible: false, reason: "before_rollout" };
  return { eligible: true, reason: "eligible" };
}

export type ShadowVerdictBucket = "would_block" | "clear" | "no_verdict";

export interface ReelShadowRow {
  jobId: number;
  label: string;
  bucket: ShadowVerdictBucket;
  total: number | null;
  rejected: boolean;
  /** Hard reject and sub-threshold are qualitatively different blocks. */
  blockKind: "hard_reject" | "below_threshold" | null;
  reason: string;
  qcFailCount: number | null;
  published: boolean | null;
  note: string | null;
}

export interface ReelShadowSummary {
  /** Rows carrying a usable verdict — the denominator for every rate below. */
  judged: number;
  wouldBlock: number;
  clear: number;
  /** Judge errored or never ran. Disclosed, never counted as either side. */
  noVerdict: number;
  hardRejects: number;
  belowThreshold: number;
  /** Of the would-block set, how many actually reached Instagram. */
  wouldBlockAndPublished: number;
  /** null when nothing was judged — a rate over zero rows is not zero. */
  blindSpotRate: number | null;
  totals: { mean: number | null; median: number | null; min: number | null; max: number | null };
  /**
   * Does the free deterministic QC checklist already flag what the LLM judge
   * flags? High agreement means the cheap check could gate at zero LLM cost.
   */
  qcAgreement: { comparable: number; bothFlagged: number; judgeOnly: number; qcOnly: number } | null;
  /**
   * Judge coverage over reels that actually posted.
   *
   * This is the field that keeps the whole readout honest. When the judge
   * throws, `dailyReelPost` writes NOTHING — deliberately, so the next tick
   * retries — which means a judge failing repeatedly does not appear above as a
   * `noVerdict` row. It appears as a SMALLER CORPUS, silently, and a small
   * corpus with no blocks in it reads as an all-clear. A posted reel with no
   * verdict row was never judged at all.
   *
   * The denominator is ELIGIBLE posted reels only — see `shadowJudgeEligibility`.
   * Counting every historically posted reel would have fabricated a coverage gap
   * out of reels that predate the judge or published through a path it does not
   * sit in, which is the same lie in the opposite direction. `excluded` reports
   * what the filter removed, so the filter itself is never silent.
   *
   * null when no outcome rows were supplied: coverage is then unknown, not full.
   */
  coverage: {
    published: number;
    withVerdict: number;
    withoutVerdict: number;
    excluded: { beforeRollout: number; otherPublishPath: number };
  } | null;
  rows: ReelShadowRow[];
}

const mean = (xs: number[]): number | null =>
  xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;

const median = (xs: number[]): number | null => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/** A verdict row is unusable if the judge lane recorded a failure or no score. */
function isUsable(row: ReelShadowJudgeRow): boolean {
  return typeof row.total === "number" && Number.isFinite(row.total);
}

/** `reel_jobs.status` values that mean the reel reached Instagram. */
export function isPublished(outcome: ReelJobOutcome | undefined): boolean | null {
  if (!outcome) return null;
  if (outcome.status === "posted") return true;
  // publish_ambiguous is genuinely unknown — it may be live. Never claim false.
  if (outcome.status === "publish_ambiguous") return null;
  return false;
}

export function summarizeReelShadow(input: {
  judge: ReelShadowJudgeRow[];
  qc?: ReelShadowQcRow[];
  outcomes?: ReelJobOutcome[];
  /** Override only in tests. Defaults to the NT-001 ship date. */
  rolloutDate?: string;
}): ReelShadowSummary {
  const qcById = new Map((input.qc ?? []).map((r) => [r.jobId, r]));
  const outcomeById = new Map((input.outcomes ?? []).map((r) => [r.jobId, r]));

  const rows: ReelShadowRow[] = input.judge
    .slice()
    .sort((a, b) => a.jobId - b.jobId)
    .map((r) => {
      const qc = qcById.get(r.jobId);
      const qcFailCount = qc ? qc.failCount : null;
      const published = isPublished(outcomeById.get(r.jobId));
      const label = r.topic?.trim() || r.briefId?.trim() || `job ${r.jobId}`;

      if (!isUsable(r)) {
        return {
          jobId: r.jobId,
          label,
          bucket: "no_verdict" as const,
          total: null,
          rejected: false,
          blockKind: null,
          reason: "judge recorded no usable score — the shadow lane fails OPEN, so this is not a block",
          qcFailCount,
          published,
          note: r.note ?? null,
        };
      }

      // The canonical predicate, imported rather than re-derived. `true` is the
      // judge-enabled arm; the disabled arm answers a different question.
      const decision = shadowJudgeGate(
        { total: r.total, rejected: r.rejected, note: r.note ?? "" },
        true,
      );
      return {
        jobId: r.jobId,
        label,
        bucket: decision.block ? ("would_block" as const) : ("clear" as const),
        total: r.total,
        rejected: r.rejected,
        blockKind: decision.block
          ? r.rejected
            ? ("hard_reject" as const)
            : ("below_threshold" as const)
          : null,
        reason: decision.reason,
        qcFailCount,
        published,
        note: r.note ?? null,
      };
    });

  const usable = rows.filter((r) => r.bucket !== "no_verdict");
  const blocking = usable.filter((r) => r.bucket === "would_block");
  const totals = usable.map((r) => r.total as number);

  const comparable = usable.filter((r) => r.qcFailCount !== null);
  const qcAgreement = comparable.length
    ? {
        comparable: comparable.length,
        bothFlagged: comparable.filter(
          (r) => r.bucket === "would_block" && (r.qcFailCount as number) > 0,
        ).length,
        judgeOnly: comparable.filter(
          (r) => r.bucket === "would_block" && (r.qcFailCount as number) === 0,
        ).length,
        qcOnly: comparable.filter(
          (r) => r.bucket === "clear" && (r.qcFailCount as number) > 0,
        ).length,
      }
    : null;

  // Coverage is computed over ALL supplied outcomes, not just judged ones —
  // that asymmetry is the entire point. Callers pass every posted reel; the ones
  // absent from `judge` are the invisible judge failures.
  const judgedIds = new Set(input.judge.map((r) => r.jobId));
  const graded = (input.outcomes ?? []).map((o) => ({
    o,
    ...shadowJudgeEligibility(o, input.rolloutDate),
  }));
  const eligible = graded.filter((g) => g.eligible).map((g) => g.o);
  const coverage = input.outcomes?.length
    ? {
        published: eligible.length,
        withVerdict: eligible.filter((o) => judgedIds.has(o.jobId)).length,
        withoutVerdict: eligible.filter((o) => !judgedIds.has(o.jobId)).length,
        excluded: {
          beforeRollout: graded.filter((g) => g.reason === "before_rollout").length,
          otherPublishPath: graded.filter((g) => g.reason === "other_publish_path").length,
        },
      }
    : null;

  return {
    judged: usable.length,
    wouldBlock: blocking.length,
    clear: usable.length - blocking.length,
    noVerdict: rows.length - usable.length,
    hardRejects: blocking.filter((r) => r.blockKind === "hard_reject").length,
    belowThreshold: blocking.filter((r) => r.blockKind === "below_threshold").length,
    wouldBlockAndPublished: blocking.filter((r) => r.published === true).length,
    blindSpotRate: usable.length ? blocking.length / usable.length : null,
    totals: {
      mean: mean(totals),
      median: median(totals),
      min: totals.length ? Math.min(...totals) : null,
      max: totals.length ? Math.max(...totals) : null,
    },
    qcAgreement,
    coverage,
    rows,
  };
}

/** Parse a `reel_shadow_judge_<jobId>` KV pair. Returns null for a non-matching key. */
export function parseJudgeRow(key: string, value: string | null): ReelShadowJudgeRow | null {
  const m = /^reel_shadow_judge_(\d+)$/.exec(key);
  if (!m || !value) return null;
  try {
    const v = JSON.parse(value) as Partial<ReelShadowJudgeRow>;
    return {
      jobId: Number(m[1]),
      briefId: v.briefId ?? null,
      topic: v.topic ?? null,
      total: typeof v.total === "number" ? v.total : Number.NaN,
      rejected: v.rejected === true,
      note: v.note ?? null,
      at: v.at ?? null,
    };
  } catch {
    // A row that will not parse is a row with NO verdict, not a passing row.
    return {
      jobId: Number(m[1]),
      total: Number.NaN,
      rejected: false,
      note: "unparseable KV value",
      at: null,
    };
  }
}

/** Parse a `reel_qc_checklist_<jobId>` KV pair. Returns null for a non-matching key. */
export function parseQcRow(key: string, value: string | null): ReelShadowQcRow | null {
  const m = /^reel_qc_checklist_(\d+)$/.exec(key);
  if (!m || !value) return null;
  try {
    const v = JSON.parse(value) as Partial<ReelShadowQcRow>;
    if (typeof v.failCount !== "number") return null;
    return {
      jobId: Number(m[1]),
      passCount: typeof v.passCount === "number" ? v.passCount : 0,
      failCount: v.failCount,
      at: v.at ?? null,
    };
  } catch {
    return null;
  }
}

export function formatReelShadowReadout(s: ReelShadowSummary): string[] {
  const pct = (n: number, d: number) => (d ? `${((n / d) * 100).toFixed(1)}%` : "n/a");
  const num = (v: number | null) => (v === null ? "n/a" : v.toFixed(1));
  const out: string[] = [];

  out.push("REEL SHADOW-JUDGE READOUT");
  out.push("");
  out.push("CONDITIONING — read this before the numbers:");
  out.push("  Every row below is a reel that ALREADY cleared the rendered-QA publish gate.");
  out.push("  A held reel never reaches the judge, so this is a BLIND-SPOT rate, not a");
  out.push("  quality base rate. It answers exactly one question: of the reels rendered-QA");
  out.push("  approved for autonomous publish, how many would an independent judge block?");
  out.push("");
  out.push(`judged rows ............................. ${s.judged}`);
  out.push(`  would block ........................... ${s.wouldBlock}  (${pct(s.wouldBlock, s.judged)})`);
  out.push(`    hard reject ......................... ${s.hardRejects}`);
  out.push(`    below ${JUDGE_GATE_MIN_TOTAL} ............................ ${s.belowThreshold}`);
  out.push(`  clear ................................. ${s.clear}`);
  out.push(`no verdict (judge lane failed / never ran) ... ${s.noVerdict}`);
  out.push("  Counted as NEITHER side: the reel shadow lane fails OPEN by design, so an");
  out.push("  Ollama timeout is an infra gap, not a quality finding.");
  out.push("");
  out.push(`already published while would-block ..... ${s.wouldBlockAndPublished}`);
  out.push("  This is the realized exposure — posts live on the feed that the judge");
  out.push("  would have stopped. It is the cost of NOT flipping.");
  out.push("");
  out.push(
    `score  mean ${num(s.totals.mean)} · median ${num(s.totals.median)} · min ${num(s.totals.min)} · max ${num(s.totals.max)}`,
  );
  out.push("  A cluster just under the threshold argues for tuning it; a long low tail");
  out.push("  argues for the gate.");

  out.push("");
  if (s.coverage) {
    const c = s.coverage;
    out.push(`JUDGE COVERAGE over ELIGIBLE posted reels ... ${c.withVerdict}/${c.published} (${pct(c.withVerdict, c.published)})`);
    out.push(`  Eligible = briefId 'autopost-<date>' (the only jobs dailyReelPost publishes,`);
    out.push(`  and the judge lives inside it) with that date on/after the rollout`);
    out.push(`  ${SHADOW_JUDGE_ROLLOUT_DATE}. Excluded as never-eligible:`);
    out.push(`    posted before rollout ..... ${c.excluded.beforeRollout}`);
    out.push(`    other publish path ........ ${c.excluded.otherPublishPath}`);
    out.push("  Those are stated rather than dropped quietly: counting them would invent a");
    out.push("  coverage gap, and hiding them would conceal how narrow this denominator is.");
    if (c.withoutVerdict > 0) {
      out.push(`  ${c.withoutVerdict} ELIGIBLE posted reel(s) carry NO verdict row at all.`);
      out.push("  A judge that throws writes nothing, so those reels were never judged —");
      out.push("  they are missing from every number above rather than counted in it. Until");
      out.push("  this reaches 0, treat the blind-spot rate as a rate over the reels the");
      out.push("  judge MANAGED to score, not over the reels that published.");
    } else if (c.published > 0) {
      out.push("  Every eligible posted reel carries a verdict — that sample is complete.");
    } else {
      out.push("  NO eligible posted reels yet, so coverage proves nothing either way.");
    }
  } else {
    out.push("JUDGE COVERAGE ... not supplied. Coverage is UNKNOWN, not complete: pass");
    out.push("  the posted reel_jobs rows (WITH briefId) to detect reels that published");
    out.push("  unjudged.");
  }

  if (s.qcAgreement) {
    const q = s.qcAgreement;
    out.push("");
    out.push(`QC-CHECKLIST AGREEMENT (over ${q.comparable} rows carrying both signals)`);
    out.push(`  both flagged .......... ${q.bothFlagged}`);
    out.push(`  judge only ............ ${q.judgeOnly}   <- what the free deterministic check CANNOT see`);
    out.push(`  QC only ............... ${q.qcOnly}`);
    out.push("  If judgeOnly is ~0 the free checklist already covers the judge and could");
    out.push("  gate at zero LLM cost. If it is large, the LLM judge is earning its call.");
  } else {
    out.push("");
    out.push("QC-CHECKLIST AGREEMENT ... no rows carry both signals yet.");
  }

  if (!s.judged) {
    out.push("");
    out.push("NOTHING JUDGED. That is an unknown, not a clean result — check whether");
    out.push("IG_SHADOW_JUDGE is false, whether any reel has reached the publish stage,");
    out.push("and whether the judge lane is erroring (see the noVerdict count above).");
  }
  return out;
}
