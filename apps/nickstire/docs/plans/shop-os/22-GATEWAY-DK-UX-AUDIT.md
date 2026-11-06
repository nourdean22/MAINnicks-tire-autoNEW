# Shop OS 22: Gateway Tire / D&K B2B portal UX audit (screen by screen)

> **Correction (2026-11-06, Nour):** the shop also trades as **Moe's** ("we're Moe's too"). "Moe's" on a vendor account or ALG field is a current trade name, not a stale one. Read every "stale name" / "rename sweep" remark below as: keep one shop-identity record that holds both trade names (Nick's and Moe's) and records which name each vendor account uses; no rename is needed. The separate point about duplicate, unsynced shop-name fields still stands.

Job 2026-11-06-shop-os-gateway-dk-ux-audit. Status: COMPLETE (one pass). This is a read-only, screen-by-screen
walkthrough of the Gateway Tire B2B ordering portal at `b2b.dktire.com`, done through Nour's own authenticated
account (same legitimate-access pattern as [21-ALG-UX-AUDIT](21-ALG-UX-AUDIT.md) and the AutoZonePro pass in
[13-TOOLKIT](13-TOOLKIT.md)). Nour named this his "main tire vendor with usually the best prices" and asked
to go as deep as possible, and to flag anything useful for nickstire.org's public tire page and tire-ordering
widget. No cart/order/quote/payment/markup/profile submissions were made against the live account; every finding
below is FACT (read directly from the account this session, 2026-11-06) unless marked otherwise.

## 0. Identity

- FACT: the portal is branded "Gateway" in the shop's own UI chrome (header wordmark "GATEWAY"), but the legal
  operator is **Dunlap & Kyle Company Inc. ("D&K")** - the site title is "D&K Company Inc." and page titles read
  "... | D&K Company Inc.". This confirms the plan's existing shorthand "D&K/Gateway Tire" is one vendor, not two.
- FACT: account **#70001887**, ship-to **17625 Euclid Ave, Cleveland, OH 44112** - the shop's real address,
  confirming this is the live production account, not a demo.
- FACT: the account's **store display name on this portal is "MOE'S TIRE"** (Settings > Account, and again as the
  label "MOES" on the shop's own markup rule, section 6). This is a **third confirmed instance** of the stale
  legacy-name problem [21-ALG-UX-AUDIT](21-ALG-UX-AUDIT.md) found inside ALG itself (Company Details says "Nick's
  Euclid Tire And Auto", Advanced > QuickVIN says "Moes Euclid Tire And Auto"). The old "Moe's Tire" name is now
  confirmed baked into a *third* independent system (a vendor portal), not just two screens inside one CRM - this
  is a cross-system identity-hygiene gap, not an ALG-only bug. See [04-DATA-MAP](04-DATA-MAP.md).
- FACT: sales rep shown on the account: Steve Starosta, mobile 330-241-1074, office in Seville, OH - matches the
  branch location named in the header's order-countdown banner (section 1).

## 1. Global structure

- Header bar: Gateway wordmark; left hamburger (collapses/expands the left "Search & Filter" sidebar - it is a
  panel toggle, not a navigation drawer); account number (display only, not a clickable menu); a persistent
  "ORDER COUNTDOWN" banner naming the fulfilling branch and a live countdown to the next local-delivery cutoff
  (observed: "Seville, OH - 2d 4h Xm Local Delivery 9 November, MONDAY" - this is the specific warehouse's next
  delivery run, not a generic shipping estimate); a ship-to address selector (dropdown, multiple ship-to
  addresses supported per Store Setup, section 1a); language selector (English, flag icon); cart icon with live
  item count; a document/quote icon (opens the shopping-cart drawer's "Save"-for-quote path, separate from the
  per-row quote icon in section 4); and a round "program" icon that opens the full account menu.
- Account menu (round icon, top right): **Open Orders / Order History**, **Invoice History / Open Invoice**,
  **Settings** (badged "New"), **Payment**, **Statement**, **Quote List**, **Bay Manager** (badged "New"),
  **DOT Registration**, **Help**, **Logout**. Every item here is a real, separate page (confirmed by opening
  each one listed in sections 6-12 below), not a stub.
- Left sidebar switches its entire filter set by catalog tab (section 2) and persists across pagination.
- 3 result-view toggles on every catalog page: grid/card, list, and a dense data-table view (the one used for
  most of this audit, since it exposes every column at once).
- A **"Cost" toggle switch** sits next to Sort on every catalog results page. ON (default): shows a Cost Price
  column. OFF: hides Cost Price entirely and promotes Item# to the leftmost column instead. This is a built-in
  **staff-view vs. customer-facing-view toggle** for the same results grid - turn it off before turning a screen
  around to show a customer, without re-querying or hiding dollar figures by hand. **Steal this** for Shop OS's
  own supplier-search screen (see [14-STOLEN-MECHANISMS](14-STOLEN-MECHANISMS.md)).

### 1a. Store Setup (Settings > Store Setup)

Three sub-tabs:
- **Store**: Ship To address selector + "Add" (confirms multiple ship-to locations are supported on one account).
- **Taxation**: one configured flat fee, label "tax", Price Type "Flat Price", Value **$10**, Notes "N/A". FACT:
  this is a single flat per-something charge the shop itself configured (not a % sales-tax calculation) - exact
  application point (per order vs. per line vs. per tire) was not confirmed without placing a real order; worth
  a direct question to Nour before Shop OS assumes this maps to Ohio's tire-disposal fee.
- **Services**: one configured flat fee, label "install", Price Type "Flat Price", Value **$1**, Category
  "tires", Notes "N/A". The $1 value strongly suggests this is a placeholder/flag the shop never finished
  configuring, not a real install price - flag for Nour rather than assuming it's live pricing.

## 2. Catalog tabs (left sidebar)

Four tabs, each with its own filter set and its own results schema:

- **Tires** (section 3-5 below).
- **Supplies**: Category dropdown (9 categories confirmed, scrollable list, likely complete: FILTERS, MISC
  PARTS, OIL, SHOP EQUIPMENT, SPECIALTY PRODUCTS, TIRE REPAIR, VALVE STEMS, WHEEL ACCESSORIES, WHEEL WEIGHTS) +
  Include Out of Stock + Min Qty in Stock + Product Code search. FACT: **Gateway/D&K is not tire-only** - it
  also distributes oil and filters, which is a potential single-vendor consolidation opportunity worth weighing
  against ALG's existing parts-vendor list (AutoZone/Fisher/Parts Authority/Detroit/Capital/GM/O'Reilly - see
  [21-ALG-UX-AUDIT](21-ALG-UX-AUDIT.md) section on Vendors & Parts Markup). Sampled 42 results in TIRE REPAIR;
  the 2.00x cost-to-retail keystone pattern (section 6) held on every sampled row here too, including $3.66 ->
  $7.32 (exact 2x). Every sampled item showed **0 Local On Hand** despite being listed as a live, orderable
  SKU - small shop-supply items on this account appear to be regional/distribution-fulfilled only, not
  branch-stocked, which matters for same-day-need items like plug kits.
- **Wheels/Tubes/Flaps**: Category dropdown (FLAPS / TUBES / WHEELS) + Rim Diameter + Product Code. Searching
  with no category selected returns "No matching records found" - a category (or Rim Diameter) must be chosen
  first. Sampled FLAPS (23 results): same keystone pricing pattern; rows have **no quote-document icon** in
  Action, only Add-to-Cart - the per-row "get a customer quote" action (section 4) is tires-only on this portal.
- **Specials**: returned **"Unable to reach server"** and 0 results on two separate attempts (initial load and a
  manual retry). FACT: this is a confirmed broken-or-empty state on this account as of 2026-11-06, not a
  one-off glitch I mis-clicked past - worth flagging to the rep (Steve Starosta) if Nour wants to use whatever
  rebate/promo program this tab is meant to surface. It's plausibly related to the "Program Items Only" checkbox
  in Tire Search (section 3) and a "Program Dashboard"/rebate mechanic referenced in earlier exploration of this
  account but not reached this pass - still UNKNOWN pending a working Specials tab or a question to the rep.

## 3. Tire search (sidebar, Tires tab)

- Three alternate entry points, visually OR'd: **Size Number**, OR **Product/MFG/Dealer Code**, OR **Select
  Brand** (dropdown).
- **Include Out of Stock** checkbox (off by default - matches the Supplies/Wheels tabs' convention).
- **Show Program Items Only** checkbox - ties to whatever rebate/promo mechanic the broken Specials tab (section
  2) is meant to expose. UNKNOWN until Specials works or the rep explains it.
- **Min Qty in Stock** numeric filter, default 1.
- **VIN** lookup field at the bottom of the sidebar (`Enter VIN no`). Tested with a well-known public sample VIN
  (`1HGCM82633A004352`, a documentation/testing example, not a real customer's) and got "Please enter a valid VIN
  number" - the field validates VIN format/checksum client-side before searching. Not tested with a real,
  check-digit-valid VIN this pass (none was available without using real customer data) - the actual fitment
  results this produces are UNKNOWN; worth a follow-up with a real vehicle's VIN in a future authorized session.

## 4. Tire search results (data-table view)

Columns, left to right (Cost toggle ON): **Item#** (full manufacturer/dealer part number, e.g. `110133510`),
**Product Name** (size + load/speed index + model + brand/logo + color code, e.g. "225/65R17 102T YOKOHAMA AVID
S33 (OE) BLK"), **Cost Price** (a struck-through "list" cost above a red **Special Price** badge showing the
shop's actual cost - in every sampled row this pass the two numbers were identical, i.e. no real special-price
discount was active on any sampled SKU; some rows, e.g. LANDSAIL RD3, show no Special Price badge at all and
just a plain cost), **Local On Hand** (color-coded stock pill at the fulfilling branch; "50+" is the display
cap), **Retail Price** (the shop's own configured sell price - see section 6, this is NOT a Gateway-suggested
price), **Action** (a `-`/qty/`+` stepper, a green **Add to Cart** cart icon that is quantity-gated - clicking
it at qty 0 throws a "Quantity cannot be 0" validation toast and does **not** add anything - and a dark
**document/quote icon** that structurally matches the Quote List feature, section 9). A **Compare** checkbox
sits in its own column per row (a compare-tires feature not explored further this pass). 108 results for a
single 225/65R17 size search.

### 4a. Product Details modal (fully read-only; opened by clicking the product name/image, not the row icons)

- Title + an OE-fitment marketing note where applicable (e.g. "Used as Original Equipment on Select Chrysler and
  Dodge Vehicles") + Part Number.
- 4-field pricing block: **Cost Price/ea**, **Special Price**, **Cost + FET**, **Retail Price/ea**, **Retail +
  FET**, with FET (Federal Excise Tax) broken out separately (observed $0.00 on the sampled passenger tire -
  FET on passenger tires is normally $0, so this is expected, not a bug; a heavier commercial tire would be the
  real test of this field).
- **Local On Hand** and **Regional On Hand** shown as two separate stock figures (observed 3 local / 14
  regional on one SKU) - a genuine two-tier availability model: a smaller, branch-local number plus a larger,
  wider-network number. **Directly useful for the nickstire.org tire widget**: showing both lets the public page
  promise "ready today" vs. "arrives on next delivery" instead of one flat yes/no in-stock flag.
- **Benefits** bullets and **Features** bullets (short marketing copy, reusable verbatim or close to it for the
  public tire page's product copy).
- **Specs** panel - confirmed complete at **28 fields** (scrolled to the end; nothing further below
  `NormalizedSize`): `LR/SR`, `PlyRating`, `UTQG`, `Warranty`, `Sidewall`, `ApprovedRimWidthMax`,
  `ApprovedRimWidthMin`, `AspectRatio`, `Diameter`, `InchWidth`, `LoadCapacitySingle`, `LoadRange`,
  `MaxInflationPressure`, `MeasuringRimWidth`, `Model`, `OverallDiameter`, `OverallWidth`, `RevolutionsPerMile`,
  `RimDiameter`, `SectionWidth`, `SegmentTags`, `StaticLoadedRadius`, `TreadDepth`, `TreadWidth`,
  `VehicleTypeTags`, `Weight`, `RoundedDiameter`, `WinterClass`, `DisplaySize`, `Format`, `NormalizedSize`. This
  is a ready-made data-model reference for both Shop OS's internal supplier-offer contract and a public tire
  fitment widget's product schema - directly answers part of request 3 (Nour's "stuff that may help the tire
  page... and the tire ordering widget").

## 5. Pricing: the "exactly 2.00x" pattern, explained

Every sampled tire, flap, and tire-repair-supply row this pass showed **Retail Price = exactly 2.00x Cost
Price** (keystone / 100% markup) - confirmed again on the detail modal's own numbers ($117.90 cost -> $235.80
retail). This is **not a Gateway platform default**. It is a single shop-configured rule, found at Settings >
**Markup Settings**:

| Field | Value |
|---|---|
| Rule label | `MOES` (stale legacy name - see section 0) |
| Make / Model / Category / Product Number scope | `--` / `--` / `--` / `--` (i.e. this one rule applies globally, unscoped) |
| Pricing Range | $0.00 - $5000.00 |
| Price Type | Markup (%) |
| Markup Value | **100%** |

The screen supports adding more rules (an "Add" button) scoped more narrowly by Make, Model, Category, or
Product Number, each with its own price range and its own percentage-or-flat markup type, plus edit/delete
controls on the existing rule. **This resolves an open question from the earlier pass**: Gateway's observed
markup model is not platform policy and has no necessary relationship to ALG's own internal 30%-default parts
markup ([21-ALG-UX-AUDIT](21-ALG-UX-AUDIT.md)) - they are two independently configured numbers, in two
different systems, that happen to both exist and are not currently reconciled anywhere. Worth a direct
conversation with Nour: is 100% markup on Gateway tires the intended margin, and does it match what actually
prints on a ticket in ALG today? **Steal the mechanism** (rule-scoped markup by make/model/category/part-number
range, percentage or flat, in Shop OS's own pricing config) regardless of what the number should be - see
[14-STOLEN-MECHANISMS](14-STOLEN-MECHANISMS.md).

## 6. Quote List (Settings menu)

Columns: Quote ID, Prepared By, Date, Customer Name, Email, Phone, Total Amount, Action. Date-range filter plus
free-text quote search. **No Quotes available** on this account currently. This is the destination the
per-row quote/document icon (section 4) structurally points to: a saved, customer-attributed quote (captures a
customer's name/email/phone against a line-item total) that is **separate from and safer than Add-to-Cart** -
it does not commit an order. This is the closest existing mechanism on this portal to what a nickstire.org
tire-ordering widget would need for a "get a quote" flow (capture customer contact info + a priced tire
selection, without an irreversible order submission) - directly answers part of request 3.

## 7. Bay Manager (Settings menu, badged "New")

A full, built-in appointment/scheduling calendar inside the **supplier's own portal**: Today/Back/Next
navigation, Day / Month / Agenda view toggle, and (in Day view) a 20-minute time-slot grid starting at 9:00 AM.
Checked both Day (today) and Month (November 2026) views - **completely empty**, no bookings found anywhere.
This is a genuinely surprising find given [21-ALG-UX-AUDIT](21-ALG-UX-AUDIT.md)'s confirmed gap that ALG itself
has **no reachable scheduling/dispatch board anywhere in its nav** - the shop's tire supplier offers one, for
free, as part of this account, and it appears entirely unused. Two live questions for Nour, not yet answered:
(1) is Bay Manager tied only to Gateway-sourced tire jobs, or could it function as a general shop
appointment board; (2) given it's unused and "New", is it worth adopting as a stopgap before Shop OS builds its
own scheduling screen, or is it out of scope/unreliable because it lives inside a vendor portal the shop doesn't
otherwise treat as a system of record. Either way, its existence is a stolen-mechanism candidate for Shop OS's
own counter screen: a 20-minute bay-slot grid with Day/Month/Agenda views is a reasonable granularity default.

## 8. Open Orders / Order History (Settings menu)

Two tabs, **Open Orders** and **Order History**, both showing real, live production data (account #70001887,
"North Gateway Tire CO., Inc..." shown as the billing-entity dropdown label - a fourth name variant worth
reconciling alongside "Moe's Tire"/"Nick's Euclid Tire And Auto"/"Nick's Tire & Auto", see section 0). Confirmed
full column set (scrolled right): Status, Invoice ID / Sales Order ID, Customer PO, Item Description, Qty, Unit
Price, Est amt (incl tax), Payment Status, Payment Source, Delivery Method, Date, Action (a download icon, not
clicked - file downloads from a third-party account need the user's explicit go-ahead). A **House Account /
Program Account** toggle sits above the table (an account-type/financing-terms setting, not explored further).
Order History supports a date-range search; widening it to 08/01/2026-11/06/2026 returned dozens of real,
already-invoiced line items going back through August. **Per this repo's existing redaction practice** (matching
[17-ALG-LEDGER-STUDY](17-ALG-LEDGER-STUDY.md)), exact dollar figures and full order detail are deliberately not
reproduced here - the structural finding is that a genuine purchase-history dataset exists on this portal and
could, with Nour's go-ahead, be mined for real buying patterns (most-ordered sizes/brands, order cadence,
house-account vs. named-PO mix) to inform both Shop OS's own reporting and the public tire page's "popular
sizes" selection.

## 9. Not reached this pass

- **DOT Registration** (Settings menu) - opened the menu entry but did not go deep; directly relevant to Ohio
  used/new-tire DOT compliance already flagged in [07-COMPLIANCE](07-COMPLIANCE.md) - worth a dedicated look.
- **Invoice History / Open Invoice**, **Payment**, **Statement** (Settings menu) - not opened, to avoid
  surfacing billing/payment-method detail unnecessarily; low expected planning value versus the privacy cost.
- **Specials** tab - blocked by a server error both times tried (section 2); needs either a retry on a different
  day or a question to the rep.
- **VIN fitment results** - the lookup field works and validates format, but was not exercised with a real,
  checksum-valid VIN this pass (section 3).
- A second tire-size search (different size/brand) to confirm the 2.00x keystone pattern is truly universal
  across the whole catalog rather than a property of the single markup rule covering the sizes sampled - though
  given the Markup Settings finding (section 5), this is now effectively confirmed by construction: one unscoped
  100%-markup rule applies to every item, so there is no further pattern left to verify.

## 10. What changes elsewhere in the plan

1. **[03-VENDORS](03-VENDORS.md) / [20-SUPPLIER-INTEGRATION-START](20-SUPPLIER-INTEGRATION-START.md)**: Gateway's
   offer data model (section 4a's 28-field Specs schema, Local-vs-Regional stock, Cost/Special/Retail/FET price
   tiers) is a concrete reference for the normalized supplier-offer contract both files call for.
2. **[14-STOLEN-MECHANISMS](14-STOLEN-MECHANISMS.md)**: add rows for the Cost/customer-view toggle (section 1),
   the rule-based markup-by-scope-and-range pricing config (section 5), the Quote-List safe-quote flow (section
   6), and the 20-minute Bay Manager scheduling grid (section 7).
3. **[04-DATA-MAP](04-DATA-MAP.md)**: a third (and now fourth, counting the Order History billing-entity label)
   stale/inconsistent shop-name variant is confirmed across systems - this is now a cross-system identity-hygiene
   problem, not an ALG-only data-quality note.
4. **nickstire.org tire page / tire-ordering widget** (Nour's explicit ask): the Local-vs-Regional stock split,
   the 28-field tire spec schema, the Benefits/Features marketing copy, the Quote-List customer-capture pattern,
   and the ORDER COUNTDOWN local-delivery-cutoff banner are all directly reusable for the public widget's data
   model and "ready today vs. arrives [date]" messaging.
5. **[07-COMPLIANCE](07-COMPLIANCE.md)**: the Taxation ($10 flat "tax") and Services ($1 flat "install") fee
   stack found in Store Setup needs reconciling against Ohio's actual tire-disposal-fee and estimate/invoice
   line-item rules before Shop OS copies this fee model.
6. **Pricing/margin**: Gateway's 100%-markup rule and ALG's 30%-default parts markup are two independently
   configured numbers in two different systems with no current reconciliation - flagged as an open question for
   Nour, not yet resolved in this file.

## Redaction note

Real order/invoice dollar amounts, customer PO identifiers beyond the generic "house"/"HOUSE" convention
observed, and any further account/billing detail are deliberately not reproduced here, consistent with this
repo's existing practice for live production data (see [17-ALG-LEDGER-STUDY](17-ALG-LEDGER-STUDY.md)). Product
catalog data (sizes, specs, list/cost/retail pricing structure, UI copy) is reproduced as FACT since it is
ordinary vendor-catalog content, not customer PII.

## Safety note (for future sessions on this account)

The per-row **document/quote icon** in tire search results is **not** purely read-only - it validates quantity
client-side and, structurally, drives toward the Quote List feature (section 6). The **Add to Cart** cart icon
is a live, quantity-gated cart action. Neither was completed (no quote was saved, no cart item was added, no
order was placed) during this pass. The safe, genuinely read-only way to inspect a product in depth is clicking
the **product name or image**, which opens the Product Details modal (section 4a).
