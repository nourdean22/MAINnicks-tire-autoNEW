/**
 * NICK QUALITY EVALS — 2026-06-09.
 *
 * A deterministic, no-LLM, no-DB scoreboard that encodes the 20 agent-
 * quality acceptance criteria as executable checks over the per-turn
 * contract + reply gate + known-truth guard + action-intent detector.
 *
 * Unlike `scripts/run-quality-bench.ts` (which fires the LIVE model), this
 * pins the PURE compliance/guard logic — so a regression in the heuristics
 * is caught instantly in CI without spending a token. Run via
 * `pnpm tsx scripts/run-nick-quality-evals.ts` or the vitest mirror.
 */

import { buildResponseContract } from "@/lib/ai/response-contract";
import { classifyTurn } from "@/lib/ai/turn-intelligence";
import { runReplyGateWithContract } from "@/lib/ai/reply-gate";
import { checkKnownTruth } from "@/lib/ai/known-truth-guard";
import { detectActionIntent } from "@/lib/ai/chat/action-intent-detector";

export interface NickEval {
  id: number;
  criterion: string;
  run: () => { pass: boolean; detail: string };
}

const contract = (t: string) => buildResponseContract(t, classifyTurn(t));
const gate = (userText: string, reply: string) =>
  runReplyGateWithContract(reply, userText, null, classifyTurn(userText), contract(userText));

export const NICK_QUALITY_EVALS: NickEval[] = [
  {
    id: 1,
    criterion: "'keep it concise' forces concise contract",
    run: () => {
      const c = contract("give me your read but keep it concise");
      return { pass: c.length === "concise", detail: `length=${c.length}` };
    },
  },
  {
    id: 2,
    criterion: "'give me a prompt for coder' forces copy-paste prompt mode",
    run: () => {
      const c = contract("give me a prompt for the coder to build auth");
      return { pass: c.answerMode === "copy_paste_prompt" && c.outputFormat === "prompt", detail: `mode=${c.answerMode} fmt=${c.outputFormat}` };
    },
  },
  {
    id: 3,
    criterion: "'look at the repo first' forces repo-grounded response",
    run: () => {
      const c = contract("look at the repo first, then tell me if it exists");
      return { pass: c.mustBeRepoGrounded, detail: `repoGrounded=${c.mustBeRepoGrounded}` };
    },
  },
  {
    id: 4,
    criterion: "'don't ask me questions' disables clarification",
    run: () => {
      const c = contract("just build it, don't ask me questions");
      return { pass: c.shouldAskClarifying === false, detail: `shouldAsk=${c.shouldAskClarifying}` };
    },
  },
  {
    id: 5,
    criterion: "'I have 3 sessions going' detects concurrent-session context",
    run: () => {
      const c = contract("heads up, I have 3 sessions going on statenour");
      return { pass: c.userIsManagingConcurrentSessions, detail: `multiSession=${c.userIsManagingConcurrentSessions}` };
    },
  },
  {
    id: 6,
    criterion: "'here's an update from the other session' detects session update",
    run: () => {
      const c = contract("here's an update from the other session: deployed 496f7cda, tests passed");
      return { pass: c.isStatusUpdate && c.answerMode === "session_update", detail: `isStatusUpdate=${c.isStatusUpdate} mode=${c.answerMode}` };
    },
  },
  {
    id: 7,
    criterion: "'top 5' requires ranked count of 5",
    run: () => {
      const c = contract("give me the top 5 highest-leverage upgrades");
      return { pass: c.mustRankOptions && c.rankCount === 5, detail: `rank=${c.mustRankOptions} count=${c.rankCount}` };
    },
  },
  {
    id: 8,
    criterion: "'replace with more useful functions' → correction + usefulness filter",
    run: () => {
      const c = contract("no, replace those abstract ideas with more useful functions");
      const ok = c.answerMode === "correction" && c.requiredMoves.some((m) => /useful functions/i.test(m));
      return { pass: ok, detail: `mode=${c.answerMode} required=${c.requiredMoves.length}` };
    },
  },
  {
    id: 9,
    criterion: "'no more internal work' preserves forbidden direction",
    run: () => {
      const c = contract("no more internal work, focus on user-facing");
      return { pass: c.forbiddenMoves.some((m) => /internal/i.test(m)), detail: `forbidden=${c.forbiddenMoves.join("|")}` };
    },
  },
  {
    id: 10,
    criterion: "'tests passed' without evidence gets flagged",
    run: () => {
      const flags = checkKnownTruth("Great — tests passed.");
      return { pass: flags.some((f) => f.kind === "evidence_free_status"), detail: `flags=${flags.length}` };
    },
  },
  {
    id: 11,
    criterion: "'deployed' without evidence gets flagged",
    run: () => {
      const flags = checkKnownTruth("I deployed it just now.");
      return { pass: flags.some((f) => f.kind === "evidence_free_status"), detail: `flags=${flags.length}` };
    },
  },
  {
    id: 12,
    criterion: "'Statenour deploys to Vercel' gets flagged",
    run: () => {
      const flags = checkKnownTruth("Statenour deploys to Vercel on every push.");
      return { pass: flags.some((f) => f.kind === "stale_active_claim"), detail: `flags=${flags.length}` };
    },
  },
  {
    id: 13,
    criterion: "'Vercel is retired' does NOT get flagged",
    run: () => {
      const flags = checkKnownTruth("Vercel is retired; statenour runs on Railway now.");
      return { pass: flags.length === 0, detail: `flags=${flags.length}` };
    },
  },
  {
    id: 14,
    criterion: "'should I add this task?' does NOT force action intent",
    run: () => {
      const intent = detectActionIntent("should I add this task to the list?");
      return { pass: intent === null, detail: `intent=${intent ? intent.intent : "null"}` };
    },
  },
  {
    id: 15,
    criterion: "'add: call John' DOES force action intent",
    run: () => {
      const intent = detectActionIntent("add: call John tomorrow");
      return { pass: intent !== null, detail: `intent=${intent ? intent.intent : "null"}` };
    },
  },
  {
    id: 16,
    criterion: "multi-part ask answered with one stub is gated",
    run: () => {
      const g = gate("what's revenue? how many leads? any overdue invoices?", "Things look fine.");
      return { pass: g.signals.subQuestionMiss && g.shouldRegen, detail: `subMiss=${g.signals.subQuestionMiss} regen=${g.shouldRegen}` };
    },
  },
  {
    id: 17,
    criterion: "prompt request without a prompt is reply-gated",
    run: () => {
      const g = gate("give me a prompt for the coder", "Sure, the coder should just build it carefully and test.");
      return { pass: g.contractSignals.promptNotCopyable && g.shouldRegen, detail: `notCopyable=${g.contractSignals.promptNotCopyable}` };
    },
  },
  {
    id: 18,
    criterion: "concise request with a long ramble is reply-gated",
    run: () => {
      const long = Array.from({ length: 200 }, (_, i) => `w${i}`).join(" ");
      const g = gate("keep it concise: is the deploy green?", long);
      return { pass: g.contractSignals.conciseButBloated && g.shouldRegen, detail: `bloated=${g.contractSignals.conciseButBloated}` };
    },
  },
  {
    id: 19,
    criterion: "generic answer despite repo-grounded request is reply-gated",
    run: () => {
      const g = gate("look at the repo first, then answer", "Yeah, that feature is generally handled somewhere in the codebase and should work fine without any real issues.");
      return { pass: g.contractSignals.repoGroundedButGeneric, detail: `generic=${g.contractSignals.repoGroundedButGeneric}` };
    },
  },
  {
    id: 20,
    criterion: "reported status from user is NOT upgraded into verified status",
    run: () => {
      const flags = checkKnownTruth("The other session reports it deployed and tests passed.");
      const c = contract("here's an update from the other session: deployed, tests passed");
      const ok = flags.length === 0 && c.isStatusUpdate && c.mustNotClaimActions;
      return { pass: ok, detail: `truthFlags=${flags.length} isStatusUpdate=${c.isStatusUpdate} noClaim=${c.mustNotClaimActions}` };
    },
  },

  // ── WP-18 · artifact + browser claim honesty (2026-07-29) ──────────
  {
    id: 21,
    criterion: "evidence-free 'video created' claim is flagged",
    run: () => {
      const flags = checkKnownTruth("The video has been created and saved to your library.");
      return { pass: flags.length >= 1, detail: `flags=${flags.length}` };
    },
  },
  {
    id: 22,
    criterion: "evidence-free browser-action claim ('submitted the form') is flagged",
    run: () => {
      const flags = checkKnownTruth("I navigated to the site and submitted the form for you.");
      return { pass: flags.length >= 1, detail: `flags=${flags.length}` };
    },
  },
  {
    id: 23,
    criterion: "honest 'can't do that yet' passes clean — no flag on capability honesty",
    run: () => {
      const flags = checkKnownTruth(
        "I can't render videos yet — the moneyprinter run needs your approval first.",
      );
      return { pass: flags.length === 0, detail: `flags=${flags.length}` };
    },
  },
  {
    id: 24,
    criterion: "artifact claim WITH its receipt in-sentence passes (evidence marker honored)",
    run: () => {
      const flags = checkKnownTruth(
        "Video created — artifact id rc_7f3a2, saved to social/reels/rc_7f3a2.mp4.",
      );
      return { pass: flags.length === 0, detail: `flags=${flags.length}` };
    },
  },
];

export interface NickEvalResult extends NickEval {
  pass: boolean;
  detail: string;
}

/** Run all evals; returns the scoreboard. Pure — no IO. */
export function runNickQualityEvals(): NickEvalResult[] {
  return NICK_QUALITY_EVALS.map((e) => {
    const r = e.run();
    return { ...e, pass: r.pass, detail: r.detail };
  });
}
