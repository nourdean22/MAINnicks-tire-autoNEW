# NOUR resilience final consolidation checkpoint — 2026-09-29

## Authority
This checkpoint records the consolidated branch state before the one final PR. It does **not** claim merge, deploy, live behavior, production migration application, or empirical Q-32 acceptance.

- Integration branch: `feat/nouros-resilience-final-current-chatgpt-20260929`
- Current-main reconciliation commit: `80e031ac88d0b35443f1986e8dc05ad5faab97ae`
- Main incorporated at that point: `223079d33407b9a6091e34a55032ea935d788e9e` (#2793), including #2789 immediately before it.
- Sibling collision census before reconciliation: zero overlapping files with #2789 and #2793.
- Historical source branches remain untouched; no force push/rewrite was used.

## Already merged before this wave
- Q-21 Money / Outcome Engine: #2777, squash `d192ccc95108a37faeddf4d38f5d5eccf2dae69c`, with follow-up #2785.
- Q-25/Q-26/Q-27: #2784, squash `bee3abc5aa61a45702cd341adb3893b39ff0013c`. Exact-head required checks were green before that merge.
- Capability ledger was corrected accordingly: Q-25/Q-26/Q-27 are codeState=merged and operationalState=unit_verified, without inventing production proof.

## Consolidated BUILT scope

### Q-28 — cron observer resilience
- grouped alert incidents rather than child-alert spam
- inferred common DB-root inhibition requires multiple distinct connection-shaped job failures
- observer DB-query failure is itself a truthful root-availability signal
- quiet-hour defer semantics preserve incident/resolution truth
- grouped resolved notifications
- incumbent observer retained; no new external Alertmanager stack

### Q-34 — explicit process ownership
- `PROCESS_ROLE=all|web|jobs`
- default remains `all`
- `web` suppresses background ownership
- `jobs` owns background work while health/admin HTTP remains available
- invalid roles fail loudly
- no Railway service split is claimed or performed here

### Q-36 — worker hygiene/topology truth
- removes vestigial worker `/cron/mega` and `/cron/mega-evening` entry points
- removes dead inbound cron-secret comparator while preserving boot-time `CRON_SECRET` required by outbound worker→StateNour forwards
- pins no worker reads of `DATABASE_URL`, `DIRECT_URL`, or `GITHUB_TOKEN`
- keeps the finite reel-render timeout
- docs reflect the measured four-service Railway topology
- actual production mega morning/evening execution remains UNVERIFIED without a real CronJobLog/Inngest receipt

### Q-31 — admission + bitemporal memory truth
The incumbent memory architecture remains canonical.

- high-volume inferred writers route through `admitMemory()`
- external Drive/Calendar/Google Reviews intake passes through incumbent Guardian/quarantine handling
- weaker/parked candidates cannot mutate the winning canonical row's provenance, trust, confidence, or validity metadata
- effective time and transaction/system time remain distinct
- retro-dated corrections do not pretend the system knew them earlier
- canonical replacement uses the deeper `memory-manager.ts` history-freezing / transaction-window semantics
- explicit operator contradiction resolution uses row-locked `memory-transaction-time.ts`
- losing-memory mutation has one owner: `cleanupResolvedContradiction()`
- bounded admission-time contradiction shadow reuses the existing contradiction row contract; normal ticker/page hides shadow rows
- direct-writer ratchet remains part of the acceptance surface

Pending migration:
`apps/statenour/prisma/migrations-pending/20260929150500_brain_memory_transaction_time/migration.sql`

It is registered with the current operator apply path and remains operator-gated. This checkpoint does **not** claim the production columns exist.

### Q-32 — Langfuse eval loop
No Braintrust duplicate was introduced.

Single deterministic owner: `lib/evals/q32-regression.ts`.
- signals: thumbs-down, L2 verifier banner, evidence-gate block, actual context-threshold drop
- advisory/over-budget context receipts do not masquerade as actual drops
- candidate export is metadata-only and carries a content hash, not raw message text
- one Langfuse annotation-queue adapter; missing config is a clean no-op
- thumbs-down and deterministic runtime signals queue existing traces for review
- runtime selection was reconciled away from the discarded duplicate `q32-eval-loop.ts` module
- judge-family classification is centralized and fails closed for unknown model families
- paired PPI interval + Cohen's kappa mechanics
- one committed de-identified recall corpus contract
- optional Langfuse cloud experiment action is conditional and remains disabled until dataset/config read-back exists

Empirical acceptance remains UNMEASURED:
- >=50 labels in 30 days
- Cohen's kappa >=0.6 on >=30 double-labeled items
- production/cloud dataset read-back

## Pre-CI defects caught during consolidation
1. The isolated runtime wiring still imported a duplicate Q-32 stats/selector module. Fixed to use `q32-regression.ts`.
2. The recovered Q-32 model-family classifier treated an unknown model string as a known family. Fixed to fail closed; the runtime judge now delegates to the same classifier.

## Truth boundary before PR
BUILT: Q-28/Q-34/Q-36 + consolidated Q-31/Q-32 code and focused tests.

NOT YET CLAIMED:
- merged to main
- deployed/live
- exact-head consolidated PR CI
- production Q-31 transaction columns
- a live PROCESS_ROLE web/jobs service split
- Railway worker env deletion
- live mega morning/evening fan-out receipt
- Q-32 live-label volume or kappa target

Next action: open one consolidated PR, run the expensive CI once, repair legitimate reds on the same branch, then re-read current main and squash merge only on an exact-head green result.

## Final pre-CI hardening added after the initial checkpoint
- Q-32 experiment source had escaped template-literal delimiters/interpolations; repaired before acceptance.
- Q-32 runtime judge independence now fails closed when either candidate or judge family is unknown. Hosting layers such as Venice/Ollama/custom gateways are not treated as model families.
- The pinned Langfuse experiment action was checked at its pinned SHA: it supplies `@langfuse/client`, supports `dataset_version`, and does not require a duplicate app dependency.
- Q-31 now has one shared transaction-column availability probe/cache in `memory-bitemporal.ts`; `memory-transaction-time.ts` reuses it.
- Q-31 prepared canonical replacements now have full compensation: transaction window, effective validity/verification state, and provisional snapshot are rolled back on failure. With supersession/history mode enabled, a failed history preparation/replacement returns the existing canonical row rather than silently falling through to a legacy overwrite.
- `memory-bitemporal-runtime.test.ts` pins that fail-closed compensation contract.
