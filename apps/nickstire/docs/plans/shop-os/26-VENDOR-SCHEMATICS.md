# Shop OS 26: vendor schematics rollup - what the build must implement from audits 21-25

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

## 2. Supplier offer: fields to add to 18's contract

18 already carries supplier/branch IDs, SKU, fitment, quantity or UNKNOWN, price/core/fees/total, location and
distance, promise semantics, estimated arrival, last-verified time, expiry and warnings. The audits add:

| Field | Why (evidence) | Rule |
|---|---|---|
| `locations[]` per offer: `{branchCode, branchName, kind: store/warehouse/coop, qty or UNKNOWN, orderableByThisAccount: yes/no/UNKNOWN}` | 24 and 25 show exact stock at 10-12 named locations, only one orderable | Show all; rank only orderable ones; a non-orderable location is "call to source", never the default pick |
| `arrival: {tier, at?}` with tier in `pickup_now, today, tomorrow, named_date, multi_day, national, unknown` | 23 has six tiers; 24 and 25 have none | `unknown` is a first-class value; Quickest Arrival never ranks an unknown ETA |
| `fulfillmentMode: route / pickup / ship / UNKNOWN` | 24 checkout | Shown on the offer card next to arrival |
| `orderCutoff?: datetime` per branch | 22, 23 countdown banners | Drives "order by X to get Y" on the comparison screen |
| `core` (per location) | 25 Alt Locations | Part of landed cost (18 already counts core/deposit) |
| `priceStatus: priced / not_priced` | 25 rows with Cost N/A | Not-priced offers are shown but never win Best Price |
| `promo?: {programId, name}` | 24 Spotlights, 23 programs, 25 tracker | Lets the counter filter to rebate-eligible items |
| `rawDescription` | 24 unparsed strings like `225/65R17~NEX~N Priz S~B/4 BW 102V TL` | Parse as fallback when structured spec fields are missing |
| `sourceTags[]` per figure: `catalog_fitment / supplier_live / cached / manual`, plus `preferredBrand` | 25 provenance icons ("Item found in Catalog data", "Primary Brand", "Information supplied by Member's System") | Every number on an offer card says where it came from (row 33) |
| `restrictedStates[]` | 25 VOC/EPA page (several chemicals list OH) | Shown on the card; blocks the order line for the shop's state unless overridden with a reason (row 35) |

Per-vendor static fallback until an API says otherwise: a hand-entered table of route runs and cutoffs per
supplier branch (from the rep questions in 24 and 25), clearly labeled "schedule, not live".

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

- Capital Tire: ROUTE schedule, cutoff, how non-Macedonia stock reaches Cleveland. (24)
- Fisher/Federated: delivery runs and cutoffs from C185OH, transfer time from other Fisher stores and
  warehouses, whether those are orderable online. (25)
- Gateway: is the Regional bucket orderable and how fast. (22)
Until answered, those suppliers compete on price only and show "ETA unknown - call".
