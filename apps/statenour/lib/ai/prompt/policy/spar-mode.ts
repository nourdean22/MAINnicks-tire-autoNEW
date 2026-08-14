/**
 * lib/ai/prompt/policy/spar-mode.ts · AG-30 (2026-07-09)
 *
 * The /spar thought-partner directive: diverge → attack → converge.
 * Before this, a "brainstorm X" turn got only a hotter temperature and
 * a creative model route — no dialectic scaffold, and every critic ran
 * post-stream where its objection was buried in the trace modal.
 *
 * Injected by finalize-system-prompt.ts ONLY when the turn's response
 * contract classifies answerMode === "brainstorm" OR the message
 * carries the explicit /spar prefix (EARLY_SPAR in chat/handlers/
 * patterns.ts — single source of truth for the prefix).
 *
 * The ATTACK framing reuses the CONTRARIAN_CRITIC persona backstory
 * verbatim (lib/ai/personas/index.ts) so the in-stream attack and the
 * post-stream adversarial critic speak with one voice.
 */

/**
 * BDN-308 (2026-08-14) · Verbalized Sampling variant of the DIVERGE step.
 *
 * SPAR step 1 already SPECIFIES the outcome — "3-5 genuinely distinct
 * options… distinct means different bets, not rewordings" — but ships no
 * MECHANISM to produce it. Asking a post-trained model for N options
 * reliably returns N phrasings of its modal answer; that is mode
 * collapse, and temperature does not fix it because the collapse is in
 * the preference data, not the sampler.
 *
 * Verbalized Sampling (arXiv 2510.01171, ICML 2026, Apache-2.0) traces
 * the cause to TYPICALITY BIAS in preference annotation — annotators
 * systematically prefer familiar text — and recovers diversity by
 * asking the model to verbalize a probability with each candidate and
 * to draw from the tail of its own distribution. Reported 1.6-2.1x
 * diversity gain, training-free, model-agnostic, and orthogonal to
 * temperature (so it composes with the hotter brainstorm route rather
 * than competing with it).
 *
 * WHY IT IS A VARIANT AND NOT THE DEFAULT
 * Every published gain is frontier-model; the upstream README itself
 * recommends GPT-5/Opus/Gemini-Pro class. Nick's fast lane is a small
 * model, and this is the SECOND finding whose kill shot is
 * "frontier-only evidence, small-lane unproven" (BDN-201 was the
 * first) — which makes it a structural property of that lane, not a
 * footnote. It also costs five candidate generations per diverge turn.
 * So it ships behind NICK_SPAR_VS, measured on the incumbent A/B
 * harness, and only the DIVERGE step changes: attack / tension /
 * converge are untouched, because nothing in the evidence says they
 * were broken.
 */
export const SPAR_MODE_VS = `# SPAR MODE — diverge → attack → converge
This is a thinking-WITH turn, not an answer-delivery turn. Structure:
1. DIVERGE — generate 5 candidate directions and assign each an explicit probability: how likely is it that THIS is the option Nour actually takes? Deliberately sample from the tail — favour candidates you'd rate below 0.10 over the obvious front-runner, because the obvious one is the one he's already considered. Every candidate must be grounded in his actual data (numbers, names, dates) and must be a different BET, not a different wording. Render as: \`option — p=0.NN — the bet in one line\`. Then keep the 3 strongest and drop the rest.
2. ATTACK — take the strongest option and attack it yourself. You are the team's professional skeptic · paid to find the holes. You don't hedge or soften. You name 3-5 concrete risks the optimistic plan ignores. Generic risks ('execution risk') waste your time.
3. TENSION — name the real tension that decides between the survivors. Do NOT resolve it unless Nour asks — the tension itself is the insight, and the choice stays his.
4. CONVERGE — end by asking which thread to develop. One question, no summary.`;

/**
 * Pick the SPAR scaffold for this turn. Default stays the incumbent —
 * flipping the flag is the experiment, not the rollback.
 */
export function getSparMode(): string {
  return process.env.NICK_SPAR_VS === "true" ? SPAR_MODE_VS : SPAR_MODE;
}

export const SPAR_MODE = `# SPAR MODE — diverge → attack → converge
This is a thinking-WITH turn, not an answer-delivery turn. Structure:
1. DIVERGE — 3-5 genuinely distinct options, each grounded in Nour's actual data (numbers, names, dates). Distinct means different bets, not rewordings.
2. ATTACK — take the strongest option and attack it yourself. You are the team's professional skeptic · paid to find the holes. You don't hedge or soften. You name 3-5 concrete risks the optimistic plan ignores. Generic risks ('execution risk') waste your time.
3. TENSION — name the real tension that decides between the survivors. Do NOT resolve it unless Nour asks — the tension itself is the insight, and the choice stays his.
4. CONVERGE — end by asking which thread to develop. One question, no summary.`;
