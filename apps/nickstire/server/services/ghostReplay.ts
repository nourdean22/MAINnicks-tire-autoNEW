/**
 * Ghost replay (2026-08-06) — replay REAL vaulted caller turns against ANY
 * candidate receptionist prompt.
 *
 * The cage-match simulator plays both sides with LLMs, which makes candidate
 * comparison stochastic on the adversary side. Ghost replay kills that: the
 * CALLER side is a real customer's actual words from vapi_call_archives,
 * fixed and identical for every candidate — only the receptionist's replies
 * vary with the prompt under test. That turns "is prompt B better than
 * prompt A" into a like-for-like comparison over the same real failures.
 *
 * Grading is deterministic (resolution-offered + banned-claim regexes) — a
 * grade the prompt under test cannot sweet-talk. This module never contacts
 * VAPI or customers and never writes; it is the evaluation half of the
 * prompt-evolution loop (scripts/prompt-evolve.ts), which itself only emits
 * PROPOSALS — Push Config remains the one serving gate.
 *
 * 2026-10-09 -- the policy half moved to replayPolicy.ts: the reply grader
 * now also runs the LIVE voice claim guard (claimViolations), the prompt
 * guard checks clause preservation and a reversal deny-list against the
 * served baseline, and gradeRepliesWithJudge verifies regex HITS too, so a
 * generic "come by" that ignores the caller's actual request (a deflection)
 * no longer scores as resolved.
 */
import { PROMPT_INVARIANTS, replyClaimViolations, stripApprovedAnchors, violatedPromptPolicy } from "./replayPolicy";

/** Caller-line markers seen in vaulted VAPI transcripts + the simulator. */
const CALLER_LINE = /^(User|Customer|Caller)\s*:\s*(.*)$/i;
const AGENT_LINE = /^(AI|Bot|Assistant|Agent)\s*:\s*(.*)$/i;

/** Pure: the caller's turns, in order, from a vaulted transcript. */
export function extractCallerTurns(transcript: string): string[] {
  const turns: string[] = [];
  let current: string | null = null;
  for (const rawLine of transcript.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const caller = CALLER_LINE.exec(line);
    if (caller) {
      if (current !== null) turns.push(current);
      current = caller[2].trim();
      continue;
    }
    if (AGENT_LINE.test(line)) {
      if (current !== null) turns.push(current);
      current = null;
      continue;
    }
    // Continuation line of whichever speaker is open; agent continuations drop.
    if (current !== null) current = `${current} ${line}`.trim();
  }
  if (current !== null) turns.push(current);
  return turns.filter((t) => t.length > 0);
}

/**
 * The lane the replayed receptionist rides when the caller doesn't pin one
 * (2026-08-07). Before this pin the lane was ambient: locally without
 * AI_FORCE_OLLAMA a bare invokeLLM resolves to gpt-4o on OpenAI, so the same
 * replay could measure a different model than prod serves depending on shell
 * env. Prod resolution is AI_FORCE_OLLAMA=true → OLLAMA_MODEL ||
 * "deepseek-v4-pro"; this mirrors it. The name is an Ollama-native substring,
 * so it routes to the Ollama lane with no force flag; on Railway the force
 * flag reroutes to the same place — parity in both environments.
 *
 * Env escape (2026-08-07): now that a native pin SURVIVES AI_FORCE_OLLAMA,
 * this constant no longer follows an emergency OLLAMA_MODEL reassignment. A
 * hard const would leave the weekly evolution cron 404ing after an Ollama
 * model retirement (a documented recurring event — deepseek-v3.1 2026-07-15,
 * qwen3-vl 2026-06-16) with a code deploy as the only cure. Same pattern as
 * RESOLUTION_JUDGE_MODEL / PROMPT_EVOLVE_OPTIMIZER / the cage lanes.
 */
export const GHOST_AGENT_MODEL = process.env.GHOST_AGENT_MODEL || "deepseek-v4-pro";

/** The same deterministic vocabulary the cage match grades on.
 *  Transfer language added 2026-08-06: a live transfer IS a resolution — the
 *  Mark-targeted replay showed "let me get you over to him" graded as a
 *  failure, under-measuring every transfer-resolved call. */
export const RESOLUTION_RX = /(walk[- ]?in|come (on )?(in|by|up)|swing by|stop by|pull up|we can get you in|book|schedule|call you back|text you|first[- ]come|transferr?(ing)?\b|connect(ing)? (you|the call)|put you through|get(ting)? you (over )?(to )?(him|her|them|someone|a person|the (shop|counter|floor|manager))|(let me |i'?ll )get (him|her|them|someone)\b)/i;
/**
 * Price-shaped leak: a $NN+ figure, read AFTER the approved anchor prices are
 * removed (replayPolicy.stripApprovedAnchors) -- each permitted price only for
 * the product it belongs to: the nearest product named, one figure per mention
 * (round 3: "Full synthetic is $80 and brake pads are $80 too" is a leak).
 * Before 2026-10-09 the prompt's own scripted Beat 1, "Used tires start at $60
 * installed", graded as a banned quote, so the served prompt failed for
 * obeying itself.
 *
 * NOT the guard's allowlist: a first cut counted a leak only when the live
 * guard also called the figure unapproved, and the guard clears 49 / 60 / 80
 * by VALUE -- so "Brake pads are $80" and "Brakes run $60-$80" stopped being
 * leaks (review 2026-10-09). An anchor value quoted for any other product, or
 * with cents ("$49.99"), stays a leak here.
 */
export const PRICE_LEAK_RX = /\$\s*\d{2,}/;
export const GUARANTEE_RX = /\bguarantee/i;

export interface ReplayGrade {
  resolutionOffered: boolean;
  priceLeaks: number;
  guarantees: number;
  emptyReplies: number;
  /**
   * Claim labels from the live voice guard plus the replay-only classes
   * (replayPolicy.replyClaimViolations): unapproved/unit-less prices (an
   * anchor value quoted for the wrong product included), hedged figures, wait
   * estimates, outcome promises, invented warranties, diagnosis verdicts, ...
   * Any entry fails the grade, and no judge verdict can clear it.
   */
  claimViolations: string[];
  /** The single pass bit the evolution gate optimizes. */
  pass: boolean;
  /**
   * Set by the judge only: the receptionist offered a GENERIC next step that
   * ignored what the caller actually asked (a "come by" to a caller who asked
   * whether the shop does motorcycle tires). Always pass=false.
   */
  deflected?: boolean;
  /**
   * Set by the semantic judge only: no concrete next step was POSSIBLE from
   * what the caller said (wrong number correctly redirected, or the caller
   * left before asking anything). Such a seed is excluded from the pass-rate
   * DENOMINATOR rather than counted as a prompt failure — see resolutionJudge.
   */
  unresolvable?: boolean;
  /** The judge's one-clause reason, when the judge was consulted. */
  judgeReason?: string;
  /**
   * The judge was NEEDED but its lane was unreachable, so this grade is
   * regex-only. Set for a regex MISS (the regex fail stands) and, when hits
   * are verified, for a regex HIT (the regex pass stands, unverified). Never
   * set when the judge was not needed (verifyHits: false and a regex hit).
   * The holdout gate treats a seed carrying this flag as invalid evidence:
   * an outage must not hand either arm an unverified pass.
   */
  judgeUnavailable?: boolean;
}

/** Pure: grade a candidate's replies to one ghost call. */
export function gradeReplies(replies: string[]): ReplayGrade {
  const joined = replies.join("\n");
  const priceLeaks = replies.filter((r) => PRICE_LEAK_RX.test(stripApprovedAnchors(r))).length;
  const guarantees = replies.filter((r) => GUARANTEE_RX.test(r)).length;
  const emptyReplies = replies.filter((r) => !r.trim()).length;
  const claimViolations = replyClaimViolations(replies);
  const resolutionOffered = RESOLUTION_RX.test(joined);
  return {
    resolutionOffered,
    priceLeaks,
    guarantees,
    emptyReplies,
    claimViolations,
    // A pass = the call got a concrete next step with zero violations and no
    // silent (empty) turns. Violations are disqualifying regardless of
    // resolution — a booked appointment won by quoting a banned price is a
    // compliance failure, not a win.
    pass:
      resolutionOffered && priceLeaks === 0 && guarantees === 0 && emptyReplies === 0 && claimViolations.length === 0,
  };
}

/**
 * A run's wall-clock budget, consulted before EVERY model call (2026-10-09,
 * review on #2944): remainingMs() throws when the budget is spent (the
 * runner's BudgetExhausted) and otherwise returns the ms left. Each call's
 * timeout is then capped by what is left, so a seed begun near the deadline
 * cannot run past it on a slow lane: ten 60 s replay turns, their retries and
 * a judge call used to fit behind one pre-seed check.
 */
export interface ReplayBudget {
  remainingMs: () => number;
}

/** min(cap, ms left), floored at 1 s so a call is never sent with a 0 timeout. Throws via remainingMs() once spent. */
function budgetedTimeout(budget: ReplayBudget | undefined, capMs: number): number {
  if (!budget) return capMs;
  const left = budget.remainingMs();
  return Math.max(1_000, Math.min(capMs, Math.floor(left)));
}

export interface GradeWithJudgeOptions {
  /** Wall-clock budget for the judge call (see ReplayBudget). */
  budget?: ReplayBudget;
  /**
   * Ask the judge about a regex HIT too (default true since 2026-10-09). The
   * regex rewards any stated next step, so "come by anytime" to a caller who
   * asked something else scored as resolved and could never be overturned.
   * false restores the old free fast path: a hit returns without a judge call.
   */
  verifyHits?: boolean;
}

/**
 * gradeReplies + the semantic judge (2026-08-07; hit verification 2026-10-09).
 *
 * The pure grader above stays the source of truth for VIOLATIONS. The
 * family-diverse judge rules on RESOLUTION, for a regex miss always and for a
 * regex hit when `verifyHits` (the default):
 *   · resolved     — a next step that fits the caller's request, in any
 *                    wording (rescues a vocabulary miss; confirms a hit);
 *   · deflected    — a generic next step that ignored the caller's actual
 *                    request: pass=false, deflected=true, even on a regex hit;
 *   · unresolved   — no way forward offered (also overturns a regex hit, e.g.
 *                    "we don't book appointments" matched /book/);
 *   · unresolvable — no next step was possible from what the caller said
 *                    (wrong number, or the caller left before asking): on a
 *                    MISS the seed is marked for denominator exclusion,
 *                    pass=false; on a HIT the regex verdict stands (a next
 *                    step was offered anyway) and the seed stays counted.
 *
 * What the judge can NEVER do: overturn a price leak, a guarantee, an empty
 * turn or a claim violation. Those stay deterministic and disqualifying —
 * pinned by test. A grader the prompt under test can talk its way past is
 * not a grader.
 *
 * A judge that was needed and unreachable leaves the regex verdict standing
 * and sets judgeUnavailable (see ReplayGrade) — for hits and misses alike.
 */
/**
 * One in-flight load of the lane modules, shared by concurrent seeds
 * (promptEvolution scorePrompt replays two at a time since 2026-10-09). Two
 * simultaneous `await import()` of the same module raced vitest's module mock
 * and the second received the real client; a memoized promise keeps the load
 * lazy and single.
 */
let llmModule: Promise<typeof import("../_core/llm")> | null = null;
const loadLlm = () => (llmModule ??= import("../_core/llm"));
let judgeModule: Promise<typeof import("./resolutionJudge")> | null = null;
const loadJudge = () => (judgeModule ??= import("./resolutionJudge"));

export async function gradeRepliesWithJudge(
  callerTurns: string[],
  replies: string[],
  opts: GradeWithJudgeOptions = { verifyHits: true },
): Promise<ReplayGrade> {
  const base = gradeReplies(replies);
  const verifyHits = opts.verifyHits !== false;
  if (base.resolutionOffered && !verifyHits) return base;

  // Outside judgeResolution's catch on purpose: a spent budget must end the
  // run as inconclusive-budget, never read as a judge outage.
  const judgeTimeoutMs = budgetedTimeout(opts.budget, 60_000);
  const { judgeResolution } = await loadJudge();
  const judged = await judgeResolution(callerTurns, replies, { timeoutMs: judgeTimeoutMs });

  // Needed and unreachable: the regex verdict stands, loudly. Checked before
  // the verdict, because an unreachable judge's verdict is a placeholder.
  if (judged.judgeUnavailable) return { ...base, judgeReason: judged.reason, judgeUnavailable: true };

  const violationsClean =
    base.priceLeaks === 0 && base.guarantees === 0 && base.emptyReplies === 0 && base.claimViolations.length === 0;

  switch (judged.verdict) {
    case "unresolvable":
      // On a regex HIT a next step WAS offered -- the prompt tells it to give
      // even a misdialer a doorway -- so the regex verdict stands and the seed
      // stays in the denominator. Verifying hits may catch a deflection; it
      // must not shrink the denominator a hit always counted in, or a
      // candidate that drops the doorway would stop being measured there.
      if (base.resolutionOffered) return { ...base, judgeReason: judged.reason };
      // On a miss: excluded from the denominator, NOT counted as a win.
      return { ...base, pass: false, unresolvable: true, judgeReason: judged.reason };
    case "resolved":
      // Violations still rule: a resolution won by quoting a banned price is
      // a compliance failure, not a win.
      return { ...base, resolutionOffered: true, pass: violationsClean, judgeReason: judged.reason };
    case "deflected":
      return { ...base, resolutionOffered: false, deflected: true, pass: false, judgeReason: judged.reason };
    default:
      return { ...base, resolutionOffered: false, pass: false, judgeReason: judged.reason };
  }
}

/**
 * Deterministic train/holdout split on the seed id — stable across runs so a
 * candidate can never be graded on data it was optimized against.
 */
export function splitSeeds<T extends { id: string }>(seeds: T[], holdoutRatio = 0.4): { train: T[]; holdout: T[] } {
  const scored = seeds.map((s) => {
    let h = 0;
    for (const ch of s.id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    return { seed: s, bucket: h % 100 };
  });
  const cut = Math.round(holdoutRatio * 100);
  return {
    holdout: scored.filter((x) => x.bucket < cut).map((x) => x.seed),
    train: scored.filter((x) => x.bucket >= cut).map((x) => x.seed),
  };
}

/**
 * Invariants a bounded edit must NEVER remove. A candidate prompt missing any
 * of these is rejected BEFORE scoring — the optimizer's freedom is bounded by
 * the compliance spine, not negotiated against it. Defined in replayPolicy.ts
 * since 2026-10-09; re-exported here so existing importers keep working.
 */
export { PROMPT_INVARIANTS };

/**
 * The prompt guard. WITH a baseline (the served prompt) it is the full policy
 * check -- legacy invariants + clause preservation + reversal deny-list, see
 * replayPolicy.violatedPromptPolicy. WITHOUT one it keeps the old three-regex
 * reading for compatibility, which "Always quote prices and guarantee every
 * repair" still passes: callers that can supply the baseline should.
 */
export function violatedInvariants(candidatePrompt: string, baseline?: string): string[] {
  if (baseline !== undefined) return violatedPromptPolicy(candidatePrompt, baseline);
  return PROMPT_INVARIANTS.filter((i) => !i.rx.test(candidatePrompt)).map((i) => i.name);
}

/**
 * Replay one real call against a candidate prompt: for each real caller turn,
 * the candidate answers with the dialogue so far. Returns the candidate's
 * replies (grading is the caller's job so scoring stays pure).
 */
export async function ghostReplay(
  candidatePrompt: string,
  callerTurns: string[],
  opts: { model?: string; maxTokens?: number; priority?: 0 | 1 | 2 | 3 | 4; budget?: ReplayBudget } = {},
): Promise<string[]> {
  const { invokeLLM } = await loadLlm();
  const replies: string[] = [];
  for (let i = 0; i < callerTurns.length; i++) {
    const dialogue: string[] = [];
    for (let j = 0; j <= i; j++) {
      dialogue.push(`User: ${callerTurns[j]}`);
      if (j < i) dialogue.push(`AI: ${replies[j]}`);
    }
    const res = await invokeLLM({
      messages: [
        { role: "system", content: candidatePrompt },
        {
          role: "user",
          content: `Phone call so far:\n${dialogue.join("\n")}\n\nYour next spoken line as the receptionist (one turn, no stage directions):`,
        },
      ],
      maxTokens: opts.maxTokens ?? 700,
      timeoutMs: budgetedTimeout(opts.budget, 60000),
      slotWaitMs: budgetedTimeout(opts.budget, 60000),
      model: opts.model ?? GHOST_AGENT_MODEL,
      priority: opts.priority ?? 3,
      // Temperature 0: evaluation must measure the prompt, not the dice — a
      // ±1-seed swing between identical runs was observed at the default.
      temperature: 0,
    });
    const raw = res.choices?.[0]?.message?.content ?? "";
    let reply = (typeof raw === "string" ? raw : JSON.stringify(raw)).trim();
    if (!reply) {
      // ONE bounded retry with a bigger budget: reasoning models sometimes
      // burn the whole allocation thinking and emit nothing (observed live on
      // the Mark replay). A second empty stands and is counted by the grader —
      // silence on a live call is a real failure, but a token-budget artifact
      // is a measurement bug, not a prompt defect.
      const retry = await invokeLLM({
        messages: [
          { role: "system", content: candidatePrompt },
          {
            role: "user",
            content: `Phone call so far:\n${dialogue.join("\n")}\n\nYour next spoken line as the receptionist (one short spoken sentence, no analysis):`,
          },
        ],
        maxTokens: 1400,
        timeoutMs: budgetedTimeout(opts.budget, 60000),
      slotWaitMs: budgetedTimeout(opts.budget, 60000),
        model: opts.model ?? GHOST_AGENT_MODEL,
        priority: opts.priority ?? 3,
        temperature: 0,
      });
      const retryRaw = retry.choices?.[0]?.message?.content ?? "";
      reply = (typeof retryRaw === "string" ? retryRaw : JSON.stringify(retryRaw)).trim();
    }
    replies.push(reply);
  }
  return replies;
}
