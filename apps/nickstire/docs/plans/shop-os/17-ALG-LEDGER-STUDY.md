# Shop OS 17: what every ALG ticket and estimate says about how the shop runs

Job 2026-10-30-shop-os-alg-study. PLANNING, nothing built. Nour (2026-10-30): "examin all the invoices in alg every
single one ... how and why and what and who" and "and estimates". Source: every invoice, estimate and customer row the
nickstire production mirror holds (first ticket 2024-01-09, last 2026-10-29), read SELECT-only on 2026-10-30. This repo
is public, so counts, dollars and percentages live only in the private study 2026-10-30 (agent memory
`alg-ledger-study-2026-10-30`); this file keeps the patterns and the decisions. Labels as in the README: FACT,
INFERENCE, UNKNOWN. No ALG login, no customer contact, no prod write.

## 1. Answer first
1. The shop is repair-led, not tire-led: suspension/steering and brakes carry most described tickets; tires are a
   minority line and tire-first customers rarely come back for repairs (FACT, sections 5-6).
2. Money sits in the mid-to-large ticket: the few-hundred and high-hundreds bands hold most tickets AND most dollars;
   small tickets are a sliver of dollars; the rare four-figure job is about a quarter of revenue (FACT).
3. Estimates are written for the big, deferrable jobs (their median is about twice the ticket median). In the live
   era about half convert, almost all on the same or next day; after a week conversion is near zero (FACT).
4. Most customers come once. The minority who return bring a large share of revenue, and the return rate has been
   rising since mid-2025 (FACT). More than half of all customers have not been in for a year (FACT).
5. The mirror lost detail in spring 2026 (split gone from 2026-04): no parts/labor split, almost no job descriptions since then. Line items, hours,
   margin and declined lines are not in our database at all (FACT, section 2).

## 2. The ledger we actually have (read this before any number)
- Two eras, not one (FACT, by month). 2024-01 to 2026-03: a historical import, date-only (stored at noon UTC), WITH a
  parts / labor / tax split and mostly filled job descriptions. 2026-04 is the switch. 2026-05 onward: the live summary
  mirror, timed close stamps, NO split, descriptions on only a small share of tickets. 04-DATA-MAP s.1 ("all zero over
  the last 90 days") is right for the live era and wrong for the history: the split exists for the older tickets.
- Descriptions are ALG labor-guide wording ("REMOVE & REPLACE ..."), empty on about half of all tickets (FACT). Every
  job-family figure is therefore a share of DESCRIBED tickets, biased to the older era.
- Estimates: one historical import (2026-05-07) of older estimates of which almost none match a ticket, plus the live
  sync since 2026-04-28. INFERENCE: converted estimates may leave ALG's estimate list, so the historical set is
  survivorship-biased; rates in this doc use the live set.
- Estimate VIN, category, parts/labor and stated concern are empty; labor rate is one default (FACT). Counter payment
  status and method mean nothing (shop data rule 3).
- Customer key = last ten phone digits (no duplicate keys, FACT). The commercial flag is never set.

## 3. How: the ticket flow
- Most cars go straight to a ticket; few tickets have a same-phone estimate in the month before (FACT). Estimate ->
  invoice is the exception path, for big or deferrable work.
- A converting estimate is decided at the counter: same day mostly, next day often, later rarely; one to six months
  later is a small tail (FACT, lag buckets).
- Partial approval is normal: on converted estimates the billed amount is usually a bit under the quote and well under
  it for a large minority (FACT, billed-to-quoted ratio). The production matcher demands the bill within ten percent of
  the quote, so it misses partial approvals and hides a large share of conversions (FACT: strict vs any-amount
  same-phone match; the any-amount match is an upper bound, it also counts other work). The "two of three estimates walk" figure in 04-DATA-MAP s.1 is the strict matcher's number.
- The counter has never recorded a decline (declined_work_captures empty, FACT); every "walked" here is an inference.

## 4. Why: job families, declines, comebacks
- Families (FACT, keyword classifier, described tickets): suspension/steering, then brakes, tires, fluids/tune-ups,
  engine, electrical, cooling. Exhaust and driveline are rare but large; oil and alignment are the smallest.
- Estimates that most often do NOT convert: cooling, brakes and exhaust (FACT, small samples). INFERENCE: these are the
  jobs customers price-shop or do themselves; suspension, electrical and engine convert about average.
- Smaller estimates convert more often than four-figure ones (FACT, by band).
- Comebacks are UNKNOWN: some repeat customers return within a week; nothing says redo, split job or new work.

## 5. What: services, tires vs repair, ticket size, parts vs labor
- Ticket size bands (FACT): the few-hundred band and the high-hundreds band are each a bit over a quarter of tickets;
  the high-hundreds band alone is the biggest slice of dollars. Small tickets (oil-change size) are about a tenth of
  tickets and almost none of the dollars. Four-figure tickets are rare and carry about a quarter of revenue.
- Tires are a minority of tickets and dollars (FACT), though "REPLACE TIRE" is the second most common description.
- Parts vs labor (history era only, FACT): parts a bit over half, labor a bit under half of parts+labor, and the labor
  share rose every year (2024 -> 2025 -> early 2026). Labor-only and parts-only tickets each exist in numbers; small
  fees are not split out.
- Average ticket is flat across years and equal for new and returning customers; growth came from car count (Jan-Oct
  2026 well ahead of Jan-Oct 2025; soft September 2026) (FACT).
- Vehicles (free text, FACT): Ford and Chevrolet lead, then Nissan, Honda, Jeep, Kia; about half domestic; most built
  2010-2019.

## 6. Who: customers
- About three in four customers came once in the window (FACT). Repeat customers are about a quarter of customers and
  over two fifths of revenue (FACT). Median gap to the second visit is a few months (FACT).
- One-year return rate by first-visit quarter rose from the 2024 level to clearly higher for 2025 H2 cohorts (FACT;
  2024 cohorts are left-censored, older regulars look new).
- Tire-first customers seldom return for service; service-first ones almost never buy tires later (FACT, described tickets).
- No whale: top customers are a small share of revenue (FACT). Email exists for almost no customer (FACT).
- Lapsed pool: more than half of customers last came over a year ago, most of them one to two years ago (FACT).

## 7. When
- Busiest days by tickets per open day: Saturday, then Thursday; Sunday is light and many Sundays have no closed
  ticket (FACT, close dates in ET). Monday has the largest average ticket (FACT).
- Close times (live era only, FACT): flat from mid-morning, peak mid-afternoon, a small evening batch.
- Season (FACT, under three years): March-April and August strongest, November-December weakest.
- The mirror's own probes log the counter out about twice per shop day, Sundays most (FACT, alg_probe_log last 30
  days; ties to 15-GAPS a5).

## 8. Ten rules for execution the data supports
Each rule names the private-study block behind it and the reading that would refute it.

| # | Rule | Supported by | Refuted if |
|---|---|---|---|
| 1 | Close the estimate at the counter or by the next morning; the follow-up that matters is the same-day one, not the week-two text | lag buckets: conversions cluster same/next day, near zero after a week | live-era conversions after day seven grow to a real share |
| 2 | Quote big jobs as "must do now / can wait" options and record which lines were declined | billed-to-quoted ratio: partial approval is common | line items (s.9 call 1) show the gap is discounts, not dropped lines |
| 3 | Split four-figure quotes into stages (safety first) | conversion by band: smaller quotes convert more often | live-era band rates flatten |
| 4 | Call back cooling, brake and exhaust estimates within a day with a price check | conversion by family: these three convert least | the next six months of live estimates bring them to average |
| 5 | Write an estimate for every car that leaves without a ticket, and capture a decline reason with one tap | estimates are rare next to tickets; counter declines recorded: none | the counter shows most walk-outs never got a quote because none was wanted |
| 6 | Key reminders and win-backs to the last invoice (not bookings) and run them on a schedule | repeat customers are a quarter of customers and over two fifths of revenue; the one-year return rate rose in the same period (cause UNKNOWN) | a reminder test does not move the one-year return rate of the next cohort |
| 7 | Give every tire-only ticket a free-check offer for the next visit (the free inspection is real, SHOP-SOUL) | tire-first customers rarely return for service | described-ticket bias: re-test on line items once pulled |
| 8 | Keep bay time for the mid-to-large repair; do not let small jobs block a lift on Saturday or Thursday | bands: high-hundreds tickets carry the most dollars; Saturday and Thursday busiest | gross profit by band (needs line items) shows small jobs earn more per hour |
| 9 | Count counter logouts per shop hour; during the parallel run, prefer the 3 AM and 8 PM syncs over daytime admin-load syncs (Nour accepted the logouts on 2026-10-21; this is a re-ask for that phase only) | probe log: about two counter logouts per shop day, Sundays most | the counter reports no logouts felt, or ALG allows a second session |
| 10 | Make a job line mandatory on every ticket in the new system (no blank descriptions) | half of all tickets have no description; the live era almost none | ALG ticket lines (s.9 call 1) already carry the job for every ticket |

## 9. Five things the mirror cannot tell us, and the ALG call that would
1. **Gross profit and parts margin.** The split is sale price only, and only for the history era. Needs the closed
   ticket WITH its lines and part cost: `/api/ticket/listTicketSessions` per ticket (04-DATA-MAP s.2; each call kicks
   the counter login, so run it overnight, one time, for history).
2. **Labor hours, effective labor rate, which tech.** Same ticket-detail call (hours per labor line, tech name).
3. **Which estimate lines were declined.** Estimate detail lines (call not yet mapped; API map night item).
4. **VIN, mileage, the vehicle behind each visit.** `api/Vehicle/listVehicles` (seen in code, shape UNKNOWN); needed
   for maintenance-due timing and household vs vehicle history.
5. **Why a customer walked, and whether a repeat visit was a comeback.** Not in ALG either: the new counter screen has
   to capture a decline reason and a "redo" flag. Also unknown today: time in shop (ALG open-to-close stamps may exist
   on ticket detail).

## 10. Scoreboard: what we can compute today vs what needs line items
Steal from Tekmetric's own KPI set (End of Day and Multi-Shop reports, Tekmetric Shop Index, read 2026-10-30:
support.tekmetric.com/hc/en-us/articles/4421136234775, .../8612596034071, tours.tekmetric.com/answers/tekmetric-shop-index).

| KPI (Tekmetric name) | Today from the mirror | Needs |
|---|---|---|
| Car count | yes (closed tickets per day/month) | nothing |
| ARO (sales) | yes | nothing |
| Close ratio | yes, but only with the any-amount same-phone match, not the strict matcher | fix or replace the matcher |
| Retention / return rate | yes (phone key) | vehicle key for households |
| Parts vs labor mix | history era only | ticket lines for the live era |
| Effective labor rate, gross profit/hr, labor GP %, ARO profit | no | ticket lines with hours and part cost |
| Comeback rate | no | a redo flag at the counter |

The private study compares our car count and ARO with the Tekmetric Shop Index medians; the gap is in ARO, not volume.

## 11. What the one-time history pull adds (for the API map night)
One overnight ticket-detail run over the full history (counter warned) turns sections 5-6 into exact job mixes, gives
the first gross-profit and labor-rate baseline, and confirms or kills rules 2, 7 and 8. The live per-ticket feed stays
a day 13-14 decision.
