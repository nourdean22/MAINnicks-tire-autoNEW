# Shop OS 24: Capital Tire B2B wholesale portal UX audit (screen by screen)

Job 2026-11-06-shop-os-capital-tire-ux-audit. Status: COMPLETE (one pass). Read-only navigation of Nour's own
authenticated Capital Tire wholesale account (capitaltire.net/Wholesale), same legitimate-access pattern as
[21-ALG-UX-AUDIT](21-ALG-UX-AUDIT.md), [22-GATEWAY-DK-UX-AUDIT](22-GATEWAY-DK-UX-AUDIT.md) and
[23-ATD-UX-AUDIT](23-ATD-UX-AUDIT.md). Nour describes Capital Tire as "a local tire vendor like ATD and
Gateway" (his words, 2026-11-06). Everything below was observed by clicking through Nour's own
paying/ordering account; no item was added to the cart, no quote/printout was saved, no order was placed, and
no account setting was saved (the one display toggle flipped for observation was restored, section 4).

Evidence tags used below: **OBSERVED** (seen on screen or in the page's own markup this pass), **INFERRED**
(reasoned from what was observed, not directly confirmed), **UNKNOWN** (not reachable without an action this
pass deliberately avoided).

## 0. Identity

- Login handle: **moeseuclid** - the same handle as ATD (23 section 0). Greeting reads "Hello, Moe's Euclid
  Tire & Auto - Moe's"; My Account shows Company "Moe's Euclid Tire & Auto", User status Active. This is the
  **sixth** confirmed surfacing of the stale "Moe's" legacy name across vendor systems this session - the
  global rename sweep flagged in 23 should now explicitly include Capital Tire.
- Ship-to: **17625 Euclid Avenue, Cleveland OH 44112** (PRIMARY, the only address in the account's address
  picker, which opens from the header location-pin icon) - same physical shop as the Gateway/D&K and ATD
  accounts.
- Platform: footer reads "Capital Tire Inc. (c) 2026 Powered by TCS Technologies" (link to tcstire.com). This
  is a **white-label B2B portal product**, not a Capital Tire in-house build (OBSERVED). Opportunity (INFERRED,
  verify before relying on it): if other regional distributors Nour buys from also run on TCS, one
  TCS-shaped adapter could cover several vendors - worth one question to the Capital Tire rep and a quick
  check of other vendors' footers.
- Support line surfaced as a homepage tile: OH & IN 800.537.0190, MI 877.338.9626.

## 1. Global structure

- Header: logo (home link), a single search box "Enter Part Number, Size or Description", a type dropdown
  (All / Tires / Wheels / Other), Search, a blue **"+"** button (section 3c), the greeting + ship-to block, a
  location-pin (ship-to address picker), a cart icon with count badge (0), and logout.
- Top nav: **Home / Spotlights / Fitment Guides / My Account / Quick Order / Review Order**. Only My Account is
  a hover dropdown (Transaction History, Change Password, Markups, Printout Settings, Other Settings, Change
  Logs). Fitment Guides is a plain link to /tirefinder; Review Order is the cart/checkout page itself, not a
  flyout.
- There is **no "Products" menu**, even though the homepage "How to Order" help copy still tells users to hover
  one. Resolved (STRONG INFERENCE): the in-app change log records "Search Bar Relocated to the Top Center of
  the Header" (launched Apr 22 2026); the help copy predates that redesign and was never updated. Lesson for
  Shop OS: in-app help that is not tied to the UI it describes goes stale silently.
- An **"AI ASSIST"** floating button (badged NEW) appears on the Markups page (section 7). Change log entry:
  "AI Assistant on the Markups Page", Jul 23 2026.
- No order-cutoff countdown banner anywhere observed (contrast: Gateway and ATD both have one - section 4).

## 2. Home

- **"What's New" release-notes panel** shown on the homepage after login, with dated, expandable entries
  (Default Secondary Sort Option 10/22/2024; Expanded Tire Features Specifications and Image Zoom 02/25/2025;
  Updated Compare Experience 09/09/2025; Improved Multi-Spotlight Visibility 10/21/2025). An X dismisses all
  notifications; the full history lives at My Account > Change Logs (section 8). Not seen on ALG, Gateway or
  ATD.
- **Spotlights** promo tiles (Goodyear, Cooper and Milestar rebates, a Nexen sweepstakes, the "Need help? Call
  us" tile). The Spotlights nav page is just the same tile grid full-page. Spotlights are also a **catalog
  filter** ("Select an active spotlight" at the top of the results filter rail) - a promo is a queryable
  attribute of a SKU, not just a banner (OBSERVED).
- **Saved Searches** panel ("Please select a Saved Search below and click See Results"; currently "No Saved
  Searches"). This is a saved *query* (filter set), distinct from ATD's saved *reorder list*.
- **Recent Web Orders** panel: Date/time + Amount per web order, a per-row reprint icon, and "View All" (links
  to Transaction History). Five orders were listed over roughly two months (values not recorded here - see
  Redaction note). Web orders and invoices are separate objects: the last-90-days invoice view (section 9)
  showed a different, smaller set of documents than this panel.
- **How to Order** help block (text summarized): search from any page; use Saved Search for repeat searches;
  "Type the quantity in the 'Order' column and then press 'Enter' or 'Tab' ... to immediately add the item";
  Quick Order for known part numbers; Review Order to finalize. See section 4 for how this compares to the
  live UI.

## 3. Search and results

### 3a. Search behavior

- Query `2256517` (no slashes or R) returned 225/65R17 results and auto-switched the type dropdown to Tires
  (OBSERVED). The search is format-tolerant; URL shape `/Wholesale/catalog/MyProductType.name:all/Power_Search:<q>`.
  Change log: "Search by Full SKU Code Now Available" (Oct 2024) and "Search All Products (where applicable)".
- A "Finding the best matches..." loading screen (tire-spinner animation) shows for a few seconds.
- Results: **51 for 225/65R17, 2 pages**, default sort **Cost ascending** (that default is an account setting -
  section 8). Sortable headers: Part Number, Manufacturer, Size, Description, Sidewall, Load Range, UTQG,
  Warranty, Sell Price, Cost, Available, Regional.
- A dismissible yellow vendor banner above results ("Cooper Discoverer HT now available ... Full Specs can be
  found HERE").

### 3b. Result row (List view, the account's current default)

Per SKU: Compare checkbox; brand logo with a small spotlight marker; product image; size; model; Part #;
spec block (Sidewall, Load Range, Load Index, Speed Rating, Type TL, UTQG, Warranty "Std.: 55000", Subclass
e.g. Performance/Highway/All Season/All Terrain/Touring/Winter/SUV); price block (**Sell Price**, **Cost** in a
small boxed chip, **FET**); stock block (**Available: n** and **Regional: n**, both capped at "50+", or "Out of
stock"); and a blue **Order** button. Grid view also exists (Grid / List toggle).

- **Sell Price = exactly 2x Cost on every row observed**, because the account's only markup rule is a default
  "+100% on Tire" (section 7). The portal is showing the shop's own retail price, computed from the shop's own
  markup rules, next to its wholesale cost.
- Out-of-stock rows carry an orange "!" icon: tooltip "This item is currently out of stock. Please click to see
  similar items." Clicking opens **Recommended Products**: a side-by-side spec matrix of same-size alternatives
  (size, model, manufacturer, subclass, sidewall, ply, load index, speed rating, warranty, UTQG, part #, FET)
  plus per-warehouse vendor prices for each - a built-in substitution path at the moment of a stock-out.
- Catalog data-quality gaps (OBSERVED): a few rows have an unparsed raw description string instead of a model
  name (pattern `225/65R17~NEX~N Priz S~B/4 BW 102V TL`) and show "Speed Rating: Not Specified" even though the
  raw string encodes 102V; one model appears twice under two part numbers (T and H speed ratings). Shop OS's
  supplier-offer normalizer must parse these raw strings, not trust the structured fields alone.

### 3c. The "+" button = dual (staggered) fitment search

The "+" next to Search (`toggleRearSearch`) reveals a second box, **"Enter Rear Tire Size"**, for staggered
front/rear fitments (change log: "Dual Fitment Lookup", Mar 18 2026). Not seen on the other three vendors.

### 3d. Filter rail

Select an active spotlight; Manufacturer; Manufacturer product line; Width; Ratio; Rim; Run Flat; Sidewalls;
Ply; Speed Rating; Load Index; Subclass; Stock (In Stock / Not in Stock); **Source** (each of the 10 named
warehouses) + **Min Qty**; Update list. **Saved filter options** lets the user name and save a filter set
(minimum 5 letters) and delete it later. Applied filters show above the results (change log, Jul 2024).
Also on the rail: Compare and Quote Selected Products (section 5), View (Grid/List), product type
(Tires/Wheels/Other), a mini "Review Order" cart summary, and **Download Price List** (generates a PDF named
"Price List - <date>" for the current search).

## 4. Inventory and delivery model (the "best price AND quickest" question)

Clicking **Order** on a row does not add anything; it opens a **"Warehouses and Prices"** modal for that SKU:

| Column | Meaning (OBSERVED) |
|---|---|
| Source | each of 10 named warehouses: Indianapolis, Dayton, Columbus, South Bend, Birch Run, Ferndale, Grand Rapids, Dover, Macedonia, Toledo |
| Sell / Cost | identical at every warehouse for the SKU checked |
| Quantity | exact on-hand per warehouse (not capped in this modal) |
| Order | a -/qty/+ stepper **only on Macedonia**; every other warehouse shows "-" |
| Total | per-row and grand total, units and dollars |

Buttons: **Add to cart**, **Add / View cart**, Close. Closed without adding.

What this means:

- **"Available"** on the result row is the home warehouse (Macedonia, OH, the branch serving Cleveland), and
  **"Regional"** is the rest of the network summarized and capped at 50+ (STRONG INFERENCE from matching the
  modal's numbers to the row).
- The portal shows **where** stock is, by name and exact count, across the whole network, but lets this account
  order **only from the home warehouse** online. How regional stock reaches the shop (transfer, call-in, or not
  at all) and how long it takes is **UNKNOWN** - no ETA, delivery date, or cutoff countdown appears anywhere,
  including checkout.
- Checkout (Review Order and Quick Order) offers **Ship via: ROUTE or PICKUP**, a PO Number (optional), and
  Comments (optional), with "# of items / Subtotal / FET / Order Amount", **Finalize Order!**, **Cancel Order**
  (clears the cart), and **Print this Page**. Neither was submitted.

Compared with the two prior precedents:

| Vendor | Where (branch/location detail) | When (arrival detail) | Fulfillment mode |
|---|---|---|---|
| Gateway/D&K (22) | Local vs Regional, two buckets | order-cutoff banner | not captured |
| ATD (23) | not by named branch | six tiers: Pickup / Today / Tomorrow / named date / Multi-Day / National | Pickup is one of the tiers |
| **Capital Tire (24)** | **10 named warehouses, exact counts; only home one orderable** | **none shown** | **ROUTE vs PICKUP chosen at checkout** |

New relative to Gateway and ATD: location and arrival are **separate dimensions** that vendors expose
independently - Capital Tire is rich on "where" and silent on "when", ATD is the reverse. This changes the
03-VENDORS cross-supplier design (see section 12, item 2).

**Inline "type quantity + Enter/Tab" (from the help copy):** in the live List view the row has an Order
*button*, not a quantity cell; the only quantity input observed is the stepper inside the warehouse modal and
the quantity cells on Quick Order. Whether Grid view or an older layout still has an inline quantity cell is
UNKNOWN (typing a quantity anywhere adds to the cart immediately per the help text, so it was not tested).
The mechanism is still worth stealing as described (14-STOLEN-MECHANISMS row 26), but it is
**documented, not confirmed live** here.

**Display Cost toggle** (top-right of the results panel): switching it off reloads the results with the Cost
column and cost chip removed, leaving Sell Price and FET - a one-click **customer-facing mode** so the screen
can be turned toward a customer at the counter. It is a saved account preference (it also appears in Other
Settings); it was flipped off for observation and restored to on.

## 5. Compare and customer quote printout

Ticking Compare on two or more rows and pressing **Compare and Quote Selected Products** opens a modal with
two tabs:

- **Features**: side-by-side spec comparison with large images. Instruction text: drag a product image onto
  **Good**, **Better** or **Best** labels to tag it for the printout; "All changes to the product orders are
  automatically saved."
- **Printout** (a customer-facing quote builder): Enter Quantity (defaults to **4**); **Change Price(s)**
  override; per option a spec card (sidewall, ply, load index, speed rating, warranty, UTQG, **tread depth**,
  type, part #) and a cost block - Subtotal, FET, Other (add-ons), Disposal Fee(s), Road Hazard, Taxes, Total;
  an **Add Ons** grid (quantity, description, method Flat Rate or Quantity Rate, price, extended price,
  taxable); **Vehicle Information** (Year/Make/Model/Option dropdowns or a custom description, plus Current
  Mileage); tax / disposal / road-hazard toggles; Notes. Nothing was entered or printed.

Defaults for that printout come from **My Account > Printout Settings**: shop logo upload, Add Sales Tax (%),
Add Disposal Fees ($ each), Add Road Hazard (%) with a **Max Price per Unit** cap, Add Road Hazard ($ each),
and a reusable **Add Ons** library (currently empty).

This is the most complete "quote the customer a Good/Better/Best set of 4 with all fees" tool seen across all
four vendors - and it sits in a supplier portal, disconnected from the shop's own ticket and customer record.

## 6. Fitment Guides (Tire Finder)

Year / Make / Model type-ahead selectors only (no VIN, no plate - contrast ATD's three lookup paths). Test
input: 2018 Honda CR-V (a generic vehicle, not a customer's). Result: one row per trim (EX, EX-L, LX, Touring)
with **Tire Size, TPMS (yes/no icon), Front psi, Rear psi (door-placard pressures), Load Index, Speed Rating,
Bolt Pattern, Rim Diameter, Offset**. Each trim has a checkbox (multi-select, then **Search selected**) and a
"+" that expands **Plus Sizes** (tire size, load, min rim width, max rim width; each selectable). Not seen as
a structured table on the other vendors: placard pressures and TPMS presence alongside the size.

## 7. Markups (the shop's retail pricing engine, inside the vendor portal)

My Account > Markups ("Sell Price - Markups"):

- **Display Setting**: Display Sell Rate (checkbox) + Save.
- **Add Markup**: Inventory Type (required) then three optional scopes combined with AND - First Option: Part
  Number(s), Second Option: Manufacturer(s), Third Option: Warehouse(s). Markup Type (Amount $ or percent),
  Direction (+ / -), Magnitude, and an optional **Maximum Profit** cap. A live sentence previews the effect
  ("a product ... which normally costs $100.00 will cost $X"). Submit Markup.
- **Specific Markups** (empty) take precedence over **Default Markups**. A **Markup Rule** dropdown decides
  which wins when several specific rules match ("If more than one markups exists, the following wins..." -
  currently **Lowest Price**).
- **Default Markups**: one row, "General Markup for Tire - Markup %, +, 100" (edit/delete icons). This is why
  every Sell Price is 2x Cost.
- **AI Assistant** panel: "Describe the markup you want in plain English. I'll ask follow-up questions if I
  need more detail." Examples: "Add 15% markup to all parts", "Mark up Goodyear tires by $10", "Reduce price of
  part ABC123 by 5%". Opened, nothing typed.

Nothing was submitted or saved on this page.

## 8. Other Settings and Change Logs

**Other Settings** (read only, not saved): default View Type (Grid/List); a two-level **Force Sort Order**
(field + direction, then second field + direction - fields include Part Number, Manufacturer, Size,
Description, Warranty, Cost Range, and **each warehouse's quantity**); **FET** display mode (Do Not Display /
Display FET separately / Include FET in Cost & Sale Price); Display Cost; Display GM Part Numbers; **Enable
Order Reminder** ("a popup will display when you first log in if there are items on your order but your order
hasn't been submitted yet"); Enable Order Confirmation Email.

**Change Logs**: 29 entries across 3 pages, each with Title, Description, Type (Feature / Bug Fix), a "Branch
Number" (their release id), and Launched Date, Nov 2022 to Jul 2026. The release cadence and topics (cart
clearing bug, local-time order timestamps, password policy and lockout, FET display options, tread depth on
printout, dual fitment, AI markups) show a portal under active development.

## 9. Transaction History (accounts receivable view)

Date presets (Today, Yesterday, This Week, Last Week, This Month, This Year, Last 30/60/90 Days) or a From/To
range; **Paid Invoices** / **Unpaid Invoices** filters; optional search; **Print Full Transaction List** and
**Download Full Transaction List (as PDF)**. Table columns: Transaction Date, Number, PO Number, **Label**
(Invoice / ROA [received on account, i.e. a payment] / Return), Amount, Status, View details. The detail link
carries DocumentNumber, InvoiceNumber, DocumentDate, DocumentAmount, DocumentType, **DueDate**,
**OutstandingAmount** and PurchaseOrderNumber; the invoice view's line columns are Order, Order qty, Cost,
Extended price, FET (each), Tax. A PO Number value such as "STOCK RETURN" shows staff using the PO field as a
free-text reason. (Row values not recorded - see Redaction note.)

## 10. Lost-sale capture (found in the page markup)

The results and Quick Order pages carry a **"Report Lost Sale"** dialog: "Select reason for not making
purchase" - **Price / Availability / Delivery Options / Product Specifications** or **Shopping only**, with
follow-up fields for price offered and the competing vendor's price/name, the product/qty/vendor that was
available elsewhere, a delivery-option choice, and a specifications choice/description. OBSERVED in the page's
own markup; **what triggers it on screen is UNKNOWN** (it did not appear during this pass, which never left a
search with items selected). Capital Tire uses it to learn why it lost an order; the same structure is exactly
what Nick's needs for declined-work recovery on its own customers.

## 11. Not reached this pass

Change Password (not opened, deliberately); the invoice/order detail and reprint views beyond column structure;
Grid view (not switched, to avoid saving a new default); the "Report Lost Sale" trigger; Wheels and Other
catalogs; any on-screen ETA for regional warehouses (none exists in the screens visited); what Spotlight
markers on brand logos mean beyond the filter; whether ROUTE has a delivery schedule anywhere. No step-up
re-auth prompt was encountered (Change Password, the likeliest place, was not opened).

## 12. What changes elsewhere in the plan

1. [14-STOLEN-MECHANISMS](14-STOLEN-MECHANISMS.md) gets a new dated section (rows 18-26): lost-sale reason
   capture with competitor price; a rule-based markup engine (default + scoped rules, a conflict rule, a
   max-profit cap, a live preview, plain-English rule entry); a customer-facing cost-hide toggle; a
   Good/Better/Best customer quote printout with fees and add-ons; stock-out substitution; a per-branch stock
   matrix with home-branch orderability and ROUTE/PICKUP; an unsubmitted-order reminder; dual front/rear size
   search plus trim-level fitment with placard psi, TPMS and plus sizing; and keyboard-only quantity entry.
2. [03-VENDORS](03-VENDORS.md)'s cross-supplier comparison section gets a Capital Tire bullet and one design
   correction: the normalized supplier offer must carry **location** (named branch + exact qty + whether this
   account can order from it) and **arrival** (ETA tier) as two separate fields, plus a fulfillment mode
   (route delivery vs pickup) - because Capital Tire supplies the first without the second. "Quickest Arrival"
   must be able to say "unknown ETA" for a vendor rather than silently ranking it.
3. Data-quality rule for every tire adapter: parse raw description strings (`size~brand~model~load/ply sidewall
   load-index+speed type`) as a fallback when structured fields are missing or "Not Specified" (section 3b).
4. Question for the Capital Tire rep (cheap, high value): how does regional (non-Macedonia) stock get to
   Cleveland and how fast, and what is the ROUTE delivery schedule and cutoff? Without that answer Capital Tire
   can only ever compete on price in Shop OS's comparison, never on speed.
5. Platform note: Capital Tire runs on TCS Technologies' white-label portal; check whether any other vendor
   Nour uses does too before building a second adapter shape.

## Redaction note

No customer PII, credentials, or session tokens appear above. Real web-order amounts and invoice amounts seen
on screen are deliberately not recorded. Per-SKU wholesale costs are not listed; only the structural fact that
sell = 2x cost under the account's single default rule. The account identity fields (handle, company name,
ship-to) are the shop's own account metadata, already disclosed in the Gateway/D&K and ATD audits. The only
inputs typed were a generic tire size (2256517) and a generic vehicle (2018 Honda CR-V) in Tire Finder.

## Safety note

Every screen above was reached by read-only navigation through Nour's own authenticated Capital Tire session.
Nothing was added to the cart (the Warehouses and Prices modal was closed without a quantity), no quote or
printout was saved or printed, no markup was submitted, no settings form was saved, no order was finalized or
cancelled, and no password was entered anywhere. The Display Cost toggle was switched off once to observe its
effect and switched back on; the two Compare checkboxes ticked to open the compare view are page state only.

Method disclosure: besides on-screen clicking, some structure (the Report Lost Sale dialog in section 10, the
field lists in sections 8-9, the change-log table) was read from the page's own HTML and from same-session GET
requests to pages linked in the portal's own menus. No hidden or undocumented endpoint was called and nothing
was written, but this is closer to the "do not scrape logged-in pages" line in 14-STOLEN-MECHANISMS'
screenshot rule than the earlier passes went. Future vendor passes should stay on-screen only unless Nour
says otherwise.
