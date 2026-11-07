# Shop OS 26: vendor schematics rollup - what the build must implement from audits 21-29

Job 2026-11-06-shop-os-vendor-schematics. Status: CURRENT (update after every new vendor audit). This file turns
the five screen-by-screen audits into the fields, objects and screens the CRM build needs, so a build session
does not have to re-read 1,500 lines of audit notes. Sources: [21 ALG](21-ALG-UX-AUDIT.md), [22 Gateway/D&K](22-GATEWAY-DK-UX-AUDIT.md),
[23 ATD](23-ATD-UX-AUDIT.md), [24 Capital Tire](24-CAPITAL-TIRE-UX-AUDIT.md), [25 Federated/Fisher](25-FEDERATED-UX-AUDIT.md);
mechanisms are numbered in [14-STOLEN-MECHANISMS](14-STOLEN-MECHANISMS.md); the supplier-offer contract this
extends is in [18-SUPPLIER-DESKTOP-OFFLINE-AI](18-SUPPLIER-DESKTOP-OFFLINE-AI.md) ("A normalized offer with
supplier and branch IDs ..."). Nothing here replaces 18; it adds the fields the audits proved are needed.

## 1. Cross-vendor matrix (OBSERVED unless marked)

| Capability | ALG (21) | Gateway/D&K (22) | ATD (23) | Capital Tire (24) | Federated/Fisher (25) |
|---|---|---|---|---|---|
| What it is | shop system | tire distributor | tire distributor | tire distributor (TCS white-label) | parts co-op store |
| Vehicle lookup | VIN (QuickVIN) | Y/M/M/T | Y/M/M/T, VIN, plate+state | Y/M/M + dual front/rear size | Y/M/M/Engine, VIN, plate+state, interchange, part # |
| Where stock is | - | Local vs Regional | not by named branch | 10 named warehouses, exact qty | 7 stores + 4 warehouses + co-op, exact qty |
| Who can be ordered from online | - | not captured | per tier | home warehouse only | home store only (INFERRED) |
| When it arrives | - | order-cutoff banner | 6 tiers Pickup -> National | none shown | none shown |
| Fulfillment mode | - | not captured | Pickup tier | ROUTE / PICKUP at checkout | not shown |
| Retail price from shop rules | vendor markup table | +100% rule | not captured | default + scoped rules, tie-break, profit cap, AI | List + Cost only; labor rate stored |
| Hide cost for customer | - | - | - | Display Cost switch | Hide Cost on every page |
| Customer quote | estimate | Quote List | Quotes funnel | Good/Better/Best printout + fees | cart + labor lines -> Start Quote |
| Job kits | package jobs | - | Create Package | - | Total Job templates |
| Cross-reference | - | - | - | same-size substitutes | Interchange (primary/secondary, OE) + Buyer's Guide |
| Lost-sale capture | - | - | - | dealer reasons + competitor price | store reasons (qty, master inv, stock, price) |
| Bulk reorder | - | - | paste spreadsheet | Quick Order | Upload/Paste (comma/pipe, 3 formats), running order |
| Accounting view | - | order history | gated (re-auth) | invoices/ROA/returns, due + outstanding | invoices with inline lines, charge types, statements |
| Promotions | - | rebate tiles | program goal gauge | Spotlights as a filter | spend-to-entries tracker |
| Shop trade name on account | Nick's and Moe's fields | MOE'S TIRE | moeseuclid | Moe's Euclid Tire & Auto | Moe's Tire & Auto - Euclid |

**Parts Authority / IMC (27), same capabilities:** vehicle lookup Y/M/M + mandatory engine, VIN or plate+state,
competitor part # with "fits this vehicle" badge; stock at the home branch, local transfer branches and ~35 plants;
**per-location Submit By and My Branch Departure times** (the only vendor that gives them); runs about every 30
minutes plus Saturday delivery; fulfillment Primary / Transfer / Shipping / **DoorDash**; Hide Prices; OE number,
OE list price and qty-per-vehicle above every aftermarket option; quality grade Good -> Ultra Premium on every SKU;
Repair Jobs (24) and Quick Selections; exploded OE diagrams; multiple carts named by vehicle; Fast Order and My
Jobs; lost-sale reasons (too expensive, need genuine, not stocked, wrong brand, other); live run tracking (run,
ETA, driver); orders, invoices and returns searchable by part number; documented punchout for Mitchell 1, ALLDATA
and R.O. Writer.

**O'Reilly Pro (28), same capabilities:** vehicle by plate+state, Y/M/M with optional engine and submodel, or VIN;
part types by Most Popular / All / Package Jobs with SAVE kits; position asked per part type; results with
warranty text, specs, list/cost, **"Available Now" vs "In Network - In Store By <time> - If Ordered By <time>"**
vs "Call for Pricing"; the cart is a **quote per vehicle** (parts, labor, other) with delivery type, return type
(new/core/warranty) and store message; **4-step delivery tracker**; interchange wizard with "May Use" house-brand
substitutes and "Fit not Determined"; stock orders; **Manage Customers** (unused); shop preferences for labor
rate, split tax, pricing method, PO mask, bay and fleet IDs, labor-guide integration; employees and an exportable
activity log; 1% electronic-order earn-back.

**Amazon (29), retail marketplace, signed-out pass:** Your Garage by plate+state or Y/M/M with a second step that
asks only the missing attributes (single-option fields pre-selected); a **conditional fit badge** ("fits only if
Position Front"); a **named delivery date plus an "order within" countdown** per offer, different by membership;
a "Get It by Tomorrow" facet; seller and shipper as separate fields; new and used offers side by side; a
**return-by date** on the offer; low-stock text. Fitment filtering is opt-in and sponsored items ignore it.
Signed in (Amazon Business): checkout PO/order fields that **print on the box label and packing slip**, per-line
"Mark as received" and an optional 3-way-match receiving module, an Ohio **reseller** tax exemption applied
account-wide, punchout and e-invoicing options, order search by PO number, "Overnight by 6:00 AM" and one-day
promises. Nour already buys vehicle-specific small parts, tools and shop consumables there several times a week.

## 2. Supplier offer: fields to add to 18's contract

18 already carries supplier/branch IDs, SKU, fitment, quantity or UNKNOWN, price/core/fees/total, location and
distance, promise semantics, estimated arrival, last-verified time, expiry and warnings. The audits add:

| Field | Why (evidence) | Rule |
|---|---|---|
| `locations[]` per offer: `{branchCode, branchName, kind: store/warehouse/coop, qty: number or {atLeast: n} (a capped `99+` / `50+`, per 30) or UNKNOWN, orderableByThisAccount: yes/no/UNKNOWN}` | 24 and 25 show exact stock at 10-12 named locations, only one orderable | Show all; rank only orderable ones; a non-orderable location is "call to source", never the default pick |
| `arrival: {tier, at?}` with tier in `pickup_now, today, tomorrow, named_date, multi_day, national, unknown` | 23 has six tiers; 24 and 25 have none | `unknown` is a first-class value; Quickest Arrival never ranks an unknown ETA |
| `fulfillmentMode: route / pickup / ship / UNKNOWN` | 24 checkout | Shown on the offer card next to arrival |
| `orderCutoff?: datetime` per branch | 22, 23 countdown banners | Drives "order by X to get Y" on the comparison screen |
| `core` (per location) | 25 Alt Locations | Part of landed cost (18 already counts core/deposit) |
| `priceStatus: priced / not_priced` | 25 rows with Cost N/A | Not-priced offers are shown but never win Best Price |
| `promo?: {programId, name}` | 24 Spotlights, 23 programs, 25 tracker | Lets the counter filter to rebate-eligible items |
| `rawDescription` | 24 unparsed strings like `225/65R17~NEX~N Priz S~B/4 BW 102V TL` | Parse as fallback when structured spec fields are missing |
| `sourceTags[]` per figure: `catalog_fitment / supplier_live / cached / manual`, plus `preferredBrand` | 25 provenance icons ("Item found in Catalog data", "Primary Brand", "Information supplied by Member's System") | Every number on an offer card says where it came from (row 33) |
| `restrictedStates[]` | 25 VOC/EPA page (several chemicals list OH) | Shown on the card; blocks the order line for the shop's state unless overridden with a reason (row 35) |
| `submitBy`, `departsMyBranchAt` per location | 27 Item Availability (home, Lorain, Huron times; far plants "Shipping") | Arrival = departure + route time; the most precise arrival data seen; refresh near each cutoff (row 36) |
| `oeRef: {oeNumber, oeListPrice, qtyPerVehicle, note}` per part type | 27 OE header row | Anchors the offer list; pre-fills quantity; gives the quote a dealer-price reference (row 39) |
| `qualityGrade: good / better / best / ultra_premium` | 27 Quality Rating | Seeds the Good/Better/Best quote options (row 40) |
| `fulfillmentMode` adds `transfer` and `courier` | 27 Branch Preferences (T, D = DoorDash) | Shown on the card; shop can disable modes per supplier (row 43) |
| `arrival.orderBy` with `arrival.at` for network stock | 28 "In Store By: Tomorrow 7:30 AM - If Ordered By: 5:25 PM" | Show the order-by time beside the ETA (row 45) |
| `priceStatus` adds `call_for_price` | 28 "Call for Pricing and Availability" | Shown, never wins Best Price |
| Supplier order fields: `ticketRef`, `bayId`, `fleetId`, `returnsAttached[]`, `status: placed / processed / out_for_delivery / delivered` | 28 Shop Preferences, Return Type, Delivery Details | Every order maps back to a ticket; pending returns ride with the next order (rows 46-48) |
| `fitConfidence: confirmed / conditional / not_confirmed` with `fitConditions[]` (e.g. position front) | 29 "fits only if following criteria are met: Position Front"; 29 sponsored misfit | A conditional fit shows its condition; a not-confirmed fit is never the default pick (rows 52, 56) |
| `arrival.range {from, to}` and `arrival.byMembership[]` | 29 "FREE delivery Nov 10 - 12"; Prime vs non-Prime dates | Rank on the latest date of the range; use the date for the shop's actual membership (row 54) |
| `returnBy: date` per order line; `soldBy`, `shipsFrom`, `condition: new / reman / used`; `restocking` | 29 buy box and results | Returns queue warns before expiry; used safety parts hidden by default (rows 57-59) |
| Supplier order line adds `purchaseUse: resale / shop_use / non_shop`, `shipTo: shop / other`, `poText` (ticket # + vehicle), `receivedAt` | 29 section 5 (reseller exemption on all purchases; mixed ship-to; PO printed on the box; Mark as received) | Ticket-attached lines default to resale + shop; shop-use totals reported monthly; `receivedAt` feeds measured run times (rows 61-64) |

**Delivery reality (Nour, 2026-11-06):** the route suppliers "are all usually about 30 min to an hour unless held
up", but "the availability is what differs a lot of the time". So for local route deliveries the run time is
close to a constant and the real ranking variable is **where the part is right now**:

| Availability tier (rank order) | Example on screen | Arrival used for ranking |
|---|---|---|
| 1. On the shelf at the supplier's servicing store/branch, orderable | O'Reilly "Available Now"; PA home-branch qty; Federated home store qty | now + that supplier's run time (default 30-60 min, "schedule, not live") |
| 2. At another branch/warehouse the account can order from (transfer) | PA other plants with a departure time; Federated alt locations if orderable | the vendor's stated departure/transfer time + run time; UNKNOWN until shown |
| 3. Network/next-day | O'Reilly "In Store By: Tomorrow 7:30 AM - If Ordered By ..." | the stated time + run time |
| 4. Shipped | Amazon dated delivery; far PA plants "Shipping" | the stated date |
| 5. Unknown / call / not orderable | Federated non-home stock; "Call for Pricing" | never ranked; shown as "call to confirm" |

Rules that follow:
- Quickest Arrival = best availability tier first, then the earliest known time inside that tier. Two tier-1
  offers are a tie on speed (within one 30-60 min run) and fall back to price; the UI says "same run window"
  instead of pretending one is 5 minutes faster.
- Live stock is the expensive, valuable data: every comparison re-checks qty at lookup time and shows the
  last-verified time; a cached qty older than the lookup never ranks as tier 1.
- "Unless held up" is measured, not guessed: each supplier order records `orderedAt` and `deliveredAt` (from the
  vendor tracker where it exists - PA run tracker, O'Reilly delivery steps - or the counter's "received" tap),
  and Shop OS replaces the 30-60 min default per supplier with the observed median and 90th percentile once it
  has ~20 deliveries. A supplier whose 90th percentile drifts past 90 min is flagged on the owner screen.
- Per-supplier static table until an API says otherwise: run-time default, cutoffs, and which branches are
  orderable, clearly labeled "schedule, not live".

## 3. Shop-owned objects the audits justify

**ShopIdentity** - one record: legal name, trade names (`Nick's Tire & Auto`, `Moe's Tire & Auto`), address,
and per-vendor account mapping (`vendor, accountNumber, displayNameOnVendor, branchCode`). Replaces the
"stale name" idea: both names are current (Nour, 2026-11-06). (21, 22, 23, 24, 25)

**SellPriceRule** - `scope: default | category | brand | part | supplier | sizeBand`, `type: percent | amount`,
`direction: up | down`, `magnitude`, `maxProfitPerUnit?`, `priority`; a shop-level `tieBreak: lowest_price |
highest_price | most_specific`; a live preview ("a $100 cost sells at $X") before save; saving requires step-up
re-auth (row 13). Single source for every retail price. (24 section 7, 22 +100% rule, 21 markup table)

**Quote** - status `open -> contacted -> converted | closed` with owner (23); options tagged `good | better |
best` (24); qty default 4 for tires; lines for parts, labor (rate x units from the shop labor rate, as in 25)
and add-ons (flat or per-unit, taxable flag); fees from shop defaults: disposal each, road hazard percent with
per-unit cap or flat each, sales tax; vehicle + mileage; notes; convert to ticket in one action.

**DeclineReason** (lost sale) - `price | timing | not_needed_now | went_elsewhere | just_shopping | availability
| specs`, optional `competitor` (pick list: Advance Auto, AutoZone, NAPA, O'Reilly, Rock Auto, eBay, other -
as in Federated's form) and `competitorPrice`; one tap on any declined estimate or quote line; feeds
declined-work follow-up. (24 section 10, 25 sections 5c and 11)

**Warranty terms per line** - the quote and invoice carry the warranty that applies (shop's own, or a program
such as Federated's Nationwide Warranty 12/12 or 24/24 if Nick's is enrolled - UNKNOWN) and any road-hazard
plan, so the customer document states coverage. (25 section 11)

**VendorProgram** - `{vendor, name, period, rules}` where rules can be spend thresholds, strategic-vendor
bonuses and year-over-year growth multipliers (Federated Suite-Stakes: 5 entries per $1,000/month, +5 per $500
of strategic vendors after the threshold, double if up 10%+ YoY); shows progress like 23's gauge. Programs
inform, never decide, which offer wins. (23, 24, 25)

**JobKit** - a named job (Brake Replacement) that pre-selects part types (hose, master cylinder, caliper, pin
kit, pads, rotors) plus labor ops, each removable. (25 Total Job, 21 package jobs, 23 Create Package)

**PartCrossRef** - `{fromBrand, fromPart, toBrand, toPart, grade: primary | secondary | oe, source}` with the
"suggestion, not equivalence" warning carried into the UI; plus reverse fitment (Buyer's Guide). (25 section
5b) Must follow 18's rule: never promote an uncertain cross-reference to an exact match.

**CatalogIssue** - "wrong part / wrong fitment" report from the counter or a tech, tied to supplier, SKU,
vehicle; feeds a supplier quality score and, where the vendor offers it, their Discrepancy report. (25)

**SupplierOrderDraft** - started-but-unsent orders surface on the morning screen until sent or parked (24
row 24); bulk entry by paste in comma or pipe with three formats (25), or keyboard-only qty + Enter (24).

## 4. Screens this implies (in build order)

1. Counter search: one box, modes VIN / plate+state / Y-M-M-engine / part # / interchange; recent vehicles per
   user, VIN-sourced ones marked. (23, 25)
2. Part-type picker: category | part type (type-ahead across all, by-popularity) | basket; tabs for categories,
   job kits, shop-defined groups. (25)
3. Offer comparison per part type: facets (brand, position, engine), Best Price and Quickest Arrival picks,
   per-location stock with orderable flag, cutoff clock, cross-ref and reverse-fitment links, hide-cost key.
   (03-VENDORS, 23, 24, 25)
4. Quote builder: good/better/best, fees, labor, vehicle, convert to ticket; decline reasons. (23, 24)
5. Supplier order review: draft list, paste/keyboard entry, human submit (18's rule: AI never buys).
6. Settings: sell-price rules with preview, quote fee defaults, landing page per user, hide accounting from
   counter users, require PO. (24, 25)

## 5. Open questions that block "Quickest Arrival"

Run time is no longer the open question for route suppliers (30-60 min, Nour, 2026-11-06 - see section 2). What
is still open is **which locations each account can actually order from and how long a transfer adds**:

- Capital Tire: ROUTE schedule, cutoff, how non-Macedonia stock reaches Cleveland. (24)
- Fisher/Federated: delivery runs and cutoffs from C185OH, transfer time from other Fisher stores and
  warehouses, whether those are orderable online. (25)
- Gateway: half answered by [30](30-PORTAL-NETWORK-SCHEMATICS.md) s.3: each regional warehouse states
  `est_delivery_days` (3-4) and every row carries `trade_region_splitup = true` (FACT). Whether this account may
  ORDER regional stock stays UNKNOWN until a cart or order response is captured. (22, 30)
Until answered, those suppliers compete on price only and show "ETA unknown - call".
- Parts Authority: drive time from branch 29 to the shop after "My Branch Departure", how Saturday delivery and
  DoorDash are chosen, and whether IMC will enable the Mitchell 1/ALLDATA-style punchout for Shop OS. (27)
- Amazon: ETA is shown (date + countdown); earliest for parts seen was overnight by 6 AM / next day, no same-day
  automotive. Nour has Amazon Business. Open: whether Shop OS can be the punchout "purchasing system" or use an
  ordering/reconciliation API. Treat as `ship`; it competes for next-morning jobs and parts no jobber has, never
  for a car on a lift. (29)
