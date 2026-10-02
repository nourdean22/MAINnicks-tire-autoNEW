# Admin truth pass — 2026-10-02

The operator's production truth pass (TiDB read at 12:54 UTC) was checked against current
source. This file records which of its findings survived, which were corrected, what
changed in code, and what is still operator-gated. Production numbers below are the
operator's read (CLAIM until re-read); the root causes are FACT from code (file:line in
the PR body).

## Corrections to the audit

| Audit claim | Verdict | Why |
|---|---|---|
| `convertedToLead` without `leadId` is a data/semantic failure | **Known and decided** | It means "Nick reached a tool" (any `state_tool_called`/`state_confirmed`, incl. the recap SMS). Operator decision 2026-09-23 (option C) kept it; the badge copy was fixed 2026-07-20. Only the schema comment still lied — fixed. Real conversions = `leadId`/`callbackId`/`bookingId` (METRICS-CONTRACT). |
| 38 AI proposals were rejected — "who/what rejected them?" | **A person, every time** | No automatic reject path exists (`proposals.ts` `rejectProposal` has one caller, the Approvals two-tap). `reviewed_by` + `audit_log proposal.rejected` name the actor. The drafts invited rejection: duplicates of callbacks a tool had already written, and booking drafts for a walk-in shop whose caller had just been told no appointment was booked. |
| "The review engine has effectively done nothing" | **Partly wrong** | Review-request ROWS are only created when an admin marks a website booking `completed`. ALG invoices (the real completion signal) never reach `review_requests`, and `review_requests.bookingId` is NOT NULL. But `post-invoice-followup` (hourly, gated by `sms_review_requests`) sends review asks to ALG customers keyed on `customers.lastVisitDate` and never writes `review_requests`. "1 review request ever" therefore undercounts review texts actually sent — check that flag and `customers.smsCampaignSent` before concluding nothing went out. |
| GSC: UI 76,966 impr / 229 clicks vs direct SUM 50,246 / 81 — UI suspect | **Direct SUM is the undercount** | The Market card prefers Google's official no-dimension total. `search_performance` rows come from a query-dimensioned request, from which Google drops anonymized queries, so a SUM is a strict subset. The card now prints which source it used. Separately the Traffic Funnel mixed Discover rows into web and used unweighted `AVG(position)` — fixed. |
| Unpaid external balances: $927.22, $495.22, $207.36 (~$1,630) | **Unverified as receivables** | `paymentStatus='pending'` mostly means the ALG ticket is still `open` (`shopDriverMirror.normalizePaymentStatus`), and the schema has no amount-paid column. Confirm each in ShopDriver before any collection call. |
| Financing clicks: 0/16 identified | **Identity exists, unjoined** | `financing_clicks.sessionId` is captured (persistent localStorage visitor id). It joins only to `leads.sessionId`, and leads has 3 rows. `gclid`/`utmTerm`/`utmContent` are sent by the client but stripped by the zod schema. |
| 866 missed calls "lost" | **Mostly age-outs, not lost sales** | Reconcile step 3 moved every live missed call older than 7 days to `lost`, receipt "aged out". Any lost-rate must split receipts. |
| 366 drafts "past the 30-min SLA" | **SLA belongs to another table** | The 30-min SLA is `sms_response_jobs.dueAt`. The drafts were real queue debt regardless: nothing ever closed one. |

## What changed (one PR, four commits)

1. **SMS human-review drafts close.** Existing `orchestration-status-reconcile` pulse job
   now cancels a draft whose obligation closed, cancels one the customer superseded by
   texting again, and expires drafts older than 7 days. A thread reply / "No reply
   needed" now cancels the conversation's drafts; approving a draft now closes the
   obligation; a stale draft cannot be sent verbatim; a double tap cannot double-send.
   Never sends. Expect the backlog to drop to ~7 days of drafts on the first pulse.
2. **Missed calls close.** One live opportunity per phone; served-by-invoice -> `won`
   via `recordOutcome`; served-by-callback/lead/booking/captured-call -> `duplicate`
   with a receipt; same-phone duplicates collapse to the newest.
3. **Nick's proposals stop inviting rejection.** Capture-aware gate, walk-in-aware
   booking drop, today's date in the prompt, past dates dropped; `scheduleCallback`
   links its callback to the call. Removed a work-order review-request insert that
   could never succeed.
4. **No green over broken cameras.** Shared `summarizeCameraFleet`; Settings -> Status
   gets a camera check (RULE 5) and Lot's header stops saying "Live" over a degraded
   fleet. Approvals copy scoped to its own queue.

## Still operator-gated (not done by this PR)

| Item | Why gated | Exact next action |
|---|---|---|
| Invoice-sourced review requests | Needs DDL: `review_requests.bookingId` NULL + `invoiceId` UNIQUE | Decide first whether `post-invoice-followup` stays the ALG review lane (it already texts). Do not add a second lane without deduping. |
| Migrations 0132 / 0136 / 0137 | Hand-applied production DDL; 0127-0130, 0133 drift unresolved first | Follow `SCHEMA_DRIFT_RUNBOOK.md`; `reconcile-migrations.mjs --strict` read-back. Until 0132, every declined estimate is INFERRED; until 0136 no holdout measurement. |
| `convertedToLead=0` gate on missed-call recovery | Changing it widens an autonomous SMS lane | ~101 calls/week reached a tool without persisting anything and are excluded from both missed-call recovery texts and the opportunity queue. Operator decision. |
| `create_booking_request` for a walk-in shop | Product decision | A caller who asked to "bring it in" without reaching `bookSlot` can still get a booking draft that, approved, creates a `bookings` appointment. |
| Receivables | Needs ShopDriver check | Verify the three balances above before any contact. |

## Read-only post-deploy checks

```sql
-- drafts: expect drafted+approval rows to fall to ~last 7 days after one pulse
SELECT status, status_reason, COUNT(*) FROM sms_orchestrations
WHERE requires_human_approval = 1 AND updatedAt > NOW() - INTERVAL 1 DAY GROUP BY 1,2;
-- missed calls: served/collapse receipts appear after the next opportunity-queue-refresh
SELECT state, COUNT(*) FROM revenue_opportunities WHERE source_type='missed_call' GROUP BY state;
-- cron receipts
SELECT job_name, status, details, started_at FROM cron_log
WHERE job_name IN ('orchestration-status-reconcile','opportunity-queue-refresh')
ORDER BY started_at DESC LIMIT 6;
```
