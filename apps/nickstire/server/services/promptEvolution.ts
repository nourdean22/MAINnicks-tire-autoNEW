/**
 * Prompt evolution service (2026-08-06) — the gated-edit loop as a callable,
 * extracted from scripts/prompt-evolve.ts so the weekly cron and the manual
 * CLI run the SAME code path.
 *
 * Mechanism (SkillOpt-shaped, #1400): real failed calls with vaulted
 * transcripts → deterministic train/holdout split → ghost-replay baseline →
 * optimizer proposes bounded candidate prompts (different model family) →
 * invariant guard → train selection → paired permutation-test holdout gate
 * (promptEvolutionGate.ts — repeated replays, regression veto). Output is a
 * serializable result; persistence and notification are the caller's job.
 * Nothing here ever writes the served prompt — Push Config stays the one
 * serving gate.
 *
 * WIRED 2026-10-09 (autoresearch audit, ledger items 2-7). What changed, and
 * why each piece sits where it does:
 *  - BASELINE. runPromptEvolution takes an explicit baseline artifact
 *    (receptionistBaseline.ts) and no longer imports ASSISTANT_SYSTEM_PROMPT.
 *    The weekly job passes the LIVE prompt (code + learned lessons as served);
 *    the CLI passes the repository constant only behind an explicit flag. The
 *    optimizer edits baseline.prompt, every baseline arm replays
 *    baseline.prompt, and the policy guard reads candidate vs baseline.prompt,
 *    so all three compare against the text callers hear. The operator gets a
 *    compact line diff (candidateDiff) to apply as a code edit + Push Config.
 *  - LANES. The replay lane (REPLAY_LANE) is not the live lane; every result
 *    records describeLaneParity so a reader sees "proxy lane", never a claim
 *    of parity the run did not have.
 *  - GRADING COST. Train scoring uses verifyHits: false (train only picks
 *    which candidate reaches a gate); holdout, success cohort and confirmation
 *    scoring verify hits. Replays and judge calls are counted into usage.
 *  - TRAIN SELECTION. comparePairedTrain margins on the same seeds, never
 *    passRate vs passRate over each prompt's own denominator.
 *  - STAGES. holdout (judgeHoldout) -> success cohort of WON calls
 *    (judgeSuccessCohort, evaluator-only, loaded only after the holdout
 *    accepts and after the optimizer has run) -> sealed confirmation
 *    (judgeConfirmation on promptEvolutionCohorts' confirm buckets, read from
 *    a larger failed-call pool than train/holdout, minus the seeds earlier
 *    runs consumed, at most CONFIRM_MAX). The runner never writes kv: it hands
 *    the sealed ids to the caller's onConfirmationSpend hook BEFORE reading
 *    them (write-ahead, so a throw mid-confirmation cannot lose them) and
 *    returns them in consumedConfirmationIds.
 *  - DIFF. candidateDiff.codeEdit says whether the candidate kept the served
 *    lessons block verbatim at its end, i.e. whether it can be applied as a
 *    code edit + Push Config at all without serving a different text from
 *    the one measured.
 *  - REDACTION. Caller words reach the optimizer only through
 *    redactCallerText + fenceUntrusted, with UNTRUSTED_DATA_NOTICE in the
 *    system message; the optimizer's rationale is redacted before it is
 *    stored or sent anywhere.
 *  - BUDGET. opts.deadlineMs is checked before every stage and every seed; a
 *    run past it returns "inconclusive-budget" with what it measured so far.
 */
import { createHash } from "node:crypto";
import { invokeLLM } from "../_core/llm";
import { fenceUntrusted, redactCallerText, UNTRUSTED_DATA_NOTICE } from "./callerTextRedaction";
import {
  extractCallerTurns,
  ghostReplay,
  gradeReplies,
  gradeRepliesWithJudge,
  RESOLUTION_RX,
  violatedInvariants,
  type ReplayBudget,
} from "./ghostReplay";
import { excludeConsumed, selectSuccessCohort, splitSeedsThreeWay } from "./promptEvolutionCohorts";
import {
  comparePairedTrain,
  describeSuccessVerdict,
  describeVerdict,
  judgeConfirmation,
  judgeHoldout,
  judgeSuccessCohort,
  minSeedsForAlpha,
  toSeedTrials,
  toSuccessTrials,
  type GateVerdict,
  type SuccessCohortVerdict,
} from "./promptEvolutionGate";
import type { PromptParity, ReceptionistBaseline, ReceptionistLane, ReplayLane } from "./receptionistBaseline";
import { RESOLUTION_JUDGE_MODEL } from "./resolutionJudge";

const OPTIMIZER_MODEL = process.env.PROMPT_EVOLVE_OPTIMIZER || "gpt-oss:120b";
/**
 * The evaluation protocol a receipt names (its contractHash). Bump it when a
 * gate's meaning changes, so two receipts are comparable only when they were
 * judged the same way. 2026-10-09: live baseline, paired train selection,
 * holdout + success cohort + sealed confirmation, hit verification.
 */
const PROTOCOL_VERSION = "prompt-evolution/2026-10-09";
/** Characters of one caller turn the optimizer sees, after redaction. */
const CALLER_EXCERPT_MAX = 140;
/** Characters of the optimizer's rationale kept, after redaction (the receipt's own cap). */
const RATIONALE_MAX = 400;
/** One-sided alpha every gate here runs at (promptEvolutionGate's default). */
const GATE_ALPHA = 0.05;
/**
 * candidateDiff caps: lines per side, characters per line, and characters per
 * side (2026-10-09 review). The diff rides in the prompt_evolution_latest kv
 * row next to the full candidate, and shop_settings.value is TEXT (65,535
 * bytes). Lines and line length alone allowed ~18k characters per side on the
 * served prompt (27k characters, 28 lines over 300): a two-touch edit spans
 * the whole prompt and put the row at 57k-61k bytes, ~13% under the column.
 * DIFF_MAX_CHARS bounds the diff at ~12k whatever the prompt's shape; the full
 * candidate is always in accepted.prompt.
 */
const DIFF_MAX_LINES = 80;
const DIFF_MAX_LINE = 300;
const DIFF_MAX_CHARS = 6000;
/**
 * Failed calls read to find sealed confirmation seeds (2026-10-09 review).
 * The confirm buckets are 20% of any pool, so the train/holdout sample
 * (seedCount, clamped to 40; the weekly job reads 30) holds the 5 seeds a
 * confirmation needs only ~75% of the time, and fewer once earlier runs have
 * consumed some (promptEvolutionCohorts.ts, SIZE). Membership is a hash of the
 * call id, independent of pool size, so this larger read moves no train or
 * holdout seed and never hands the optimizer a sealed one.
 */
const CONFIRM_POOL_SEEDS = 90;
/**
 * Sealed seeds one confirmation spends, at most: minSeedsForAlpha(0.05) = 5
 * plus room for seeds the judge rules unresolvable. Sealed seeds are the
 * scarce input, so a confirmation spends no more than it needs (most recent first).
 */
const CONFIRM_MAX = 8;

export interface Seed {
  id: string;
  callerTurns: string[];
  evalOutcome: string;
  summary: string | null;
  /**
   * Revenue-truth annotation (2026-08-07): the latest reconciliation verdict
   * for this call, or null when none exists. 'manual_review' = an INFERRED
   * phone+time invoice match (conf 0.75) — kept as a seed but annotated,
   * because a converted 'callback_needed' call converted via the HUMAN lane
   * and the AI leg still failed: the best near-misses.
   */
  revenueResolution: string | null;
}

export interface SeedLoad {
  seeds: Seed[];
  /**
   * Calls dropped because their conversion is VERIFIED — auto 'attributed'
   * (unique lead→paid-invoice link) or an operator decision confirmed with an
   * invoice. eval_outcome never consults invoices (classifyCall grants
   * conversion only on persisted lead/callback/booking ids), so
   * 'lost_opportunity' can be a mislabeled win — training the optimizer on
   * wins poisons it. Only PROVEN wins are removed; unproven losses stay.
   */
  excludedVerified: number;
}

/** One seed's grade under one prompt (ghostReplay.ReplayGrade, plus the seed id). */
export interface ScoredGrade {
  id: string;
  pass: boolean;
  priceLeaks: number;
  resolutionOffered: boolean;
  guarantees: number;
  emptyReplies: number;
  /** replayPolicy claim labels (ReplayGrade.claimViolations); any entry fails the grade. */
  claimViolations: string[];
  /** The judge ruled the next step generic, ignoring what the caller asked. */
  deflected?: boolean;
  replies?: string[];
  unresolvable?: boolean;
  judgeReason?: string;
  judgeUnavailable?: boolean;
}

export interface ScoredPrompt {
  passRate: number;
  /** Seeds the judge ruled impossible — excluded from `total`, reported honestly. */
  unresolvable?: number;
  passes: number;
  total: number;
  grades: ScoredGrade[];
  /** What this scoring cost: one replay per seed, and every judge call gradeRepliesWithJudge made. */
  usage: { replays: number; judgeCalls: number };
}

export async function loadSeeds(seedCount: number, filterRx?: RegExp | null): Promise<SeedLoad> {
  const { getDb } = await import("../db");
  const d = await getDb();
  if (!d) throw new Error("no DB");
  const { sql } = await import("drizzle-orm");
  // Revenue-truth join (2026-08-07): CONSUME the incumbent reconciliation
  // product, never rebuild the phone join — revenue_reconciliation_candidates
  // is written every ≤2h by dashboardSync via buildCallInvoiceCandidates
  // (lead-link = 'attributed'/verified; phone+time-only = 'manual_review'
  // conf 0.75), and revenue_attribution_decisions carries the operator's
  // ruling (current_slot=1), which overrides the auto-candidate in EITHER
  // direction. Keyed on the numeric log id (candidates key on
  // vapi_call_logs.id, not the VAPI string id). Latest-per-call shape mirrors
  // routers/revenueAttribution.ts reviewQueue.
  const [raw] = await d.execute(sql`
    SELECT a.vapi_call_id AS id, a.transcript, l.eval_outcome AS evalOutcome, l.aiSummary AS summary,
           rc.resolution AS revenueResolution, d.decision AS operatorDecision, d.invoice_id AS decisionInvoiceId
    FROM vapi_call_archives a
    JOIN vapi_call_logs l ON l.vapiCallId = a.vapi_call_id
    LEFT JOIN (
      SELECT c.call_id, c.resolution
      FROM revenue_reconciliation_candidates c
      INNER JOIN (
        SELECT call_id, MAX(created_at) AS latest_created_at
        FROM revenue_reconciliation_candidates
        GROUP BY call_id
      ) latest ON latest.call_id = c.call_id AND latest.latest_created_at = c.created_at
    ) rc ON rc.call_id = l.id
    LEFT JOIN revenue_attribution_decisions d ON d.call_id = l.id AND d.current_slot = 1
    WHERE a.transcript IS NOT NULL
      AND l.eval_outcome IN ('lost_opportunity','callback_needed')
    ORDER BY a.started_at DESC
    LIMIT ${seedCount * 3}
  `);
  const rows = raw as unknown as Array<{
    id: string; transcript: string; evalOutcome: string; summary: string | null;
    revenueResolution: string | null; operatorDecision: string | null; decisionInvoiceId: number | null;
  }>;
  // Verified-only exclusion, operator ruling first: a 'rejected' decision
  // UN-excludes an auto-'attributed' candidate; a 'confirmed' decision with
  // an invoice excludes regardless of the candidate.
  const isVerifiedConversion = (r: (typeof rows)[0]): boolean => {
    if (r.operatorDecision != null) return r.operatorDecision === "confirmed" && r.decisionInvoiceId != null;
    return r.revenueResolution === "attributed";
  };
  const excludedVerified = rows.filter(isVerifiedConversion).length;
  const seeds = rows
    .filter((r) => !isVerifiedConversion(r))
    .map((r) => ({
      id: r.id, callerTurns: extractCallerTurns(r.transcript), evalOutcome: r.evalOutcome,
      summary: r.summary, revenueResolution: r.revenueResolution,
    }))
    .filter((s) => s.callerTurns.length >= 2 && s.callerTurns.length <= 10)
    .filter((s) => !filterRx || filterRx.test(s.callerTurns.join("\n")))
    .slice(0, seedCount);
  return { seeds, excludedVerified };
}

/**
 * The outcomes classifyCall treats as a WIN. Read by the success audit only —
 * never by loadSeeds, and never by the optimizer.
 */
export const SUCCESS_OUTCOMES = ["hard_conversion", "walk_in_directed", "human_handoff", "resolved_info"] as const;

/**
 * WIDEN THE APERTURE (2026-08-07) — replay calls the classifier called a WIN.
 *
 * Every defect this loop has found so far came from calls already labeled a
 * failure: it can only ever find what we already knew went wrong. Measured the
 * same day: of 2,509 classified calls, 248 are failure-labeled and only 57 of
 * those have a vaulted transcript — while 538 hard_conversion, 445
 * walk_in_directed and 700 human_handoff calls were never examined at all.
 * A call can convert DESPITE a bad turn, and a compliance breach inside a
 * won call is exactly the defect nobody is looking for.
 *
 * ★ These seeds are an AUDIT and EVALUATOR sample, NOT training data. A won
 * call is a mislabeled-win risk of the #1410 class, and feeding "fix this"
 * edits from calls that worked is how an optimizer learns to break what
 * already converts. Since 2026-10-09 runPromptEvolution loads them for ONE
 * purpose: the success-regression cohort (judgeSuccessCohort), replayed under
 * both prompts AFTER the optimizer has run, so a won call can veto a
 * candidate but can never shape one. Pinned structurally
 * (successAudit.test.ts) and behaviourally (promptEvolution.integration.test.ts:
 * no won-call text in any optimizer prompt).
 */
export async function loadSuccessSeeds(seedCount: number, filterRx?: RegExp | null): Promise<Seed[]> {
  const { getDb } = await import("../db");
  const d = await getDb();
  if (!d) throw new Error("no DB");
  const { sql } = await import("drizzle-orm");
  const [raw] = await d.execute(sql`
    SELECT a.vapi_call_id AS id, a.transcript, l.eval_outcome AS evalOutcome, l.aiSummary AS summary
    FROM vapi_call_archives a
    JOIN vapi_call_logs l ON l.vapiCallId = a.vapi_call_id
    WHERE a.transcript IS NOT NULL
      AND l.eval_outcome IN ('hard_conversion','walk_in_directed','human_handoff','resolved_info')
    ORDER BY a.started_at DESC
    LIMIT ${seedCount * 3}
  `);
  const rows = raw as unknown as Array<{ id: string; transcript: string; evalOutcome: string; summary: string | null }>;
  return rows
    .map((r) => ({
      id: r.id, callerTurns: extractCallerTurns(r.transcript), evalOutcome: r.evalOutcome,
      summary: r.summary, revenueResolution: null,
    }))
    .filter((s) => s.callerTurns.length >= 2 && s.callerTurns.length <= 10)
    .filter((s) => !filterRx || filterRx.test(s.callerTurns.join("\n")))
    .slice(0, seedCount);
}

/**
 * A defect found inside a call that WON. Compliance breaches are the headline:
 * they are disqualifying regardless of outcome, and a converted call that
 * quoted a banned repair price is a compliance failure the classifier scored
 * as a success.
 */
export interface SuccessAuditFinding {
  id: string;
  evalOutcome: string;
  priceLeaks: number;
  guarantees: number;
  emptyReplies: number;
  /** replayPolicy claim labels: an unapproved price, a wait estimate, an outcome promise, ... */
  claimViolations: string[];
  resolutionOffered: boolean;
  replies: string[];
  callerTurns: string[];
}

export interface SuccessAuditResult {
  audited: number;
  clean: number;
  findings: SuccessAuditFinding[];
}

/** Replay won calls and surface only the ones carrying a real defect. */
export async function auditSuccessCalls(
  prompt: string,
  seeds: Seed[],
  log: (line: string) => void = () => {},
): Promise<SuccessAuditResult> {
  const findings: SuccessAuditFinding[] = [];
  for (const s of seeds) {
    const replies = await ghostReplay(prompt, s.callerTurns, { priority: 3 });
    // The deterministic violation checks only — NOT gradeRepliesWithJudge. A
    // won call's resolution is not in question, and spending a judge call per
    // seed to re-confirm it would be measurement theatre.
    const g = gradeReplies(replies);
    // claimViolations (2026-10-09): the live voice claim guard's labels are
    // deterministic compliance checks too -- a wait estimate or an outcome
    // promise inside a won call is the same class of defect as a price leak.
    const defective = g.priceLeaks > 0 || g.guarantees > 0 || g.emptyReplies > 0 || g.claimViolations.length > 0;
    if (defective) {
      findings.push({
        id: s.id, evalOutcome: s.evalOutcome, priceLeaks: g.priceLeaks, guarantees: g.guarantees,
        emptyReplies: g.emptyReplies, claimViolations: g.claimViolations, resolutionOffered: g.resolutionOffered,
        replies, callerTurns: s.callerTurns,
      });
      log(`DEFECT in a WON call ${s.id} (${s.evalOutcome}): priceLeaks=${g.priceLeaks} guarantees=${g.guarantees} empty=${g.emptyReplies} claims=${g.claimViolations.join(",") || "none"}`);
    }
  }
  return { audited: seeds.length, clean: seeds.length - findings.length, findings };
}

export interface ScoreOptions {
  /** Keep each seed's graded replies (the CLI's dialogue display). */
  keepReplies?: boolean;
  /**
   * Ask the judge about regex HITS too (gradeRepliesWithJudge's verifyHits,
   * default true). runPromptEvolution passes false for train scoring only.
   */
  verifyHits?: boolean;
  /** Called before each seed's replay; runPromptEvolution's budget check throws from here. */
  beforeSeed?: () => void;
  /** Consulted before EVERY replay and judge call; caps each call's timeout at the time left (ghostReplay ReplayBudget). */
  budget?: ReplayBudget;
  /** Incremented in place as replays and judge calls happen, so a scoring cut short is still counted. */
  tally?: { replays: number; judgeCalls: number };
}

export async function scorePrompt(prompt: string, seeds: Seed[], opts: ScoreOptions = {}): Promise<ScoredPrompt> {
  const verifyHits = opts.verifyHits !== false;
  const usage = { replays: 0, judgeCalls: 0 };
  const grades: ScoredPrompt["grades"] = [];
  for (const s of seeds) {
    opts.beforeSeed?.();
    const replies = await ghostReplay(prompt, s.callerTurns, { priority: 3, budget: opts.budget });
    usage.replays++;
    if (opts.tally) opts.tally.replays++;
    // gradeRepliesWithJudge asks the judge on every seed when hits are
    // verified, and on a regex MISS only otherwise (its resolutionOffered is
    // exactly this test). The integration test pins the count to the judge
    // calls the mocked lane actually received.
    if (verifyHits || !RESOLUTION_RX.test(replies.join("\n"))) {
      usage.judgeCalls++;
      if (opts.tally) opts.tally.judgeCalls++;
    }
    const g = await gradeRepliesWithJudge(s.callerTurns, replies, { verifyHits, budget: opts.budget });
    grades.push({
      id: s.id, pass: g.pass, priceLeaks: g.priceLeaks, resolutionOffered: g.resolutionOffered,
      guarantees: g.guarantees, emptyReplies: g.emptyReplies, claimViolations: g.claimViolations,
      ...(g.deflected ? { deflected: true } : {}),
      ...(g.unresolvable ? { unresolvable: true } : {}),
      ...(g.judgeReason ? { judgeReason: g.judgeReason } : {}),
      ...(g.judgeUnavailable ? { judgeUnavailable: true } : {}),
      // The GRADED conversation — a display must show what was judged, not a
      // fresh sampling (MoE models re-phrase run to run; a re-sampled display
      // misled a live verification once).
      ...(opts.keepReplies ? { replies } : {}),
    });
  }
  // HONEST DENOMINATOR (2026-08-07): a call no prompt could have resolved —
  // the caller reached a wrong number or left before asking anything — is not
  // a prompt failure and must not sit in the denominator. Seed 019fd32f was
  // exactly this: two turns, "Is this Nick's Auto Parts?", gone. Counting it
  // understated every baseline and fed the optimizer an unwinnable failure.
  const graded = grades.filter((g) => !g.unresolvable);
  const passes = graded.filter((g) => g.pass).length;
  return {
    passRate: graded.length ? passes / graded.length : 0,
    passes,
    total: graded.length,
    unresolvable: grades.length - graded.length,
    grades,
    usage,
  };
}

/**
 * The failure brief the optimizer reads. Caller words are the one untrusted
 * input in it: each first turn is redacted WHOLE and then cut
 * (redactCallerText), and fenced (fenceUntrusted) so text a caller spoke can
 * neither carry a phone number out nor pass as an instruction. Calls are
 * labelled by position, not by call id: the optimizer needs no identifier.
 */
function failureBrief(trainFailures: Array<{ seed: Seed; grade: ScoredGrade }>): string {
  return trainFailures.slice(0, 6).map((f, i) => {
    const label = `call-${i + 1}`;
    const humanLane = f.seed.revenueResolution === "manual_review" ? " · likely converted later via the HUMAN lane — the AI leg still failed" : "";
    const excerpt = fenceUntrusted(label, redactCallerText(f.seed.callerTurns[0] ?? "", CALLER_EXCERPT_MAX));
    const claims = f.grade.claimViolations.length ? f.grade.claimViolations.join(",") : "none";
    return `- ${label} (${f.seed.evalOutcome}${humanLane}): caller said ${excerpt}; grade: resolution=${f.grade.resolutionOffered}${f.grade.deflected ? " (deflected)" : ""} priceLeaks=${f.grade.priceLeaks} claims=${claims}`;
  }).join("\n");
}

/**
 * Ask the optimizer for k bounded edits of `basePrompt`. Its input is the
 * prompt and the redacted, fenced failure brief -- nothing else. `beforeCall`
 * runs before every optimizer call (the run's budget check).
 */
/** A bounded edit the optimizer proposed: replace exactly one verbatim excerpt of the current prompt. */
export interface BoundedEdit {
  find: string;
  replace: string;
}

/**
 * The excerpt the optimizer may ask to replace, and how much the replacement
 * may grow it. One section, never the prompt: the live prompt is ~32,000
 * chars with single lines over 1,000 chars (vapi.ts ASSISTANT_SYSTEM_PROMPT),
 * so the cap is stated to the model in CHARACTERS, not lines (2026-10-09
 * review: "30 lines" and a 4,000-char cap contradicted each other on 111 of
 * this prompt's 140 possible 30-line windows).
 */
const EDIT_FIND_MAX_CHARS = 6000;
const EDIT_GROWTH_MAX_CHARS = 2500;
const EDIT_FIND_ASK = "usually 1 to 10 lines and never more than about 5,000 characters";

/**
 * The LAST block whose markers sit on their own lines. Prose that mentions the
 * markers ("I put the excerpt between <FIND> and </FIND> as asked") never
 * matches, so it cannot capture " and " and spend the one retry (2026-10-09
 * review). A one-line <TAG>text</TAG> is accepted only when no line-anchored
 * block exists.
 */
function lastMarkedBlock(text: string, tag: string): string | null {
  const anchored = new RegExp(`^<${tag}>[ \\t]*\\r?\\n([\\s\\S]*?)\\r?\\n<\\/${tag}>[ \\t]*$`, "gm");
  let last: string | null = null;
  for (const m of text.matchAll(anchored)) last = m[1];
  if (last !== null) return last;
  // Inline fallback only when the block IS the line: prose around the markers never counts.
  const inline = new RegExp(`^<${tag}>([^\n]*?)<\/${tag}>[ \t]*$`, "gm");
  for (const m of text.matchAll(inline)) last = m[1];
  return last;
}

/**
 * What the optimizer answered, in order of preference: a bounded edit, or a
 * whole prompt (the pre-2026-10-09 contract, still accepted when a model
 * insists on re-emitting everything), or nothing usable.
 */
export function parseOptimizerReply(text: string): { rationale: string | null; edit: BoundedEdit | null; whole: string | null } {
  const rationale = /RATIONALE:\s*(.+)/.exec(text)?.[1]?.trim() ?? null;
  const find = lastMarkedBlock(text, "FIND");
  const replace = lastMarkedBlock(text, "REPLACE");
  const edit = find !== null && replace !== null && find.trim().length > 0 ? { find, replace } : null;
  const whole = lastMarkedBlock(text, "PROMPT")?.trim() ?? null;
  return { rationale, edit, whole: whole && whole.length > 200 ? whole : null };
}

/**
 * Apply one bounded edit to the full prompt. The excerpt must occur EXACTLY
 * once: first verbatim, then with every line trimmed (a model reflows
 * indentation and trailing spaces, never words). Zero or several occurrences
 * return null with the reason: an edit the code cannot place is not a
 * candidate. The result keeps every other character of the prompt, which is
 * the whole point: the 2026-10-09 live runs rejected both candidates before
 * replay because the optimizer, asked to re-emit a 32,000-character prompt,
 * dropped 24 and 5 compliance clauses on the way.
 */
export function applyBoundedEdit(prompt: string, edit: BoundedEdit): { prompt: string } | { refused: string } {
  if (edit.find.length > EDIT_FIND_MAX_CHARS) return { refused: `find excerpt is ${edit.find.length} chars; the cap is ${EDIT_FIND_MAX_CHARS}` };
  if (edit.replace.length > edit.find.length + EDIT_GROWTH_MAX_CHARS) return { refused: `replacement grows the section by ${edit.replace.length - edit.find.length} chars; the cap is ${EDIT_GROWTH_MAX_CHARS}` };
  const base = prompt.replace(/\r\n/g, "\n");
  const find = edit.find.replace(/\r\n/g, "\n");
  const replace = edit.replace.replace(/\r\n/g, "\n");

  const exact = occurrences(base, find);
  if (exact.length === 1) return { prompt: base.slice(0, exact[0]) + replace + base.slice(exact[0] + find.length) };
  if (exact.length > 1) return { refused: `find excerpt occurs ${exact.length} times; it must be unique` };

  // Line-trimmed match: the same lines, indentation and trailing spaces aside.
  const baseLines = base.split("\n");
  const findLines = find.split("\n").map((l) => l.trim());
  while (findLines.length && findLines[0] === "") findLines.shift();
  while (findLines.length && findLines[findLines.length - 1] === "") findLines.pop();
  if (!findLines.length) return { refused: "find excerpt is blank" };
  const starts: number[] = [];
  for (let i = 0; i + findLines.length <= baseLines.length; i++) {
    let ok = true;
    for (let j = 0; j < findLines.length; j++) {
      if (baseLines[i + j].trim() !== findLines[j]) { ok = false; break; }
    }
    if (ok) starts.push(i);
  }
  if (starts.length === 0) return { refused: "find excerpt not found in the current prompt (verbatim or line-trimmed)" };
  if (starts.length > 1) return { refused: `find excerpt matches ${starts.length} places line-trimmed; it must be unique` };
  const at = starts[0];
  const out = [...baseLines.slice(0, at), ...replace.split("\n"), ...baseLines.slice(at + findLines.length)];
  return { prompt: out.join("\n") };
}

function occurrences(haystack: string, needle: string): number[] {
  const out: number[] = [];
  let i = haystack.indexOf(needle);
  while (i !== -1 && out.length < 3) {
    out.push(i);
    i = haystack.indexOf(needle, i + 1);
  }
  return out;
}

const OPTIMIZER_FORMAT =
  'Output format, nothing else: one line "RATIONALE: <why this one edit>", then the excerpt to change between <FIND> and </FIND> ' +
  `(each marker on its own line; copy the excerpt from CURRENT PROMPT verbatim, keeping its line breaks, ${EDIT_FIND_ASK}, enough to be unique), ` +
  "then its replacement between <REPLACE> and </REPLACE>. " +
  "To add a rule, put the line it follows in FIND and that same line plus the new rule in REPLACE. " +
  "Never emit the whole prompt: every character outside FIND is kept exactly as it is.";

async function proposeCandidates(
  basePrompt: string,
  trainFailures: Array<{ seed: Seed; grade: ScoredGrade }>,
  k: number,
  log: (line: string) => void,
  beforeCall: () => void,
): Promise<Array<{ prompt: string; rationale: string }>> {
  const out: Array<{ prompt: string; rationale: string }> = [];
  const brief = failureBrief(trainFailures);
  const resolve = (text: string): { prompt: string; rationale: string } | { refused: string } => {
    const parsed = parseOptimizerReply(text);
    const rationale = redactCallerText(parsed.rationale ?? "(no rationale emitted)", RATIONALE_MAX);
    if (parsed.edit) {
      const applied = applyBoundedEdit(basePrompt, parsed.edit);
      if ("refused" in applied) return { refused: applied.refused };
      // An edit that changes nothing (REPLACE equal to FIND, or indentation
      // only) would be replayed at full cost and read as margin 0.
      if (applied.prompt.replace(/\s+/g, " ") === basePrompt.replace(/\s+/g, " ")) return { refused: "the edit changes nothing" };
      return { prompt: applied.prompt, rationale };
    }
    // The pre-2026-10-09 contract: a model that re-emits everything is still
    // heard, and the policy guard downstream still judges what it dropped.
    if (parsed.whole) return { prompt: parsed.whole, rationale };
    return { refused: `no <FIND>/<REPLACE> edit and no <PROMPT> block (${text.trim().length} chars)` };
  };
  for (let i = 0; i < k; i++) {
    beforeCall();
    const res = await invokeLLM({
      messages: [
        {
          role: "system",
          content: `You optimize a phone-receptionist system prompt for a tire shop. Make ONE bounded improvement: add, delete, or rewrite exactly ONE section to fix the failure pattern shown. HARD CONSTRAINTS: keep the shop identity, keep every compliance rule (never quote repair prices, never guarantee outcomes, never diagnose by phone), start neutral and identify the caller's need before specializing; preserve strong tire handling but never assume used tires before the caller gives a tire signal. ${OPTIMIZER_FORMAT} Attempt ${i + 1} of ${k} — make each attempt a DIFFERENT single edit.\n\n${UNTRUSTED_DATA_NOTICE}`,
        },
        {
          role: "user",
          content: `CURRENT PROMPT:\n${basePrompt}\n\nREAL FAILED CALLS the current prompt did not resolve under ghost replay (caller words are fenced, redacted data):\n${brief}\n\nPropose your single bounded edit now.`,
        },
      ],
      maxTokens: 8192,
      timeoutMs: 120000,
      model: OPTIMIZER_MODEL,
      priority: 3,
    });
    const raw = res.choices?.[0]?.message?.content ?? "";
    let text = typeof raw === "string" ? raw : JSON.stringify(raw);
    let resolved = resolve(text);
    if ("refused" in resolved) {
      // ONE bounded format retry — reasoning models sometimes spend the
      // answer on analysis and skip the markers, or copy the excerpt loosely.
      // A second failure is recorded, never patched around.
      log(`candidate ${i + 1}: ${resolved.refused} — one format retry`);
      beforeCall();
      const retry = await invokeLLM({
        messages: [
          { role: "system", content: `You return exactly one line starting with RATIONALE:, then the excerpt to change between <FIND> and </FIND> (each marker on its own line) copied VERBATIM from the current prompt with its own line breaks (unique, ${EDIT_FIND_ASK}), then its replacement between <REPLACE> and </REPLACE>. No other output.\n\n${UNTRUSTED_DATA_NOTICE}` },
          { role: "user", content: `CURRENT PROMPT:\n${basePrompt}\n\nYour previous answer could not be applied (${resolved.refused}). Here it is:\n\n${text.slice(0, 6000)}\n\nRe-emit it now as: RATIONALE: <one line>\n<FIND>\n<verbatim excerpt>\n</FIND>\n<REPLACE>\n<replacement>\n</REPLACE>` },
        ],
        maxTokens: 8192,
        timeoutMs: 120000,
        model: OPTIMIZER_MODEL,
        priority: 3,
      });
      const retryRaw = retry.choices?.[0]?.message?.content ?? "";
      text = typeof retryRaw === "string" ? retryRaw : JSON.stringify(retryRaw);
      resolved = resolve(text);
    }
    if ("prompt" in resolved) out.push(resolved);
    else log(`candidate ${i + 1}: ${resolved.refused} after retry — recorded as a failed proposal`);
  }
  return out;
}

/**
 * Content id of a prompt: sha256 hex, first 24 -- the same function as
 * receptionistBaseline's promptHash (module-private there), so a candidate
 * hash and a live prompt hash compare directly (pinned by test). The weekly
 * job uses it to hash a pre-2026-10-09 proposal that carried no hash.
 */
export function promptHashOf(prompt: string): string {
  return createHash("sha256").update(prompt).digest("hex").slice(0, 24);
}

/** A compact line diff for the operator: the changed region between the common prefix and suffix. */
export interface CandidateDiff {
  /** 1-based baseline line where the changed region starts. */
  startLine: number;
  removedCount: number;
  addedCount: number;
  /**
   * Baseline lines the candidate removed or rewrote, from the top of the
   * region: at most DIFF_MAX_LINES lines, each at most DIFF_MAX_LINE chars,
   * DIFF_MAX_CHARS chars in all (newlines counted).
   */
  removed: string[];
  /** Candidate lines that replace them, same caps. */
  added: string[];
  /** true when a cap cut either side; the full candidate is in accepted.prompt (kv only). */
  truncated: boolean;
  /**
   * Whether the edit is a CODE edit (2026-10-09 review). The baseline is the
   * live prompt: the repository prompt plus the learned-lessons block Push
   * Config appends (baseline.lessonsSuffix). true = the candidate still ends
   * with that block verbatim, so writing the text before it into
   * ASSISTANT_SYSTEM_PROMPT and pushing serves what was measured, as long as
   * Push Config still appends that same block (baseline.parityDetail says
   * whether the served block was today's lessons).
   * false = the edit changes the lessons block or follows it: applied as a
   * code edit it would sit BEFORE the lessons, a different text from the one
   * measured. null = the baseline diverged from the repository prompt, so
   * there is no code/lessons boundary to check against.
   */
  codeEdit: boolean | null;
}

/**
 * No dependency: trim the common leading and trailing lines; what is left is
 * the changed region. A single bounded edit (the optimizer's contract) diffs
 * exactly; several separate edits read as one region spanning them, which is
 * a correct diff, just not a minimal one. null when the texts are identical.
 * codeEdit compares with CRLF and trailing whitespace normalized: the
 * optimizer's prompt block is trimmed, the served one may not be.
 */
function lineDiff(baseline: string, candidate: string, lessonsSuffix: string | null): CandidateDiff | null {
  const a = baseline.replace(/\r\n/g, "\n").split("\n");
  const b = candidate.replace(/\r\n/g, "\n").split("\n");
  let pre = 0;
  while (pre < a.length && pre < b.length && a[pre] === b[pre]) pre++;
  let suf = 0;
  while (suf < a.length - pre && suf < b.length - pre && a[a.length - 1 - suf] === b[b.length - 1 - suf]) suf++;
  const removed = a.slice(pre, a.length - suf);
  const added = b.slice(pre, b.length - suf);
  if (!removed.length && !added.length) return null;
  /** Leading lines of one side, each clipped, until a cap: true in `cut` when any cap removed text. */
  const cap = (lines: string[]): { kept: string[]; cut: boolean } => {
    const kept: string[] = [];
    let chars = 0;
    for (const l of lines.slice(0, DIFF_MAX_LINES)) {
      const line = l.length > DIFF_MAX_LINE ? `${l.slice(0, DIFF_MAX_LINE - 3)}...` : l;
      if (chars + line.length + 1 > DIFF_MAX_CHARS) break;
      chars += line.length + 1;
      kept.push(line);
    }
    return { kept, cut: kept.length < lines.length || kept.some((line, i) => line !== lines[i]) };
  };
  const r = cap(removed);
  const ad = cap(added);
  const norm = (s: string) => s.replace(/\r\n/g, "\n").trimEnd();
  const codeEdit = lessonsSuffix === null ? null : norm(candidate).endsWith(norm(lessonsSuffix));
  return { startLine: pre + 1, removedCount: removed.length, addedCount: added.length, removed: r.kept, added: ad.kept, truncated: r.cut || ad.cut, codeEdit };
}

/** Thrown by the budget check; runPromptEvolution turns it into "inconclusive-budget". */
class BudgetExhausted extends Error {
  constructor(readonly stage: string) {
    super(`prompt evolution budget exhausted before stage ${stage}`);
  }
}

export type EvolutionOutcome =
  | "accepted"
  | "accepted-unconfirmed"
  | "rejected-holdout"
  | "rejected-regression"
  | "rejected-underpowered"
  | "rejected-train"
  | "rejected-success-regression"
  | "rejected-success-violation"
  | "rejected-success-degraded"
  | "rejected-success-underpowered"
  | "rejected-confirmation"
  | "invalid-evaluator"
  | "inconclusive-budget"
  | "no-candidates"
  | "baseline-clean";

export type PromotionStage = "none" | "offline_candidate" | "offline_candidate_unconfirmed";

export interface EvolutionUsage {
  /** Ghost replays (one per seed per scoring), both arms, every stage. */
  replays: number;
  /** Resolution-judge calls those scorings made. */
  judgeCalls: number;
  /** Optimizer calls, format retries included. */
  optimizerCalls: number;
  durationMs: number;
}

export interface EvolutionOptions {
  /**
   * The prompt every baseline arm replays and the optimizer edits. Required:
   * the weekly job passes resolveLiveReceptionistBaseline() (what callers
   * hear); repositoryBaseline() is for an explicit offline CLI run only.
   */
  baseline: ReceptionistBaseline;
  seedCount?: number;
  candidates?: number;
  /** Replays per seed per prompt on the holdout and the confirmation set (default 3). */
  holdoutRepeats?: number;
  /** Won calls in the evaluator-only success cohort (default 8; at least minSeedsForAlpha). */
  successCohortSize?: number;
  /** Replays per won call per prompt (default 2). */
  successRepeats?: number;
  /**
   * Confirmation seed ids earlier runs spent (the caller's persisted list).
   * null = the list could not be read: every confirm seed is treated as spent,
   * so no sealed seed is ever re-read on a guess.
   */
  consumedConfirmationIds?: readonly string[] | null;
  /**
   * Write-ahead record of a sealed set. Awaited once, with the ids of the
   * confirmation seeds about to be scored, BEFORE the first one is replayed;
   * the weekly job persists them here. A run that then throws mid-confirmation
   * (a lane error, a DB error) still leaves them marked spent; a hook that
   * rejects fails the run with no sealed seed read. The runner itself never
   * writes kv; the ids also come back in consumedConfirmationIds.
   */
  onConfirmationSpend?: (ids: readonly string[]) => Promise<void>;
  /** Wall-clock budget in ms from the start of the run. Unset = no budget. */
  deadlineMs?: number;
  /** Clock for the budget (tests). Default Date.now. */
  now?: () => number;
  log?: (line: string) => void;
}

export interface EvolutionResult {
  usableSeeds: number;
  /** Proven wins removed from the failure pool (see SeedLoad.excludedVerified). */
  excludedVerified: number;
  trainCount: number;
  holdoutCount: number;
  baselineTrain: string;
  baselineHoldout: string;
  candidateSummaries: Array<{
    rationale: string;
    train: string;
    rejectedInvariants?: string[];
    promptHash?: string;
    /** comparePairedTrain margin vs the baseline on the same train seeds. */
    trainMargin?: number;
    /** false = the train reading measured nothing actionable (outage share over the cap). */
    trainUsable?: boolean;
  }>;
  /** The proposal: set for "accepted" and "accepted-unconfirmed" only. */
  accepted: null | { rationale: string; holdout: string; prompt: string; promptHash: string; confirmed: boolean };
  /** The holdout gate's full reading; null when no candidate reached the holdout. Same as gates.holdout. */
  gate: GateVerdict | null;
  gates: { holdout: GateVerdict | null; success: SuccessCohortVerdict | null; confirmation: GateVerdict | null };
  outcome: EvolutionOutcome;
  promotionStage: PromotionStage;
  /** What was measured against -- never the prompt text itself. */
  baseline: {
    source: ReceptionistBaseline["source"];
    assistantId: string | null;
    promptHash: string;
    promptChars: number;
    providerBehaviorHash: string | null;
    providerBehaviorSchema: string | null;
    parity: PromptParity;
    parityDetail: string;
    fetchedAt: string;
  };
  /** parity false = the replay is a PROXY lane for the one callers ride. */
  lanes: { live: ReceptionistLane; replay: ReplayLane; parity: boolean; differences: string[] };
  cohorts: {
    train: number;
    holdout: number;
    /** Sealed seeds scored (or that would have been): unconsumed confirm-bucket seeds, most recent first, at most CONFIRM_MAX. */
    confirm: number;
    /** Confirm-bucket seeds in the confirmation pool (CONFIRM_POOL_SEEDS failed calls) before the consumed exclusion and the cap. */
    confirmEligible: number;
    /** Comparable seeds judgeConfirmation needs to be able to reach alpha; a smaller cohort is not scored. */
    confirmNeeded: number;
    /** Won calls replayed in the success cohort (0 when the run never got there). */
    success: number;
  };
  exclusions: {
    /** Distinct seeds a BASELINE scoring ruled unresolvable (out of every denominator). */
    unresolvable: number;
    /** Distinct seeds with a judge outage in either arm, any stage. */
    evaluatorUnavailable: number;
    /** Confirm-bucket seeds left out as already consumed by an earlier run (all of them when the list was unreadable). */
    consumedConfirmation: number;
    /** true when the caller passed consumedConfirmationIds: null. */
    consumedListUnknown: boolean;
  };
  usage: EvolutionUsage;
  /** The candidate that reached the holdout (hash + redacted rationale), whatever the gates said. */
  candidate: null | { promptHash: string; parentHash: string; rationale: string };
  /** That candidate's line diff vs the baseline, for the operator (kv only, never logs). */
  candidateDiff: CandidateDiff | null;
  /** Confirmation seeds THIS run scored; the caller adds them to its persisted consumed list. */
  consumedConfirmationIds: string[];
  budget: { deadlineMs: number | null; exhaustedAt: string | null };
  evaluator: { optimizerModel: string; judgeModel: string; ghostModel: string; protocolVersion: string };
}

/**
 * Every success-cohort veto, named. success-empty and underpowered measured
 * nothing (too few won calls to rule), so they share one name that says so;
 * the receipt grades them inconclusive from the gate's own reason.
 */
const SUCCESS_VETO_OUTCOME: Record<Exclude<SuccessCohortVerdict["reason"], "preserved">, EvolutionOutcome> = {
  "success-regressed-seed": "rejected-success-regression",
  "success-new-violation": "rejected-success-violation",
  "success-degraded": "rejected-success-degraded",
  "evaluator-unavailable": "invalid-evaluator",
  "success-empty": "rejected-success-underpowered",
  underpowered: "rejected-success-underpowered",
};

/** "passes/total", with the exclusions inline. */
function describeScore(s: ScoredPrompt): string {
  // Report the exclusions inline — a denominator that silently shrank is
  // the same class of lie as a run that measured nothing and printed zero.
  return `${s.passes}/${s.total}${s.unresolvable ? ` (${s.unresolvable} unresolvable excluded)` : ""}`;
}

/**
 * One full gated evolution cycle. Throws on infrastructure failure (no DB,
 * LLM lane down, no baseline) — a failed run must be a failed cron run, never
 * a quiet success. A budget overrun is not a failure: it returns
 * "inconclusive-budget" carrying whatever was measured before it.
 */
export async function runPromptEvolution(opts: EvolutionOptions): Promise<EvolutionResult> {
  const baseline = opts?.baseline;
  if (!baseline || typeof baseline.prompt !== "string" || !baseline.prompt.trim()) {
    throw new Error("runPromptEvolution needs an explicit baseline: resolveLiveReceptionistBaseline(), or repositoryBaseline() for an offline run");
  }
  const seedCount = Math.max(4, Math.min(40, opts.seedCount ?? 12));
  // Replays per holdout seed per prompt. One replay is what let a single
  // nondeterministic seed flip pass as an improvement (promptEvolutionGate.ts).
  const repeats = Math.max(1, Math.min(5, opts.holdoutRepeats ?? 3));
  const k = Math.max(1, Math.min(3, opts.candidates ?? 2));
  // Below this many comparable seeds no gate here can reach alpha.
  const confirmNeeded = minSeedsForAlpha(GATE_ALPHA);
  const successN = Math.max(confirmNeeded, Math.min(20, opts.successCohortSize ?? 8));
  const successRepeats = Math.max(1, Math.min(3, opts.successRepeats ?? 2));
  const log = opts.log ?? (() => undefined);
  const clock = opts.now ?? Date.now;
  const startedAt = clock();
  const deadlineMs = typeof opts.deadlineMs === "number" && Number.isFinite(opts.deadlineMs) && opts.deadlineMs >= 0 ? opts.deadlineMs : null;
  const consumedList = opts.consumedConfirmationIds === undefined ? [] : opts.consumedConfirmationIds;

  // Dynamic: receptionistBaseline imports vapi.ts, which this module only
  // needs for the lane mirror -- the baseline itself arrives as an argument.
  const { REPLAY_LANE, describeLaneParity } = await import("./receptionistBaseline");
  const laneParity = describeLaneParity(baseline.liveLane, REPLAY_LANE);

  const usage: EvolutionUsage = { replays: 0, judgeCalls: 0, optimizerCalls: 0, durationMs: 0 };
  const unresolvableIds = new Set<string>();
  const outageIds = new Set<string>();
  const gates: EvolutionResult["gates"] = { holdout: null, success: null, confirmation: null };
  const cohorts: EvolutionResult["cohorts"] = { train: 0, holdout: 0, confirm: 0, confirmEligible: 0, confirmNeeded, success: 0 };
  const measured = { usableSeeds: 0, excludedVerified: 0, baselineTrain: "unmeasured", baselineHoldout: "unmeasured" };
  const summaries: EvolutionResult["candidateSummaries"] = [];
  const consumedThisRun: string[] = [];
  let consumedExcluded = 0;
  let candidate: EvolutionResult["candidate"] = null;
  let candidateDiff: CandidateDiff | null = null;
  let accepted: EvolutionResult["accepted"] = null;
  let exhaustedAt: string | null = null;

  const finish = (outcome: EvolutionOutcome): EvolutionResult => ({
    usableSeeds: measured.usableSeeds,
    excludedVerified: measured.excludedVerified,
    trainCount: cohorts.train,
    holdoutCount: cohorts.holdout,
    baselineTrain: measured.baselineTrain,
    baselineHoldout: measured.baselineHoldout,
    candidateSummaries: summaries,
    accepted: outcome === "accepted" || outcome === "accepted-unconfirmed" ? accepted : null,
    gate: gates.holdout,
    gates: { ...gates },
    outcome,
    promotionStage: outcome === "accepted" ? "offline_candidate" : outcome === "accepted-unconfirmed" ? "offline_candidate_unconfirmed" : "none",
    baseline: {
      source: baseline.source,
      assistantId: baseline.assistantId,
      promptHash: baseline.promptHash,
      promptChars: baseline.prompt.length,
      providerBehaviorHash: baseline.providerBehaviorHash,
      providerBehaviorSchema: baseline.providerBehaviorSchema,
      parity: baseline.parity,
      parityDetail: baseline.parityDetail,
      fetchedAt: baseline.fetchedAt,
    },
    lanes: {
      live: baseline.liveLane,
      replay: { ...REPLAY_LANE, tools: [...REPLAY_LANE.tools] },
      parity: laneParity.parity,
      differences: laneParity.differences,
    },
    cohorts: { ...cohorts },
    exclusions: {
      unresolvable: unresolvableIds.size,
      evaluatorUnavailable: outageIds.size,
      consumedConfirmation: consumedExcluded,
      consumedListUnknown: consumedList === null,
    },
    usage: { ...usage, durationMs: clock() - startedAt },
    candidate,
    candidateDiff,
    consumedConfirmationIds: [...consumedThisRun],
    budget: { deadlineMs, exhaustedAt },
    evaluator: { optimizerModel: OPTIMIZER_MODEL, judgeModel: RESOLUTION_JUDGE_MODEL, ghostModel: REPLAY_LANE.model, protocolVersion: PROTOCOL_VERSION },
  });

  const checkBudget = (stage: string): void => {
    if (deadlineMs !== null && clock() - startedAt >= deadlineMs) throw new BudgetExhausted(stage);
  };
  /** One scoring pass: budget-checked before every seed, counted into usage and the exclusion sets. */
  const score = async (prompt: string, seeds: Seed[], arm: "baseline" | "candidate", stage: string, verifyHits: boolean) => {
    checkBudget(stage);
    const scored = await scorePrompt(prompt, seeds, {
      verifyHits,
      beforeSeed: () => checkBudget(stage),
      // Every replay turn, retry and judge call re-checks the budget and is capped at the time left.
      budget: { remainingMs: () => (checkBudget(stage), deadlineMs === null ? Infinity : deadlineMs - (clock() - startedAt)) },
      tally: usage,
    });
    for (const g of scored.grades) {
      if (g.judgeUnavailable) outageIds.add(g.id);
      if (arm === "baseline" && g.unresolvable) unresolvableIds.add(g.id);
    }
    return scored;
  };

  try {
    checkBudget("load-seeds");
    const { seeds, excludedVerified } = await loadSeeds(seedCount);
    if (seeds.length < 4) throw new Error(`only ${seeds.length} usable seeds — need >= 4`);
    // Holdout membership is exactly the old splitSeeds(seeds, 0.4)
    // (promptEvolutionCohorts.test.ts pins it); the sealed confirmation
    // buckets come out of what used to be train.
    const { train, holdout } = splitSeedsThreeWay(seeds, { holdout: 0.4, confirm: 0.2 });
    if (!train.length || !holdout.length) throw new Error("degenerate split");
    // The sealed set is drawn from a LARGER read of the same failed-call pool
    // (CONFIRM_POOL_SEEDS): same hash, so none of it is train or holdout, and
    // enough of it survives the consumed exclusion for the stage to run.
    const confirmPool = await loadSeeds(Math.max(seedCount, CONFIRM_POOL_SEEDS));
    const confirmEligible = splitSeedsThreeWay(confirmPool.seeds, { holdout: 0.4, confirm: 0.2 }).confirm;
    const unspent = consumedList === null ? [] : excludeConsumed(confirmEligible, consumedList);
    const confirm = unspent.slice(0, CONFIRM_MAX);
    consumedExcluded = confirmEligible.length - unspent.length;
    Object.assign(cohorts, { train: train.length, holdout: holdout.length, confirm: confirm.length, confirmEligible: confirmEligible.length });
    measured.usableSeeds = seeds.length;
    measured.excludedVerified = excludedVerified;

    // Train is scored WITHOUT hit verification: it only picks which candidate
    // reaches a gate, and every gate below verifies hits. Keeps judge cost
    // bounded to the stages whose verdicts count.
    const baseTrain = await score(baseline.prompt, train, "baseline", "baseline-train", false);
    measured.baselineTrain = describeScore(baseTrain);
    const baseHold = await score(baseline.prompt, holdout, "baseline", "baseline-holdout", true);
    measured.baselineHoldout = describeScore(baseHold);

    // The optimizer must never see an unwinnable call. An unresolvable seed
    // (wrong number, or the caller gone before asking) has pass=false like any
    // other failure, so without this filter the failure brief would ask for a
    // prompt edit to fix a hang-up — the mislabeled-LOSS twin of #1410's
    // mislabeled-WIN poisoning.
    const trainFailures = baseTrain.grades
      .filter((g) => !g.pass && !g.unresolvable)
      .map((g) => ({ seed: train.find((s) => s.id === g.id)!, grade: g }));
    if (!trainFailures.length) return finish("baseline-clean");

    // The optimizer runs HERE, once, before any won call is loaded: the
    // success cohort below can veto a candidate but can never shape one.
    const candidates = await proposeCandidates(baseline.prompt, trainFailures, k, log, () => {
      checkBudget("optimizer");
      usage.optimizerCalls++;
    });
    let best: { prompt: string; rationale: string; promptHash: string; margin: number } | null = null;
    let scoredAny = false;
    let usableAny = false;
    for (const c of candidates) {
      const promptHash = promptHashOf(c.prompt);
      // Checked against the prompt the optimizer edited, as replayPolicy requires.
      const violated = violatedInvariants(c.prompt, baseline.prompt);
      if (violated.length) {
        summaries.push({ rationale: c.rationale, train: "unscored", rejectedInvariants: violated, promptHash });
        continue;
      }
      const scored = await score(c.prompt, train, "candidate", "candidate-train", false);
      // Paired on the SAME seeds (comparePairedTrain), never passRate vs
      // passRate over each prompt's own denominator.
      const cmp = comparePairedTrain(baseTrain.grades, scored.grades);
      scoredAny = true;
      usableAny ||= cmp.usable;
      summaries.push({ rationale: c.rationale, train: `${scored.passes}/${scored.total}`, promptHash, trainMargin: cmp.margin, trainUsable: cmp.usable });
      if (cmp.usable && cmp.margin > 0 && (!best || cmp.margin > best.margin)) best = { ...c, promptHash, margin: cmp.margin };
    }

    if (!candidates.length) return finish("no-candidates");
    // Every scored candidate's train reading drowned in judge outages: the
    // run measured nothing, it did not refute anything.
    if (!best) return finish(scoredAny && !usableAny ? "invalid-evaluator" : "rejected-train");
    candidate = { promptHash: best.promptHash, parentHash: baseline.promptHash, rationale: best.rationale };
    candidateDiff = lineDiff(baseline.prompt, best.prompt, baseline.lessonsSuffix);

    // Paired, repeated holdout. The baseline's first scoring above is reused as
    // replay 1, so a run that never reaches here pays nothing extra.
    const baseRuns: ScoredPrompt[] = [baseHold];
    const candRuns: ScoredPrompt[] = [];
    for (let r = 0; r < repeats; r++) {
      if (r > 0) baseRuns.push(await score(baseline.prompt, holdout, "baseline", "holdout", true));
      candRuns.push(await score(best.prompt, holdout, "candidate", "holdout", true));
    }
    const gate = judgeHoldout(toSeedTrials(baseRuns), toSeedTrials(candRuns));
    gates.holdout = gate;
    log(`holdout gate: ${describeVerdict(gate)}`);
    if (!gate.accept) {
      return finish(
        gate.reason === "regressed-seed" ? "rejected-regression"
          : gate.reason === "underpowered" ? "rejected-underpowered"
            : gate.reason === "evaluator-unavailable" ? "invalid-evaluator"
              : "rejected-holdout",
      );
    }
    const proposal = { rationale: best.rationale, holdout: describeVerdict(gate), prompt: best.prompt, promptHash: best.promptHash };

    // SUCCESS COHORT, evaluator-only: won calls replayed under both prompts.
    // Loaded only now -- after the holdout accepted (cost) and after the
    // optimizer ran (a won call never reaches a failure brief).
    checkBudget("success-cohort");
    const wonCalls = await loadSuccessSeeds(successN * 3);
    const successCohort = selectSuccessCohort(wonCalls, successN);
    cohorts.success = successCohort.length;
    const successBase: ScoredPrompt[] = [];
    const successCand: ScoredPrompt[] = [];
    for (let r = 0; r < successRepeats; r++) {
      successBase.push(await score(baseline.prompt, successCohort, "baseline", "success-cohort", true));
      successCand.push(await score(best.prompt, successCohort, "candidate", "success-cohort", true));
    }
    const success = judgeSuccessCohort(toSuccessTrials(successBase), toSuccessTrials(successCand), { alpha: GATE_ALPHA });
    gates.success = success;
    log(`success cohort: ${describeSuccessVerdict(success)}`);
    if (success.veto) return finish(SUCCESS_VETO_OUTCOME[success.reason as keyof typeof SUCCESS_VETO_OUTCOME]);

    // SEALED CONFIRMATION, once per candidate. A cohort smaller than
    // confirmNeeded is guaranteed "underpowered", so it is not scored: that
    // would spend sealed seeds to learn nothing. They stay sealed for a later
    // candidate.
    if (confirm.length < confirmNeeded) {
      log(`confirmation not run: ${confirm.length} sealed seed(s) available, ${confirmNeeded} needed to reach alpha ${GATE_ALPHA}`);
      accepted = { ...proposal, confirmed: false };
      return finish("accepted-unconfirmed");
    }
    // Spent from the first replay on: a set that has been read is no longer
    // sealed, whatever happens next. Recorded BEFORE that replay: the caller's
    // hook persists it (write-ahead), so a throw below cannot lose it, and
    // consumedThisRun returns it on every path that returns (budget included).
    checkBudget("confirmation");
    const spentIds = confirm.map((s) => s.id);
    if (opts.onConfirmationSpend) await opts.onConfirmationSpend(spentIds);
    consumedThisRun.push(...spentIds);
    const confirmBase: ScoredPrompt[] = [];
    const confirmCand: ScoredPrompt[] = [];
    for (let r = 0; r < repeats; r++) {
      confirmBase.push(await score(baseline.prompt, confirm, "baseline", "confirmation", true));
      confirmCand.push(await score(best.prompt, confirm, "candidate", "confirmation", true));
    }
    // MULTIPLICITY (decision, 2026-10-09). Alpha stays GATE_ALPHA, not
    // alpha / k: every confirmation reads a DISJOINT set (consumed seeds are
    // never re-read), so each one is a fresh test on data no earlier candidate
    // was selected on, and its 5% bound holds for the candidate it confirms.
    // What it does not bound is the share of false confirmations across many
    // weeks (family-wise); that would need a persisted confirmation count and
    // is not a claim this result makes. Invalidated if consumed seeds are ever
    // re-read or confirm sets overlap.
    const confirmation = judgeConfirmation(toSeedTrials(confirmBase), toSeedTrials(confirmCand), { alpha: GATE_ALPHA });
    gates.confirmation = confirmation;
    log(`confirmation: ${describeVerdict(confirmation)}`);
    if (confirmation.accept) {
      accepted = { ...proposal, confirmed: true };
      return finish("accepted");
    }
    if (confirmation.reason === "underpowered") {
      accepted = { ...proposal, confirmed: false };
      return finish("accepted-unconfirmed");
    }
    return finish(confirmation.reason === "evaluator-unavailable" ? "invalid-evaluator" : "rejected-confirmation");
  } catch (err) {
    if (!(err instanceof BudgetExhausted)) throw err;
    exhaustedAt = err.stage;
    log(`budget: ${deadlineMs} ms spent before stage ${err.stage}; stopping with what was measured (inconclusive-budget)`);
    return finish("inconclusive-budget");
  }
}

