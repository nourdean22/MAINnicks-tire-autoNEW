# Shop OS 15: gaps (what the plan, research and Nour's asks have not covered)

Job 2026-10-30-shop-os-gaps, read 2026-10-30: files 01-11, SHOP-SOUL, truth_os, agent memory, and sibling docs still in
open PRs: 12 local AI (PR 3382), 13 toolkit (PR 3383), 14 mechanisms (PR 3385). A topic marked covered by 12, 13 or 14
reopens here if that PR does not merge. Each row was grepped in this folder and 08-IDEAS first; a gap 08 lists is "listed, not
scheduled". Angles: a his words, b the shop's day, c data, d integrations, e operations, f research never run.

## Top 10 by cost of missing it

| Rank | Row | Cost if missed | Who | Next step |
|---|---|---|---|---|
| 1 | e1 deploys in shop hours | a restart mid-checkout can lose a ticket worth $150-1,000; 7 open days, a deploy on every merge | platform lane | write the deploy window rule before /system code |
| 2 | a5 ALG logouts | each probe kicks the counter mid-ticket during the parallel run, uncounted | server lane | count every ShopDriver login per shop hour |
| 3 | a3 ALG baseline vs bake-off | about 5 crew days on days 8-12 | Nour | one yes/no now |
| 4 | e2 owner-away rules | refunds, voids and overrides wait for Nour or go unchecked | Nour | fill the 6-row table |
| 5 | b5 free checks unrecorded | no finding, no quote, no follow-up from the top of the funnel | Nour | photo of the 27-point sheet |
| 6 | a1 Google ruling | two sessions build against opposite rules | Nour | one ruling |
| 7 | b4 discounts | up to $250 per ticket given without proof, or promised and missed | session | proof field |
| 8 | c1 bays count | every per-bay number is wrong | Nour | 30-second answer |
| 9 | b2 status texts | status calls interrupt the counter; unseen replies lose approvals | session | inbound map |
| 10 | e3 new-hire training | a new counter hire learns on live tickets | session | practice-ticket spec |

## a. Nour's words vs the plan

| # | Gap | Why it matters | Evidence it is missing | Who | Next step |
|---|---|---|---|---|---|
| a1 | Google ruling (shop account owns Drive/Sheets, CEO account views) contradicts 01 s.9 and 09 s.3: no customer data to Sheets | sessions follow one rule and break the other | 01-DESIGN.md:131-133, 09:62-64; `server/sheets-sync.ts` already writes a sheet; doc 13 s.2b covers only the share | Nour | rule: reports to Sheets yes; customer rows yes or no |
| a2 | "dont worry about safeguards" not written in: README fact 5, 06 row 6, 09 s.3 still gate on FTC | sessions build to a retired rule | README.md:37-38, 06:17, 09:53-58 | manager | mark them "good practice, not a gate" |
| a3 | "alg is the protype" vs roadmap v3 default "buy the core" plus a crew bake-off | crew days spent on a choice he may have made | 05-ROADMAP.md:30-47; memory planning-manager ruling 2 | Nour | is the bake-off still on? |
| a4 | "everything interconnext my apps": no plan file names StateNour or the existing bridge | owner dashboards built twice | grep `statenour|bdnick|NOUR OS`: 0 files; `server/_core/statenour-bridge-routes.ts`; SHOP-SOUL s.9 | session (doc 16) | map which /system events cross the bridge |
| a5 | "alg scrape ... every day": it runs (3 AM, 8 PM, admin loads at most 1 per 30 min, chat) and each probe logs the counter out; plan counts only per-ticket pulls | logouts mid-ticket in the parallel run | truth_os.md:133-137, `algProbeBudget.ts:15-16`; plan 01:38-40, 04:58; the Settings buttons `shopdriver.syncInvoices` / `syncCustomers` write no log row (`server/routers/shopdriver.ts:660-669, 797-801`) | server lane | log every ShopDriver login (probe rows plus both Settings buttons), then count per shop hour |
| a6 | "how many ompleyees ... edit": doc 13 decides Settings; 10's screen list has no route | decided, never scheduled | 10-UI-BUILD.md:24-32 | session | add /system/settings |

## b. The shop's day

| # | Gap | Why it matters | Evidence it is missing | Who | Next step |
|---|---|---|---|---|---|
| b1 | Opening routine: sign-in, cars left overnight, open ROs, parts due, drawer start | only the close exists (08 #28) | grep `opening|morning`: 0 relevant | session | 5-line opening card in 01 s.5 |
| b2 | Status texts (approved, started, ready) and where replies land | status calls interrupt; unseen replies lose approvals | 08 #16 only; grep `inbound|reply`: 0 relevant | session | map inbound texts to the ticket |
| b3 | Tire fast lane: quote at the car window, ~20 min; plan's quote is a keyboard screen | the common sale happens on a phone outside | SHOP-SOUL.md:82-86, q5; 10-UI-BUILD.md:26 | Nour, session | time a phone window quote |
| b4 | Site discount programs (each needs proof), 20% off labor up to $250: no counter line | discount without proof, or missed | `shared/business.ts:293-370`, PR 3352; grep `teacher|nurse`: 0 | session | discount line with proof field |
| b5 | Free checks (brake, battery, E-Check, alignment pull, 27-point): no template | no record, no finding to quote | SHOP-SOUL.md:68-71; grep `27-point|E-Check`: 0 | Nour, session | photo the paper sheet |
| b6 | First-snow tire rush: board, stock, staffing | busiest money days | grep `season|winter|snow`: 0 | manager (f2) | run f2, add to 05 |
| b7 | Paid online tire order has no handoff into an RO | double charge or lost order | 01-DESIGN.md:28 asset only; memory shop-data-meanings rule 1 | session | one flow line in 01 s.4 |

## c. Data

| # | Gap | Why it matters | Evidence it is missing | Who | Next step |
|---|---|---|---|---|---|
| c1 | Bays: site says "two lifts, two flat bays" and "4 lifts"; 06 asks techs, not bays | per-bay metrics divide by it | SHOP-SOUL.md:297; 06:11 | Nour | add to 06 row 0b |
| c2 | Tech pay (hourly, flat rate, commission), 7-day crew schedule, payroll export | clocks nobody's pay reads get ignored | grep `payroll|commission|shift`: 0 | Nour (f3) | how is each person paid |
| c3 | Charge customers and fleets: statements, terms | uncollected balances | 05:55 "receivables" once; grep `fleet`: 0 | Nour | add to 06 |
| c4 | Code the plan never names for reuse: `server/storage.ts` (photo store), `services/vinDecode.ts`, `sheets-sync.ts`, the bridge | rebuilt, or a second store | 10 s.3 names none; 02 R15 treats VIN decode as research | session | add to 10 s.3 |
| c5 | Customer and vehicle dedupe | split history and texts | 11-REVIEW.md:37-38; grep `dedupe|merge` in 05: 0 | session | listed, not scheduled: day in 05 15-20 |

## d. Integrations

Covered in open sibling PRs (reopen here if one does not merge): local AI and laptops (12, PR 3382); Maverick, Koalafi,
QuickBooks, Routes, Drive share (13, PR 3383); ALG screens (14, PR 3385); MCP (16, not started yet).

| # | Gap | Why it matters | Evidence it is missing | Who | Next step |
|---|---|---|---|---|---|
| d1 | CARFAX free plate-to-VIN for publishing service records: no decision row | paid lookup ~$40/mo + $0.09; sharing history is a privacy call | 02-RESEARCH.md:36-38; grep `CARFAX` in 06: 0 | Nour | add to 06 |
| d2 | Tire registration path not chosen: an independent dealer may hand the buyer a paper card at sale, or submit the TIN itself within 30 days (paper or electronic) | a new tire sold with neither is a federal record failure | 49 CFR 574.8(a)(1) (ecfr.gov); 07 s.4 names only the dealer-submits path; `tire_registrations` 0 rows | Nour, then manager (f4) | pick paper card or dealer-submit; only dealer-submit needs a provider |
| d3 | Printing from /system on the counter PC | 07 needs printed forms | grep `print` in 10: 0 | client lane | add a print view |
| d4 | Caller-ID screen pop | know the caller first | 08 #14; test never booked | Nour (10 min) | listed, not scheduled |

## e. Operations

| # | Gap | Why it matters | Evidence it is missing | Who | Next step |
|---|---|---|---|---|---|
| e1 | No deploy window: the shop is open 7 days and a merge redeploys mid-day | lost draft or payment record | grep `deploy|freeze`: 0; root AGENTS.md "CI cost": a merge redeploys both services | platform lane | /system merges outside open hours |
| e2 | Owner-away matrix: refunds, voids, price overrides, discounts, supplier orders, comeback write-offs | waits for Nour or goes unchecked | 09:47-48 covers checkout only; SHOP-SOUL s.7 "clear lines" | Nour | 6-row table |
| e3 | New-hire training: no practice tickets | learning on live money | 05 weights training 10% only; grep `practice`: 0 | session | practice-ticket flag |
| e4 | Saturday support: who fixes /system mid-day | 11 scored support 2-3/10 | no runbook or owner in 05, 09 | Nour, manager | one-page runbook |
| e5 | One front-desk PC carries counter, office ears and lot counting; it crashed once | one box down stops all three | memory office-lane-shop-pc, lot-vision-v2; doc 12 s.1 | Nour | measure load with all three |

## f. Research never run (manager runs these; this lane does not)

| # | Exact query | Decision it changes |
|---|---|---|
| f1 | "ShopDriver Elite Dowell Systems terms of service data export automated access customer data ownership" | whether the full history pull is allowed (a5, 04 s.3) |
| f2 | "Cleveland Ohio first snowfall tire shop demand spike weeks winter tire sales Google Trends" | b6 surge stock and staffing |
| f3 | "independent tire and auto shop technician pay plan flat rate vs hourly vs commission 3 to 5 techs survey" | c2 which clock data matters |
| f4 | "electronic tire registration service independent dealer cost 49 CFR 574.8 TIN registration provider" | d2 cost of dealer-submit vs paper card |
| f5 | "auto repair shop share of inbound calls that are vehicle status checks" | b2 value |

## Things Nour mentioned that nobody wrote down (verbatim; addresses replaced by role words)

| Quote | Where it stands |
|---|---|
| "buld my own crm ... i want everything interconnext my apps, comps, websites, everything" | a4 |
| "things like how many ompleyees n all that i should be able to edit and do whatever i want with whenever i want" | doc 13 Settings row; a6 |
| "the alg scrape should be happening every day now? we shouldnt have a pronlem getting all the data form alg" | a5, f1 |
| "alg is kind of like the protype set up i want because its fast n simple but smart too" | doc 14; a3 |
| "dont worry about safeguards i check with laywrrs already ... be fully aggressive in incorperating our stuff" | a2 |
| "use google drive n google sheets n everything google connected to [shop account] but i also want my ceo email [CEO account] too see" | doc 13 s.2b; a1 |
| "download a offline ai from huggingface ... interconnect nattynour ... and nicksmax" | doc 12 |
| "i was going to send some screenshots of alg and tell u to reverse enginner them" | doc 14 |
| "even incorperating claud n chat into it with mcps", "make sure all controls options edits, are available for me from inside the crm", "a customer profile searcher ... instagrams facebooks ... public info" | doc 16 (paused) |
| "examin all the invoices in alg every single one ... and estimates" | doc 17 (paused) |
| "keep all sessions up to date with each other" | manager process (memory feedback-sessions-share-findings) |

Quotes still uncovered after docs 16 and 17: a1-a6. Everything above is a plan gap, not code; nothing here is built.
