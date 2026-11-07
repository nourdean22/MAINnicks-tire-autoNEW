# 35 - Supplier gap gate: four outside reports checked against the code

Date 2026-11-07. Docs only; no code changed. SHOP DATA: none read. No portal logins, no supplier orders.

Every claim below came from outside AI output, so each was treated as a lead until a file or a primary page said so.

| Label | Source |
|---|---|
| R1 | ChatGPT "Nick's Tire Supplier Intelligence Audit" (2026-11-07) |
| R2 | "Nick's Tire Supplier Intelligence Report" (2026-11-07) |
| R3 | "Compare Suppliers Gap Review" (2026-11-07) |
| R4 | ChatGPT follow-up "10 gaps" (pasted, 2026-11-07); source of the "Sellable Tire Offer" object |
| gate | found while checking; no report claimed it |

Code under test: the supplier compare v2 branch (PR 3571, draft, parked for the CRM build) and `main` at 68c057f186.
Paths are under `apps/nickstire/`. "PR" in a receipt means the PR 3571 branch; every other path is `main`.

Dedupe: an earlier Perplexity pass (manager notes, `supplier-compare-v2-perplexity-review-2026-11-07.md`) already
lists: second supplier, out-the-door price + margin floor, own shelf stock, add-to-estimate, saved quotes, retail-only
view, LT/load/speed/fitment, stale price label, arrival-first ranking. Rows that repeat it say "baseline" and are
not argued again.

Verdicts: **built** (the code or a primary page already settles it); **new** (real gap, confirmed by the receipt,
not built); **refuted** (the code contradicts it); **claim** (not verified here; stays a lead).

## 1. Claim table

### 1a. Claims about our code

| # | Src | Claim | Verdict | Receipt |
|---|---|---|---|---|
| 1 | R2 R3 R4 | Arrival is invented: every D&K local hit is "here in 30-60 min", any day, any hour; no cutoff, no weekend | new | PR `shared/sourcing.ts:80` runMinutes 30-60, `:197` span(now); PR `server/services/sourcingGateway.ts:59` local = shelf, at and orderBy UNKNOWN |
| 2 | R2 R3 | The cutoff is already readable; the ordering code calls it | built (unwired) | `server/services/gatewaySupplierOrder.ts:209-210` readCutoff -> `/master/get-cut-off-time`; used at `server/routers/gatewayOrder.ts:207` |
| 3 | R2 R3 R4 | "Fits" means only the size string matched; load index, speed rating and P/LT ignored | new (sharpens baseline) | PR `sourcingGateway.ts:76` "confirmed" on `size === wanted`; PR `sourcing.ts:117-119` regex drops P and load/speed |
| 4 | R2 R3 | Load and speed can be parsed from D&K today | built (other path) | `server/routers/gatewayTire.ts:364-365` reads `invent_lrsr` ("95H") for the public finder |
| 5 | R2 R3 | No LT, C, ST or staggered (front/rear) search | new (baseline) | PR `sourcing.ts:115` LT refused; the panel has one size input |
| 6 | R1 R2 R3 R4 | Dealer cost leaks to front desk and techs through the older tire search | new | `shared/adminPermissions.ts:224` gatewaytire.* -> workorders.manage; `gatewayTire.ts:1488` searchBySize returns costPrice `:1524` and marginPercent `:1528`; calculateMargin `:1547` takes and returns cost |
| 7 | R2 R3 R4 | "Hide cost" is cosmetic; the server still sends cost | new (baseline) | PR `client/src/components/admin/SupplierComparePanel.tsx:13,52,130-138` localStorage toggle; compareTires still returns unitPrice |
| 8 | gate | When the role read fails, a read runs as if owner (reads fail open, writes fail closed) | new | `server/_core/trpc.ts` ~223-250: effective = security ?? MFA_NOT_REQUIRED_STATE, logged at error |
| 9 | R4 | Server permission on the new route is unverified | built | PR `shared/adminPermissions.ts:123` sourcing.* -> money.manage (owner/manager) |
| 10 | R1 | Wholesale cost can silently be the retail number | new | `server/services/gatewayClient.ts:242-249` Math.min of selling_price and cost_price; `gatewayClient.test.ts:30` pins `{cost_price: 941.5}` -> 941.5; callers `gatewayOrder.ts:118`, `gatewayTire.ts:335,344,599,1506`, `tireQuote.ts:165`, `dataPipelines.ts:67`, `tirePriceRanges.ts` |
| 11 | gate | Doc 32 phase 0 already owns half of row 10 (return UNKNOWN, not 0, when unpriced) | built (planned) | `32-CONCRETE-PLAN.md` phase 0 row; the retail-fallback half is not in it |
| 12 | R4 | The v2 adapter repeats row 10 | built (avoided) | PR `sourcingGateway.ts:24-25` takes a price only when selling_price > 0 |
| 13 | R1 R2 | The older search over-counts regional stock | new | `gatewayTire.ts:1517` totalQty = item.total_qty -> `:1530` regionalInventory |
| 14 | R2 R3 | A missing FET makes the offer unpriceable | built (by design) | PR `sourcing.ts:129` no FET -> UNKNOWN; fixtures carry `fet: 0`, so passenger tires still price (INFERRED: low risk) |
| 15 | R2 R3 | tire_tax and rebate_* are ignored | new | PR `sourcingGateway.ts:73` reads only pricing.fet; doc 30 lines 158-159 list both; fixtures show tire_tax 1.0 (INFERRED: the Ohio fee) |
| 16 | R2 R3 | est_delivery_days per regional warehouse is thrown away | new | PR `sourcingGateway.ts:8` comment and `away()` set arrival UNKNOWN; doc 30 lines 32, 150-152 show 3-4 days per site |
| 17 | R2 | One size returns 288 rows, 180 at zero stock | claim | doc 30 capture not re-read; PR `sourcingGateway.ts:32` drops zero-qty away rows; local zero rows: not checked |
| 18 | R1 R2 | "Priority Scheduling" for online orders contradicts first come, first served | new (wider than claimed) | `gatewayTire.ts:97` vs `shared/business.ts:184,188`; same idea in Fleet.tsx:21,97,145, routes.ts:1141, blog.ts:3924-3932, winback.ts:223, LocalBusinessSchema.tsx:249 |
| 19 | R2 R3 | The 15-minute stale rule measures how fresh D&K's data is | refuted | lastVerifiedAt is our request time (PR); `/quicksearch/cache` is a real endpoint name (`gatewayClient.ts:226`), but D&K-side caching is only INFERRED |
| 20 | R2 R3 R4 | Stale or orderable-UNKNOWN offers can still win Best price | built (by design; label is baseline) | doc 26 ranking rule; only Quickest drops them |
| 21 | R2 R3 | Markup is cost x 2 in code, 30% default in ALG, +100% in the portal | claim | `gatewayTire.ts:5,65,354` "100% markup" text with configurable getTireMarkup; doc 21 s6.7 and doc 22 s5 not re-read |
| 22 | R2 R3 | A size price floor helper already exists | built | `server/lib/tirePriceRanges.ts:128` computeSizePriceFloors |
| 23 | R3 | A "Text me this quote" path exists | built | client tire-finder-v2 test lines 373-377 (PR 3157) |
| 24 | R2 R3 | "Did not answer", "no tires" and "size not accepted" are three messages | built (baseline) | PR panel lines 186-197 |
| 25 | R1 R2 R3 R4 | No lookup history and no outcome (sold, lost and why) | new (baseline-adjacent) | no log on the sourcing route; doc 26 DeclineReason not built |

### 1b. Claims about rules and other products

| # | Src | Claim | Verdict | Receipt |
|---|---|---|---|---|
| 26 | R2 R3 | TIA: never fit a lower load index than the original tire | built (fact) | tireindustry.org tire-replacement page, read 2026-11-07 |
| 27 | R2 | Ohio levies 50 cents per tire on sale | built (fact); "$1 total" is a claim | ORC 3734.901(A)(1), read 2026-11-07; the second 50 cents not read |
| 28 | R2 | FET is $0 for tires under 3,500 lb load (IRS Pub 510) | claim | the Pub 510 read returned no rate line |
| 29 | R2 | DOT tire registration (49 CFR 574.8) duties apply to the shop | claim | only the section heading came back |
| 30 | R1 R2 R3 | PartsTech carries D&K and Capital free, ATD paid | built (fact) | PartsTech supplier-list help article, read 2026-11-07; Hesselbein and Gateway sit under D&K |
| 31 | R2 R3 | PartsTech costs $0-45 a month | claim | pricing page not read |
| 32 | gate | PartsTech's API terms ask for exclusivity in the app that embeds it | built (fact) | partstech.com/api-agreement-terms, read 2026-11-07: exclusive catalog and ordering provider for "Your Application"; waiver path; fee set in the order form |
| 33 | R1 | Tekmetric Quick Quote and Smart Tire Job, TCS estimator, TireConnect fields, ATD six arrival tiers | claim | product pages not re-read; the ATD tiers match doc 23 (Nour's own audit) |
| 34 | R3 | Tekmetric shows customers retail only and shows shelf stock before vendors | claim | support article not re-read |
| 35 | R2 | D&K's terms treat its pricing as confidential | claim | b2b-admin.dktire.com terms not read |

### 1c. Proposals

| # | Src | Proposal | Verdict | Receipt |
|---|---|---|---|---|
| 36 | R1 R2 R3 R4 | Out-the-door price from one rule | new (baseline) | doc 26 SellPriceRule defined, not built |
| 37 | R2 R3 R4 | Good / better / best instead of the cheapest tire | new | doc 26 Quote options, not built |
| 38 | R2 R3 | Copy the pick as an ALG line | new | PR maps the ALG line fields; no button |
| 39 | R2 R3 R4 | Our own rack (new and used) beside supplier stock | new (baseline) | no own-stock source in sourcing |
| 40 | R1 R3 R4 | A second supplier (ATD, Capital) | new (baseline) | only the "not connected" footnote |
| 41 | R2 | Weekend banner and a promise line ("here by X if ordered by Y") | new | rides on rows 1-2 |
| 42 | R2 R4 | Freeze the quote; Ohio written-estimate election | new | doc 32 phase 0 owns the 10% re-approval gate; the freeze is not designed |
| 43 | R4 | State chain observed > rechecked > selected > ordered > received > installed | new | no such field; Quote status covers open to closed only |
| 44 | R2 | Supplier scorecard and arrival reliability | new (later) | needs the row 25 log first |
| 45 | R2 | The receptionist quotes tires from this data | new (later) | needs rows 1 and 36 first |

## 2. Counts

45 rows, each counted once by its verdict:

| Verdict | Rows | Share |
|---|---|---|
| built | 14 (2, 4, 9, 11, 12, 14, 20, 22, 23, 24, 26, 27, 30, 32) | 31% |
| new | 22 (1, 3, 5, 6, 7, 8, 10, 13, 15, 16, 18, 25, 36-45) | 49% |
| refuted | 1 (19) | 2% |
| claim | 8 (17, 21, 28, 29, 31, 33, 34, 35) | 18% |

Of the 22 new rows, 7 overlap the Perplexity baseline (3, 5, 7, 25, 36, 39, 40); 15 are new to this gate.

## 3. Ranked gaps for the next PR 3571 round

P0 means it can cost money or a customer's trust on the first day staff use the panel.

### P0 - safety and money

1. **Truthful arrival** (rows 1, 2). Wire `readCutoff` into the adapter, add the shop calendar (Sunday, holidays),
   and show "order by X for the Y run" or "arrival not stated". Drop the made-up now+30-60 window.
2. **Spec gate** (rows 3, 4, 26). Parse load and speed from `invent_lrsr` (prior art `gatewayTire.ts:364`), keep
   P/LT/C in the normalizer, rename "confirmed" to "size match", and warn (not block) when load or speed is below
   spec or unknown.
3. **Cost leak** (rows 6, 8). Pin `gatewaytire.searchbysize` and `gatewaytire.calculatemargin` to money.view and
   money.manage, as `refundorder` already is; make `sourcing.*` reads fail closed when the role read throws.
4. **Retail read as dealer cost** (rows 10, 11). `pickWholesaleCost` returns UNKNOWN when selling_price is missing
   instead of falling back to cost_price; change the test that pins it. Fold into doc 32 phase 0, same line.
5. **Wrong promises on the site** (row 18). "Priority Scheduling" and "front of the line" fleet copy contradict first
   come, first served. Copy-only change, but customer-facing, so Nour signs off the words.

### P1 - accuracy and speed at the counter

6. Per-warehouse quantity in the older search, not total_qty (row 13).
7. Read `est_delivery_days` per regional site (row 16) and `tire_tax` as its own fee line (row 15).
8. Mark stale and orderable-UNKNOWN Best price picks "check before quoting" (row 20, baseline).
9. A server-built customer view with no cost fields (row 7), so "Hide cost" stops being cosmetic.
10. Out-the-door price from SellPriceRule plus `computeSizePriceFloors` (rows 22, 36); then good / better / best
    (row 37), "Copy for ALG" (row 38) and a lookup + outcome log (row 25).

### P2 - after P0 and P1 are live

11. Second supplier: a two-week PartsTech trial on its own screen (row 30); read the exclusivity term (row 32)
    before any embed.
12. Our own rack stock (row 39).
13. Scorecard and arrival learning once the log has data (row 44).
14. Weekend banner and promise line, on top of item 1 (row 41).

Top 3 new to this gate (not in the baseline): truthful arrival using the cutoff read we already have; the cost
leak through the older tire search plus fail-open role reads; retail read as dealer cost in `pickWholesaleCost`.

## 4. Do not build (every report that spoke to it agrees)

1. Automatic purchasing, or any order the panel places on its own (R1; doc 32 keeps the PO a draft).
2. Scraping, RPA or reading portal pages (R1, R3; doc 32 rules it out).
3. A learned supplier model or ML ranking before a lookup log exists (R1, R2).
4. "Same day guaranteed" banners or any promise the supplier did not state (R1; rows 1 and 41 here).
5. Profit-per-bay-minute scoring (R1, R2). R1 also rejects a second invoice system beside ALG, dashboards before
   reconciliation, auto-refresh to look live, calling every API at once and a client-only cost toggle as the
   customer view; R2 also rejects "Saleability Score", "Smart Basket" and "Time-to-Installed".
No report argued for any of these.

## 5. The "Sellable Tire Offer" object (R4): adapt, do not add

Verdict: **adapt**. No fourth object; R4's fields already have homes.

| R4 field | Home |
|---|---|
| supplier, part, qty, cost, location, arrival | PR `shared/sourcing.ts` SupplierOffer and Candidate |
| retail and out-the-door price | doc 26 SellPriceRule applied to the Candidate |
| options and the pick | doc 26 Quote options good / better / best |
| fees, labor, vehicle, convert to ticket | doc 26 Quote |
| lost-sale reason | doc 26 DeclineReason |

What is missing goes onto the existing objects:

1. `fitStatus` on Candidate: `size_match | spec_ok | below_spec | spec_unknown` (gap 2).
2. `promiseValidUntil` on a Quote option: the cutoff or stale time after which arrival must be re-checked (gap 1).
3. `offerSnapshot` on a Quote option: the Candidate as quoted (supplier, part number, cost, arrival, checked at),
   so a quote does not move when stock does.
4. `nextAction` on Quote: re-check, text, order draft or convert. R4's longer state chain (row 43) waits; Quote
   status stays `open -> contacted -> converted | closed`.

Why not a new object: a second offer type beside SupplierOffer splits ranking and pricing into two places, the same
drift the admin registry and doc 26 were written to stop.

## 6. Not verified here

1. IRS Pub 510 FET rate and the 3,500 lb line (row 28).
2. 49 CFR 574.8 text on who registers tires (row 29).
3. PartsTech's monthly price (row 31) and D&K's own terms on pricing and automated use (row 35).
4. Ohio's second 50 cents (row 27); doc 21 s6.7 and doc 22 s5 (row 21), not re-read in this pass.
5. Other products' feature claims (rows 33, 34); product pages not re-read.

Kill criterion: if the next PR 3571 round ships P0 items 1-4 and a re-gate finds any still open, this ranking
misjudged effort and is redone. Re-gate on 2026-11-21 or the first CRM build day, whichever comes first.
