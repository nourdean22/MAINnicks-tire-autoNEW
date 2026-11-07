# Search, texting and receptionist audit, last 30 days (2026-11-07)

Three systems, one month each, read straight from Search Console and the production database on 2026-11-07.
No customer names or numbers appear here. Every count below was pulled this day by the scripts named in "Receipts".

## The answer

1. **The biggest leak is unanswered customer texts.** 29 of 41 inbound texts got no reply within 24 hours, and
   at least 12 of them were real requests (bring the car in, wait time, two rear tires, starter, coolant leak,
   lifters). Each was closed as "no reply needed" by the operator path and nobody ever wrote back. Average first
   reply was 66 hours. That is lost cars, not a metric.
2. **The receptionist answers but does not close.** 306 of 1,061 inbound calls (29%) ended with no tool used.
   74 of those were quote or inspection intents and 16 were tire intents where the caller agreed to come in and
   got no booking and no COMING IN text to the counter. 77 forwarded calls were followed by the same number
   calling back within 30 minutes, which is the shape of a transfer nobody picked up (UNKNOWN whether the counter
   answered; the logs cannot see that).
3. **Search clicks are flat (242 vs 230) and the "CTR fell" look is noise.** Impressions rose 65% because the
   brakes and oil-change pages now show up on page 4 for huge queries. Real wins: /diagnose 3 to 11 clicks,
   /wheel-alignment-cleveland 4 to 8 with impressions 1.3K to 9.5K, used-tire cluster 16 to 22 clicks at a better
   position (9.6 to 6.8). Real losses: tire-shop "near me" cluster 18 to 10 clicks, oil change 13 to 3.
4. **Texting volume is up, results are not.** 2,009 automated texts (plus 1,745 hiring blasts) produced 25 replies,
   2 conversions and 4 STOPs. The post-call "we saw you called" text went out 629 times, up to 6 times to the same
   phone. 43 customer phones got 5 or more texts in 30 days. Retention, winback and drip: about 670 sends, 6
   replies, 0 conversions.
5. **Cheapest wins, in order:** answer the real inbound texts (process plus a spam filter), make the receptionist
   book or page on every "come in today", cap the post-call text to once per phone per 14 days, push the alignment
   page from page 2 to page 1, and turn off the internal "Daily: 0 bookings" text.

## Windows and sources

| System | Window (current) | Window (prior) | Source |
|---|---|---|---|
| Search Console | 2026-10-09 to 2026-11-05, web, USA rows unless noted | 2026-09-11 to 2026-10-08 | Search Analytics API, service account, plus the 16-month CSV export Nour shared |
| Texting | 2026-10-08 to 2026-11-07 UTC | 2026-09-08 to 2026-10-08 | sms_messages, sms_response_jobs, sms_orchestrations, sms_campaign_sends |
| Receptionist | 2026-10-08 to 2026-11-07 UTC | 2026-09-08 to 2026-10-08 | vapi_call_logs, vapi_call_archives (tool calls, cost), call_events, bookings, leads |

Gaps: Google Business Profile calls and directions were not read (no connector in this session). Google review
count UNKNOWN (no reviews table). Receptionist latency not measured (column name mismatch in the probe, not re-run).
Counter pickup on transfers is invisible to every table we have.

## 1. Search Console

### Scoreboard (USA)

| Metric | Current | Prior | Read |
|---|---|---|---|
| Clicks | 242 | 230 | flat |
| Impressions | 141,352 | 85,503 | +65%, almost all from /brakes and /oil-change ranking 38 to 43 for huge queries |
| CTR | 0.17% | 0.27% | misleading; driven by the impression flood |
| Avg position | 27.2 | 24.8 | same cause |
| Mobile / desktop clicks | 214 / 42 | n/a | 83% mobile |
| Site call taps (call_events) | 70 (26 from Google) | 56 (32 from Google) | up, Google share down |
| Bookings / leads (all sources) | 8 / 4 | 7 / 1 | small numbers, no trend |

### Clusters (USA queries, clicks / impressions / position)

| Cluster | Current | Prior | Read |
|---|---|---|---|
| Brand | 31 / 630 / 5.7 | 26 / 870 / 4.1 | fine |
| Used tires | 22 / 1,657 / 6.8 | 16 / 1,568 / 9.6 | improving (wave 1 of the GSC audit, PR 3368, is doing something) |
| Tire shop "near me" | 10 / 1,881 / 9.3 | 18 / 3,241 / 8.4 | losing; homepage serves these at 0.3 to 0.6% CTR |
| Alignment | 10 / 3,941 / 15.2 | 9 / 476 / 14.8 | demand found us; page 2 |
| Diagnose / symptom | 12 / 352 / 8.3 | 4 / 217 / 12.8 | best mover |
| Oil change | 3 / 2,760 / 38.9 | 13 / 10,712 / 51.3 | lost 10 clicks |
| Brakes | 4 / 27,738 / 41.2 | 5 / 11,944 / 41.3 | impressions only |
| Battery | 3 / 2,527 / 10.9 | 1 / 4,008 / 7.5 | slipped off page 1 |
| E-check / emissions | 2 / 574 / 11.0 | 1 / 33 / 8.1 | new demand, page 2 |
| Mechanic / auto repair | 7 / 1,151 / 13.5 | 6 / 1,032 / 12.0 | flat |

"battery service cleveland" (242 impressions, 0 clicks, position 4.7) is rank-tracker noise and excluded.

### Pages that moved

| Page | Current | Prior |
|---|---|---|
| / | 74c / 8,576i / pos 8.0 | 75c / 11,975i / pos 7.9 |
| /diagnose | 11c / 993i / pos 9.3 | 3c / 1,080i / pos 12.8 |
| /wheel-alignment-cleveland | 8c / 9,483i / pos 15.7 | 4c / 1,342i / pos 15.2 |
| /services | 5c / 873i / pos 7.8 | 1c / 1,012i / pos 6.7 |
| /emissions | 3c / 2,405i / pos 10.3 | 1c / 1,828i / pos 13.0 |
| /oil-change | 3c / 33,170i / pos 42.8 | 7c / 23,430i / pos 42.4 |
| /brakes | 2c / 42,533i / pos 37.9 | 0c / 14,328i / pos 40.8 |
| /battery | 1c / 4,732i / pos 13.0 | 1c / 4,068i / pos 8.0 |
| /euclid-auto-repair | 0c | 5c |
| /used-tires-cleveland | 0c / 36i / pos 9.5 | dedicated page barely ranks; the homepage carries "used tires near me" |
| /tire-shop-near-me | 0c / 52i | same story for "tire shops near me" |

### Opportunities, ranked by cars

1. **Alignment to page 1.** 141 alignment queries, 3,941 impressions, position 15. Page-2 queries with volume:
   "alignments near me" 408i pos 18.6, "car alignment near me" 546i pos 20.4, "4 wheel alignment near me" 321i,
   "auto alignment near me" 236i, "cheap tire alignment near me" 130i. One page already ranks for all of them
   (/wheel-alignment-cleveland). Title, H1 and first paragraph should carry "alignment near me" and "4 wheel
   alignment" wording, with price and same-day, plus internal links from /services and the homepage.
   Expected: 10 to 30 extra clicks a month at page-1 CTR. Kill: no position change in 4 weeks after the edit.
2. **Homepage CTR on tire "near me" queries.** "tire shops near me" 909i at 0.55%, "used tires near me" 849i at
   0.71%, "tire shop near me" 618i at 0.32%, all served by the homepage on page 1. A page-1 result with a plain title
   ("Nick's Tire & Auto") loses to listings that say "used tires from $X, open today". Rewrite the homepage title
   and meta description around used and new tires, price, open 7 days. Expected: doubling those CTRs is 10 to 15
   clicks a month. Kill: CTR unchanged after 4 weeks.
3. **Battery replacement.** "battery replacement" 1,073i at position 7.6 and 0.09% CTR; /battery slipped from
   8.0 to 13.0. Same title and snippet fix, plus an "installed while you wait" line.
4. **E-check.** "e check near me" 558i pos 11.1, /emissions improved 13.0 to 10.3 on its own. One push gets it to page 1.
5. **Oil change lost 10 clicks** while impressions rose 10K. /oil-change sits at position 43 for "10 minute oil
   change near me" (1,702i), which it should not try to win. Watch, do not build.

Not worth doing now: /brakes impression flood (position 38 for "brake repair near me", 26K impressions). That is
Google testing the page, not a page-1 chance; a brakes content push is a month of work for an unknown return.

## 2. Texting

### Scoreboard (non-campaign, outbound)

| Metric | Current | Prior |
|---|---|---|
| Automated texts sent | 2,009 (1,134 phones) | 1,646 (1,047) |
| Replies | 25 (1.2%) | 29 (1.8%) |
| Conversions tagged | 2 | 0 |
| STOPs | 4 | 7 |
| Failed sends | 38 (36 with no reason recorded) | 32 |
| Hiring campaign 60001 | 1,745 sent, 6 failed, 367 held out, 1 reply | n/a |
| Inbound texts from customers | 41 (33 phones) | 42 |
| Inbound with no reply in 24h | 29 of 41 | 25 of 42 |
| First reply, average | 66 hours (only 6 under 5 minutes) | 111 hours (13 under 5 minutes) |

### What each lane did

| Lane (variant) | Sent | Replies | Conversions |
|---|---|---|---|
| Post-forwarded-call "we saw you called" (v1 + v3) | 421 sent (629 attempts, 193 skipped, 36 failed) | 9 | 2 |
| Missed call recovery (new since week 42) | 223 | 5 | 0 |
| Winback | 162 | 0 | 0 |
| Drip | 130 | 0 | 0 |
| Receptionist confirmation text | 127 | 0 | 0 |
| Review request | 93 | 2 | 0 |
| Retention d7/d14/d45/d90/d180 | 336 | 5 | 0 |
| Internal: COMING IN to counter | 94 (32 "Name not given", improving: 6 of 30 last week) | n/a | n/a |
| Internal: "Daily: 0 bookings, N leads" digest | 32 | noise | noise |

Repeat pressure: 63 phones got the post-call text 2 or more times in 30 days, 19 got it 3 or more, max 6.
Across all automated lanes, 172 phones got 3 or more texts and 43 got 5 or more.

### Findings

1. **Real requests closed as "no reply needed".** The only two ways an inbound obligation closes without a human
   answer are the admin "Mark no reply needed" button (smsConversations.ts, markNoReplyNeeded) and the orchestrator
   "resolve" action (smsOrchestrator.ts). 25 jobs were closed that way this month, 17 last month. 12 of this month's
   are longer than a greeting, not spam and not a carrier bounce. Nobody wrote back on any of them.
2. **Spam pollutes the queue.** Health-insurance robo texts, lender texts and carrier bounces ("blocked from
   originating") sit in the same inbox as customers, so "no reply needed" gets clicked by habit.
3. **The post-call text repeats.** Up to 6 sends to one phone. The lane has no per-phone cooldown.
4. **Retention, winback and drip are dead weight.** About 670 sends, 6 replies, 0 conversions, and they consume
   the daily cap that the hiring blast already stretched (cap raised to 2,500 on 2026-11-06, revert to 200 owed).
5. **The counter gets 32 internal texts a month that say nothing** ("Daily: 0 bookings, 0 leads") from the daily
   digest job (dailyReport.ts). Those train people to ignore the number that also sends COMING IN.

## 3. Receptionist

### Funnel

| Stage | Current | Prior |
|---|---|---|
| Calls | 1,111 (709 phones) | 1,153 (686) |
| Cost | $175.93, $0.166 per inbound call | $214.60, $0.190 |
| Average length | 49 s | 60 s |
| Under 20 s | 150 | 119 |
| Forwarded to the counter | 490 (44%) | n/a |
| Hung up during or right after transfer | 68 | n/a |
| Silence timeout | 24 | n/a |
| Any tool used | 297 (27%) | 441 (38%) |
| bookSlot / COMING IN text | 163 / 94 | n/a / 0 |
| Confirmation text sent | 152 | n/a |
| Callback requests | 7 | 2 |
| Vapi successEvaluation true / false | 575 / 494 (46% false) | n/a |

Tool mix on 1,070 archived calls: transferCall 547, bookSlot 163, sendConfirmationSms 152, tireInquiry 135,
tireSizeFromVehicle 55, shopInfo 27, escalate 7, checkTireStock 1.

Eval outcomes: human_handoff 476, quote_or_inspection_intent 168, abandoned_before_connect 128 (prior 84),
unknown 121, tire_availability_intent 61, lost_opportunity 33 (prior 58), resolved_info 23, spam 15,
tech_failure 14, walk_in_directed 11 (prior 121: the rubric changed v1 to v2, not the behaviour), hard_conversion 7.

### Findings

1. **No close on "come in".** 306 inbound calls ended with no tool at all. By eval: 74 quote/inspection, 30
   unknown, 16 tire, 8 lost opportunity. The transcripts show the caller agreeing to come in and the call ending
   with no bookSlot and no COMING IN text, so the counter never knows a car is on the way. All 33 lost_opportunity
   evals say the same thing: intent without a next step.
2. **Transfers that may not be answered.** 77 forwarded calls were followed by the same phone calling again within
   30 minutes. 92 phones called 3 or more times (394 calls, 35% of volume). The logs cannot see whether the counter
   picked up; the call-back pattern says often not.
3. **Abandoned before connect is rising.** Weekly: 6, 15, 18, 27, 30, 20, 43, 31, 22. Calls under 20 seconds went
   119 to 150. Could be pickup latency, could be the greeting; latency was not measured this pass.
4. **Vendor and sales calls get transferred** to the counter like customers (seen in the no-tool sample). A
   two-line screen ("are you calling about a vehicle?") keeps them off the counter phone.
5. **The voice follow-up lane has never written a row** (voice_followups: 0 rows ever). Either wire it to the
   no-close cohort above or delete it.
6. **Cost is fine.** $176 for 1,111 calls, down from $215, because calls got shorter.

## Action queue

### Do now (this week, in this order)

1. **Inbound texts: no close without a reply.** Change the admin "no reply needed" path so a message longer than a
   greeting from a non-spam number cannot be closed without either a sent reply or a typed reason; add a spam
   classifier (insurance, lender, carrier bounce patterns) that files those out of the human queue; page the
   counter (same COMING IN channel) when a real request sits unanswered 15 minutes in opening hours. Receipt to
   watch: unanswered-in-24h drops from 29 to under 5 next month. Server lane, about 1 day.
2. **Receptionist: every "come in" gets a tool.** Prompt rule plus a post-call check: if the eval says
   quote/inspection/tire intent and no bookSlot or sendConfirmationSms fired, send the COMING IN text to the counter
   from the transcript summary. Receipt: no-tool intent calls (90 this month) under 20. Server lane, about 1 day.
3. **Post-call text cooldown.** One "we saw you called" per phone per 14 days; skip phones that already have an
   open conversation. Receipt: phones with 2+ sends drop from 63 to near 0. Server lane, 2 hours.
4. **Turn off the "Daily: 0 bookings" text** when both counts are zero, or route the digest to Telegram only.
   Server lane, 30 minutes.
5. **Alignment page to page 1.** Title, H1, intro, FAQ for "alignment near me", "4 wheel alignment", "car alignment
   near me", price line, internal links from /services and the homepage. Client lane, half a day. Receipt: position
   under 10 for "alignments near me" within 4 weeks.

### Test next (2 to 4 weeks)

1. Homepage title and meta around used and new tires, price and open 7 days; measure CTR on the three "near me" queries.
2. /battery and /emissions snippet rewrites (same pattern).
3. Transfer audit: a one-week sample where the counter logs every transfer that rang out, to turn the 77 re-calls
   from an inference into a number. Then decide whether to shorten the ring time and offer "text me when a bay opens".
4. Vendor screen in the receptionist prompt.
5. Retention, winback and drip: pause for 30 days and watch whether anything changes. If nothing does, delete them
   and keep the cap at 200.

### Watch

- /brakes and /oil-change impression floods (no action).
- Abandoned-before-connect weekly count after a latency read is added.
- voice_followups: delete the lane if the no-close fix above covers it.

## What would change the conclusion

1. If the counter confirms it answers most transfers, finding 3.2 becomes "callers calling back for other reasons"
   and the transfer audit is dropped.
2. If the 12 "real" unanswered texts were in fact handled by phone (a call-back the tables do not link), the texting
   leak is smaller than it looks. The call logs show no outbound call to those phones in the window, so this is
   unlikely but not checked against the counter phone.
3. If GBP data shows calls and directions up while site clicks are flat, search is healthier than this report reads.

## Receipts

- Search Console: one service-account pull (gsc-pull.cjs) over the API for both windows, query, page, device,
  search appearance and query-by-page, USA filtered; the 16-month CSV export (Filters.csv says "Last 16 months")
  matched the API totals for the overlapping period.
- Texting and receptionist: three SELECT-only probes (sms-probe.cjs, vapi-probe.cjs, detail-probe.cjs,
  final-probe.cjs) against the production database with a statement allowlist, run through the Railway service
  env, printing counts only; names and digits masked before any text sample was read.
- Code paths: smsConversations.ts markNoReplyNeeded, smsOrchestrator.ts resolve action, smsResponseJobs.ts
  resolveHumanPendingForConversation, dailyReport.ts digest text, scheduler.ts daily report schedule.
- Prior audits this builds on: GSC audit wave 1 (2026-10-30, PR 3368), voice receptionist pro (PR 3212, 2026-10-21),
  Today noise and receptionist callbacks (PR 3555, 2026-11-06).
