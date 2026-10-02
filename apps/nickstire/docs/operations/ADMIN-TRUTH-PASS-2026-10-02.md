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

## What changed (one PR)

1. **SMS human-review drafts close.** Existing `orchestration-status-reconcile` pulse job
   now cancels a draft whose obligation closed, cancels one the customer superseded by
   texting again, and expires drafts older than 7 days. A thread reply / "No reply
   needed" now cancels the conversation's drafts; approving a draft now closes the
   obligation; a stale draft cannot be sent verbatim; a double tap cannot double-send.
   Never sends. Expect the backlog to drop to ~7 days of drafts on the first pulse.
2. **Missed calls close.** One live opportunity per phone; a PAID invoice on a later shop
   day -> `won` via `recordOutcome`; a later callback/lead/booking/captured call, or a paid
   invoice the same shop day (before-or-after the call is unknowable, so never a win) ->
   `duplicate` with a receipt; same-phone duplicates collapse to the newest. Auto-closes
   touch only untouched `new` cards; an assigned or worked card is left to its owner.
   Times are shop-time strings formatted in SQL. Dismissing the newest card no longer
   re-cards the phone's older calls.
3. **Nick's proposals stop inviting rejection.** Capture-aware gate, walk-in-aware
   booking drop, today's date in the prompt, past dates dropped; `scheduleCallback`
   links its callback to the call. Removed a work-order review-request insert that
   could never succeed.
4. **Stale callbacks carry evidence.** Today appends "Invoiced <date> ... likely served" or
   "Booked <date> ..." to an open callback card when the same phone was invoiced (same day
   or later) or booked after the request. Hint only; the operator closes it.
5. **Financing clicks get an attribution ladder.** The same visitor session id is on leads,
   bookings, callback requests, tire orders and click-to-call events; the panel now shows the
   identity a click reached and any invoice for that phone on or after the click (applications
   and approvals are not observable — the providers report nothing). A failed read shows
   "unknown", no longer "No financing clicks recorded yet".
6. **Approvals shows what happened after a decision** (invoice / booking / callback for the
   proposal's phone), and the shop-state lot band reads the vehicle-truth camera's healthy
   frames instead of any camera's heartbeat.
7. **No green over broken cameras.** Shared `summarizeCameraFleet`; Settings -> Status
   gets a camera check (RULE 5) and Lot's header stops saying "Live" over a degraded
   fleet. Approvals copy scoped to its own queue.

## Migrations — prepared in this PR, applied by one operator action after deploy

Research (docs + evidence, no DB access from the build container) found: 0127/0128/0129 are
APPLIED but unrecorded (record-only); 0130, 0132, 0133, 0136, 0137, 0138 were never applied;
0135 is unknown; 0139 is new in this PR (invoice-sourced review requests). Every reader of a
missing object degrades safely today (named "not applied" states); no `heldout` write can
happen while 0136 is absent (needs a durable assignment row + OFF-by-default flags).

This PR adds the DDL for 0130, 0132, 0133, 0136, 0137, 0138, 0139 to `handleRunMigrations`
(verbatim from the .sql files, generated, not retyped). `migrationListGuards.test.ts` now pins
every re-asserted `MODIFY … ENUM` to its schema.ts enum (mutation-proven), because a stale
re-assertion would shrink a live enum.

Exact sequence (after merge + deploy):
1. Admin -> System Health -> Run migrations (or `POST /api/admin/run-migrations` with
   `ADMIN_API_KEY`). Read `errors[]` in the response — `success:true` does not mean every
   statement applied. Expected watch item: `MODIFY bookingId int NULL` touches the
   `fk_reviewreq_booking` column; if TiDB refuses it, the invoice review lane simply stays
   inert (it checks nullability before writing).
2. Record the ledger (from a machine with the Railway CLI):
   `railway run --service MAINnicks-tire-auto -- node scripts/record-migrations.mjs --only 0127,0128,0129,0130,0132,0133,0136,0137,0138,0139`
   (dry run; it refuses anything the reconciler does not classify UNRECORDED_BUT_EXACT_MATCH),
   then the same with `--execute`.
3. `railway run --service MAINnicks-tire-auto -- node scripts/reconcile-migrations.mjs --strict`
   — exit 0 is the receipt. 0135 stays reported until its own state is verified.
4. Keep every `contact_holdout_*` flag OFF until step 3 shows `heldout` in the
   `winback_sends`, `sms_campaign_sends` and `review_requests` status enums.

## Changed series (stated, not silent)

- **Bridge `gsc_summary` (StateNour) now reports Google's official total** with `source`, falling
  back to stored rows labelled `stored_query_rows_partial`. Any StateNour series built on it
  (brain-intelligence actualScore = totalClicks) steps UP at this deploy because the basis
  changed, not because search improved. Follow-up for the StateNour side: its `gsc_summary` tool
  description still says "derived from raw click+impression sums".
- **opportunity-queue-refresh `recordsProcessed`** now also counts missed-call cards the
  collector collapsed (a collapse is a real change), so the loop-shape contract stops reading
  a collapse-only run as idle.
- **Traffic Funnel** clicks/impressions drop (Discover rows removed) and position changes
  (impression-weighted) at this deploy, for the same reason.

## Still operator-gated (not done by this PR)

| Item | Why gated | Exact next action |
|---|---|---|
| `convertedToLead=0` gate on missed-call recovery | Changing it widens an autonomous SMS lane | ~101 calls/week reached a tool without persisting anything and are excluded from both missed-call recovery texts and the opportunity queue. Operator decision. |
| `create_booking_request` for a walk-in shop | Product decision | A caller who asked to "bring it in" without reaching `bookSlot` can still get a booking draft that, approved, creates a `bookings` appointment. |
| Receivables | Needs ShopDriver check | Verify the three balances above before any contact. |

## Review requests now come from paid ALG invoices

After 0139: the `review-requests` cron creates one pending row per paid shopdriver invoice
from the last 3 days (10-digit phone, not opted out, not asked inside the cooldown by either
lane), then sends through the unchanged queue and every existing gate. `post-invoice-followup`
skips phones already on review cooldown, so a customer gets one ask per cooldown across both
lanes. Before 0139 the cron logs `invoice rows: migration 0139 … not applied` and creates
nothing. Sending still requires the `sms_review_requests` flag. The SMS greets "First Last"
from ALG's "Last, First", and "there" for placeholders, an empty first name, or a business
account (LLC / Inc / Auto / Tire / Towing ...); it says "your service", never the ticket text.

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
