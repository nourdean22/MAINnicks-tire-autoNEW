# Shop OS 11: outside review (ChatGPT and Perplexity, 2026-10-27)

Nour, 2026-10-27: "go ask chat gpt in chrome and perplextiy how these plans couild be better imrpved".
Both got the same prompt (a summary of 01-DESIGN, 05-ROADMAP v1, 08-IDEAS, 09; framed on the gallery's
"Devil's Advocate" prompt): steelman, attack the 7 weakest assumptions, argue against building, score 1-10, improve,
add 10 ideas. ChatGPT ran signed out (free model) in Chrome; Perplexity ran Pro (thread 13162431-9589-49ad-b5cf-a8ee8fb544fa).

## Verdict: both scored it 4/10, independently, for the same reasons

| Area | ChatGPT | Perplexity |
|---|---|---|
| Product idea for a walk-in tire shop | 8/10 | 8/10 |
| Proof of where the shop actually loses money | not scored | 3/10 |
| Money lifecycle (payments, refunds, financing, daily close) | 3/10 | 3/10 |
| Data migration confidence | 2/10 | (in feasibility 4/10) |
| Scope discipline | 2/10 | (in feasibility 4/10) |
| Outages, restore, rollback, support | 3/10 | 2/10 |

## Where they agree (the changes we are making)

1. **Wrong first milestone.** Prove one complete money path first: quote -> approval -> work -> invoice -> payment
   recorded -> daily close that balances. Reconciliation moves from P4 to P1.
2. **Measure before building.** Time real counter interactions and log lost customers for a few days; find the real
   bottleneck (it may be the tech's hours or parts delays, not the counter screen).
3. **Run a buy-versus-build bake-off with the crew.** Same real scripts on Shopmonkey and Tekmetric (plus one more):
   anonymous used-tire quote, 4 tires with deposit, brake job with partial approval and a supplement, wrong-part return,
   split payment with financing still unfunded, warranty comeback, export of the records. Perplexity's line: "Buy the
   ledger. Build the differentiating layer."
4. **The ALG move is a feasibility gate, not one night.** Check what ShopDriver's terms allow, ask Dowell for an
   export, keep original IDs and a dated cutoff, check invoice by invoice (monthly totals can hide two swapped tickets).
   Do not block the new system on full history: start new tickets clean, keep ALG as the archive if needed.
5. **Cut or defer:** live-traffic parts ranking, the AI copilot revenue experiment (too few tickets a month to measure
   in 3 weeks), plate-triggered automation, lobby TV, tire wear forecast, a second parts integration, inventory and
   bays beyond a small fast-moving list.
6. **Add:** a payment and funding ledger with a 10-minute daily close; finance-to-cash settlement per program
   ("approved" never means "paid"); deposits, refunds, voids, warranty and comeback paths; core and supplier-credit
   recovery; a restore drill and a paper outage kit; double-submit and two-counter concurrency tests; customer and
   vehicle duplicate cleanup; staff who can run it without the owner.
7. **Compliance is reviewed rules, not checkboxes:** legal review of the estimate and approval flow; tax rate and item
   treatment from the accountant, not a hard-coded 8%; storing a tire TIN is not the same as completing registration.
8. **Better kill switch:** any money, approval or data-loss failure stops the pilot at once; speed misses trigger a
   redesign or the commercial option.

## Acceptance gates they proposed (adopted in 05-ROADMAP)
- Zero unexplained money differences across 7 straight daily closes.
- Every sampled approval resolves to the exact work and price shown to the customer.
- A real backup restore and an export another tool can read.
- Both counter staff and the tech finish common tasks without the owner stepping in.
- Common tire quote at least 20% faster at the median than ShopDriver; repair ticket no slower; tech burden counted.

## Where we disagree, and why
- **"Default to buying the core."** Both lean toward buying. That reverses Nour's approved approach A, so it is not
  ours to decide: the bake-off week gives him the evidence, and the day-10 decision is his.
- **"One hybrid technician."** That was our summary. The real number of people turning wrenches is UNKNOWN in our notes
  (USER.md names Zach as hybrid tech; Mash and Manny run operations). If there are more techs, dispatch matters more.

## Round 2: deep research on plan v2 (2026-10-27, after Nour signed in)

ChatGPT Deep Research ran in the ChatGPT desktop app (driven by computer use; 12 minutes, 23 citations), with Nour's
steer typed mid-run: "less legal more aggressively looking for shit that will make me more money and make my life
easier". Its report: "Profit-First Stress Test of Nick's Tire Plan v2". Perplexity deep research (pplx_alpha) ran in
Chrome, thread 5d6c9dbd-055a-49e1-9c59-400b5bca77bc.

| | ChatGPT | Perplexity |
|---|---|---|
| Score for v2 | 6.5/10 | 7/10 |
| Becomes 8.5-9/10 if | the goal changes to gross profit per constrained tech/bay hour with the owner out of routine decisions; buy-core/build-edge is the default; free-money moves come before code; API access is a real test; gates are about money and owner freedom | buy is the default and build needs a quantified exception; the purchased tier passes a credentialed API/export test; counsel and accountant sign off on sample transactions; staff pass the exception scripts; day 30 is a decision, not a forced cutover |
| One line | "Buy the ledger. Build the brain." | "Buy the transaction system, keep Maverick, and build only the shop-specific layer." |

What changed our plan (folded into 05-ROADMAP v3):
1. **The goal is money per hour, not a better invoice screen.** Scoreboard: gross profit dollars per day, per tech
   hour and per bay hour; lost walk-ins; quote-to-sale; average ticket; parts-blocked minutes; owner interventions.
   ChatGPT's point: the shop's average ticket sits well below the national average (about $704) and median (about
   $650) that Tekmetric published for its shops, so selling more on the same cars may be worth more than any software.
2. **Take the free money before choosing software (days 4-7):** run PartsTech's free plan (unlimited users and
   suppliers, live stock and price, 30+ tire suppliers; Plus is $45/month with good/better/best tire comparison) in its
   own app against today's workflow and time the parts search; price the top 15 jobs (normal labor, minimum parts
   margin, normal total, common add-ons, who may discount); three tire packages (good/better/best) instead of 14
   choices; a simple arrival classification (express / predictable / diagnostic).
3. **The 8 finance programs are a sales funnel, not payment plumbing:** track needed -> offered -> which provider ->
   started -> approved -> accepted -> funded, the dollars, the provider cost and the counter minutes. Likely three
   programs do 90% of the useful work.
4. **First come, first served is the customer promise, not the shop-floor algorithm:** keep arrival order for
   fairness, but run an express lane (tire, flat, battery), a predictable-repair lane and a diagnostic lane, with an
   aging rule so long jobs never starve.
5. **Owner freedom is a measured gate:** fewer than 2 avoidable owner interventions a day and 5 straight closes done
   without the owner, instead of "staff can work without the owner".
6. **API reality (FACT per the reports, primary docs cited there):** Shopmonkey lists "API and Webhooks" on Basic,
   Clever, Genius and Multi-Shop; endpoints include `GET /v3/order`, `GET /v3/order/:id/authorization`,
   `GET /v3/inspection`, `POST /v3/integration/payment/search`, webhook create/read/update. Tekmetric's API access for
   an ordinary Start/Grow shop could NOT be verified (an independent client uses `GET /api/v1/repair-orders` and
   `/api/v1/jobs`); rule: no Tekmetric purchase on "yes, we have an API" without working credentials and our own test.
7. **Test the real tiers:** Shopmonkey Clever ($399/month), Tekmetric Grow ($349) + Tire Suite ($39), Shop-Ware Pro
   ($389) only if there is time. Weighted score: counter speed under interruption 25%, money/refund/deposit correctness
   20%, tech workflow 15%, parts/tire workflow 15%, API + data exit 15%, training and owner dependence 10%; plus hard
   fails that override the score.
8. **"Saturday from hell" scripts:** the 60-second anonymous tire customer; a walk-in while the phone rings and someone
   is paying; four special-order tires with a deposit, then cancel two, refund, change brand; brake job approve front,
   decline rear, find a caliper later; partial cash plus Maverick, then refund; finance approved but not funded;
   wrong part, return, core, credit later; warranty comeback; internet out; end-of-day close done by staff alone.
9. **No long double entry:** the old system stays authoritative until a cutover timestamp; before that, shadow days
   replay real transactions; after it, one system writes. Migrate what must work on day one (open jobs, deposits,
   receivables, unfunded financing, credits owed); keep history retrievable; normalize old lines later or never.
10. **Our app starts as a read-only mirror of the bought core** (customer, vehicle, RO, job, authorization,
    inspection, payment status, declined work); every write-back must earn its place; assume webhooks arrive twice or
    not at all and reconcile against the source.

The cameras, receptionist and website are the edge nobody else has: join phone call -> quoted intent -> plate
arrival -> counter -> RO -> sale -> gross profit, to answer which call types make money, how many cars enter and never
become tickets, and at what queue size customers start leaving. ChatGPT: "You can build a system that understands
Nick's parking lot."

Where we stand: Nour approved approach A on 2026-10-26. All four reviews now recommend the hybrid (buy the core, build
the brain at /system). That is Nour's call on decision day (day 13-14 of roadmap v3); both branches are written out.

## Their new ideas we had not listed (added to 08-IDEAS section "From the outside review")
Quote-to-sale tracking with lost-sale reasons; finance-to-cash settlement queue; core and supplier-credit ledger;
pre-job readiness check before a car takes a bay; vehicle custody and key-tag log; release check before handing keys
back; comeback ledger tied to the original job; technician interruption shield; canned-job margin guardrails; a small
fast-moving parts shelf; demand-vs-capacity staffing test.
