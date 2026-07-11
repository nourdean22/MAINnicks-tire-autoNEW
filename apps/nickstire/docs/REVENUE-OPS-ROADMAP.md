# Nick's Tire & Auto — Revenue Operations Roadmap

Prioritize dependency and verified business value over feature count.

## Wave 1 — Data truth and regression protection

**Outcome:** executive metrics stop blending observed activity, inference and verified business results.

- Maintain `CURRENT-TRUTH.md`, `METRICS-CONTRACT.md` and `ISSUE-REGISTRY.md`.
- Separate VAPI tool engagement, persisted lead/callback/booking, walk-in direction, arrival and paid invoice.
- Version classifier and quality definitions.
- Score conversation execution independently from commercial outcome.
- Use official no-dimension GSC totals for headline reporting.
- Keep stored GSC rows as bounded dimensional analysis with coverage diagnostics.
- Add semantic prerender checks for critical routes.
- Show source, freshness, denominator and unavailable states in compact admin surfaces.

## Wave 2 — Reliability and operational ownership

**Revenue impact:** high  
**Risk reduction:** high  
**Dependency:** Wave 1 definitions

- Add structured run receipts for GSC, VAPI evaluation, prerender, lead and booking writes.
- Standardize last attempted, last successful, duration, rows, errors, retries and run IDs.
- Alert only on actionable thresholds with a named owner.
- Add replay/idempotency tests for VAPI and lead/booking writes.
- Resolve the current historical repository-scan findings through an operator-controlled incident plan.

## Wave 3 — Attribution foundation

**Revenue impact:** very high  
**Risk:** medium  
**Dependency:** reliable source records

- Add a canonical attribution-link model or equivalent existing-table contract.
- Prefer direct booking/customer/invoice identifiers.
- Support normalized phone and bounded time-window candidates only as inferred matches.
- Store match method, confidence, evidence and manual resolution.
- Prevent one invoice from being attributed to multiple origins.
- Report verified attributed revenue separately from unmatched revenue and modeled value.

## Wave 4 — Recovery workflow

**Revenue impact:** very high  
**Risk:** medium  
**Dependency:** attribution and consent truth

- Consolidate missed opportunities into a durable queue.
- Support owner, status, next action/time, attempts, consent, do-not-contact, source links and audit history.
- States: new, assigned, attempted, contacted, scheduled, walk-in expected, arrived, won, lost, no response, do not contact and duplicate.
- Enforce quiet hours, opt-outs, frequency caps and manual override before outbound automation.
- Measure recovery only from verified later outcomes.

## Wave 5 — Executive scorecard

**Revenue impact:** medium-high  
**Risk:** low after prior waves  
**Dependency:** trustworthy definitions and attribution

- Demand: calls, qualified calls, website leads, bookings, organic clicks and freshness.
- Conversion stages with explicit denominators.
- Reliability: abandonment, technical failure, GSC sync, prerender freshness and integration health.
- Operations only where connected: cars checked in/completed, ARO, service revenue, technician productivity and comebacks.
- Unavailable cards state `Not connected` or `Not currently measurable`; never show dummy values.

## Wave 6 — GBP and local SEO operating system

**Revenue impact:** medium-high  
**Risk:** low-medium  
**Dependency:** publication receipts and measurement truth

- Draft, approve, publish and verify review responses and GBP posts as separate states.
- Track photo requests through capture, approval, upload and verification.
- Use current business constants and source-backed claims.
- Scale pages only after crawler parity and GSC measurement remain green.

## Wave 7 — Content and paid acquisition

**Revenue impact:** variable  
**Risk:** medium-high  
**Dependency:** attribution and conversion truth

- Connect each campaign to a source code and measurable funnel.
- Start with bounded experiments and explicit stop conditions.
- Do not optimize ads against tool engagement or modeled revenue.
- Promote only campaigns that produce verified downstream value.

## Wave 8 — Forecasting and optimization

**Revenue impact:** high when mature  
**Risk:** high if premature  
**Dependency:** sustained verified history

- Forecast demand, capacity, service mix and recovery value with confidence intervals.
- Compare predictions with actual outcomes and calibrate.
- Retire stale or contradicted rules.
- Keep irreversible actions operator-gated.

## Immediate operator decisions

1. Choose the repair-order/invoice system that will be canonical for attribution.
2. Decide whether first-come-first-served walk-in guidance should remain named `bookSlot` in VAPI or later migrate through a versioned tool alias.
3. Approve a coordinated repository-history remediation window after affected access material is rotated.
4. Assign front-desk ownership and response-time expectations for the recovery queue.