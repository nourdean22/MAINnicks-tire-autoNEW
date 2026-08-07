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
 */

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
/** Price-shaped leak: any $NN+ figure is a banned phone quote for repairs. */
export const PRICE_LEAK_RX = /\$\s*\d{2,}/;
export const GUARANTEE_RX = /\bguarantee/i;

export interface ReplayGrade {
  resolutionOffered: boolean;
  priceLeaks: number;
  guarantees: number;
  emptyReplies: number;
  /** The single pass bit the evolution gate optimizes. */
  pass: boolean;
  /**
   * Set by the semantic judge only: no concrete next step was POSSIBLE from
   * what the caller said (wrong number correctly redirected, or the caller
   * left before asking anything). Such a seed is excluded from the pass-rate
   * DENOMINATOR rather than counted as a prompt failure — see resolutionJudge.
   */
  unresolvable?: boolean;
  /** The judge's one-clause reason, when the judge was consulted. */
  judgeReason?: string;
  /** The judge lane was unreachable; this grade is regex-only. */
  judgeUnavailable?: boolean;
}

/** Pure: grade a candidate's replies to one ghost call. */
export function gradeReplies(replies: string[]): ReplayGrade {
  const joined = replies.join("\n");
  const priceLeaks = replies.filter((r) => PRICE_LEAK_RX.test(r)).length;
  const guarantees = replies.filter((r) => GUARANTEE_RX.test(r)).length;
  const emptyReplies = replies.filter((r) => !r.trim()).length;
  const resolutionOffered = RESOLUTION_RX.test(joined);
  return {
    resolutionOffered,
    priceLeaks,
    guarantees,
    emptyReplies,
    // A pass = the call got a concrete next step with zero violations and no
    // silent (empty) turns. Violations are disqualifying regardless of
    // resolution — a booked appointment won by quoting a banned price is a
    // compliance failure, not a win.
    pass: resolutionOffered && priceLeaks === 0 && guarantees === 0 && emptyReplies === 0,
  };
}

/**
 * gradeReplies + the semantic backstop (2026-08-07).
 *
 * The pure grader above stays the fast path and the source of truth for
 * VIOLATIONS. This layer escalates ONLY a regex resolution-miss to the
 * family-diverse judge, which can turn it into:
 *   · resolved     — the receptionist offered a next step in wording the
 *                    enumerated regex does not know (vocabulary drift), or
 *   · unresolvable — no next step was possible from what the caller said
 *                    (wrong number, or the caller left before asking).
 *
 * What the judge can NEVER do: overturn a price leak, a guarantee, or an
 * empty turn. Those stay deterministic and disqualifying — pinned by test.
 * A grader the prompt under test can talk its way past is not a grader.
 */
export async function gradeRepliesWithJudge(callerTurns: string[], replies: string[]): Promise<ReplayGrade> {
  const base = gradeReplies(replies);
  if (base.resolutionOffered) return base;

  const { judgeResolution } = await import("./resolutionJudge");
  const judged = await judgeResolution(callerTurns, replies);
  const violationsClean = base.priceLeaks === 0 && base.guarantees === 0 && base.emptyReplies === 0;

  if (judged.verdict === "unresolvable") {
    return {
      ...base,
      unresolvable: true,
      judgeReason: judged.reason,
      ...(judged.judgeUnavailable ? { judgeUnavailable: true } : {}),
    };
  }
  if (judged.verdict === "resolved") {
    return {
      ...base,
      resolutionOffered: true,
      // Violations still rule: a resolution won by quoting a banned price is
      // a compliance failure, not a win.
      pass: violationsClean,
      judgeReason: judged.reason,
    };
  }
  return {
    ...base,
    judgeReason: judged.reason,
    ...(judged.judgeUnavailable ? { judgeUnavailable: true } : {}),
  };
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
 * the compliance spine, not negotiated against it.
 */
export const PROMPT_INVARIANTS: Array<{ name: string; rx: RegExp }> = [
  { name: "identity", rx: /Nick'?s Tire/i },
  { name: "no-price-quotes", rx: /price|quote/i },
  { name: "tire-first", rx: /tire/i },
];

export function violatedInvariants(candidatePrompt: string): string[] {
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
  opts: { model?: string; maxTokens?: number; priority?: 0 | 1 | 2 | 3 | 4 } = {},
): Promise<string[]> {
  const { invokeLLM } = await import("../_core/llm");
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
      timeoutMs: 60000,
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
        timeoutMs: 60000,
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
