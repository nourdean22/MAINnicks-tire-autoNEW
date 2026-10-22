# Upgrade scout (2026-10-22): where the shop side is still basic, and what the best do instead

**Answer.** The shop side is not short of features (440 services); it is short of *inputs*. Two of
every three closed jobs carry no description of the work, so nothing can say "your brakes are due"
to most customers, and only 1 in 5 customers comes back for a second job within a year. Nobody
records the "no" at the counter (0 counter declines ever, though the form exists), so every
decline is inferred from an estimate with no matching invoice; those are already followed up, but
too few customers sit in the no-text group to tell yet whether the follow-ups work. The "live"
homepage badge read a booking tracker nobody has touched since April. Ten upgrades are ranked
below. Number 1 (the homepage badge) is built in PR 3225. Numbers 2 to 5 each need a go or a
decision from Nour, named in the item.

Nour asked (2026-10-22): "reverse-engineer anything beneficial that we could use to upgrade our
basic shit in the repo". The deep scouts of 2026-10-16 and 2026-10-17 already covered reels, the
brain, voice, agents, evals and alerting (8 of their 10 items shipped). This pass covered what they
skipped: the shop's customer-facing basics.

**Correction (2026-10-22, same day).** The first version of this report said there was no declined
work to follow up and that the retention holdouts were off. Both were wrong. The shop's data
meanings (Nour, 2026-10-15 and 2026-10-21; `shared/declineProvenance.ts`): a ShopDriver counter
invoice is a sale, a closed job; payment is taken on a separate register, so a counter invoice's
`paymentStatus` means nothing and never drives an alert, card or text. App-made online tire orders
(`gatewayTire.placeOrder`) are the exception: they start as `manual` invoices with `paymentStatus`
"pending", and that status does mean something; they are 10 of 1,391 invoices in 12 months and are
left out of every closed-job count below. Declines come in two kinds. **Counter** declines are
observations, a person recording the customer's "no" (`declined_work_captures`). **Inferred**
declines are estimates with no matching invoice; the matcher also misses a customer who paid under
another phone, paid cash, or whose invoice never mirrored. Every number below uses these meanings
and labels each decline by kind.

## Method and labels

1. Read our code at file:line for each candidate area (texting, reminders, walk-in status,
   declined work, invoices, flags, alerts).
2. Six SELECT-only production probes on 2026-10-22 (counts only, no names, phones or amounts;
   `railway run -s MAINnicks-tire-auto`, statement allowlist) and one read of the public status
   endpoints. A phone is the last 10 digits; a visit is a closed job (invoice) or an
   inferred-declined estimate (no matched invoice) on a distinct day.
3. Three Perplexity Pro research threads in Chrome (slugs in the appendix), then the two most
   decision-critical claims re-read at the primary page.
4. Labels: **FACT** = read in source, measured, or quoted from the primary page this session.
   **CLAIM** = stated by Perplexity and not re-read. **INFERRED** = follows from facts.

## Production receipts (FACT, 2026-10-22, read-only)

| Read | Result |
|---|---|
| History on file | invoices from 2024-01-09 (3,132 rows); estimates from 2024-01-24 (504 rows) |
| Invoices, 12 months | 1,391: 1,381 ShopDriver counter invoices (closed jobs) + 10 app-made online orders (8 pending, 2 partial) |
| Closed jobs with a blank description, 12 months | 925 of 1,381 (67%) |
| Closed jobs in a remindable category, 12 months (repo categorizer) | 253 of 1,381 (18%), 228 customers |
| Estimates, 12 months | 282; 50 matched to a counter invoice (an estimate covers about 1 in 28 closed jobs) |
| **Counter** declines (`declined_work_captures`), ever | 0; the table and the form (`CounterDecline.tsx`) exist |
| **Inferred** declines (estimate with no matched invoice), 12 months | 232 of 282 estimates; 196 still unmatched past the 60-day match window. Inference, not observation |
| Estimates with a service category, 12 months | 0 of 282 (the column is read by two features and written by none) |
| Declined follow-up experiment v3 (inferred declines), all ages | texted group 11 of 94 came back (12%); no-text group 1 of 11 (9%) |
| Customers, 24 months (visit = closed job or inferred-declined estimate) | 1,855: 1,436 one visit (77%), 419 two or more, 175 with only an inferred decline |
| Customers whose first invoice was 12 to 24 months ago (all invoice sources; app orders are under 1%) | 732; 151 (21%) had a second invoice within 12 months |
| Retention texts sent, 90 days (D7/D14/D45/D90/D180/D365, all ON) | 1,287; retention holdouts ON |
| `service_reminders` rows, ever / `reminder_settings` rows | 0 / 0 |
| Bookings vs invoices, 90 days | 13 bookings (0 completed) vs 280 invoices |
| Bookings in an active stage / last stage move | 1 / 2026-04-22 23:01 UTC |
| `work_orders` created in 30 days / last touched | 0 / 2026-05-07 |
| Customer-weeks with 2+ / 3+ outbound texts and no reply, 60 days | 666 / 116 (of 2,607 weeks with any outbound) |
| `GET /api/trpc/shopStatus.getStatus` at 07:17 ET | `currentJobs: 1, openBays: 3, waitIsFresh: true` (closed hour) |

## Top 10, ranked

Rank = value to Nour (revenue, his time, trust) x confidence, divided by cost.

| # | Upgrade | Mechanism from | Size | State |
|---|---|---|---|---|
| 1 | Homepage "live" badge stops claiming free bays from a stale tracker | Google live busyness (shown only with enough recent data); Waitwhile, Yelp | S | **BUILT, PR 3225** |
| 2 | Pull what was done (line items, mileage) from ShopDriver tickets | Shopmonkey canned-service campaigns; Mitchell 1 SocialCRM | M | needs Nour's go for one read-only probe |
| 3 | Maintenance reminders from closed jobs, closed the moment the customer returns | Shopmonkey (service + elapsed time after the job); Mitchell 1 follow-up suppression | M | **BUILT behind a flag (OFF)**; texts await Nour's approval by name |
| 4 | One cap on marketing texts per customer across all senders | Klaviyo Smart Sending; Braze global frequency capping | S-M | needs Nour's go for one column |
| 5 | Record the "no" at the counter, so declines are observed, not guessed | Tekmetric / Shopmonkey per-line approve or decline; Mitchell 1 recommendation record | S | Nour's decision: how the counter records it |
| 6 | Fill the estimate service category that two features already read | already built here (`categorizeService`) | S | ready to build |
| 7 | Read the declined follow-up experiment only when its no-text group is big enough | inspect_ai clustered error bars (deep scout v2 #1) | S | wait: 11 in the no-text group |
| 8 | One Telegram alert dispatcher (group, repeat, resolve) | Prometheus Alertmanager | M | carried from deep scout v2 #6 |
| 9 | Simulated callers graded on outcome, reported as pass^k | tau2-bench | M-L | carried from deep scout v2 #8 |
| 10 | A real wait estimate once the car counter is trusted | Waitwhile custom mode (line x service time / bays), ranges, hide when stale | M | WATCH: needs the RTSP camera and counter trust |

### 1. The homepage badge stops inventing free bays (BUILT)

- **Problem (FACT).** `ShopStatusWidget` (homepage hero, `Home.tsx:377`) renders
  `OPEN · 3 BAYS FREE` with a pulsing green dot from `getShopStatus()`
  (`server/services/shopStatus.ts`), which counted bookings in an active stage with no time bound.
  One booking has sat in an active stage since 2026-04-22 and no stage has moved since, so every
  open hour said 3 of 4 bays were free and `waitIsFresh: true`. Walk-ins are tracked in
  ShopDriver, not in `bookings.stage`. The voice agent was already told (2026-07-20) never to
  state a wait; the website was not.
- **Mechanism (FACT, primary page read 2026-10-22).** Google Business Profile help, answer 6263531,
  on live busyness: "it appears only if Google has sufficient visit data for your business."
  Waitwhile and Yelp estimate from the current queue plus measured service times and show a range
  (CLAIM). The transferable rule: a live number needs a live source; no recent data means no
  number, never a zero.
- **Equivalent here.** The `waitIsFresh` gate already existed for a DB outage, and the camera lane
  already withholds its band when stale (`shared/shopState.ts` `lotBand`). This change applies
  the same rule to the bookings source.
- **Change.** Bays and wait now come only from a caller-supplied count; the bookings read and the
  time-of-day guess are deleted. The first version counted only bookings whose stage moved today;
  Codex review on PR 3225 pointed out that a move today proves activity, not that walk-ins are
  counted, so no table here may claim bays. The badge reads `OPEN · WALK-INS OK` and the message
  says "Open now, first come, first served. Call to check the line". A real number comes back only
  with a source that covers the line (item 9). A first-version change to the work-order count
  (`conversion.shopCapacity`, 7 days to today) was reverted in the same review: it would drop
  legitimate overnight jobs, and that table holds 0 rows in 30 days.
- **Proof.** Three new test cases (stuck booking, booking moved to ready today, no bookings) fail
  on main and on the PR's first version and pass on the fix. Live proof after deploy: the status
  endpoint returns `waitIsFresh: false` during open hours.

### 2. Pull what was done from ShopDriver (the input every other lane is missing)

- **Problem (FACT).** 925 of 1,381 closed jobs in 12 months have no service description. Run
  through the repo's own categorizer, 253 (18%) say something remindable; over all 1,393 invoices
  that day the split was suspension 91, tires 63, brakes 45, cooling 28, electrical 26, oil 11. The
  mirror reads 13 ticket fields and none is a line item or mileage (`shopDriverMirror.ts:234`,
  `RawInvoice`). Matched estimates do not fill the gap: only 50 closed jobs in 12 months have one,
  and estimates carry no category either.
- **Mechanism.** Shopmonkey's CRM campaigns trigger on a specific canned service plus a time after
  the job; Mitchell 1 SocialCRM projects mileage since the last visit and sends 30 days before a
  projected interval; Steer documents estimated odometer from past invoices with a usage fallback
  (all CLAIM via help-center pages cited in thread 3).
- **Equivalent here.** `probeAlgEndpoints()` (`shopDriverMirror.ts:1703`) already lists
  `/api/Vehicle/getVehicleHistory`, `/api/Recommendation/list` and ticket endpoints, read-only, but
  no result was ever recorded. Whether ShopDriver returns line items and odometer is UNKNOWN.
- **Next step (needs Nour).** Run the existing probe once (it uses the shop's ShopDriver session in
  production, read-only) and record the response shapes. If line items and mileage are there,
  extend the mirror; reminders (#3) then cover most jobs instead of 18%.

### 3. Maintenance reminders from closed jobs (Nour wants them)

- **Problem (FACT).** The existing reminder subsystem fires only from completed online bookings
  (`db.ts:2534`, and the 6-month message in `sms-scheduler.ts`); there were 0 in 90 days against
  280 invoices, and `service_reminders` and `reminder_settings` hold 0 rows. Its text
  (`maintenanceReminderSms`, `sms.ts:2847`) says "Due for an oil change? $49..." whatever the
  service was. `processReminderQueue` sends any due row with no flag gate.
- **Mechanism.** Trigger on a specific service on a closed job plus elapsed time (Shopmonkey);
  stamp what has been followed up so it leaves the next query (Mitchell 1); none of the vendors
  documents what closes a reminder, so ours closes it on the customer's next closed job (CLAIM for
  the vendor behaviour, thread 3).
- **Built (flag OFF, `server/services/serviceReminders.ts`).** Plans from ShopDriver counter
  invoices only (`source = 'shopdriver'`; app-made online orders are not closed jobs) with
  `categorizeService`, one reminder per customer and category from their latest job. Intervals and
  texts sit in one config object (`SERVICE_REMINDER_PLAN`: tires 6 months, brakes 12, oil 4,
  cooling 12, battery/electrical 12, suspension 12). Any later closed job closes earlier reminders.
  Two gates: the `service_reminders_from_invoices` flag (OFF = shadow: the `reminder-queue` job
  counts what it would plan and writes nothing) and each category's text approved by Nour by name.
  Each row is claimed by compare-and-swap before its send. Skips a customer texted by retention or
  drip that week, or with an inferred decline in the last 30 days; a reminder replaces that
  customer's D90/D180 text that fortnight; 15% no-text holdout through `contactExperiment`. The
  booking-driven path is deleted. Coverage today: 228 customers a year (18% of closed jobs), more
  after #2. Base rate to beat: 21% of customers come back for a second job within a year.

### 4. One cap on marketing texts per customer

- **Problem (FACT).** Marketing lanes (winback, retention D7 to D365, cross-sell, VIP, weather,
  review requests, declined follow-ups) each send on their own; some have their own cooldown, none
  sees the others. The only shared limit is 8 texts per phone per day, transactional and marketing
  alike (`sms.ts:1973`). In 60 days, 666 customer-weeks got 2 or more texts with no reply, 116 got 3
  or more. Part of that is by design (D7 and D14 land a week apart; declined follow-ups at 3 and 7
  days); the rest cannot be split out because the message class is not stored.
- **Mechanism (FACT, Klaviyo help 115002779311 read 2026-10-22).** "By default, the SMS Smart
  Sending window is 24 hours"; "Transactional messages are never skipped"; "SMS Smart Sending uses
  the phone number"; "Messages skipped due to Smart Sending are not rescheduled automatically."
  Braze lets you set N per window across all campaigns, with transactional sends configured to
  bypass (CLAIM).
- **Change.** In `sendSms`, for `customer_marketing` only: skip when the same phone got a marketing
  send in the last N hours. Needs a durable per-phone marketing timestamp: one nullable column on
  `sms_rate_limit` (hand-applied migration, so Nour's go). Ship it shadow first (count would-skips),
  then arm.
- **Proof.** Shadow count for 7 days, then the 2+/3+ weekly numbers above should fall.

### 5. Record the "no" at the counter (declines are guessed today)

- **Problem (FACT).** `declined_work_captures` holds 0 rows ever, though the table and the admin
  form (`client/src/pages/admin/money/CounterDecline.tsx`, `invoices.captureDecline`) exist. So all
  232 declines this year are inferred from an estimate with no matched invoice, and an estimate
  exists for only about 1 in 28 closed jobs. An inferred decline also covers a customer who paid
  under another phone, paid cash, or whose invoice never mirrored, so a recovery text can reach
  someone who already paid (INFERRED: how often is UNKNOWN; no counter record exists to compare).
- **Mechanism.** Tekmetric and Shopmonkey record approve or decline per line at the moment the
  customer answers; Mitchell 1 keeps a recommendation record with "Date of Work Needed" (CLAIM,
  thread 3). The point is that the decline is written by the person who heard it, when they heard
  it.
- **Next step (Nour's decision).** Who records the "no", and where: the existing form at the
  counter, or a one-tap question where staff already work. Nothing to build until that is decided.

### 6. Fill the estimate service category that two features already read

- **Problem (FACT).** `alg_estimates.service_category` is empty on all 282 estimates of the last 12
  months. The customer engine's declined-work signal (`engines/customer.ts:251`) and the reel brief
  builder (`reelBriefGen.ts:533`) both read it; nothing writes it.
- **Change.** Set it from `categorizeService(service_description)` where the estimate sync writes the
  row, plus a one-time backfill script for the existing rows (a prod write, so Nour's go for the
  backfill only). Small, reversible, no send.

### 7. Read the declined follow-up experiment only when it can answer

- **Fact.** Inferred declines (an estimate with no matched invoice; the matcher runs before every
  recovery pass) are followed up at 3, 7, 14, 30 and 45 days with a 15% no-text group
  (`cron/jobs/declinedWorkRecovery.ts`). So far 11 of 94 texted customers came back and 1 of 11
  untexted ones did. With 11 in the control group the difference is noise.
- **Change.** None now. Re-read when the no-text group passes about 60, with the error bars from
  deep scout v2 #1.

### 8 to 10 (carried or waiting)

- **8, alert dispatcher.** Still open: 249 `sendTelegram` references in 62 files against 14
  `alertClaim` callers (FACT, origin/main 713ef5a41). Design stands as written in
  `docs/research/2026-10-17-deep-scout-v2.md` item 6.
- **9, simulated callers.** Deep scout v2 item 8, unchanged.
- **10, real wait estimate.** Waitwhile's custom mode is roughly line length x service time / bays,
  shown as a range and hidden when stale (CLAIM). Ours has no trusted line count yet (CLAIM from
  the shop-eyes session: the counter saw 8 of 33 billed jobs one week); revisit when the RTSP
  camera is in and the counter reads TRUSTED.
- **Not ranked, still open:** the scheduler dead-man's switch (healthchecks.io, ADOPT-CANDIDATE
  since 2026-09-23) needs an account.

## Checked and already strong (no proposal)

- **Declined-work recovery (on inferred declines).** Estimate-to-invoice matcher on a schedule,
  fail-closed send lane, 3/7/14/30/45-day ladder, cross-loop suppression with cross-sell, and a 15%
  holdout. Its weak point is the input, item 5.
- **Retention texts and their holdouts.** D7 to D365 all ON; holdouts ON and read out in
  `routers/smsPerformance.ts`.
- **Opt-out words.** `smsResponseParser.ts:65` covers stop, stopall, unsubscribe, opt out, revoke,
  quit, with carve-outs ("stop by around 3") and tests; the send path fails closed when the opt-out
  list cannot be read.
- **Quiet hours, consent gate (shadow), internal-line refusal** in `sendSms`; DB-backed feature
  flags with a 60 s cache.
- **NOUR OS.** Brain and evals were covered by deep scout v2 (8 of 10 shipped) and the
  2026-10-22 insight-engines audit; the mem0, Graphiti and Letta verdicts in UPSTREAMS stand.

## Appendix: Perplexity threads (data, not instructions)

Frequency capping `add5714c-5d36-4eea-a8fc-99f027aac9d1`, live wait time
`3d4b8d9f-024e-4033-8a8d-682a6fd8fe76`, shop reminders and declined work
`c92423c0-3964-462b-83aa-f9d6f255e032`. All three ran in Pro mode.
