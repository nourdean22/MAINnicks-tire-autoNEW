# ROADMAP · statenour-os

**Last reconciled:** 2026-05-08 (v10.0.484 EOD reconciliation pass · 43-version sprint · see `cohort-2026-05-08-eod-summary.md`)

> **What this file IS:** high-level future horizons — directions the
> system is heading once the active wave settles. Each horizon is a
> theme, not a checklist.
>
> **What this file is NOT:** a sequential plan. Active execution lives
> in [`V10-PLAN.md`](V10-PLAN.md) (current wave) and historical detail
> in [`UPGRADE-PLAN.md`](UPGRADE-PLAN.md) (v8.x archive). Shipped
> features live in [`CHANGELOG.md`](CHANGELOG.md). Verified ground
> truth lives in [`docs/RECONCILIATION.md`](../RECONCILIATION.md).
>
> The previous detailed v10/v11 ROADMAP (1009 lines, ~80 tier-1
> through tier-12 items) was archived 2026-04-29 to
> [`../archive/ROADMAP-v10.4-archived-2026-04-29.md`](../archive/ROADMAP-v10.4-archived-2026-04-29.md).
> Most of its tier-1 items shipped in v8.x; the rest were either
> superseded by the mega-overhaul approach or rolled into the horizons
> below.

---

## Horizon 1 · Closed-loop intelligence

> Theme: every detector cron's output reaches the assistant; every
> assistant decision becomes input to a calibration loop.

- Chat already sees v8.x BrainMemory alerts (v8.22). Next: contradiction
  detector output flows into chat context too.
- Decision-quality drift + prediction-streaks already detect; surface
  proactive prompts ("you've been wrong on lead-close 3× in a row —
  pause this Tuesday") in the morning brief.
- Auto-embed every captured surface (journal: ✅ v8.22; chat messages:
  partial; commitments: pending) so semantic search reaches everything.
- Every Nick prediction logs a target date + actual outcome; rolling
  Brier score per category surfaces in `/system/embedding-coverage`-
  style dashboard.

## Horizon 2 · Phone-first power

> Theme: Telegram covers full read + write surface so Nour runs the OS
> from the counter.

- /goals /predict /search /stats /alerts read-side ✅ v8.23. Next:
  proactive push (streak break → notification, decision drift →
  Telegram).
- Voice notes: /voice already transcribes; pipe through ingestJournal
  so dictating becomes journaling becomes searchable.
- Mobile responsive sweep ✅ v8.17/v8.24 on key surfaces. Continue
  through `/system/quality`, `/system/anti-patterns` (already mobile-
  friendly), `/system/decision-drift` (✅), and the chat composer
  on narrow viewports.
- Critical action confirmations: every irreversible button (delete,
  archive, send) has a swipe-to-confirm pattern on mobile.

## Horizon 3 · Multi-tenant readiness

> Theme: lift the single-operator assumption far enough that a future
> "Nour shares Nick with Dania" doesn't require a rewrite.

- `lib/db/tenant.ts` skeleton + `withTenant` async ctx ✅ v8.5.
  Propagate through every cron + every API route.
- Brain-bus channels are global today; namespace by tenantId.
- BrainMemory queries currently scan all rows; add a `tenantId` column
  + composite index `(tenantId, category, key)`.

## Horizon 4 · Outcome benchmarking

> Theme: every action ROI tagged. Pick the leverage move from data,
> not vibes.

- Tasks have effort/energy fields but never link to revenue impact.
  Add an `outcome` field (set on DONE) + cohort-grade (A/B/C/F) so
  weekly review can compare planned vs realized.
- Goal pace (✅ v8.9 GoalNextActionsCard) covers velocity. Next:
  cohort-style effort-vs-leverage scatter plot.
- Every Nick tool call has `recordToolInvocation` already (v8.x).
  Add an outcome rating (was the tool call right?) and feed into
  tool-pruning ranker.

## Horizon 5 · Hardening + observability

> Theme: production safety + production visibility — both grew through
> v8.x → v9.x → v10. v10 closed prompt injection, sensitive-GET leaks,
> Cascade-on-soft-delete, fail-open webhooks, brain-bus replay gaps,
> schema audit gap, pre-first-token same-turn fallback. Remaining:

- ~~59 unauthed routes flagged by the auth-coverage gate~~ → ratcheted
  to HARD in v9.1.17. Periodic re-sweep when new routes added.
- Adopt structured `logger` across `lib/` (~550 `console.log` callsites
  → JSON with request-id correlation). Use `traceId` from v10 E.5
  AgentTrace as the correlation key.
- `authedFetch` standardization across remaining 30+ bare `fetch()`
  callsites in client code.
- Bundle-size visibility (`@next/bundle-analyzer` in a `pnpm analyze`
  script).
- Prisma slow-query log → surface top-5 in `/system/performance`.
- Post-first-token same-turn fallback (deferred from v10.0.3 — current
  pre-first-token fallback handles most cases; mid-stream needs different
  approach).

## Horizon 6 · Devastating-lead intelligence

> Theme: things competitors don't have. The moat layer.

- Pin bundles (named context constellations Nour swaps between).
- Time-travel queries: "what would Jan 5 me have said about this?"
  via nightly `BrainMemorySnapshot`.
- Adversarial-Nick mode: same Nick, instructed to disagree on demand.
- Auto-harvest decisions from chat into `DecisionEntry` w/ predicted
  outcome + check-in date.
- Cold archive: BrainMemory rows >365d move to `BrainArchive` (never
  deleted, tool-only access). Perfect 10-year recall.
- Ghost Nour: trained on past decisions/journal; predicts what past-
  Nour would have done. Surfaces alongside Nick on important calls.

## Horizon 7 · Cross-ring shop OS mirror

> Theme: business ring (`nickstire.org`) data flows into the personal
> OS in real time. The personal OS becomes the control tower for both.

- Today: every 4h sync from nickstire → autonicks via `STATENOUR_SYNC_KEY`.
- Next: streaming events. Every customer call, text, invoice → personal
  OS within 10s via a `ShopEventStream` table + an SSE subscriber on `/`.
- Cars-today line metric promoted top-of-fold.
- Estimate→Invoice conversion tracker (the critical gate) with
  per-row action buttons (Call / SMS / Mark lost).

---

## How to use this file

- Adding work? If it's the **next 1-2 commits**, put it in
  `UPGRADE-PLAN.md §0.6 Active priorities`. If it's a **theme for next
  month+**, fold it into the matching horizon above (or add a new
  horizon).
- Don't track per-task status here. That's UPGRADE-PLAN's job.
- Don't write 80-item tier lists here. That's what the archived v10/v11
  ROADMAP became — it stopped being useful once items shipped faster
  than the doc could be updated.

---

**Reconciled at v10.0.484** · 2026-05-08 EOD · this doc was reviewed against the live state of the OS in the v10.0.442-484 sprint reconciliation pass. See `docs/cohort-2026-05-08-eod-summary.md` for the sprint summary and which sections of this doc were touched. If a claim in this doc contradicts code reality, the code wins · open an issue.
