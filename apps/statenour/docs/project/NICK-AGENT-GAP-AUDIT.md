# Nick Agent Quality — Gap Audit

**Date:** 2026-06-09 · **Branch:** `statenour-nick-agent-gap-audit` · **Base:** `origin/main` @ `c4716a90` (includes domain-missions `237e064b` + Dockerfile fix `496f7cda`).
**Scope:** agent *behavior quality* only — make Nick less dumb, less fake-confident, more precise, more constraint-respecting, better at separating **reported** vs **verified** status. NOT UI/dashboards/docs/migrations.

## Method

First-hand reads (full file): `turn-intelligence.ts`, `reply-gate.ts`, `query-shape.ts`, `chat-mode.ts`, `fact-check.ts`, `chat/action-claim-detector.ts`, `output-critic.ts`. Recon (grep/ls): module existence, test coverage, the existing eval scripts, action stack. Items not read full are marked *(recon)* below and classified conservatively.

## Concurrent-session safety

Three live worktrees detected:
- `statenour-domain-missions` @ `496f7cda` — domain rollout (mine, complete + merged into origin/main).
- `statenour-truth-intelligence-wave` @ `dc5696c1` — **ACTIVE** "useful function wave": Claude Session Importer, What-Changed digest, Task-rescue scanner, Action-receipt feed, Command shortcuts.
- `statenour-nick-agent-gap-audit` (this) @ `c4716a90`.

**Hard avoid (function-wave owns these):** session importer, receipt FEED, command-shortcut router, what-changed, task-rescue. → candidate components #4, #6 (feed), #12 (importer), #13 marked **DEFER/COLLIDE**. I will add only pure *classification flags* (`isStatusUpdate`, `isMultiSessionContext`) inside the response-contract — these are detection, not the importer feature, and touch no shared file.

**Also do not touch:** Dockerfile, migration 0010, domain seed/migrate endpoint, mission classifier, `config/repos.ts`, `config/crons.ts`, CURRENT-TRUTH / stale-doc guard / runbooks (read-only).

## Existing-stack map (what's already there)

| Layer | Module | Current capability |
|---|---|---|
| Turn classify | `turn-intelligence.ts` | intent (9) · outputShape (10) · complexity · urgency · domain · temperature · CoT/2-pass flags. Pure. **No** answer-mode/length/constraint fields. |
| Query shape | `query-shape.ts` | shape (yes_no/explain/plan/list/factual/casual) → tokenBudget · `needsTool` · factualHints · extracts requested list count. Pure. |
| Mode/prune | `chat-mode.ts` | quick/standard/deep → tool-catalog pruning + context scope. Not answer-contract. |
| Reply gate | `reply-gate.ts` | post-stream signals: empty · stub · iDontKnow · subQuestionMiss · hedgeStorm + absorbs critic. **No** request-compliance checks. Pure. |
| Output critic | `output-critic.ts` | 4-axis (specificity/cliché/antiNour/length) + hedge gate + 7-axis content critic. Measures **universal** quality, **not** what the user *requested*. Pure. |
| Fact check | `fact-check.ts` | extracts $/count/%/date/name claims, verifies vs **this turn's** brain context (substring). **No** known-false/stale-truth notion, **no** evidence-free-status check. Pure. |
| Action stack | `chat/action-intent-detector.ts` · `chat/action-claim-detector.ts` · `chat/action-result-verifier.ts` · `action-vocab.ts` · `tool-telemetry`/circuit-breaker | vocab-driven verb+object claim detection · per-sentence hedge isolation · cross-checks claims vs fired tools · blocked-tool pruning. Strong. Covers **chat-tool** actions only. |

## Candidate-component classification (the 18)

| # | Component | Existing module(s) | Gap | Risk | Decision |
|---|---|---|---|---|---|
| 1 | Response contract builder | — (turn-intel + query-shape are inputs) | No unified contract (length/answerMode/format/constraints) | low | **MISSING → BUILD** `response-contract.ts` |
| 2 | Nour mode detector | turn-intel.intent · chat-mode | No Nour modes (copy_paste_prompt, operator_command, session_update, correction, wait_mode) | low | **PARTIAL → fold into #1** answerMode |
| 3 | Executive decision frame | turn-intel `decision` + CoT prompt | No deterministic must-give-next-move / must-rank | low | **PARTIAL → #1 (mustGiveNextMove) + #C (flag vague "I can…")** |
| 4 | Multi-session control tower | — | function-wave building importer | — | **DEFER/COLLIDE** (add only `isMultiSessionContext` flag in #1) |
| 5 | Truth/staleness arbiter (replies) | docs guard only (build-time) | Nothing guards **replies** for stale infra claims | low | **MISSING → BUILD** `known-truth-guard.ts` |
| 6 | Evidence/receipt governor | action-claim/result (tool actions) | engineering-status ("deployed") uncovered; receipt FEED = function-wave | low | **PARTIAL → evidence-free-status check in #D**; FEED **DEFER** |
| 7 | Tool/action reliability governor | action-intent + action-claim + action-result + telemetry | — | — | **ALREADY EXISTS — do not rebuild** |
| 8 | Prompt v2 parity/eval | `prompt/v2/*` *(recon)* | parity eval absent | med | **NOT NOW** (risky, out of behavior-quality scope) |
| 9 | Answer quality eval harness | `run-quality-bench` (live-model) · `quality-sweep-v2` (code audit) | no **deterministic, no-LLM** pack for contract/gate/truth logic | low | **MISSING → BUILD** eval pack (#E) |
| 10 | Reply-gate upgrades | `reply-gate.ts` | no request-compliance checks | low | **PARTIAL → EXTEND** (#C) |
| 11 | Fact-check / known-truth | `fact-check.ts` | no known-false/stale notion | low | **PARTIAL → sibling** `known-truth-guard.ts` (#D); don't modify fact-check core |
| 12 | Session update parser | — | function-wave importer | — | **DEFER** (add only `isStatusUpdate` flag in #1 + pure tests) |
| 13 | Command shortcut router | — | function-wave owns | — | **DEFER/COLLIDE** |
| 14 | User preference/style enforce | system-prompt *(recon)* | no deterministic concise/format post-check | low | **PARTIAL → #1 + #C** |
| 15 | Clarifying-question suppression | — | nothing enforces "don't ask when told not to" | low | **MISSING → #1 flag + #C check** |
| 16 | Concision enforcement | output-critic length axis (shape-tied) | not tied to explicit "concise" request | low | **PARTIAL → #1 + #C** |
| 17 | Top-N/ranking enforcement | query-shape extracts count | reply count never checked | low | **MISSING → #C check** |
| 18 | "Don't claim verified unless verified" | action-claim (tool actions) | engineering-status claims uncovered | low | **PARTIAL → #D** |

## Phase-1 — true gaps to build (all pure · tested · collision-safe)

**B. `lib/ai/response-contract.ts` (new) — the keystone.** Consumes `TurnSignal` + `QueryShape` + new Nour-mode detection → one `ResponseContract` (answerMode, length, outputFormat, shouldAskClarifying, mustBeRepoGrounded, mustIncludeEvidence, mustNotClaimActions, mustRankOptions+count, mustGiveNextMove, userIsCorrectingDirection, userIsAskingForCoderPrompt, userIsManagingConcurrentSessions, isStatusUpdate, forbidden/required moves, reasons). Pure, no IO. Covers #1,#2,#3,#14,#15,#16,#17(detect),#4/#12 flags.

**C. extend `lib/ai/reply-gate.ts` — `runReplyGateWithContract(reply,userText,critic,turnSignal,contract)`.** Adds request-compliance checks: concise-requested-but-bloated · prompt-requested-but-not-copyable · top-N-wrong-count · repo-grounded-but-generic · told-not-to-ask-but-asked · vague "I can…" non-completion · evidence-free verified/deployed/tests-passed claim. Existing `runReplyGate` untouched (backward compatible). Covers #10,#15,#16,#17,#18(partial).

**D. `lib/ai/known-truth-guard.ts` (new).** Pure registry of forbidden **active** claims (statenour→Vercel, statenour-master=prod, standalone statenour-os=prod, codex/ollama-local=prod) + evidence-free engineering-status claims (deployed/tests passed/created without receipt context), **negation + reported-speech aware** ("Vercel is **retired**" safe; "reported by the session" safe). Guards **replies**, not docs. No DB, no repo reads. Covers #5,#11,#18(status).

**E. Nick quality eval pack — `tests/ai/nick-quality-evals.test.ts` + `scripts/run-nick-quality-evals.ts`.** Deterministic, no model/DB. Encodes the 20 acceptance criteria as fixtures over B/C/D + existing detectors. Covers #9.

**Deferred (collision):** #4 control-tower, #6 receipt-feed, #12 importer, #13 shortcuts → function-wave. **Not now:** #8 prompt-v2 parity. **Leave alone:** #7 (exists).

## Build order
1. (this doc — commit alone)
2. `response-contract.ts` + tests
3. `reply-gate` extension + tests
4. `known-truth-guard.ts` + tests
5. eval pack + runner

## Verification plan
Per commit: targeted vitest + `tsc`. Pure modules → fast deterministic tests, no LLM/DB. Full build/vitest only if host contention (concurrent sessions + Windows turbo) allows; else targeted green gates + honest classification. **No** prod data, **no** migration, **no** provider/prompt-v2 flips.
