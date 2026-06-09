# NEXT-INTELLIGENCE-WAVE — Statenour

> **Status:** Active plan (drafted 2026-06-09). The truth-cleanup half of this
> wave shipped first (`01c5438c`). This doc ranks the intelligence upgrades and
> tracks what ships vs. defers. Current truth: [`../CURRENT-TRUTH.md`](../CURRENT-TRUTH.md).

## Premise

Statenour already has strong cognition (BrainMemory + pgvector recall + BGE
rerank, mastery/XP, a 5-layer fabrication-defense stack, an action-write
verifier wired to the `chat_claim_warn` chip). The gaps this wave closes are
**reliability/trust**, not raw capability:

1. Nothing **measures** whether Nick/agents actually know current truth
   (deploy path, source-of-truth, action honesty, migration safety).
2. Future agents inherit prose, not **operating procedure** — no structured
   "how to work safely here" they can load.
3. Action honesty is enforced reactively (detector regex + verifier) but there's
   no normalized **receipt** contract a summary can be checked against.
4. Useful knowledge surfaced in chat/journal doesn't convert to **action**.

## Ranking (daily-use × trust × future-agent × low-regression × fit × cost)

| Rank | Upgrade | Why | Regression risk | Ships this wave |
|---|---|---|---|---|
| 1 | **Memory evals + truth scoreboard** (P5) | Catches stale memory/docs/wrong-deploy/false-claim drift deterministically; protects every future session | **Very low** — new dir, no DB writes, no external API by default | **YES** |
| 2 | **Agent runbooks foundation** (P6) | Gives future sessions safe operating procedure (migrations, deploys, classifier, stale-doc, boundary) | **Very low** — typed catalog + md + a guard | **YES** |
| 3 | **Action receipts / no-false-claims** (P7) | Normalizes "did it actually happen?" into a typed receipt; hardens the existing verifier | **Medium** — touches chat finalize seam; kept additive | **YES (additive v1)** |
| 4 | **Knowledge→action converter** (P8) | One-click idea→task/rule/decision; suggestion-only, no silent writes | **Low-medium** — pure lib + one surface | **YES (lib + tests; UI wiring minimal)** |
| 5 | Generative UI confirm cards (P9) | Buttons instead of long text for uncertain/sensitive actions | Medium (UI) | **DEFER** — depends on P7/P8 landing clean |
| 6 | System jobs/cron console (P10) | Transparency for crons/jobs | Low | **DEFER** — already exists (`/system/crons`, `cron-runs`, `deployment-truth`); improve via runbook + freshness check instead of a new surface |

## P5 — Memory evals + truth scoreboard (ship)

- **Files:** `lib/evals/memory-eval-types.ts`, `memory-evals.ts` (dataset),
  `memory-eval-runner.ts` (deterministic), `scripts/run-memory-evals.ts`
  (`pnpm eval:memory`), `app/api/system/memory-evals/route.ts` (owner GET),
  `components/system/memory-evals-card.tsx`, `tests/lib/evals/memory-evals.test.ts`.
- **Data model impact:** none (no DB). Runner is read-only.
- **Categories:** deployment_truth, source_of_truth, stale_doc_detection,
  migration_safety, action_honesty, task_classification, memory_kind,
  business_context, personal_os_context, provider_truth. ≥20 evals.
- **Determinism:** each eval declares `expectedFacts` + `forbiddenClaims`; the
  runner scores a candidate answer string by required-fact presence + forbidden
  absence. With no answer source it runs as **dataset validation** (no LLM).
  LLM judging is an explicit future flag, OFF by default.
- **Tests:** dataset validity (unique ids, ≥20, every eval has facts +
  forbidden, forbidden covers the retired-deploy/false-claim set), runner purity
  (no DB import).
- **Rollback:** delete the dir + script + route + card + the `eval:memory`
  script line. Nothing else depends on it.
- **Anti-overbuild:** no auto-LLM spend; no cron; no new schema.
- **Success metric:** `pnpm eval:memory` green in CI; the card shows
  pass/fail per category so a future agent/operator can see truth drift at a glance.

## P6 — Agent runbooks foundation (ship)

- **Files:** `lib/runbooks/types.ts`, `lib/runbooks/catalog.ts`,
  `docs/runbooks/*.md` (+ `docs/runbooks/index.md`),
  `scripts/check-runbooks.ts` (`pnpm check:runbooks`),
  `tests/lib/runbooks.test.ts`.
- **8 active runbooks:** current-truth, claude-code-session, migrations-and-deploys,
  task-classifier-domain-missions, stale-doc-cleanup, action-honesty-and-receipts,
  memory-evals, nickstire-vs-statenour-boundary.
- **Guard:** active runbooks can't carry critical stale-deploy terms (reuse the
  stale-doc term set), need required fields + `lastVerified`, and `relatedFiles`
  must exist on disk or be marked external.
- **Rollback:** delete the dir + md + script + test + `check:runbooks` line.
- **Success metric:** AGENTS.md + CURRENT-TRUTH link the index; `pnpm check:runbooks` green.

## P7 — Action receipts (ship, additive v1)

- **Reuse, don't duplicate:** the existing action-write verifier (`75e48458`),
  `chat_claim_warn` chip, `action-claim-detector.ts`, and tool `sideEffecting`
  metadata. v1 = a normalized `ActionReceipt` type + `toReceipt()` normalizer +
  a `canClaimDone(receipts)` guard, with tests on core tools (createTask,
  completeTask, pinMemory, journalDecision). **No chat-route restructure** — the
  normalizer is a pure utility the finalize seam can adopt incrementally.
- **Rollback:** delete `lib/ai/receipts/*` + tests; nothing imports it until wired.

## P8 — Knowledge→action converter (ship lib + tests)

- **Files:** `lib/knowledge/action-converter.ts` + `tests/lib/knowledge/action-converter.test.ts`.
- Pure heuristic v1 (suggestion-only, `requiresApproval` for side-effects); one
  surface wired only if trivial. No silent writes.

## Verification gates (every phase)

`pnpm typecheck` (0) · targeted vitest · `pnpm check:stale-docs` · `pnpm check:runbooks`
(P6+) · `pnpm eval:memory` (P5+). Full `pnpm test` before the final commit.
