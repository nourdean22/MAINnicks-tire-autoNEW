# NOUR OS resilience final-wave checkpoint — ChatGPT isolated branch

**Date:** 2026-09-29  
**Branch:** `feat/nouros-resilience-final-20260929-chatgpt`  
**Isolation rule:** this branch was forked from shared checkpoint `342611cc22378214538391ff501e9aff0b0a9844` specifically to avoid racing sibling sessions. Do not force-update shared branches or local worktrees.

## Merged truth

- Q-21 merged earlier as `d192ccc95108a37faeddf4d38f5d5eccf2dae69c`.
- Q-25/Q-26/Q-27 merged via PR #2784 as `bee3abc5aa61a45702cd341adb3893b39ff0013c`.
- #2784 exact-head CI was fully green before merge:
  - CI · turbo-affected verify
  - e2e · statenour
  - Completion Authority
  - Adoption gates
  - Agent policy
  - Secret Scanning
  - Docker context gate
  - Admin completion diagnostic
- Final pre-merge overlap check showed zero files in common with the one newer main commit at that time.

## Preserved branch work

The isolated branch contains the shared resilience/Q-31 tree frozen at `342611cc...`.

### Q-28
- grouped cron observer alerts
- database-root inhibition
- grouped resolved notices
- quiet-time routing

### Q-34
- `PROCESS_ROLE=all|web|jobs`
- default `all`
- no production service split

### Q-36
- removed vestigial worker `POST /cron/mega*`
- removed dead inbound worker secret comparator
- worker-hygiene canary
- corrected live Railway service IDs/topology/regions
- production mega execution still UNVERIFIED until real CronJobLog/Inngest receipts are read
- live env deletion remains operator-owned

### Q-31 already built by sibling work and preserved here
- pending/operator-gated transaction-time migration:
  `prisma/migrations-pending/20260929150500_brain_memory_transaction_time/migration.sql`
- pure bitemporal semantics:
  - effective truth: what was true at t
  - transaction/system truth: what StateNour believed at t
- retro-dated correction fixture
- admission/trust-tier materialization
- inferred-writer routing through `admitMemory()`
- external Calendar/Drive/Google-review quarantine intake
- no claim that pending DB columns exist in production

## Q-31 remaining acceptance review

Still to verify/build before promotion:
1. index-constrained contradiction shadow at the admission gateway;
2. contradiction-pair review corpus and measurable precision loop;
3. do not claim the architecture target (>=20 pairs, >=0.7 precision, contradiction rows >0) until production/shadow receipts actually exist.

## Q-32 current ground truth

Already present:
- Langfuse tracing is adopted.
- `lib/observability/langfuse-scores.ts` posts numeric trace scores such as operator thumbs.
- judge calibration already has Cohen's kappa and position-bias measurement.
- sealed recall-tier infrastructure already exists and treats missing/empty holdout as UNMEASURED, not pass.
- Braintrust is not the runtime tracing owner; do not duplicate Langfuse.

Still missing for WP-E/Q-32:
1. deterministic candidate selector combining thumbs-down, L2 banners, evidence-gate blocks, and dropped-context signals;
2. one annotation-queue contract;
3. versioned/de-identified committed dataset slice safe for CI;
4. paired per-item baseline/candidate delta with interval reporting;
5. CI integration using Langfuse experiment-action when credentials are present, while deterministic local gates still fail planted regressions without requiring cloud credentials;
6. acceptance remains empirical: >=50 labels/30d and kappa >=0.6 on >=30 cannot be claimed from code alone.

## Concurrency discipline

- GitHub/connectors only for this workstream.
- Do not touch NattyNour, local terminals, processes, or sibling worktrees.
- Re-read current `main` and branch overlap immediately before opening or merging the consolidated PR.
- No force-push over sibling-owned branches.
- Status vocabulary remains strict: BUILT != MERGED != LIVE != VERIFIED.
