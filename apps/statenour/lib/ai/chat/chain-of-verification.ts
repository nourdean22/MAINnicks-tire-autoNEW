/**
 * CHAIN-OF-VERIFICATION (CoVe) · arXiv 2309.11495 · gated by NICK_COVE.
 *
 * After Nick drafts a factual answer, this module:
 *   1. PLAN     — generate 2-4 verification questions targeting the
 *                 draft's checkable factual claims (numbers, names,
 *                 dates, specific facts).
 *   2. EXECUTE  — answer each question FRESH, in ISOLATION. The
 *                 verification model sees ONLY the question + the
 *                 user's original question for context — it does NOT
 *                 see the draft. Isolation is the mechanism: it stops
 *                 the model from rubber-stamping its own hallucination.
 *   3. REVISE   — show the draft + the independent answers and let the
 *                 model rewrite ONLY the parts that contradict the
 *                 verified facts. If nothing contradicts, the draft is
 *                 returned verbatim.
 *
 * Failure philosophy · this sits in the user-facing chat path, so it
 * NEVER throws. Any error (provider outage, parse failure, timeout)
 * returns the original draft unchanged with `changed: false`. The
 * worst case is "CoVe was a no-op", never "the chat turn broke".
 *
 * Model-invocation style mirrors adversarial-critic.ts — the
 * makeTracedAiChat factory (gives the budget gate + provider fallback
 * + AgentTrace coverage for free). Parsing mirrors extract-structured.
 */
import "server-only";

import { makeTracedAiChat } from "@/lib/ai/traced-aichat";
import { extractJsonArray } from "@/lib/ai/extract-structured";
import { logger as rootLogger } from "@/lib/logger";

const aiChat = makeTracedAiChat("chain-of-verification", "chat");
const log = rootLogger.withSurface("ai/chain-of-verification");

const MAX_QUESTIONS = 4;
const MIN_DRAFT_LEN = 60; // too short to carry a verifiable factual claim

export interface CoveResult {
  /** Revised text, or the original draft when nothing changed / on failure. */
  revised: string;
  /** True only when the revise pass actually altered the draft. */
  changed: boolean;
  /** The verification questions generated (empty on early-out / failure). */
  questions: string[];
}

const PLAN_SYSTEM = `You generate verification questions to fact-check a draft answer.
Read the draft and list 2-4 SHORT, INDEPENDENT questions that each check ONE concrete factual claim in it (a number, name, date, amount, or specific fact). Skip opinions, suggestions, and pleasantries — only checkable facts.
Output a JSON array of strings only, e.g. ["How many open estimates are there?", "What is the advertised oil-change price?"]. No prose, no markdown.`;

const ANSWER_SYSTEM = `You answer ONE factual question as accurately and concisely as possible, using only what you actually know or can ground in the user's context. If you do not know, say "unknown" — do NOT guess. One or two sentences max. No markdown.`;

const REVISE_SYSTEM = `You revise a draft answer so it agrees with independently verified facts.
You are given the original question, the draft, and a list of verification Q&A pairs that were answered IN ISOLATION (without seeing the draft).
Rewrite the draft to correct ONLY claims that contradict the verified answers. Preserve the draft's voice, length, and everything that is already consistent. Do not add new claims or caveats.
If nothing in the draft contradicts the verified facts, output the draft UNCHANGED, verbatim.
Output ONLY the (possibly revised) answer text — no preamble, no markdown fences, no explanation.`;

/**
 * Run Chain-of-Verification over a draft answer. Graceful on every
 * failure path: returns the original draft with `changed: false`.
 */
export async function verifyAndRevise(
  draft: string,
  userQuestion: string,
  opts: { signal?: AbortSignal } = {},
): Promise<CoveResult> {
  const noop: CoveResult = { revised: draft, changed: false, questions: [] };
  if (!draft || typeof draft !== "string" || draft.trim().length < MIN_DRAFT_LEN) {
    return noop;
  }

  try {
    // ── 1 · PLAN — generate verification questions ──
    const planRes = await aiChat(
      [
        { role: "system", content: PLAN_SYSTEM },
        { role: "user", content: `DRAFT ANSWER:\n${draft.slice(0, 4000)}` },
      ],
      // 2026-09-17 · was "fast". This surface is one of the six Langfuse shows
      // failing (56 ERROR observations / 7d). `fast` is OLLAMA_FAST_MODEL under
      // the 1500-token / 45s "terse responses" cap, and this call must emit a
      // JSON array of verification questions — when it comes back empty or
      // truncated the chain falls through to the METERED rescue tail, which
      // then fails on billing. "reason" stays on the same flat un-metered
      // Ollama subscription.
      //
      // ⚠ The ANSWER call below keeps "fast" deliberately: it returns prose
      // (`res.content.trim()`), so it cannot fail to parse and does not cause
      // the fall-through.
      "reason",
      { signal: opts.signal },
    );
    if (!planRes.content || planRes.provider === "none") return noop;

    const parsed = extractJsonArray<string>(planRes.content);
    if (!parsed.ok) {
      log.warn("cove_plan_parse_failed", { raw: parsed.raw.slice(0, 120) });
      return noop;
    }
    const questions = parsed.value
      .filter((q): q is string => typeof q === "string" && q.trim().length > 0)
      .map((q) => q.trim())
      .slice(0, MAX_QUESTIONS);
    if (questions.length === 0) return noop;

    // ── 2 · EXECUTE — answer each question in ISOLATION (no draft) ──
    // The verification model never sees the draft. This is what kills
    // self-confirming hallucination.
    const answers = await Promise.all(
      questions.map(async (q) => {
        try {
          const res = await aiChat(
            [
              { role: "system", content: ANSWER_SYSTEM },
              {
                role: "user",
                content: `Original user question (for context): ${userQuestion.slice(0, 800)}\n\nVerification question: ${q}`,
              },
            ],
            "fast",
            { signal: opts.signal },
          );
          if (!res.content || res.provider === "none") return null;
          return res.content.trim().slice(0, 600);
        } catch {
          return null;
        }
      }),
    );

    const qa = questions
      .map((q, i) => ({ q, a: answers[i] }))
      .filter((p): p is { q: string; a: string } => Boolean(p.a));
    // Nothing could be independently verified — don't risk a blind rewrite.
    if (qa.length === 0) return { ...noop, questions };

    // ── 3 · REVISE — fix only contradictions ──
    const qaBlock = qa.map((p, i) => `Q${i + 1}: ${p.q}\nVerified A${i + 1}: ${p.a}`).join("\n\n");
    const reviseRes = await aiChat(
      [
        { role: "system", content: REVISE_SYSTEM },
        {
          role: "user",
          content: `ORIGINAL QUESTION:\n${userQuestion.slice(0, 800)}\n\nDRAFT:\n${draft.slice(0, 4000)}\n\nVERIFIED FACTS:\n${qaBlock}`,
        },
      ],
      "reason",
      { signal: opts.signal },
    );
    if (!reviseRes.content || reviseRes.provider === "none") {
      return { ...noop, questions };
    }

    const revised = reviseRes.content.trim();
    if (!revised) return { ...noop, questions };

    const changed = revised !== draft.trim();
    if (changed) {
      log.info("cove_revised", { questions: questions.length, verified: qa.length });
    }
    return { revised: changed ? revised : draft, changed, questions };
  } catch (err) {
    // Never break the chat path — a CoVe failure is always a no-op.
    log.warn("cove_failed", {
      error: err instanceof Error ? err.message.slice(0, 200) : String(err).slice(0, 200),
    });
    return noop;
  }
}
