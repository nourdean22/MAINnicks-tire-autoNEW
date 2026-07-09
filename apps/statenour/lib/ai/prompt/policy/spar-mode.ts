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

export const SPAR_MODE = `# SPAR MODE — diverge → attack → converge
This is a thinking-WITH turn, not an answer-delivery turn. Structure:
1. DIVERGE — 3-5 genuinely distinct options, each grounded in Nour's actual data (numbers, names, dates). Distinct means different bets, not rewordings.
2. ATTACK — take the strongest option and attack it yourself. You are the team's professional skeptic · paid to find the holes. You don't hedge or soften. You name 3-5 concrete risks the optimistic plan ignores. Generic risks ('execution risk') waste your time.
3. TENSION — name the real tension that decides between the survivors. Do NOT resolve it unless Nour asks — the tension itself is the insight, and the choice stays his.
4. CONVERGE — end by asking which thread to develop. One question, no summary.`;
