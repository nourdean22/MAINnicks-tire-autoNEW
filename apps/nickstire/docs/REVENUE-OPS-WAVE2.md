# Revenue Operating System — Wave 2 Closure

## Scope

This wave closes five measurement and attribution gaps without silently upgrading inferred evidence to verified revenue.

1. Statenour executive GSC totals now use the official no-dimension Search Console aggregate.
2. Attribution decisions are durable, reversible, and attributable to an admin.
3. Reconciliation runs are idempotent and retain run-level diagnostics.
4. The journey surface distinguishes call, lead, booking, arrival, repair order, and paid invoice.
5. Legacy VAPI evaluation rows can be dry-run and selectively backfilled into the versioned measurement contract.

## Migration

Apply migration 0069 before using the reconciliation or decision endpoints:

```bash
cd apps/nickstire
pnpm exec tsx scripts/migrations/apply-revenue-attribution-closure.ts
```

The applicator is idempotent and verifies all four required tables.

## Reconciliation cadence

The existing dashboard-sync scheduler invokes a reconciliation pulse every 15 minutes during business hours. The pulse reads the latest durable run and executes at most once every two hours.

Default window:

- calls from the prior 7 days
- paid invoices through 14 days after the call window
- existing current decisions are preserved
- inferred and ambiguous candidates are never auto-confirmed

## Admin procedures

`revenueAttribution.reconciliationRuns`
: Recent run status, counts, errors, and timestamps.

`revenueAttribution.reviewQueue`
: Latest unresolved inferred or ambiguous candidates.

`revenueAttribution.reconcile`
: Manual idempotent reconciliation trigger for a supplied window.

`revenueAttribution.resolve`
: Creates a new current decision and supersedes the prior decision while retaining history.

`revenueAttribution.journey`
: Evidence-aware call-to-revenue chain.

`revenueAttribution.legacyBackfill`
: Dry-run by default. Apply mode requires the exact confirmation phrase `APPLY_LEGACY_VAPI_BACKFILL`.

## Evidence rules

- Direct call → lead → uniquely claimed paid invoice is verified.
- An invoice claimed by multiple leads is ambiguous, even when the call has a direct lead link.
- Exact phone, bounded time, and service overlap remain inferred until reviewed.
- Booking confirmation is not vehicle arrival.
- Arrival and repair-order stages remain `not_connected` unless a reviewed work-order identifier is recorded.
- Pending, partial, refunded, missing, and multiply claimed invoices are excluded from verified attributed revenue.

## Canonical GSC contract

Statenour uses `statenourMetrics.gscExecutiveSummary` for headline metrics.

- Source: `gsc_official_no_dimension`
- Definition: `gsc-revenue-ops-v1`
- CTR unit: ratio from 0 to 1
- Top queries/pages: dimensional detail, never substitutes for official totals

The old `gsc_summary` bridge remains available for compatibility but is no longer the active chat-prefetch source.

## Legacy VAPI backfill

Dry-run first:

```text
mode: dry_run
```

Apply only after reviewing eligible and skipped counts. The backfill:

- touches only evaluated rows missing `metadata.revenueOpsV1`
- does not refetch provider transcripts
- preserves existing metadata
- stamps the backfill definition and source limitation
- remains distinguishable from native v1 evaluations

## Rollback

Application rollback:

- revert the Wave 2 code changes
- stop using the new tRPC procedures

Data rollback:

- do not drop decision history during a normal application rollback
- legacy VAPI metadata backfills can be identified by `backfillVersion = vapi-legacy-backfill-v1`
- database-table removal requires a separately reviewed destructive migration
