# NOUR OS Carousel checkpoint — Q-21 / Q-25 / Q-26 / Q-27

**Checkpoint time:** 2026-09-29  
**Recovery branch:** `feat/nouros-carousel-q25-q27-20260929`  
**Status language:** BUILT means committed on the recovery branch. MERGED means present on `main`. LIVE/VERIFIED is used only with production evidence.

## Merged baseline

### Q-21 · Causal contact holdouts + Money / Outcome Board — MERGED

- Squash merge on `main`: `d192ccc95108a37faeddf4d38f5d5eccf2dae69c`.
- Final PR #2777 gates: Turbo affected verify PASS, StateNour E2E PASS, Adoption gates PASS, Completion Authority PASS, Agent Policy PASS, Secret Scan PASS, admin completion diagnostic PASS.
- Durable randomized 15% no-contact controls, explicit `heldout` terminal state, matured treatment/control cohorts, randomized incremental gross-revenue lift, and separate correlation metrics.
- Negative lift remains visible.
- Provider/carrier cost is still **UNMEASURED**; the board must not call incremental gross revenue “profit”.
- Contact-lane experiment flags remain default OFF.
- Q-21 migration remains operator-gated; this checkpoint does not claim a production schema apply.

## Active recovery branch

This branch was created from the then-current `main` before Q-21 merged and has since diverged because `main` continued moving. **Do not merge it blindly.** Reconcile/re-anchor it onto the latest `main` before opening its PR.

### Q-25 · RealityEvent registry + canonical event envelope — BUILT, NOT MERGED

Built on the recovery branch:

- `apps/statenour/lib/events/reality-event-registry.ts`
  - explicit registered RealityEvent families/types;
  - event-version and retention-class ownership;
  - rejects unknown types, explicit version mismatch, and retention-class mismatch;
  - payload validation by family.
- `RealityEvent` schema extension:
  - `event_version`
  - `occurred_at`
  - `correlation_id`
  - `causation_id`
  - `retention_class`
- Additive pending migration at:
  - `apps/statenour/prisma/migrations-pending/20260929123500_reality_event_envelope/migration.sql`
- Existing `DomainEventEnvelope` remains the shared event-envelope system; RealityEvent is adapted into it rather than creating a second spine.
- Episode events now carry explicit eventVersion/retentionClass/correlation/causation lineage.
- Nick’s `evidenceLedger` input accepts the governed envelope.
- `webExperimentResolve` emits a versioned experiment verdict envelope.
- RealityEvent writes remain inside the existing bridge receipt/idempotency transaction.
- Focused tests added for registry refusals, envelope adaptation, sync-door validation, and Episode lineage.

**Not claimed:** migration applied to production, production reads of the new columns, or full-branch CI green.

### Q-26 · Freshness and volume contracts — BUILT, NOT MERGED

Built:

- `apps/nickstire/shared/businessDataContracts.ts`
  - dbt-style source freshness semantics without adding dbt;
  - same-weekday seasonal volume z-scores without adding Elementary;
  - explicit `fresh|warn|error|unmeasured` freshness states;
  - explicit `normal|warn|error|unmeasured` volume states.
- Critical honesty boundary:
  - ShopDriver invoice freshness is based on a real successful sync receipt.
  - Event tables such as leads/callbacks are **not** declared stale merely because a day has zero new business.
- `MetricEnvelope` can carry an optional typed freshness verdict.
- `data-accuracy-check` is wired to the contracts:
  - invoice freshness;
  - invoice/leads/callback same-weekday volume;
  - volume judgment suppressed when invoice-mirror freshness is not trustworthy;
  - a clean run reports what it measured rather than the ambiguous old `All data clean`.

**Not claimed:** full CI green, production cron observation, or final threshold calibration from live history.

### Q-27 · BG/NBD + Gamma-Gamma customer-value ranking — BUILT IN PART, NOT MERGED

Built:

- `apps/nickstire/shared/customerValueModel.ts`
  - BG/NBD P(alive);
  - BG/NBD conditional expected purchases;
  - Gauss hypergeometric 2F1 helper for the required formula;
  - Gamma-Gamma conditional expected transaction value;
  - composite ranking score.
- CDNOW reference parameters are pinned from the architecture register.
- Golden tests reproduce the documented CDNOW/lifetimes expected-purchase examples within tolerance and Gamma-Gamma published examples within cents-level tolerance.
- One math correction was caught during implementation: the CDNOW fit has `a < 1`; the singularity is at `a = 1`, so the kernel must not reject every `a <= 1`.
- `apps/nickstire/server/lib/customerValueRanking.ts` is started as a read-only ranking service:
  - same-shop-day invoice rows collapse into one purchase period;
  - no messaging/action side effects;
  - output explicitly says `rankingOnly: true`;
  - output calibration is `external-cdnow-reference-not-shop-fitted`.

**Still to finish before PR:** focused ranking-service tests, admin/read endpoint wiring, compile/type verification, and current-main reconciliation.

## Next execution order

1. Finish Q-27 read endpoint + tests.
2. Add truthful completion evidence/current-truth notes for Q-25/26/27.
3. Re-anchor the branch onto latest `main` without dropping intervening work.
4. Run focused tests, TypeScript/Prisma/SQL checks, then open PR.
5. Repair CI and merge only when green.
6. Continue:
   - Q-28 Alertmanager semantics in cron observer;
   - Q-34 `PROCESS_ROLE=all|web|jobs`, default all, no default behavior change;
   - Q-36 worker hygiene;
   - Q-31 memory admission + `expired_at` + shadow contradiction check;
   - Q-32 Langfuse eval loop + de-identified committed recall corpus.

## Safety / operator gates carried forward

- Do not touch NattyNour worktrees/processes used by other active sessions.
- Do not claim a pending migration is live.
- Do not arm customer-contact experiments automatically.
- Q-27 remains ranking-only until Nick’s own data has a measured calibration/eval; it must not silently become a send or revenue promise.
- Main is moving quickly: re-read current `main`, open PRs, and changed-file overlap immediately before every rebase/merge.
