# Operational queue census · does every open row map to an obligation? (2026-09-22 ~21:50Z)

**Answer first.** Every table with a status-like column was read (read-only, 60 tables). Most open
rows are honest work-in-progress. Four are not. **308 `sms_orchestrations` rows read `queued`
forever — but the texts were sent**: the orchestrator persists an outside-hours send as
`queued · outside_hours_queued` and hands the message to the durable delayed queue in
`sms_messages`, which sends it at the next 08:00 and stamps *its own* row `sent`; nothing ever
stamps the orchestration row, so the orchestration status is terminal-by-omission and every reader
of it (the admin queue filter, the learning engine, this census's first pass) counts a sent text as
unsent. **45 customer replies wait for a human** (`sms_response_jobs · human_pending`, 27 older
than 30 days, surfaced in the admin SMS section but not worked). **Three `emergency_requests` are
`new` at 158–178 days.** **`revenue_reconciliation_candidates` holds 227,988 rows, 18,491 of them
`manual_review`** — a backlog no human will read, growing every run. The 39 % failure share in
`sms_messages` is historical (5,184 of 5,346 failures are May 2026); September is 3 %.

Operator mandate 2026-09-22 item 12: a row must map to an obligation, an incident, or an explicit
review reason. Below, each queue gets that reading.

## A measurement that lied first, and the check that caught it

The first read joined queued orchestrations to `sms_messages` on the exact message body: 296 of
308 came back with no message row, which reads as "296 customers never got their text". The sent
body carries a footer the orchestration body does not, so the exact-body join was a proxy. Joined
by phone and a time window instead: **sent 311 · delivered 49 · failed 31 · no conversation row 21
· queued 17 (today, the offline gateway)**, and 243 of the 308 orchestrations were followed by a
sent outbound to that phone within 36 h. The texts went out. The row never learned.

## Every status-bearing table (rows · status split · open-ish rows and their oldest age)

| table | rows | status split | open rows · oldest | reading |
|---|---|---|---|---|
| sms_orchestrations | 2,981 | sent 1,059 · delivered 510 · skipped 505 · drafted 358 · **queued 308** · failed 85 · blocked 53 | queued 308 · 89 d | `queued` is terminal-by-omission (above); drafted 358 = human-approval drafts, 224 older than 30 d |
| sms_response_jobs | 89 | human_pending **45** · responded 28 · suppressed 13 · failed 2 | 45 · 57 d | obligation queue, surfaced in `SmsOrchestratorSection.tsx`, not drained by a human: 27 rows > 30 d |
| sms_messages | 13,562 | sent 6,406 · failed 5,346 · delivered 1,619 · received 169 · queued 22 | queued 22 · today | failures are May 2026 (5,184); 90-day reasons: blank 58 · `stale_sending_expired` 55 · `gateway_timeout_delivery_uncertain` 23; today's 22 queued = the offline gateway |
| revenue_reconciliation_candidates | 227,988 | unmatched 209,188 · manual_review **18,491** · ambiguous 309 | — | unbounded; `manual_review` is a label nobody reads — needs a cap or a resolver, not a human |
| revenue_opportunities | 938 | lost 708 · new 213 · won 10 · dismissed 7 | new 213 · 56 d | the opportunity queue; 213 open against a 10:708 won:lost history — worth its own read |
| customer_notifications | 24 | pending 22 · sent 2 | 22 · 171 d | dead queue — no writer since spring, no drain |
| emergency_requests | 3 | new 3 | 3 · 178 d | after-hours emergencies (`after_hours_emergency`), never transitioned — handled by phone, the row never learned |
| referrals | 6 | pending 6 | 6 · 167 d | no drain |
| review_pipeline | 10 | pending 10 | 10 · 49 d | no drain (`review-requests` reads `review_requests`, 1 row) |
| social_content_inventory | 91 | review_ready 35 · failed 30 · published 14 · rejected 7 · ready 4 · draft 1 | 39 · 53 d | human review queue, not worked |
| nickgpt_drafts | 422 | draft 397 · approved 25 | — | 397 drafts, 25 ever approved — a draft is a proposal, not an obligation |
| pipeline_runs | 211 | success 197 · error 11 · **running 3** | — | killed mid-run by a restart, never reconciled (the statenour session found the same shape in its cron log today) |
| revenue_reconciliation_runs | 436 | completed 434 · **running 2** | — | same: stuck by restart |
| content_runs | 2 | generating 2 | — | same |
| expected_arrivals | 209 | no_show 171 · arrived 25 · expected 13 | 13 | the arrivals kernel (#2488); expected 13 is live work |
| drip_enrollments | 217 | completed 120 · active 97 | 97 | live |
| callback_requests | 31 | no-answer 24 · completed 7 | — | terminal states only |
| leads · bookings | 9 · 8 | closed 4 · completed 2 · contacted 1 · booked 1 · lost 1 / confirmed 4 · cancelled 3 · completed 1 | 1 / 4 | tiny, live |
| reel_jobs · ig_autopost_log · scheduled_posts | 153 · 535 · 11 | failed 80 · failed 295 · failed 2 | — | terminal; failure shares belong to the reel/IG ledger rows |
| admin_proposals · audit_log · operator_quality_overrides · memberships | 22 · 503 · 6 · 3 | draft 10 · proposed 34 · active 2 · active 1 | — | governance rows, all read by their panels |
| 20 tables with 0–3 rows | | | | nothing to audit |

## The orchestration status that never transitions

| fact | evidence |
|---|---|
| how a row gets there | `smsOrchestrator.ts:1552-1576`: `sendSms()` returns `{ queued: true }` outside the sending window; the row is persisted `status = queued, status_reason = outside_hours_queued, metadata.queuedUntil = tomorrow 08:00` |
| who sends it | `sms.ts queueForLater()` persists an `sms_messages` row (`queued`) and `processDelayedQueue()` sends it at the window and stamps **that** row `sent`; `rehydrateQueuedFromDb()` survives restarts |
| who stamps the orchestration | nobody: `sms.ts` never touches `sms_orchestrations`; the only readers of `queued` are the admin filter (`routers/smsOrchestrator.ts:25`) and two analytics counts — `smsLearningEngine.ts:267` labels them `gatewayOffline` |
| what the 308 are | `vapi_forwarded_call_followup` 255 · `vapi_confirmation` 36 · `inbound_sms` 7 · `after_hours_capture` 6 · `stale_lead_followup` 4; `should_auto_send = 1`, `requires_human_approval = 0` on every row |
| what actually happened | joined by phone + window: sent/delivered for the great majority; 31 failed; 21 have no conversation row (the phone-format split fixed 2026-06 predates them); 17 are today's, held by the offline gateway |

**Fix (proposal, bookkeeping only, no customer surface):** when `processDelayedQueue()` stamps an
`sms_messages` row `sent`, stamp the matching `sms_orchestrations` row (same phone, created within
the queueing window, `status = queued · outside_hours_queued`) `sent · sent_from_delayed_queue`
with `sent_at`; and for the delayed row's `failed`, `failed · delayed_queue_failed`. Then the
learning engine's `gatewayOffline` count stops reading sent texts as an outage. A one-time
back-stamp of the 243 historical rows is a production write and the operator's call.

## What the operator decides

1. **The 45 human-pending replies** (27 > 30 d): work them in the admin SMS section, or tell the
   system they are closed — a queue nobody drains should not be called a queue.
2. **`manual_review` at 18,491**: the reconciliation writer should stop labelling rows for a review
   that never happens (cap, auto-resolve, or drop the label); a follow-up PR, not this one.
3. **Stuck `running` rows** (pipeline_runs 3, revenue_reconciliation_runs 2, content_runs 2): an
   "interrupted" reconciliation at boot — the statenour session is building the same thing for its
   cron log; share the shape.
4. **Dead queues** (`customer_notifications` 22 pending · 171 d, `referrals` 6 · 167 d,
   `review_pipeline` 10 · 49 d, `emergency_requests` 3 · 178 d): either a drain or a terminal
   state; today they are neither.
5. **Back-stamp the 243 sent-but-queued orchestrations** once the stamping fix ships (a UPDATE on
   prod rows; dry run first, as every maintenance script here does).

## Not done here

No row was changed and no code shipped for the queues; this is the reading. `revenue_opportunities`
(213 new, 10 won of 718 resolved) deserves its own read against the lot board before anyone calls
it a queue.
