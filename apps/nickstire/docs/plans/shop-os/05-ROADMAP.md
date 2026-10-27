# Shop OS 05: roadmap v3 (profit first)

Job 2026-10-26-shop-os. v3, 2026-10-27, after the deep research round (11-REVIEW round 2: ChatGPT 6.5/10, Perplexity
7/10 on v2) and Nour's steer: "less legal more aggressively looking for shit that will make me more money and make my
life easier". The goal is no longer "replace ShopDriver correctly". It is: **more gross profit per tech and bay hour,
with the owner out of routine decisions.** Software is a tool for that. Nour approved approach A on 2026-10-26; v3 keeps
both branches open until decision day.

Scoreboard from day 1 (a spreadsheet is fine): gross profit dollars per day, per tech hour and per bay hour; lost
walk-ins and why; quote-to-sale; average ticket; parts-blocked minutes; owner interventions per day.

## Days 1-3: find the money leaks (no code)
For every arriving car: arrival time, job type, waited or left, why. For every closed ticket: parts cost and sale,
labor sale, tire sale, discount, book hours vs actual tech time, comeback? For every tech interruption: blocked by what,
minutes. For every owner touch: why he was needed, minutes. Parts: vendor, ordered, promised, received, right the first
time, return or core. Financing: needed, offered, provider, approved $, funded $, counter minutes.
Output by end of day 3: the top three things costing real dollars. Owner: name a counter lead to run the sheet.

## Days 4-7: take the free money (before choosing any software)
| Move | Cost | Measure |
|---|---|---|
| Run PartsTech's free plan in its own app against today's parts searches (upgrade to Plus, $45/month, only if good/better/best tires help) | $0-45/month | median parts-search minutes before vs after |
| Price the top 15 jobs: normal labor, minimum parts margin, normal total, common add-ons, who may discount | time | margin per job family, discount dollars |
| Three tire packages (good / better / best) instead of a wall of choices | time | tire quote-to-sale, tire margin |
| Standard paid diagnostic policy (what it costs, when it is credited to the repair) | time | diagnostic dollars, diag -> repair conversion |
| Arrival classes: express (tire, flat, battery) / predictable repair / diagnostic, with an aging rule | time | waiter turnaround, walkaways |
| Finance funnel log: offered -> started -> approved -> funded, per provider | time | which 3 programs do the real work |
| Owner-intervention log | time | interventions per day |

## Days 8-12: vendor bake-off on real tiers, run by the crew
- Shopmonkey Clever, Tekmetric Grow + Tire Suite; Shop-Ware Pro only if there is time; AutoLeap only if it earns it.
- Same data, same configuration, the crew runs it, salespeople only watch. "Saturday from hell" scripts (11-REVIEW
  round 2 item 8) plus our own app's quote flow for comparison.
- Weighted score: counter speed under interruption 25%, money/refund/deposit correctness 20%, tech workflow 15%,
  parts/tire workflow 15%, API + data exit 15%, training and owner dependence 10%.
- Hard fails override the score: slow walk-in quote; ambiguous payment/refund/deposit records; API access not
  demonstrated with real credentials on our account; no usable export; tech falls back to paper or texts; a workflow
  that fights how the shop runs.
- API test for each finalist on our own account: RO created/updated event; read RO, jobs, part and labor lines,
  authorization history, inspection findings and photos, payment records and manual references, customer and vehicle;
  detect posted/refunded/deleted; incremental sync; export enough that our app survives leaving the vendor. Anything
  not demonstrated scores zero.

## Days 13-14: decision (Nour)
- Default (all four reviews): **buy the core, build the brain.** The bought system is the ledger (customer, vehicle,
  RO, jobs, authorization, inspection, invoice, payment record). nickstire.org/system is the operating brain on top.
- Build our own core only with positive proof that the finalists cannot handle the shop and that the gap costs real
  money. If so, that becomes its own scoped project; ShopDriver stays live meanwhile.
- Month-to-month where offered (Tekmetric and Shop-Ware advertise it).

## Days 15-20: configure, don't invent (buy branch)
Customers and vehicles, top 15 canned jobs with the prices from days 4-7, labor rates, tax (accountant), user
permissions, tech workflow, tire flow, payment types incl. Maverick references and refunds, declined work,
authorization flow, parts ordering, returns and cores. Migrate what must work on day one (open jobs, deposits,
receivables, unfunded financing, credits owed); keep ShopDriver for history. Our app becomes a **read-only mirror** of
the bought core first; no write-backs until the mirror stays correct.

## Days 21-24: try to break it
Replay 20 ugly old transactions; two simulated closes; double-submit, two people on one RO, approval of an old estimate
after a price change, payment entered twice, refund after close, deposit moved, finance approved not funded, wrong part
and return, core outstanding, printer down, tech phone dead, webhook late, twice or never, API errors.

## Days 25-30: controlled production, then cut over only if the business is better
Gates: every money difference explainable over 7 closes; common walk-in transactions no slower after the learning
period (target 20% faster quoting); fewer than 2 avoidable owner interventions a day; no unofficial paper or text
workflow; parts sourcing time down or first-choice availability up; quote-to-sale and average ticket not worse;
outage drill passed; export opened and checked outside the vendor; our app receives enough data to rebuild the owner
dashboard. Then build nothing major for two weeks; let it settle.

## After that: build the brain at nickstire.org/system (our edge)
In order, each with its own money proof (details in 08-IDEAS):
1. Express-lane board and the tech-to-counter blocker button (NEED PART / NEED APPROVAL / NEED INFO / READY QC).
2. Gross-profit-per-hour dashboard by job family, tech and bay.
3. Finance funnel and provider router.
4. Parts return, core and credit control tower; supplier score on realized cost (wrong parts, lateness, returns).
5. Tiny demand-driven tire stock: which 10-20 sizes or price points would have converted the most lost same-day
   business in the last 90 days (website searches, orders, calls, plates, declined quotes).
6. Revenue attribution from the lot cameras and receptionist: call -> quoted intent -> plate arrival -> counter -> RO ->
   sale -> gross profit; unserved arrivals; queue size where customers start leaving.
7. Comeback P&L and vendor recovery; vehicle release check; demand-based staffing from camera and phone data.
8. AI pointers last, rules first, judged on correctness and use before any revenue claim.

## If the decision is "build our own core"
Use roadmap v2's money-path order (quote -> approval -> invoice -> payment record -> daily close first), the same gates,
and a separate schedule; ShopDriver stays live until every gate passes. The /system mockup and 01-DESIGN still apply.

## Kill switches
| If | Then |
|---|---|
| Any money, approval or data-loss failure in the pilot | stop at once, fix, re-run the gate |
| A finalist cannot show API access with real credentials | it cannot be the base for our layer |
| Our quote screen loses to the finalists in the crew's timed tests | do not build that screen; use theirs |
| ALG data cannot be extracted cleanly or within its terms | start new tickets clean; ALG stays the archive |

## Lanes (monorepo-manager)
lane-research (bake-off scripts, API tests, vendor docs), lane-nickstire-server (read-only mirror, money and funnel
logs), lane-nickstire-client (/system brain screens). At most 2 writer lanes at once on this machine.
