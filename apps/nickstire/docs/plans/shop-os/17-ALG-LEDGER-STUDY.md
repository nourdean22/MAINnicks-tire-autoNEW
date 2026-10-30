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
5. The mirror lost detail in 2026-05: no parts/labor split, almost no job descriptions since then. Line items, hours,
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
- Estimate fields that look like data but are not: VIN empty on every row, labor rate one default value, category,
  parts/labor and stated concern empty (FACT). Payment status and method on counter tickets mean nothing (shop data
  rule 3).
- Customer key = last ten phone digits (no duplicate phone keys in the customer table, FACT); a few tickets have no
  phone. Commercial flag is never set; fleets are invisible except by visit frequency.

## 3. How: the ticket flow
- Most cars go straight to a ticket with no estimate on record; only a small share of tickets has an estimate from
  the same phone in the month before (FACT). So "estimate -> invoice" is the exception path, used for big or
  deferrable work.
- When an estimate converts, it is decided at the counter: same day most of the time, next day often, later rarely
  (FACT, lag buckets). Converted late (one to six months) is a small tail (FACT).
- Partial approval is normal: on converted estimates the billed amount is usually a bit under the quote and well under
  it for a large minority (FACT, billed-to-quoted ratio). The production matcher demands the bill within ten percent of
  the quote, so it misses partial approvals and roughly halves the visible conversion rate (FACT: strict vs any-amount
  same-phone match). The "two of three estimates walk" figure in 04-DATA-MAP s.1 is the strict matcher's number.
- The counter has never recorded a decline (declined_work_captures empty, FACT). Every "walked" in this doc is the
  inference from no matching ticket.

## 4. Why: job families, declines, comebacks
- Ticket families by description (FACT, keyword classifier over described tickets): suspension/steering first, then
  brakes, then tires, then fluids/tune-ups, engine/diagnostic, electrical and cooling. Exhaust and driveline are rare but
  among the largest tickets; oil changes and alignments are the smallest.
- Estimates that most often do NOT convert: cooling, brakes and exhaust (FACT, small samples). INFERENCE: these are the
  jobs customers price-shop or do themselves; suspension, electrical and engine estimates convert about as often as
  average.
- Smaller estimates convert more often than four-figure ones (FACT, by band).
- Comebacks are UNKNOWN: a second ticket within a week happens for a visible minority of repeat customers, but nothing
  says whether it was a redo, a split job or new work.

## 5. What: services, tires vs repair, ticket size, parts vs labor
- Ticket size bands (FACT): the few-hundred band and the high-hundreds band are each a bit over a quarter of tickets;
  the high-hundreds band alone is the biggest slice of dollars. Small tickets (oil-change size) are about a tenth of
  tickets and almost none of the dollars. Four-figure tickets are rare and carry about a quarter of revenue.
- Tires are a minority of described tickets and of dollars (FACT); "REPLACE TIRE" is the second most common description.
- Parts vs labor (history era only, FACT): parts a bit over half, labor a bit under half of parts+labor, and the labor
  share rose every year (2024 -> 2025 -> early 2026). Labor-only and parts-only tickets each exist in numbers; small
  fees are not split out.
- Average ticket is flat across years and the same for new and returning customers (FACT). Growth came from car count:
  Jan-Oct 2026 is clearly ahead of Jan-Oct 2025 in tickets and in dollars, with a soft September 2026 (FACT).
- Vehicles (free text, FACT): Ford and Chevrolet lead, then Nissan, Honda, Jeep, Kia, Toyota, Hyundai; about half
  domestic; two thirds built 2010-2019; few newer than 2020.

## 6. Who: customers
- About three in four customers came once in the window (FACT). Repeat customers are about a quarter of customers and
  over two fifths of revenue (FACT). Median gap to the second visit is a few months (FACT).
- One-year return rate by first-visit quarter rose from the 2024 level to clearly higher for 2025 H2 cohorts (FACT;
  2024 cohorts are left-censored, older regulars look new).
- Tire-first customers seldom return for service; service-first customers almost never buy tires later (FACT).
- No whale: the top customers are a small share of revenue; a handful of fleet-like keys (frequent, all year) exist
  (FACT). Contact data: phone on nearly all customers, email on almost none (FACT).
- Lapsed pool: more than half of customers last came over a year ago, most of them one to two years ago (FACT).

## 7. When
- Busiest days by tickets per open day: Saturday, then Thursday; Sunday is light and many Sundays have no closed
  ticket (FACT, close dates in ET). Monday has the largest average ticket (FACT).
- Close times (live era only, FACT): flat from mid-morning, peak mid-afternoon, a small evening batch.
- Season (FACT, under three years): spring (March-April) and August are strongest; November-December weakest by count;
  October has the largest average ticket.
- The mirror's own probes log the counter out about twice per shop day, Sundays most (FACT, alg_probe_log last 30
  days; ties to 15-GAPS a5).
