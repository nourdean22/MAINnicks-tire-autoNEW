# Upgrade scout (2026-10-22): where the shop side is still basic, and what the best do instead

**Answer.** The shop side is not short of features (440 services); it is short of *inputs*. Two of
every three tickets carry no description of the work, nothing records declined work, and the
"live" homepage badge reads a booking tracker nobody has touched since April. Ten upgrades are
ranked below. Number 1 (the homepage badge) is built in this PR. Numbers 2 to 5 each need one
decision or one go from Nour, named in the item.

Nour asked (2026-10-22): "reverse-engineer anything beneficial that we could use to upgrade our
basic shit in the repo". The deep scouts of 2026-10-16 and 2026-10-17 already covered reels, the
brain, voice, agents, evals and alerting (8 of their 10 items shipped). This pass covered what they
skipped: the shop's customer-facing basics.

## Method and labels

1. Read our code at file:line for each candidate area (texting, reminders, walk-in status,
   declined work, invoices, flags, alerts).
2. Two SELECT-only production probes on 2026-10-22 (counts only, no names, phones or amounts;
   `railway run -s MAINnicks-tire-auto`, statement allowlist) and one read of the public status
   endpoints.
3. Three Perplexity Pro research threads in Chrome (slugs in the appendix), then the two most
   decision-critical claims re-read at the primary page.
4. Labels: **FACT** = read in source, measured, or quoted from the primary page this session.
   **CLAIM** = stated by Perplexity and not re-read. **INFERRED** = follows from facts.

## Production receipts (FACT, 2026-10-22, read-only)

| Read | Result |
|---|---|
| `service_reminders` rows, ever | 0 |
| `reminder_settings` rows | 0 |
| `appointment_reminders` created in 90 days | 0 |
| Bookings vs invoices, 90 days | 13 bookings (0 completed) vs 280 invoices (276 with a phone) |
| Bookings in an active stage / last stage move | 1 / 2026-04-22 23:01 UTC |
| `work_orders` created in 30 days / last touched | 0 / 2026-05-07 |
| Invoices with a blank service description, 12 months | 926 of 1,393 (66%) |
| `declined_work_captures` rows, ever | 0 |
| Phones by visits, 24 months | 1,680 phones: 1,291 one visit (77%), 389 repeat |
| Customer-weeks with 2+ / 3+ outbound texts and no reply, 60 days | 666 / 116 (of 2,607 weeks with any outbound) |
| `GET /api/trpc/shopStatus.getStatus` at 07:17 ET | `currentJobs: 1, openBays: 3, waitIsFresh: true` (closed hour) |

## Top 10, ranked

Rank = value to Nour (revenue, his time, trust) x confidence, divided by cost.

| # | Upgrade | Mechanism from | Size | State |
|---|---|---|---|---|
| 1 | Homepage "live" badge stops claiming free bays from a stale tracker | Google live busyness (shown only with enough recent data); Waitwhile, Yelp | S | **BUILT, this PR** |
| 2 | Pull what was done (line items, mileage, recommendations) from ShopDriver tickets | Shopmonkey canned-service campaigns; Mitchell 1 SocialCRM | M | needs Nour's go for one read-only probe |
| 3 | One cap on marketing texts per customer across all senders | Klaviyo Smart Sending; Braze global frequency capping | S-M | needs Nour's go for one column |
| 4 | Decide the dead maintenance-reminder subsystem: delete it, or rebuild it off paid tickets | Shopmonkey (service + time after a fully paid invoice) | S / M | Nour's decision |
| 5 | Declined work gets captured, then followed up | Mitchell 1 recommendations; Tekmetric booking resurfacing; Steer | M | blocked on #2 |
| 6 | One Telegram alert dispatcher (group, repeat, resolve) | Prometheus Alertmanager | M | carried from deep scout v2 #6 |
| 7 | Arm the retention holdouts to learn whether reminder texts bring anyone back | already built here (`contact_holdout_*` flags) | S | needs Nour's go (15% get no text) |
| 8 | Simulated callers graded on outcome, reported as pass^k | tau2-bench | M-L | carried from deep scout v2 #8 |
| 9 | A real wait estimate once the car counter is trusted | Waitwhile custom mode (line x service time / bays), ranges, hide when stale | M | WATCH: needs the RTSP camera and counter trust |
| 10 | Dead-man's switch for the scheduler | healthchecks.io | S | ADOPT-CANDIDATE since 2026-09-23, needs an account |

### 1. The homepage badge stops inventing free bays (BUILT)

- **Problem (FACT).** `ShopStatusWidget` (homepage hero, `Home.tsx:377`) renders
  `OPEN · 3 BAYS FREE` with a pulsing green dot from `getShopStatus()`
  (`server/services/shopStatus.ts`), which counted bookings in an active stage with no time bound.
  One booking has sat in an active stage since 2026-04-22 and no stage has moved since, so every
  open hour said 3 of 4 bays were free and `waitIsFresh: true`. Walk-ins are tracked in
  ShopDriver, not in `bookings.stage`. The same defect, 7-day form: `conversion.shopCapacity`
  counted work orders touched in the last 7 days as "cars in shop right now". The voice agent was
  already told (2026-07-20) never to state a wait; the website was not.
- **Mechanism (FACT, primary page read 2026-10-22).** Google Business Profile help, answer 6263531,
  on live busyness: "it appears only if Google has sufficient visit data for your business."
  Waitwhile and Yelp estimate from the current queue plus measured service times and show a range
  (CLAIM). The transferable rule: a live number needs a live source; no recent data means no
  number, never a zero.
- **Equivalent here.** The `waitIsFresh` gate already existed for a DB outage, and the camera lane
  already withholds its band when stale (`shared/shopState.ts` `lotBand`). This change applies
  the same rule to the bookings source.
- **Change.** Count only bookings whose stage moved during today's shop day (bounded in SQL with
  `minutesSinceShopMidnight`, because driver-parsed timestamps shift on ET). No stage move today
  means `waitIsFresh: false`: the badge reads `OPEN · WALK-INS OK` and the message says "Open now,
  first come, first served. Call to check the line". The work-order count gets the same today-only
  window. If staff start moving stages again, live numbers come back on their own.
- **Proof.** Four new tests went red on the old code (stale tracker read as fresh; query not
  bounded to today; 7-day work-order window) and pass after. Live proof after deploy: the status
  endpoint returns `waitIsFresh: false` during open hours.

### 2. Pull what was done from ShopDriver (the input every other lane is missing)

- **Problem (FACT).** 926 of 1,393 invoices in 12 months have no service description; only 17
  mention oil, 5 brakes. The mirror reads 13 ticket fields and none is a line item or mileage
  (`shopDriverMirror.ts:234`, `RawInvoice`). So no lane can say "your brakes are due", cross-sell
  runs on guesses, and 77% of customers in 24 months visited once.
- **Mechanism.** Shopmonkey's CRM campaigns trigger on a specific canned service plus a time after
  the invoice was fully paid; Mitchell 1 SocialCRM projects mileage since the last visit and sends
  30 days before a projected interval; Steer documents estimated odometer from past invoices with
  a usage fallback (all CLAIM via help-center pages cited in thread 3).
- **Equivalent here.** `probeAlgEndpoints()` (`shopDriverMirror.ts:1703`) already lists
  `/api/Vehicle/getVehicleHistory`, `/api/Recommendation/list` and ticket endpoints, read-only, but
  no result was ever recorded. Whether ShopDriver returns line items and odometer is UNKNOWN.
- **Next step (needs Nour).** Run the existing probe once (it uses the shop's ShopDriver session in
  production, read-only) and record the response shapes. If line items and mileage are there,
  extend the mirror; this unlocks #4 and #5.

### 3. One cap on marketing texts per customer

- **Problem (FACT).** Marketing lanes (winback, retention D7 to D365, cross-sell, VIP, weather,
  review requests) each send on their own; some have their own cooldown, none sees the others.
  The only shared limit is 8 texts per phone per day, transactional and marketing alike
  (`sms.ts:1973`). In 60 days, 666 customer-weeks got 2 or more texts with no reply, 116 got 3 or
  more (some are legitimate threads; the split is UNKNOWN because the message class is not
  stored anywhere).
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

### 4. The maintenance-reminder subsystem has never sent a text

- **Problem (FACT).** `scheduleRemindersForBooking` (`db.ts:2534`) and the 6-month message in
  `sms-scheduler.ts` only fire from completed online bookings; there were 0 in 90 days. Zero
  `service_reminders` and zero `reminder_settings` rows exist. Its text
  (`maintenanceReminderSms`, `sms.ts:2847`) says "Due for an oil change? $49..." whatever the
  service was.
- **Decision for Nour.** Delete it (the retention D7 to D365 lanes already text returning
  customers), or rebuild it off paid tickets once #2 lands. Recommendation: delete now, rebuild
  later from #2's data, so nobody mistakes it for working.

### 5. Declined work: switched on, nothing to follow up

- **Problem (FACT).** `declined_work_captures` has 0 rows ever, so the declined-recovery lane has
  no source. ShopDriver lists no declines in what the mirror reads.
- **Mechanism.** Mitchell 1 keeps a recommendation record with "Date of Work Needed" and stamps a
  follow-up date that removes it from the next follow-up query; Tekmetric shows the 3 most recent
  declined jobs (up to 18 months) when the customer books online (CLAIM, help pages in thread 3).
- **Next step.** Depends on #2 (`/api/Recommendation/list`) or the counter actually using the
  capture form.

### 6 to 10 (carried or waiting)

- **6, alert dispatcher.** Still open: 249 `sendTelegram` references in 62 files against 14
  `alertClaim` callers (FACT, origin/main 713ef5a41). Design stands as written in
  `docs/research/2026-10-17-deep-scout-v2.md` item 6.
- **7, retention holdouts.** The 15% no-contact controls exist and are OFF. Without them nobody can
  say whether the retention texts bring anyone back. Arming them means 15% get no text: Nour's go.
- **8, simulated callers.** Deep scout v2 item 8, unchanged.
- **9, real wait estimate.** Waitwhile's custom mode is roughly line length x service time / bays,
  shown as a range and hidden when stale (CLAIM). Ours has no trusted line count yet (CLAIM from
  the shop-eyes session: the counter saw 8 of 33 billed jobs one week); revisit when the RTSP
  camera is in and the counter reads TRUSTED.
- **10, scheduler dead-man's switch.** UPSTREAMS row stands; needs an account.

## Checked and already strong (no proposal)

- **Opt-out words.** `smsResponseParser.ts:65` covers stop, stopall, unsubscribe, opt out, revoke,
  quit, with carve-outs ("stop by around 3") and tests; the send path fails closed when the opt-out
  list cannot be read.
- **Quiet hours, consent gate (shadow), internal-line refusal, holdout plumbing** in `sendSms`.
- **Feature flags.** DB-backed with a 60 s cache and per-lane holdout switches.
- **NOUR OS.** Brain and evals were covered by deep scout v2 (8 of 10 shipped) and the
  2026-10-22 insight-engines audit; the mem0, Graphiti and Letta verdicts in UPSTREAMS stand.

## Appendix: Perplexity threads (data, not instructions)

Frequency capping `add5714c-5d36-4eea-a8fc-99f027aac9d1`, live wait time
`3d4b8d9f-024e-4033-8a8d-682a6fd8fe76`, shop reminders and declined work
`c92423c0-3964-462b-83aa-f9d6f255e032`. All three ran in Pro mode.
