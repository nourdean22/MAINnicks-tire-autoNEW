# Shop OS 25: Federated Auto Parts (FederatedLink, Fisher Auto Parts store) UX audit (screen by screen)

Job 2026-11-06-shop-os-federated-ux-audit. Status: COMPLETE (one pass). Read-only, on-screen navigation of
Nour's own authenticated FederatedLink account (federatedlink.com), same legitimate-access pattern as
[21](21-ALG-UX-AUDIT.md) through [24](24-CAPITAL-TIRE-UX-AUDIT.md). This is the first **parts** vendor audited
(21 is the shop system; 22-24 are tire distributors). No item was added to the cart, no quote was started, no
order placed, no lost-sale or discrepancy report submitted, and no setting saved.

Evidence tags: **OBSERVED**, **INFERRED**, **UNKNOWN** (as in 24). Method: on-screen clicking plus reading the
current page's own text and element labels; unlike 24, no background requests to other pages were made.

## 0. Identity

- Platform: **FederatedLink**, the e-commerce catalog of Federated Auto Parts (a distributor cooperative). The
  shop's store is **Fisher Auto Parts**, branch **C185OH** (a Federated member), shown co-branded in the header.
- Account **[redacted]**, account name **"Moe's Tire & Auto - Euclid"**, 17625 Euclid Ave, Cleveland OH 44112-1215.
  Moe's is a current trade name of the shop (Nour, 2026-11-06), not stale.
- Branch information is shown on User Settings: branch code, branch manager name, branch phone and branch
  manager email (contact details not copied here).
- Footer build tag `[.28.186]`; language switch English / Español / Français.

## 1. Global structure

- **Header bar:** a promotion progress pill **"$X - N entries"** on a track ending at **$1,000** (tooltip
  "Suite-Stakes - Click for more information"; element id `FederatedPromotionsTrackerAmount`): purchases this
  period are converted into sweepstakes entries and shown as progress toward a spend threshold. A hidden truck
  icon "You have unprocessed VIC Orders" (meaning of VIC UNKNOWN; not shown because none are pending). A running
  cart total ("Running Total for Items in the Cart") with item-count badge, the account number, and a hamburger
  mega-menu.
- **Mega-menu** with its own **"Find Menu Items"** search box, grouped: Admin Tools (Fleet Management, List
  Ordering), Tools & Services (Help Center, Message Center, Quotes, Reset Password, Stock Order, Car Care
  Program (Installer), Product Knowledge (Videos/Sell Sheets), Sales and Promotions, VOC/EPA - Regulated Sales),
  Catalog (Category Management), Account Info (Invoices, Order History, Statements, User Settings), **Recents**
  (last pages used), Logout. A "Forgot your Identifix Password?" link shows the catalog is wired to Identifix
  repair information.
- Rotating promo banner (Toys for Tots, Mobil 1 sale, a "Race to Sebring" customer promotion, a scholarship, an
  "URGENT ATEQ TPMS TOOLS UPDATE" program notice).
- Footer: **Hide Cost** checkbox on every page (same counter-safe idea as Capital Tire, 24 section 4).

## 2. One search box, five modes

A mode dropdown left of the search box (OBSERVED): **Item Search** (part number), **Interchange** (competitor or
OE number), **VIN**, **Plate in [state]** (state pre-set to Ohio), **Vehicle** (description). Three icon tabs
beside it: Cars & Trucks catalog; **previously selected vehicles** (a per-user recent-vehicle list, each row
year/make/model plus full engine descriptor, with a barcode icon on vehicles that came from a VIN decode); and
"select one of your Catalogs".

VIN test with the public sample VIN `1HGCM82633A004352` decoded straight to **2003 Honda Accord 3.0L V6 SOHC GAS
FI J30A4** and opened the part-category picker in one step.

## 3. Vehicle picker (Year / Make / Model / Engine)

Four side-by-side columns; each pick turns orange with an X to undo. Years go back to 1896 and makes include
hundreds of historical and foreign marques; Mexico- and Canada-market models carry a flag icon (and User
Settings can hide them). The engine column lists full descriptors with engine code and output (e.g. "2.4L L4
DOHC GAS DI FI K24W9 184hp/137kw") plus "Proceed to Catalog - No engine selection". Test vehicle: 2018 Honda
CR-V (generic, not a customer's).

## 4. Part selection: three panes, three tabs

- Panes: **Category** | **Part Type** (with a type-ahead filter that searches all categories, a **By
  Popularity** sort, and a notes icon) | **Selected Parts** (a basket of part types, Clear All, then **Next**).
  Several part types can be picked at once and searched together.
- Tabs: **Main Categories**; **Total Job** (job templates such as A/C Compressor, Alternator, Ball Joint,
  **Brake Replacement**, CV Shaft, Fuel Pump, Head Gasket, Water/Oil/Power Steering Pump replacement - picking
  Brake Replacement pre-selected hose, master cylinder, caliper, caliper pin kit, pad set and rotor, each
  removable); **Custom Categories** (shop-defined groups of part types, built under Category Management:
  Categories | Selected Part Types | All Part Types with search, plus Update. That page showed an empty
  "User Notice: error:" popup on load - a vendor bug).

## 5. Parts results

One collapsible section per selected part type (orange header with a **Discrepancy** link for the whole type).
Facet filters per section: Brand, Position (Front/Rear), EngineBase. An **In Stock** toggle in the vehicle bar.
Per part row:

- Brand | part number | part type; Mfr Code (line code, e.g. SSR, BRM, RAY), MfrLabel (product line), Note
  (e.g. "Includes Hardware; OE Material Is Ceramic"), Position, YearRange, product image and brand logo, a
  product-info link.
- **Cost** and **List** (some rows show "N/A" for both - catalogued but not priced for this account);
  **On Hand: n** with a green dot (or 0); **Alt Locations**; Qty box; **Add To Cart**.
- Row actions: **Lost Sale**, **Discrepancy**, **Interchange**, **Buyer's Guide**.

Test results for 2018 CR-V 2.4L: 17 brake pad sets across 7 brands and 15 rotors across 3 brands; only a few
SKUs on hand at the home store. (Per-SKU prices not recorded.)

### 5a. Alt Locations (the delivery/inventory model)

Modal "Alternate Locations" for the SKU, columns **Location | List | Sell | Core | Qty | qty box | Add**
(OBSERVED). Rows: the home store **C185OH**, six more Fisher Auto Parts stores (codes STCLOH, SEUCOH, WICKOH,
WILBOH, MNTROH, HMAVOH), **OH Warehouse**, **KY Warehouse**, **Staunton Warehouse**, **PA Warehouse**, and
**Federated Co-Man** (the co-op level). Green dot = in stock there; a **phone icon** replaces the dot where qty
is 0 (call to source). Price and core are the same at every location for the SKU checked. Only the home
store's Add button was active; the others were greyed (INFERRED: online orders go through the home store;
whether a greyed row becomes orderable when selected is UNKNOWN and was not tested).

**No ETA, delivery time, or order cutoff appears anywhere** (results, Alt Locations, cart). User Settings
offers an **Alternate Location Display** mode: As Popup (default) / Next Location with Inventory / **Up to 6 on
Parts page** (shows nearby-store stock inline on the results row).

### 5b. Interchange and Buyer's Guide

- **Interchange <part#>**: filter by part type and brand; rows list brand, part type, cross-referenced part
  number (competitor brands, retailer numbers such as Advance Auto, and OE Honda numbers), each with its own
  Interchange link; legend **Primary** vs **Secondary** interchange; part numbers this store carries are shown
  bold/linked. A yellow disclaimer: interchange is "a suggestion ... not a judgment or statement of equivalent
  or functional application."
- **Active Buyer's Guide**: reverse fitment - every Make / Model / Year / Engine the part fits (the test pad
  fit Acura ADX and Honda Clarity, CR-V, HR-V, 2017-2025).

### 5c. Lost Sale and Discrepancy (store-side capture)

Clicking **Lost Sale** on a row opens a Reason list: **Insufficient quantity on hand / Not on master inventory /
Out of stock (no minimum set) / Price too high** (dismissed without choosing - a click likely records
immediately). These are the store's reasons for its own stocking decisions, the counterpart of Capital Tire's
dealer-facing version (24 section 10). **Discrepancy** reports a catalog error for a part or a whole part type
(form not opened).

## 6. Cart = parts + labor quote

`/cart/view.aspx` keeps the current vehicle and a link back to the search results. Besides parts, it has
**"Quote Specific Items"** (Description, Rate, Units, Add) for labor or misc lines, a **Start Quote** button,
a **Subtotal** ("Does not include tax"), **PO number**, **comments**, and **Place Order**. User Settings stores a
shop **Labor Rate** (populated) and a hidden transaction-type selector **Estimate / Work Order / Invoice**
(INFERRED: the quote can become a shop document). In other words the parts portal can build the customer's
estimate - the same job Shop OS is meant to own.

## 7. Ordering paths

- **Stock Order**: Order from (home store only), Account, **Running Order** (a persistent open stock order; "None
  Found"), **Upload/Paste** with delimiter (comma or pipe) and format (Mfr Code + Part + Qty / Part + Qty / Part
  only), Create List, Clear, Delete; grid Mfr Code, Part Number, Qty, Description, Location, List, Cost, Core,
  **QOH**.
- **List Ordering**: Workflow (**Stock Order** or **Running List**), list and location selectors, PO Number,
  Comment, then line entry Mfr Code + Part Number (required) + qty.
- **Quotes**: Account, Quote Date range, Quote No; no records.
- **Fleet Management**: Fleets list with search and **New Fleet** (empty) - fleet accounts tracked inside the
  parts portal.
- **Message Center**: split inbox/preview pane; empty.

## 8. Account and accounting

- **Order History**: Account, Order Date range, Order Number, Location, More Filters.
- **Invoices**: Account, Invoice, Date Range presets (Current/Last Month, Week, Year, Today, Yesterday, Last
  30/60/90/120 Days, Custom), **PO Number**, **Part Number**, **Charge Type** (Charge, Cash, Check, Visa,
  Mastercard, AmEx, Discover, Paid, Paid Out, Split Payment Sale, Credit, Refund), Location, Format type.
  Results: Type, Invoice, Date, Account, Billing Location, PO Number, Qty, Total, a PDF icon, and an expander
  that shows the invoice's lines inline (Qty, Line Cd., Part No., Description, List, Cost, Ext.). The last
  month showed several dozen small invoices (values not recorded) - the shop buys parts many times a week.
- **Statements**: Account, Location, Statement Date range.
- **User Settings** (not saved): account info, license agreement, branch info, **Reset Manager Password**
  (a manager vs staff user split exists), and **Catalog Options**: Catalog Region (the regional warehouse),
  Hide Cost, Hide Mexican Vehicle, Hide Canadian Vehicle, Alternate Location Display, **Labor Rate**, **Hide
  Invoices & Statements** (keep accounting away from counter users), **Require PO**, **Identifix Access**
  (Username/Password or Dealer), **Landing Page** (choose any menu page as the start screen).

## 9. Not reached (after the gap-closing pass in section 11)

Plate lookup (not submitted - plates are customer data); Start Quote and Place Order (would create records);
whether greyed Alt Location rows can be ordered (would mean trying to order); the Identifix hand-off (needs a
separate login); and what "VIC Orders" are - the Help Center returned **503 Service Temporarily Unavailable**
during the pass and a web search found nothing, so it stays UNKNOWN (ask the Fisher branch).

## 10. What changes elsewhere in the plan

1. [14-STOLEN-MECHANISMS](14-STOLEN-MECHANISMS.md) rows 27-32: Total Job part kits; Interchange + Buyer's Guide;
   catalog discrepancy reporting; the three-pane multi-part-type picker with per-type facets; one search box
   with five modes plus a VIN-tagged recent-vehicle list; and the warning that vendor carts now build labor
   quotes.
2. [03-VENDORS](03-VENDORS.md): Federated is the first parts vendor in the cross-supplier evidence and shows the
   same shape as Capital Tire - exact stock at many named locations, home-store-only online ordering, no ETA -
   so the location/arrival split (correction 6) is not a tire quirk; it is the norm.
3. [26-VENDOR-SCHEMATICS](26-VENDOR-SCHEMATICS.md) consolidates all five audits into the fields and objects the
   build must implement.
4. Ask the Fisher branch the same three questions as Capital Tire: delivery runs and cutoffs from C185OH, how
   fast a part moves from another Fisher store or a warehouse, and whether those can be ordered online.

## 11. Gap-closing pass (same day, Nour's request: "Finish Federated gaps")

**Interchange search mode (OBSERVED).** Searching the Advance Auto pad number `PXD2036H` returned every
equivalent the catalog knows (ADVICS, PowerStop, Raybestos, SST, Wagner, plus pad-and-hardware kits), each graded
primary or secondary, with the disclaimer banner - and a **live green stock dot only on the equivalent the home
store has on hand** (SST D2036C). This is the "customer walks in with an AutoZone/Advance quote" flow: competitor
number in, what-we-can-sell-today out.

**Item Search mode.** Part number `D2036C` returns the single row with three provenance icons, all labeled in
the page: a book icon **"Item found in Catalog data."**, a star **"This Brand is a Primary Brand"** (the store's
preferred line), and on the stock figure **"Information supplied by Member's System"** (price and on-hand come
from the Fisher store's own system, not Federated's catalog). The Part Type pane also has **"Report missing Part
Type for selected vehicle"** (the speech-bubble icon), and By Popularity is a sort toggle.

**Catalog Discrepancy Feedback form (opened, cancelled, nothing saved).** One dialog for both report types:
Type (**Lost Sale** or **Catalog Discrepancy**) -> Reason -> Optional Information -> contact info + Comment,
with **a screenshot of the part row auto-attached** as a thumbnail. Lost Sale reasons: Insufficient quantity on
hand / Not on master inventory / Out of stock (no minimum set) / Price too high. Catalog Discrepancy reasons:
Incorrect Image / Incorrect Part Application. Optional information for both: **Price** and **Competitor**
(Advance Auto, AutoZone, eBay, NAPA, O'Reilly, Rock Auto, or Enter Other). Save stays disabled until a reason is
picked.

**Catalog selector (third icon).** Non-vehicle catalogs: **Commodities** (shop supplies - absorbents,
additives, antifreeze, batteries, brake fluid, cleaners, DEF, oil by viscosity, refrigerant oil, transmission
fluids...) and **Paint & Body Supplies**, in the same three-pane layout (Category | Sub-category with
type-ahead | Selected Sub-Categories).

**Suite-Stakes (public rules page, opened in a new tab, then closed).** Federated's Aug 1 - Oct 31 2026 trade
promotion for registered installer customers: 1 entry for registering; **5 entries per $1,000 of "supporting
vendor" purchases per month**; **5 more per $500 of "strategic vendor" purchases** once the $1,000 monthly
threshold is met; **entries double in any month that is up 10% or more on the same month last year**. Drawing on
or about Nov 6 2026; prizes range from gift cards and tools to trips. The header pill ("$X - N entries" against
a $1,000 track) is this month's progress toward that threshold. Whether Nick's registered is not shown.

**Car Care Program (installer view).** Federated's nationwide network of independent shops. Member benefits:
**Nationwide Warranty** (12 month/12,000 mile and 24/24 terms, three coverage levels, enrollment required),
**180-day roadside assistance** for the shop's customers, Tire and Road Hazard plans (incl. AWD), signage,
on-hold messaging, business website, MechanicNet (Epicor) customer-retention marketing, AutoPass instant
customer credit, lease financing, training (ASE reimbursement), Cintas, insurance. A document library lists
each with start/end dates. Whether Nick's is enrolled is UNKNOWN.

**Product Knowledge.** Manufacturer training videos and webinars (SMP monthly webinar, K-Seal Academy, AP
Exhaust catalytic converter clinic, BBB/SilentStop, KYB) and sell sheets (oil API/ILSAC standards, 1234yf
refrigerant facts, Littelfuse chart, product features and benefits).

**Sales and Promotions.** Current flyers (Installer, Farm/Fleet/Marine, Paint & Body, Tools & Equipment), all
valid through 12/30/2026, store-branded (Fisher Auto Parts).

**VOC/EPA - Regulated Sales.** A static list, by manufacturer line code, of part numbers that **cannot be stocked
or sold in listed states** (several CRC, 3M and Gunk chemicals list **OH**), lead wheel weights banned in IL,
MD, NY and VT, plus links to each state's VOC rules. It is a page, not a flag on the catalog row - nothing stops
an Ohio shop from adding a restricted item to the cart.

**Help Center:** returned 503 during the pass (vendor outage).

## Redaction note

No customer PII, credentials or session tokens appear above. The recent-vehicle list (real customer vehicles,
year/make/model only) is described, not copied. Per-SKU costs, invoice values, the promotion amount, the labor
rate value and branch staff names are not recorded. The only inputs typed were a generic vehicle (2018 Honda
CR-V) and a public sample VIN.

## Safety note

Read-only, on-screen navigation of Nour's own session. Nothing was added to the cart, no quote started, no
order placed, no lost-sale reason or discrepancy submitted, no setting saved, no password entered. Selected
Parts baskets were cleared after use. The VIN test added the sample vehicle to the account's recent-vehicle
list (harmless, can be ignored). The browser window was resized for a desktop layout.
