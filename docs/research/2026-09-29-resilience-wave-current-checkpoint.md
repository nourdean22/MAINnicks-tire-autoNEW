# NOUR OS consolidated resilience wave — authoritative recovery checkpoint

**Date:** 2026-09-29  
**Branch:** `feat/nouros-resilience-q28-q32-current-20260929`  
**Base:** `b81fd95d876e9cfc0c47d3df2b41f6a833213d8c`  
**Safety:** GitHub/connector-only. Do not touch NattyNour/local worktrees/processes while sibling sessions are active.

## Merged truth

- Q-21 merged as `d192ccc95108a37faeddf4d38f5d5eccf2dae69c`.
- Q-25/Q-26/Q-27 merged through PR #2784 as `bee3abc5aa61a45702cd341adb3893b39ff0013c`.
- #2784 passed exact-head Turbo affected verify, StateNour E2E, Completion Authority, Adoption Gates, Agent Policy, Secret Scanning, Docker context, and admin diagnostic before merge.

## Hidden/recovered workstream

The visible chat did not show all completed execution. GitHub branch
`feat/nouros-resilience-q28-q34-q36-q31-q32-20260929` is the durable source of truth for that hidden work.

At recovery it carried **43 commits / 33 changed files** beyond the #2784 merge point:
- Q-28 cron observer grouping, DB-root inhibition, recovery notices, quiet routing.
- Q-34 `PROCESS_ROLE=all|web|jobs`, default `all`, no live Railway split.
- Q-36 worker hygiene and live Railway truth corrections.
- substantial Q-31 memory work:
  - admission wiring for inferred journal/session/belief/distillation writers;
  - Drive/Calendar/Google Reviews external-content quarantine;
  - bitemporal query kernel;
  - pending transaction-time migration;
  - focused bitemporal tests.

That source branch is **not** being force-rebased or rewritten because other sessions may still own it.

## Current-main reconciliation

From #2784 merge `bee3abc5...` to current base `b81fd95d...`, sibling sessions added 11 commits.

A file-level collision census found only two overlaps with the recovered 33-file wave:
- `apps/nickstire/docs/operations/capability-ledger.json`
- `apps/nickstire/docs/operations/REALITY-LEDGER.md`

All recovered Q-28/Q-34/Q-36/Q-31 source files are disjoint from those sibling changes and can be transplanted onto this branch. The two ledgers must be merged semantically from current main and regenerated.

## Q-31 audit — important truth correction

Recovered Q-31 work is substantial but **not complete yet**.

What is built:
- `memory-bitemporal.ts` cleanly separates:
  - effective time: “what was true at t?”
  - transaction time: “what did StateNour believe at t?”
- pending additive migration `20260929150500_brain_memory_transaction_time` adds
  `transaction_from_at` + `transaction_expired_at` and indexes;
- `memory-admission.ts` materializes trust tier and effective-window metadata;
- inferred semantic writers have been moved toward `admitMemory()`;
- external Drive/Calendar/Reviews pass through the incumbent Guardian quarantine before memory admission.

What is still missing before Q-31 can be called complete:
1. transaction-time expiry must be wired at the actual supersession boundary **before** the supersession mutation;
2. all explicit supersession paths must be covered or intentionally bounded;
3. the new pending migration must be registered in the post-#2790 operator-only apply endpoint and drift test, so it is one request away without auto-applying;
4. the contradiction shadow / acceptance evidence must be made explicit;
5. production migration remains operator-gated and must not be claimed applied.

## Q-32

Not yet recovered as implemented. Build it on this branch by reusing the existing Langfuse stack:
- deterministic selector → one annotation queue;
- versioned dataset;
- `langfuse/experiment-action` CI experiment;
- paired per-item delta + uncertainty interval;
- different-model-family judge;
- committed de-identified recall slice;
- planted-regression fail + A/A pass canaries.

Do not add Braintrust as a duplicate eval platform.

## Merge strategy

One consolidated PR for the resilience / memory / eval wave:
- recover proven Q-28/Q-34/Q-36/Q-31 changes onto this current-main branch;
- complete Q-31;
- complete Q-32;
- update capability/current-truth/evidence artifacts;
- run one expensive exact-head CI wave;
- squash merge only when current-main overlap is rechecked and all required gates are green.

**Vocabulary:** BUILT != MERGED != LIVE != VERIFIED. Pending migrations and live env changes remain operator-owned until explicit apply/read-back proves otherwise.
