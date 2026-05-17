# ADR-0004 · withGuardian wrapper · 9 failure categories

**Status:** Accepted
**Date adopted:** v10.0.357 (2026-05-06)
**Backfilled:** 2026-05-07 (v10.0.450)

## Context

By v10.0.350 the AI surface had ~30 async entry points (chat
streaming, judge eval, adversarial critic, deep research, multi-
agent orchestrator, tool implementations, cron jobs, telemetry
sinks). Failure modes were inconsistent:

- Some paths returned `null` silently on error (judge eval).
- Some paths threw and propagated to a 500 (chat streamText).
- Some paths swallowed errors with `.catch(() => null)` (adversarial
  critic dispatch · see v10.0.448 silent-failure-hunter audit).
- Some paths logged with `console.error` (mixed with structured logs
  from `lib/logger`).
- Timeouts were inconsistent · 5s / 8s / 30s · some unbounded.
- Retries were ad-hoc · some paths retried 3x with no backoff,
  others didn't retry at all.

The 4-phase glitch taxonomy work (v10.0.330 era) had identified 8
recurring failure categories from operator complaints. Without a
centralized wrapper, each new feature re-invented its own error
handling and re-introduced one of the 8 known failures.

## Decision

Adopt a **single guardian wrapper** (`lib/tools/guardian.ts`) with
9 named failure categories that wraps every external-IO async
function in the AI surface:

```ts
withGuardian("scope-name", asyncFn, {
  timeoutMs?: number,        // default 30s
  maxRetries?: number,       // default 0
  classify?: (err) => Cat,   // override default classification
})
```

The 9 categories are:

1. **timeout** · operation exceeded the deadline
2. **rate-limit** · 429 from upstream provider
3. **auth** · 401/403 (key missing, rotated, or scoped wrong)
4. **upstream-5xx** · server-side error from a downstream service
5. **client-network** · connection refused, DNS fail, TLS error
6. **payload-shape** · response parsed but missing expected fields
7. **payload-empty** · response was empty (200 OK with no content)
8. **schema-validation** · response failed Zod / TypeScript-shape check
9. **unknown** · uncategorized; logged with full stack for follow-up

Each wrapped call emits a structured log line with the category,
duration, retry count, and (sanitized) error head. The wrapper
also writes a `system_metric` row keyed by scope so the observability
dashboard (v10.0.377) can surface per-scope failure rates.

## Consequences

**Positive:**

- Every wrapped call has known timeout · known retry policy · known
  category vocabulary. New features inherit the discipline.
- The observability dashboard can show "scope X is failing 12% of
  the time, mostly upstream-5xx" — actionable signal.
- The 9-category vocabulary makes runbook remediation crisp:
  "scope `judge-eval` is in `auth` category" → check the OPENAI key.
- The wrapper composes with the same-turn provider fallback · when a
  Guardian'd call fails with `upstream-5xx` on Venice, the chain
  rotation logic at `provider.ts` picks it up automatically.

**Negative:**

- Wrapping is opt-in · the v10.0.448 silent-failure-hunter audit
  found that `_criticize` in `adversarial-critic.ts` was wrapped, but
  the `criticizeAsync` outer dispatch was not (the swallowing
  `.catch(() => null)` was outside the guardian boundary). New code
  must remember to wrap.
- The 9 categories cover 95% of cases but not all · some failure
  modes (silent provider degradation · partial JSON · semantic
  mis-categorization) don't fit cleanly and end up in `unknown`.
- Adding a new category requires touching the central guardian file
  + updating every dashboard consumer · so the 9 are sticky even
  when a 10th would help.

## Alternatives considered

- **Per-feature error-handling utilities** — rejected. Was the
  status quo before v10.0.357 and produced exactly the inconsistency
  the wrapper exists to solve.
- **Throw-and-catch at the route handler** — rejected. Catches
  everything but loses category granularity. Observability would
  only show "error rate" not "auth-failure rate."
- **Sentry / external error-tracking SDK** — rejected for now on
  cost + infrastructure grounds. The structured-log + system_metric
  approach gives us 80% of what Sentry would, at zero added vendor
  cost.
- **Result<T, E> types instead of try/catch** — considered. A more
  functional pattern would push the discipline into the type system,
  but TypeScript's lack of effect types means the discipline still
  has to be enforced at the boundary. The guardian wrapper does
  this with less ceremony.

## References

- `lib/tools/guardian.ts` — wrapper implementation, category
  classification, default timeouts
- `app/api/system/observability/route.ts` — per-scope failure rate
  surface
- v10.0.357 commit · guardian introduction
- v10.0.377 commit · request tracer + observability dashboard
- v10.0.448 commit · silent-failure-hunter audit · added breadcrumbs
  to the dispatch sites that were OUTSIDE guardian boundaries
- ADR-0003 · v1/v2 split (the v1 builder predates guardian; some
  v1-only paths still throw rather than wrap)

## Open items

- Audit pass to ensure every async entry point is guardian-wrapped
  (the silent-failure-hunter pass at v10.0.448 was scoped to the
  AI deliberation loop · the broader chat surface needs the same
  treatment).
- Consider adding a 10th category for `provider-degraded` (returns
  200 but with garbage / hallucinated content). Currently this falls
  into `payload-shape` which mixes it with structural mismatches.

---

**Reconciled at v10.0.484** · 2026-05-08 EOD · this doc was reviewed against the live state of the OS in the v10.0.442-484 sprint reconciliation pass. See `docs/cohort-2026-05-08-eod-summary.md` for the sprint summary and which sections of this doc were touched. If a claim in this doc contradicts code reality, the code wins · open an issue.
