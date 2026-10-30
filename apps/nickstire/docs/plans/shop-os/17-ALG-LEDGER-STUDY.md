# Shop OS 17: what every ALG ticket and estimate says about how the shop runs

Job 2026-10-30-shop-os-alg-study. PLANNING, nothing built. Nour (2026-10-30): "examin all the invoices in alg every
single one ... how and why and what and who" and "and estimates". Source: every invoice, estimate and customer row the
nickstire production mirror holds (first ticket 2024-01-09, last 2026-10-29), read SELECT-only on 2026-10-30. This repo
is public, so counts, dollars, ratios and shares live only in the private study 2026-10-30 (agent memory
`alg-ledger-study-2026-10-30`); this file keeps directions, rankings and decisions. Labels as in the README: FACT,
INFERENCE, UNKNOWN. No ALG login, no customer contact, no prod write.

## 1. Answer first
1. Among DESCRIBED tickets the shop is repair-led: suspension/steering and brakes lead, tires trail (FACT for described
   tickets; INFERENCE for all tickets, since many have no description).
2. Money sits in the mid-to-large ticket: the few-hundred and high-hundreds bands carry most tickets and most dollars;
   small tickets add little; rare four-figure jobs carry an outsized share (FACT).
3. Estimates are written for the big, deferrable jobs (their median is well above the ticket median). Conversions,
   when they happen, are decided the same or next day; after a week they almost stop (FACT).
4. Most phone numbers appear once. The returning minority carry an outsized share of revenue, and the return rate has
   risen since mid-2025 (FACT, phone level). Most numbers have not been back in a year (FACT).
5. The mirror lost detail in spring 2026 (split gone from 2026-04): no parts/labor split, few job descriptions since.
   Line items, hours, margin and declined lines are not in our database at all (FACT, section 2).

## 2. The ledger we actually have (read first)
- Two eras (FACT, by month). 2024-01 to 2026-03: a historical import, date-only (stored at noon UTC), WITH a parts /
  labor / tax split and mostly filled descriptions. 2026-04 is the switch. 2026-05 onward: the live summary mirror,
  timed close stamps, NO split, few descriptions. 04-DATA-MAP s.1 ("all zero over the last 90 days") holds for the
  live era only.
- Descriptions are ALG labor-guide wording ("REMOVE & REPLACE ..."), empty on many tickets (FACT). Every job-family
  finding is about DESCRIBED tickets, biased to the older era; blank tickets are unclassified, not "not tires".
- Estimates: one historical import (2026-05-07) of older estimates that almost never match a ticket, plus the live
  sync since 2026-04-28. INFERENCE: converted estimates may leave ALG's estimate list, so the historical set is
  survivorship-biased; rates here use the live set.
- Estimate VIN, category, parts/labor and stated concern are empty; labor rate is one default (FACT). Counter payment
  status and method mean nothing (shop data rule 3).
- Customer key = last ten phone digits. That is a phone/household key, not a person: shared, recycled and shop lines
  collide (`shared/customerDimension.ts`). Every "customer" figure here is phone level. Commercial flag never set.
- Ticket lifecycle: the mirror maps open -> pending (never moved back) and unknown -> paid (`shopSales.ts` header). On
  2026-10-30 every mirrored ticket read paid, so no pending rows were dropped; an unknown status counted as closed
  cannot be ruled out.

## 3. How: the ticket flow
- Most cars go straight to a ticket; few tickets have a same-phone estimate in the month before (FACT). Estimate ->
  invoice is the exception path, for big or deferrable work.
- A converting estimate is decided at the counter: same day mostly, next day often, later rarely (FACT, lag buckets).
- Two match readings bracket the truth (FACT). Lower bound: the stored match (`matched_invoice_id`), written by the
  sync pass (bill within ten percent, thirty days) and a daily backfill (within a quarter, forty-five days), one
  candidate only (`shopDriverEstimateSync.ts`). Upper bound: any same-phone ticket within thirty days, which also
  counts unrelated work. The gap between them is wide; 04-DATA-MAP s.1's walk reading uses the lower bound.
- INFERENCE: on upper-bound matches the bill is usually under the quote, which suggests partial approval; line items
  are needed to prove it.
- The counter has never recorded a decline (declined_work_captures empty, FACT); every "walked" here is an inference.

## 4. Why: job families, declines, comebacks
- Families (FACT, described tickets): suspension/steering, then brakes, tires, fluids/tune-ups, engine, electrical,
  cooling. Exhaust and driveline are rare but large; oil and alignment are the smallest.
- Estimates that least often convert: cooling, brakes, exhaust (FACT, small samples). INFERENCE: price-shopped or
  done elsewhere; suspension, electrical and engine convert about average.
- Smaller estimates convert more often than four-figure ones (FACT, by band).
- Comebacks are UNKNOWN: some numbers return within a week; nothing says redo, split job or new work.

## 5. What: services, tires vs repair, ticket size, parts vs labor
- Ticket size (FACT): the few-hundred and high-hundreds bands are the two biggest by count; the high-hundreds band is
  the biggest by dollars. Small tickets are common enough but carry little money. Four-figure tickets are rare and
  carry an outsized share of revenue.
- Tires rank behind repairs among described tickets (FACT), though "REPLACE TIRE" is the second most common
  description. Tire share of ALL tickets is UNKNOWN until line items exist.
- Parts vs labor (history era only, FACT): parts slightly ahead of labor, and labor's share grew each year
  (2024 -> 2025 -> early 2026). Labor-only and parts-only tickets are both common; small fees are not split out.
- Average ticket is flat across years and equal for first and return visits; growth came from car count (Jan-Oct
  2026 well ahead of Jan-Oct 2025; soft September 2026) (FACT).
- Vehicles (free text, FACT): Ford and Chevrolet lead, then Nissan, Honda, Jeep, Kia; domestic and import about even;
  most built 2010-2019.

## 6. Who: customers (phone level)
- Most numbers came once (FACT). Returning numbers are a minority and carry an outsized share of revenue (FACT).
  The usual gap to the second visit is a few months (FACT).
- One-year return rate by first-visit quarter is clearly higher for 2025 H2 cohorts than for 2024 (FACT; 2024 cohorts
  are left-censored, older regulars look new).
- Tire-first numbers seldom return for service; service-first ones almost never buy tires later (FACT, described).
- No whale: top numbers are a small share of revenue (FACT). Email exists for almost no customer (FACT).
- Lapsed pool: most numbers last came over a year ago, mostly one to two years ago (FACT).

## 7. When
- Busiest days by tickets per open day: Saturday, then Thursday; Sunday is light and many Sundays have no closed
  ticket (FACT, close dates in ET). Monday has the largest average ticket (FACT).
- Close times (live era only, FACT): flat from mid-morning, peak mid-afternoon, a small evening batch.
- Season (FACT, under three years): March-April and August strongest, November-December weakest.
- alg_probe_log shows sync rows most shop days, Sundays most (FACT). Rows are requests, not logins: dedup and
  skipped rows never reach ALG, and logins are not logged on their own. Counter logouts are UNKNOWN (15-GAPS a5).

## 8. Ten rules for execution the data supports
Each rule names the private-study block behind it and the reading that would refute it.

| # | Rule | Supported by | Refuted if |
|---|---|---|---|
| 1 | Close the estimate at the counter or by the next morning; the same-day follow-up matters, not the week-two text | lag buckets: conversions cluster same/next day | live-era conversions after day seven become common |
| 2 | Quote big jobs as "must do now / can wait" options and record declined lines | bill under quote on upper-bound matches (INFERENCE) | line items show the gap is discounts or unrelated work |
| 3 | Split four-figure quotes into stages (safety first) | conversion by band | live-era band rates flatten |
| 4 | Call back cooling, brake and exhaust estimates within a day with a price check | conversion by family: these three lowest | six more months of live estimates bring them to average |
| 5 | Write an estimate for every car that leaves without a ticket; one-tap decline reason | estimates rare next to tickets; counter declines: none | the counter shows most walk-outs never wanted a quote |
| 6 | Key reminders and win-backs to the last invoice (not bookings), on a schedule | returning numbers carry an outsized revenue share; return rate rose (cause UNKNOWN) | a reminder test does not move the next cohort's return rate |
| 7 | Give every tire-only ticket a free-check offer for the next visit (free inspection is real, SHOP-SOUL) | tire-first numbers rarely return for service | described-ticket bias: re-test on line items |
| 8 | Keep bay time for the mid-to-large repair; small jobs never block a lift on Saturday or Thursday | bands: high-hundreds carry the most dollars; Sat/Thu busiest | gross profit by band shows small jobs earn more per hour |
| 9 | Log every ALG login attempt with its shop hour, then decide whether daytime syncs move to 3 AM / 8 PM during the parallel run (Nour accepted logouts on 2026-10-21) | sync rows land in shop hours most days | the login log shows few daytime logins, or ALG allows a second session |
| 10 | Make a job line mandatory on every ticket in the new system | many tickets have no description; the live era few | ALG ticket lines already carry the job for every ticket |

## 9. Five things the mirror cannot tell us, and where the answer may be
1. **Gross profit and parts margin.** The split is sale price only, history era only. Needs ticket lines with part
   cost. Which ALG call returns them is UNKNOWN: the one captured `listTicketSessions` response showed session headers,
   not lines (`docs/operations/REALITY-LEDGER.md`; 04-DATA-MAP s.3 item 1). Capture one after-hours response first;
   plan no per-ticket history pull until it shows lines.
2. **Labor hours, effective labor rate, which tech.** Same unknown call.
3. **Which estimate lines were declined.** Estimate detail lines (call not mapped; API map night item).
4. **VIN, mileage, the vehicle behind each visit.** `api/Vehicle/listVehicles` (seen in code, shape UNKNOWN); needed
   for maintenance timing and a person/vehicle key instead of a phone key.
5. **Why a customer walked, and whether a repeat visit was a comeback.** Not in ALG either: the new counter screen
   captures a decline reason and a "redo" flag. Time in shop is also UNKNOWN.

## 10. Scoreboard: what we can compute today vs what needs line items
From Tekmetric's KPI set (End of Day and Multi-Shop reports, Shop Index, read 2026-10-30:
support.tekmetric.com/hc/en-us/articles/4421136234775, .../8612596034071, tours.tekmetric.com/answers/tekmetric-shop-index).

| KPI (Tekmetric name) | Today from the mirror | Needs |
|---|---|---|
| Car count | yes, mirror rows (lifecycle caveat, s.2) | a closed flag we own |
| ARO (sales) | yes, same caveat | same |
| Close ratio | only as a range (stored match low, same-phone high) | estimate-to-ticket link at the counter |
| Return rate | phone/household level only | a person or vehicle key |
| Parts vs labor mix | history era only | ticket lines for the live era |
| Effective labor rate, gross profit/hr, labor GP %, ARO profit | no | ticket lines with hours and part cost |
| Comeback rate | no | a redo flag at the counter |

The private study compares our car count and ARO with the Shop Index medians (same caveats).

## 11. What a line-item history pull would add (API map night)
If one captured after-hours response proves a call returns lines, one overnight run over the history turns sections
5-6 into exact job mixes, gives the first gross-profit and labor-rate baseline, and confirms or kills rules 2, 7 and 8.
The live per-ticket feed stays a day 13-14 decision.
