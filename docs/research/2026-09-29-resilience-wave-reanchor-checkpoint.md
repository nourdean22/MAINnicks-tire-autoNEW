# NOUR OS resilience-wave reanchor checkpoint

**Date:** 2026-09-29  
**Branch:** `feat/nouros-resilience-q28-q34-q36-q31-q32-20260929`  
**Purpose:** durable continuation point while other sessions are active. GitHub/connector-only; do not touch NattyNour/local worktrees/processes.

## Merged repo truth

- Q-21 Money / Outcome Engine merged earlier as `d192ccc95108a37faeddf4d38f5d5eccf2dae69c`.
- Q-25/Q-26/Q-27 merged through PR #2784 as `bee3abc5aa61a45702cd341adb3893b39ff0013c`.
- #2784 exact-head acceptance before merge:
  - Turbo affected verify: success
  - StateNour E2E: success
  - Completion Authority: success
  - Adoption Gates: success
  - Agent Policy: success
  - Secret Scanning: success
  - Docker context gate: success
  - Admin completion diagnostic: success
- Final collision check before #2784 merge found zero overlap with the newer sibling #2783 commit.

## Resilience wave preserved on prior branch

Source branch: `feat/nouros-resilience-q28-q34-q36-20260929`.

Built there and awaiting semantic transplant onto this fresh branch:
- Q-28 cron observer grouping + database-root inhibition + grouped resolved notices + quiet-time routing.
- Q-34 `PROCESS_ROLE=all|web|jobs`, default `all`, no production service split.
- Q-36 StateNour worker hygiene:
  - remove vestigial worker `POST /cron/mega*` routes;
  - remove dead inbound secret comparator;
  - worker-hygiene canary;
  - correct live Railway deploy facts and cross-app boundary docs.

Live Railway facts read-only on 2026-09-29:
- exactly four production services: Nick's, StateNour web, StateNour worker, Redis;
- Nick, StateNour web, StateNour worker: one replica each in `us-east4-eqdc4a`;
- Redis: one replica in `us-west2`;
- worker service id `5441c378-3bab-4bb7-958f-36961159f5fe`;
- Nick service id `a6234c8d-1ff4-478f-9085-654954b54e97`;
- worker has no Railway cron schedule and no service/custom domains.

Truth boundary:
- Inngest mega functions are registered.
- `INNGEST_MEGA_V2` exists in Railway config but its value is redacted by the connector.
- Production mega morning/evening firing remains UNVERIFIED until a real CronJobLog/Inngest receipt is read.
- Live worker env-variable deletion remains operator-owned.

## Next execution on this branch

1. Transplant Q-28/Q-34/Q-36 onto this branch while preserving the newly merged Q-25/Q-26/Q-27 ledger + memory entries.
2. Continue Q-31:
   - wire high-volume agent-inferred semantic writers through `admitMemory()`;
   - add transaction-time `expired_at` before supersession mutation;
   - enforce interval-overlap rule for invalidation;
   - add retro-dated correction fixture and contradiction-shadow coverage;
   - migration remains pending/operator-applied.
3. Continue Q-32:
   - reuse existing Langfuse;
   - deterministic selector -> one annotation queue -> versioned dataset -> CI experiment action;
   - de-identified committed recall slice;
   - no Braintrust duplicate.
4. One consolidated PR, one expensive CI wave, exact-head verification, then squash merge if green.

## Status vocabulary

BUILT != MERGED != LIVE != VERIFIED. Operator-gated migrations and live env changes remain pending unless explicit read-back proves otherwise.


## 2026-09-29 concurrency update

A sibling session landed Q-31 work on this branch before this checkpoint was written. Do not overwrite it. The commits include:
- staged transaction-time migration `20260929150500_brain_memory_transaction_time`;
- deploy-safe bitemporal query kernel + tests;
- admission/trust-tier materialization;
- admission wiring for journal, session distillation, belief harvesting, higher-order distillation;
- quarantine intake for Calendar, Drive, and Google reviews;
- external-memory intake and Drive accounting.

These changes are BUILT ON BRANCH, not yet reviewed/merged/live. Review them against the Q-31 acceptance criteria before promotion.

Current main advanced four commits after #2784. A merge-base comparison from `bee3abc5...` found exactly one overlapping source file between those main changes and this branch:
- `apps/statenour/lib/brain/pipeline-controller.ts`

All other current-main changes are disjoint. Do not force-rebase this active branch while sibling sessions may still own it. Reconcile the single overlap semantically on a final fresh branch immediately before opening the consolidated PR.
