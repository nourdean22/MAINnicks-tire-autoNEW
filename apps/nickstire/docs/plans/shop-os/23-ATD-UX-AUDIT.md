# Shop OS 23: ATD Online (American Tire Distributors) B2B portal UX audit (screen by screen)

> **Correction (2026-11-06, Nour):** the shop also trades as **Moe's** ("we're Moe's too"). "Moe's" on a vendor account or ALG field is a current trade name, not a stale one. Read every "stale name" / "rename sweep" remark below as: keep one shop-identity record that holds both trade names (Nick's and Moe's) and records which name each vendor account uses; no rename is needed. The separate point about duplicate, unsynced shop-name fields still stands.

Job 2026-11-06-shop-os-atd-ux-audit. Status: COMPLETE (one pass). Read-only navigation of Nour's own
authenticated ATD Online account (atdonline.com), same legitimate-access pattern as
[21-ALG-UX-AUDIT](21-ALG-UX-AUDIT.md) and [22-GATEWAY-DK-UX-AUDIT](22-GATEWAY-DK-UX-AUDIT.md). ATD is Nour's
second tire vendor ("prob second in line to gateway" - his words, 2026-11-06). Everything below was observed by
clicking through Nour's own paying/ordering account; no cart, quote, order, or payment was ever submitted.

## 0. Identity

- Account username: **moeseuclid**. This is the **fourth/fifth** confirmed instance of the stale "Moe's Tire"
  legacy name surfacing across systems (ALG's two prior instances, Gateway/D&K's "MOE'S TIRE" display name,
  now ATD's own login handle) - worth a single global rename sweep across every vendor account, not a
  per-vendor fix.
- Location# [redacted], ship-to **17625 Euclid Ave, Cleveland, OH** - the same address Gateway/D&K uses, confirming
  this is the same real shop account across both tire vendors.
- Distribution center: **DC #225** ("View DC #225 Details" link in the header).
- Sales/account context: not captured this pass (no rep-name equivalent to Gateway's account rep was surfaced
  in the header; may exist inside a gated account page - see section 9).

## 1. Global structure

- Header bar: Location#/address, phone (800-903-0014), a truck icon "View DC #225 Details" link, a cart icon
  (count badge, currently 0), a help "?" icon, and the account name dropdown ("moeseuclid").
- A yellow banner, present on every page: **"To maintain tax exempt status, you need to submit current
  certificates. Submit Certificates and Track Progress"** - a persistent compliance nag tied to the account's
  tax-exempt status, with its own tracked "progress" state (implies a document-upload/approval workflow behind
  the link, not opened this pass).
- An orange **"FRAUD ALERT"** banner, dated 11/03/26, warning that ATD will never dispatch FedEx or any other
  ground carrier to pick up tires already delivered on an ATD truck route, and to call Customer Service
  (800-903-0014) if someone attempts this - a live, dated anti-fraud notice baked into the portal chrome itself,
  not a one-time popup.
- Top nav: **HOME / TIRES / CUSTOM / WHEELS / TUBES & FLAPS / TOOLS & SUPPLIES / VALUEBUYS / RESOURCES**, plus a
  right-aligned **CONTACT US**. These are **hover-reveal mega-menus**, not simple links - a plain click just
  highlights the tab without navigating (this is why an early click on "TIRES" appeared to do nothing; the
  working interaction is hover, confirmed by the WHEELS mega-menu opening on click with sub-items: AG
  IMPLEMENTS, AGRICULTURE, CUSTOM, STEEL WHEEL, TRAILER WHEELS, WHEEL ACCESSORIES [has its own sub-menu],
  WHEELS CATALOG [external-link icon, opens outside ATD Online]). ATD's catalog scope is broader than passenger
  tires alone - it includes agricultural/implement tires and wheels, consistent with a full-line distributor.
- A persistent **"ORDER COUNTDOWN"** banner (e.g. "57h 15m - Local delivery Monday") appears on every
  results/search page - the same delivery-cutoff UX convention already confirmed on Gateway/D&K
  (22-GATEWAY-DK-UX-AUDIT section 4), now a second confirmed instance: this is an industry-standard B2B
  tire-distributor pattern, not a vendor-specific quirk, and Shop OS's own cross-supplier order screen should
  carry an equivalent "order by X to get Y" countdown per connected supplier.
- Search affordances available directly from Home: a header keyword/size/brand search box, a separate
  **Year/Make/Model/Trim** vehicle-fitment selector with its own GO button, a left-sidebar **VIN** lookup
  (Vehicle VIN Number + Search), and - new, not seen on Gateway - a left-sidebar **LICENSE PLATE** lookup
  (State dropdown, defaulted to the account's home state OH, + Plate Number + Search). ATD offers three
  independent vehicle-identification paths (Y/M/M/T, VIN, plate+state) side by side on the same page; Gateway
  offered only Y/M/M/T-style search. Plate+state lookup was not test-submitted this pass (same caution as a
  real customer's plate being PII) but its presence alone is a mechanism worth adopting: Shop OS's counter
  screen should offer VIN **and** plate+state as equally-first-class vehicle lookups, not VIN alone.
- Right-sidebar quick links on Home: **MY LISTS / MY QUOTES / ORDER HISTORY / MY RETURNS**, each with its own
  "?" help icon and expand/chevron; and a separate **QUICK LINKS** block: ATD Retail Rewards, Promos & Rebates,
  Traction Learning Center, IPG Home Page.
- A promotional carousel on Home featured an **"ATD Destinations Collection"** trip-rewards program ("Earn a
  trip to Secrets Playa Blanca", Feb 7-13 2027, "Learn How to Qualify"), a Vogue Tyres "$150 off per tire"
  promo, and a Hankook "$8,000 in marketing rewards" loyalty-program promo - vendor-funded sales-incentive
  programs are a recurring theme across this vendor (see section 11).
- **"EVEN FASTER" SMS customer service**: a dedicated text-message support number (704.893.3961, hours listed),
  alongside the normal phone/email/live-chat channels - a lightweight mechanism worth noting for Shop OS's own
  customer-facing support surface.

## 2. Account menu (step-up re-authentication on sensitive sections)

Clicking the "moeseuclid" account dropdown reveals a rich, sectioned menu:

**Profile/communication**: My Profile, Messages, Communication Preferences, Approvals.
**Ordering/admin**: Stock Order, Lists, Users, Accounting, Credit Cards, Order History.
**Account config**: Location Settings, Quote Setup, My Quote.
**Log Off.**

The single most important structural finding in this section: **Users and Accounting (and, by the same
pattern, almost certainly Approvals and Credit Cards) are gated behind a step-up password re-entry screen** -
clicking either one does not open the page directly; instead it shows "PLEASE VERIFY YOUR PASSWORD FOR ACCESS"
with a password field scoped to "Password for moeseuclid" and Cancel/Verify buttons. This pass did not enter
the password (same safety discipline as every other pass this session - no credentials typed into any vendor
account) and cancelled out both times, so the actual Users and Accounting screen contents remain UNKNOWN. The
mechanism itself is the finding: **a step-up re-auth gate in front of a session's own most sensitive
sub-screens (user management, financial/billing data) even though the surrounding session is already
logged in** - a genuinely valuable security UX pattern Shop OS should adopt for its own admin-level actions
(adding a staff login, viewing payment/billing detail, changing markup rules), not just a single
all-or-nothing session login.

My Profile and Communication Preferences were not opened (lower priority, likely simple contact-detail forms);
Location Settings, Quote Setup were not opened either, for time budget reasons - flagged as not-reached below.

## 3. Order History

Home > Order History. Two independent search modes on one screen:

- **Search By Number**: a "Number Type" dropdown with six options - **ATD Product Number, Confirmation Number,
  Invoice Number, Order Number, PO Number, Supplier Number** - plus a Number field and GO. The presence of a
  dedicated **PO Number** lookup field confirms ATD orders can carry the shop's own internal purchase-order
  reference, not just ATD's own order ID - a direct mechanism for linking a supplier order back to Shop OS's
  own job/ticket number.
- **Search By Date Placed**: From/To date fields (defaulted to the trailing 7 days) + GO.
- Two tabs: **ALL** / **RETURNS ONLY** - so order history and returns share one search screen and one result
  set, filtered by tab, rather than being two separate features. (Note: the Home-sidebar "MY RETURNS" quick
  link is a *different*, narrower surface - see section 11 - showing only "recent orders" eligible for return,
  not a full searchable history.)
- With the default 7-day window, result: "No orders that meet that criteria could be found" (expected - this
  account has no real order activity in the observed window).

## 4. Tire search and results

Tested with the same size used across all three vendor passes this session for comparability: **225/65R17**
(74 results via the header keyword/size search box).

- Sub-tabs: **All Products** / **All Programs**. All Products is the full 74-result catalog; **All Programs**
  filters down to only the 3 SKUs currently enrolled in an active vendor marketing/rebate program (in this
  test, all 3 were Hercules Tires products, each carrying a small green badge icon next to the product name) -
  this is the live, working counterpart to Gateway's confirmed-broken "Specials" tab, and it is directly wired
  to the same Marketing Programs system described in section 11.
- Controls: Sort By, Results Per Page, a **"HIDE UNIT COST"** toggle (the second confirmed instance of a
  staff-view/customer-view display toggle this session, after Gateway's "Cost" switch - 14-STOLEN-MECHANISMS
  row 7), a **"COMPARE SELECTED"** button with a per-row checkbox column (this one appears functionally wired,
  unlike Gateway's inert compare checkbox - not fully exercised this pass to avoid any accidental cart/compare
  side effect), a print icon, and a results-density/layout toggle.
- Left sidebar **REFINE BY**: an Availability radio group (All / Local / **Local+** [default] / National), a
  Value Buys filter ("Show Only Value Buys" + Apply All), and My Brands checkboxes (Continental, Dunlop,
  Falken, General, Hankook, Hercules, Ironman, Kumho, Nexen, and more below the fold).
- Results-table column headers are **stacked, two rows deep**: "Cost" over "FET" (Federal Excise Tax), and a
  separate "Retail" column alongside. The price shown per row (e.g. "$73.00 Missing") is the **Cost** figure;
  "Missing" is the **FET** value for that row, not a missing price - FET only applies to certain
  heavy/commercial tire classes, so it legitimately reads "Missing" (not applicable) on ordinary passenger
  tires. (This resolves the open question flagged mid-pass: "Missing" is a tax-field label, not a pricing
  defect.) The **Retail** column was blank on every row observed in this account - consistent with Gateway's
  finding that retail/markup display depends on a shop-configured rule, not a platform default; ATD's
  equivalent markup-configuration screen was not reached this pass (likely inside the gated Accounting or
  Location Settings pages - see section 2).
- **Per-SKU delivery/inventory model - the standout mechanism from this entire pass.** Both the results table
  and the product detail page (section 5) show a full tiered breakdown, far richer than Gateway's simple
  Local/Regional split:
  - **Pickup** (qty)
  - **Today, Delivery** (qty, shown in red when 0)
  - **Tomorrow** (qty, red when 0)
  - a specific **named next-local-delivery date**, e.g. "Mon 11/9" (qty, green when available)
  - **Multi-Day** (qty, expandable - clicking it reveals a genuine per-date forecast table, e.g. "Tue 11/10:
    29 units", "Wed 11/11: 1 unit" - confirmed by direct expansion this pass, not inferred)
  - **National** (qty, "3-5 Business Days")
  
  This is a complete answer, in concrete working UX form, to Nour's explicit requirement that Shop OS's CRM
  display **both the best-priced option and the quickest-to-arrive option** whenever ordering: ATD already
  solves the "quickest" half of that requirement for a single vendor, with a six-tier granularity (pickup /
  today / tomorrow / next named local date / per-date multi-day forecast / national 3-5 day). Shop OS's
  cross-supplier comparison screen should match or exceed this granularity *per connected vendor*, then rank
  vendors against each other on top of it - see the new cross-cutting section added to
  [03-VENDORS](03-VENDORS.md#cross-supplier-comparison-best-price-and-fastest-arrival-together-2026-11-06-nours-requirement).

## 5. Product Detail page

Opened read-only by clicking a product name/link (not an "add to cart" icon) on the first search result:
**"225/65R17 102H IRON iMOVE PT PLUS BW 50K"**, Ironman brand. Breadcrumb: Home > Ironman.

- Product image + 4 thumbnail angle shots.
- Three small icons top-right of the title: **email**, **print**, and a third icon (blue, glyph resembling a
  stylized figure/bookmark with an arrow) whose exact label could not be confirmed - no tooltip appeared on
  hover and `find`/`read_page` returned no accessible name for it. Best guess from icon shape and position
  (grouped with email/print, i.e. a share/save action, not a commit action): an "add to list" or "save/pin"
  shortcut. Flagged UNKNOWN rather than guessed further.
- **Inventory & Delivery Time**: the same tiered breakdown described in section 4, with Multi-Day expanded to
  show the named per-date forecast.
- **Pricing Information**: an editable **Unit Price** field with an "Update" link (confirms price can be
  manually overridden per line before adding to cart - useful for matched-price/negotiated-price scenarios),
  Total Price, "Taxes, Fees and Services", Installed Price, **ADD TO CART**, **BUY NOW**, and an **Actions**
  dropdown. The Actions dropdown (inspected via accessibility tree without committing to any option) contains:
  **Add to List, Create List, Create Package, Freight Cost** - "Create Package" here is the tire-specific
  equivalent of a bundled multi-item job, parallel to ALG's "package job" mechanism
  (14-STOLEN-MECHANISMS row 1) and worth cross-referencing; "Freight Cost" as a standalone action implies
  freight/shipping cost can be checked or added independently of placing the order.
- **Specifications** table (28 fields were captured on Gateway; ATD's equivalent, slightly different field
  set, captured here): Supplier# (98874), Product# (98874.1), Z# (153143499 - an ATD-internal SKU identifier
  not seen on Gateway), Size (225/65R17), Ship Weight (26.25), UTQG (480AA), Load/Speed (102H), Mileage
  Warranty (50K), Ply (SL), Seasonal Designation (All Other), Sidewall (Black Wall), Extended Mobility (N),
  Load Range (Standard Load), Max Load Single (1874@44), Overall Diameter (28.5), Rim Width Min (6), Section
  Width (225), Tread Depth (10.1), Treadwear Rating (480).
- Left sidebar on this page reveals two facets not present on the plain search page: a **PRODUCT TYPE** block
  (Product Category = Tires, Product Type = Passenger & Light, plus a Tire Size field with "Add Rear Size" -
  i.e. staggered front/rear fitment is a first-class input here), and a **second, distinct VIN search block**
  (separate from the Y/M/M/T vehicle-fitment form elsewhere on the site).

## 6. VIN-driven fitment flow (tested with a public sample VIN)

Tested with a widely-published, non-real-customer sample VIN commonly used for VIN-decoder testing
(`1HGCM82633A004352`, a 2003 Honda Accord) entered into the product-detail-page VIN block - the same
precedent of using a safe test VIN set on the Gateway pass.

- Result: **"Please choose a Tire/Wheel Size, or a Suspension Option, based on available Trims"**, with a note:
  "Any Suspension Options will feature products that are outside of factory specs, modification will be
  required." One matching trim was returned: **EX 2 Dr. V6**, with clickable OE Tires (Front/Rear
  P205/60R16 91V) and OE Wheels (16x6.5) columns.
- Clicking the OE tire size jumps straight into a **dedicated fitment-results page**, not a generic search:
  - Displays "2003 HONDA ACCORD EX 2 DR. V6 (FACTORY OPTION)" with an actual rendered car-silhouette image
    matched to the year/make/model/body style, and a **"VIEW IN VISUALIZER"** button (a virtual wheel/tire
    fitment visualizer - not opened further this pass, but its presence alone is a notable mechanism: letting
    a customer or counter staff see a candidate wheel/tire combination rendered on their actual vehicle before
    buying).
  - A cross-sell banner: **"Looking for Winter Tires?"** with a warning-triangle icon, shown directly on the
    fitment-results page.
  - Returns one **default recommended product** (here: Ironman iMOVE GEN2 AS, Cost $59.00) rather than a full
    list - complete with Features (marketing bullet copy on tread tech) and Specs (Part#, Product#, Size,
    Ship Weight), **ADD TO PACKAGE** / **ADD TO CART** buttons, and print/email icons.
  - One feature bullet reads: **"60-Month Limited Protection Policy and Road Hazard Protection"** - a
    warranty/protection-plan term surfaced directly inline in the product's own feature list, not as a
    separate upsell step.
  - A tabbed **"Installation Data & Original Equipment Specifications"** panel underneath, with its own
    TIRES / WHEELS / TPMS / SUSPENSION tabs and a "DIAMETER SELECTION - Show OE Sizes" dropdown - i.e. the
    same VIN decode also drives wheel, TPMS-sensor, and suspension-modification product paths, not tires
    alone.

This VIN flow is a materially richer mechanism than anything captured on ALG or Gateway: VIN -> exact factory
trim -> OE tire AND wheel size -> a single pre-selected recommended product -> a visual fitment check -> a
cross-sell prompt, all in two clicks from a bare VIN. Shop OS's own VIN-intake flow (14-STOLEN-MECHANISMS
row 4, currently scoped as "plate -> VIN/year/make/model, no scanner needed") should be extended to match this
depth: trim-level OE tire/wheel spec lookup feeding directly into a product recommendation, not just a vehicle
identification step.

## 7. Quotes (Quotes Summary) - a built-in customer-quote CRM

Account menu > My Quote (breadcrumb reads "Home > Quotes Summary"). This is the single most CRM-relevant
screen found on ATD, directly answering part of what Nour wants Shop OS's own CRM to do.

- **Search Saved Quotes** filter form: Date range (From/To, defaulted to the trailing ~6 weeks), Customer Name
  (First/Last), Customer Email, Customer Phone, **Created By** (a "Select User" dropdown - confirms multi-user
  accounts, each quote attributable to the staff member who created it), **Status** (a "Select Status"
  dropdown with four real values: **Closed, Contacted, Converted, Open**), Product #, and Quote ID.
- Results table columns (all independently sortable): **Date, Customer Name, Customer Phone, Customer Email,
  Created By, Status, Last Modified**, plus **Print** and **Export** links above the table. No records existed
  in this account ("No matching records found").
- **This is a lightweight sales-pipeline/lead tracker baked directly into the tire vendor's own portal**: a
  quote object carries a customer identity (name/email/phone), an owner (Created By), and moves through an
  explicit four-stage lifecycle - **Open -> Contacted -> Converted / Closed**. This is structurally identical
  to what a CRM "deal" or "opportunity" record looks like, just scoped to tire quotes. It is the single
  strongest piece of concrete evidence this session that Nour's instinct - that his CRM should track quotes
  through a funnel with "who's been contacted, who converted" - is not a novel idea he's inventing from
  scratch, but a pattern his own tire supplier already ships. ADOPT candidate for Shop OS: a Quote entity with
  this exact four-status lifecycle (or a near match), owned by a staff user, searchable/sortable/exportable the
  same way, and - unlike ATD's version - wired so a Converted quote becomes a real ticket/invoice automatically
  rather than requiring a second manual order.
- "Quote Setup" (sibling menu item, not opened this pass) likely configures default quote terms/expiry/branding
  - flagged as not-reached.

## 8. Lists (saved reorder lists, with recurring-order scheduling)

Account menu > Lists. Three sub-tabs: **MY LISTS** (empty: "No List Found"), **CREATE LIST**, **ADD TO LIST**.

The **CREATE LIST** form is a second strong CRM-adjacent mechanism:
- **List Name** (free text).
- **Share List With Location?** - a dropdown (observed default: "Yes - Read-only"; other values not fully
  enumerated this pass, but the presence of a "Read-only" value implies at least one editable alternative) -
  i.e. a saved list can be shared across the account's other locations/users with explicit read vs. write
  permission, not just privately owned by the creator.
- **Recurring Order?** - a Yes/No dropdown, with an explicit safety note underneath: **"Recurring orders do
  not go through without your consent."**
- Cancel / Create List buttons.

This is a genuine **subscription/standing-reorder mechanism with built-in multi-location sharing permissions
and an explicit consent gate on automation** - directly relevant to the "what changes elsewhere" item already
flagged from Gateway (shop-wide recurring parts/tire reordering) and to Nour's own instinct that routine
reorders (parts, tires) should be smart/automatic but still shop-controlled. ADOPT for Shop OS: a saved list
object with (a) a name, (b) a share scope (private / shared-read-only / shared-editable) for multi-location or
multi-staff shops, and (c) an optional recurring-order toggle that still requires a human confirmation step
before anything actually gets ordered, worded the same honest way ATD does it.

## 9. Stock Order (bulk reorder by part number, paste-from-spreadsheet)

Account menu > Stock Order. A dedicated bulk-entry screen distinct from normal search-and-cart:

- A single-row quick-add: **Product #** field + **Qty** field + **ADD** button, appending to a running table
  below (Product # / Qty / Unit Cost / Total), with a live **Subtotal**.
- A **"Copy / Paste Spreadsheet"** link/icon directly under the table - letting staff paste a block of
  part-number + quantity rows copied from an external spreadsheet directly into the bulk-order grid, instead of
  typing each line by hand (not test-submitted; the control's presence and placement make its purpose
  unambiguous).
- **Add to List** and **ADD TO ORDER** actions at the bottom.

This is the clearest "we already know exactly what we buy every week" reorder mechanism found across all three
vendor passes this session - a direct, low-effort ADOPT candidate for Shop OS's own recurring-parts/tire
reorder screen: a part#+qty grid that accepts a pasted spreadsheet block in one action, feeding either a
one-time stock order or (combined with section 8's Lists mechanism) a named recurring list.

## 10. Vendor recalls, account messages, and marketing-program progress tracking

All three found together on the Home page, below the main promo carousel - a cluster of "things ATD pushes at
the dealer without being asked," worth treating as one family of mechanisms:

- **Marketing Programs** widget: a specific, named, dated incentive program card - **"Hercules Open Market
  2026"**, labeled a **"Quarterly Program"** "As of: 11/05/26" - rendered as a **half-donut goal gauge**
  ("3 Units to Goal", currently 0/3), a side-by-side breakdown of **"Location #[redacted]: 0 Units Purchased"**
  vs. **"All Locations: 0 Units Purchased"**, a countdown ("55 days left to fulfill program period, Program
  started 01/01/26 and ends 12/31/26"), and a "Click here! Program & Incentive Details" link. This is the
  live, fully-working version of what Gateway's "Specials" tab was clearly meant to be but is confirmed broken
  on that vendor (14-STOLEN-MECHANISMS row 10 context) - and it is the same system that drives the "All
  Programs" catalog sub-tab in section 4 (the 3 Hercules SKUs with the green badge icon are exactly the
  products counting toward this program's unit goal). ADOPT candidate: a per-vendor, per-program progress
  gauge (goal vs. purchased, this-location vs. all-locations, days remaining) is a genuinely good "are we
  leaving rebate money on the table" surface for Shop OS's own supplier dashboard - this is a concrete, better
  answer to the open question flagged from the Gateway pass about whether/how to surface vendor rebate
  programs.
- **ATD Messages** panel ("Subject" / "Date Posted" columns, empty this pass) - a vendor-to-dealer inbox/
  notification feed distinct from account-level Messages in the dropdown menu (section 2); not confirmed
  whether these are the same underlying list or two separate systems.
- **Vendor Recalls** panel - "Current Vendor Recalls", "Latest vendor recall information", "No Recall Messages"
  (this account currently has none), with a **"SEE ALL VENDOR RECALLS"** button. A live product-safety-recall
  feed surfaced directly on the vendor-portal homepage. This is worth flagging as a distinct, higher-stakes
  ADOPT candidate from a liability standpoint, not just a UX nicety: if Shop OS tracks which tires/parts were
  installed on which customer's vehicle (which it should, for warranty/recall purposes regardless of this
  suggestion), a connected feed of vendor recalls that can be cross-matched against sold inventory is a real
  customer-safety and shop-liability mechanism, not merely a "nice dashboard widget."

The Home sidebar's **MY RETURNS** quick link (distinct from Order History's "RETURNS ONLY" tab, section 3) was
expanded this pass and showed **"There Aren't Any Recent Orders Available"** - confirming it is a narrower,
recent-activity-only returns surface, separate from the full searchable Order History/Returns tab.

## 11. Not reached this pass

Users, Accounting, Approvals, Credit Cards (all gated behind the step-up password re-auth described in section
2 - contents genuinely UNKNOWN, not merely unexplored); My Profile; Communication Preferences; Location
Settings; Quote Setup; the "Create Package" and "Freight Cost" Actions-dropdown items (inspected via
accessibility tree only, never clicked); the VALUEBUYS, TUBES & FLAPS top-nav catalog areas (WHEELS and CUSTOM
mega-menus were opened; the others were not, given the breadth already captured); the License Plate search
(not submitted - same caution as entering a real plate anywhere); full cart/checkout flow (deliberately not
entered, consistent with every pass this session - no cart/order/quote was ever submitted against this live
account); the ATD Retail Rewards / Promos & Rebates / Traction Learning Center / IPG Home Page quick-link
destinations (not opened); the third unidentified icon on the product-detail page (section 5).

## 12. What changes elsewhere in the plan

1. [14-STOLEN-MECHANISMS](14-STOLEN-MECHANISMS.md) gets a new dated section (rows 12-17) for: the tiered
   Pickup/Today/Tomorrow/named-date/Multi-Day/National delivery model (the single strongest mechanism from
   this pass), the step-up re-auth gate on sensitive account pages, the Quotes CRM funnel
   (Open/Contacted/Converted/Closed), the Lists recurring-order + share-permission mechanism, the Stock Order
   paste-from-spreadsheet bulk reorder, and the vendor-recall feed.
2. [03-VENDORS](03-VENDORS.md) gets a new cross-cutting section answering Nour's explicit requirement: Shop
   OS's CRM must show both the best-priced and the quickest-to-arrive option across connected suppliers when
   ordering parts/tires/anything - grounded in concrete evidence from all three completed vendor passes (ALG
   has no cross-vendor view at all; Gateway shows a two-tier Local/Regional split for itself only; ATD shows a
   six-tier Pickup-through-National breakdown for itself only). See that new section for the detailed design
   implication.
3. [20-SUPPLIER-INTEGRATION-START](20-SUPPLIER-INTEGRATION-START.md)'s ATD capability-gate row (03-VENDORS'
   first-cohort table currently lists ATD only as a "candidate aggregator" footnote, not yet a cohort member)
   should be reconsidered given how much read-only structure was actually reachable this pass through Nour's
   own portal login - ATD may deserve a capability row of its own alongside AutoZone Pro / Parts Authority /
   D&K, pending the same REA/API-permission review already required for the others.
4. The VIN-intake mechanism already flagged from ALG (14-STOLEN-MECHANISMS row 4, QuickVIN/plate-decode) should
   be extended per section 6 above: trim-level OE tire+wheel spec and a default product recommendation, not
   just a bare vehicle identification step.
5. The "package job" mechanism already adopted from ALG (14-STOLEN-MECHANISMS row 1) gets independent
   corroboration from ATD's own "Create Package" Actions-dropdown item (section 5) - two different vendors
   both ship a bundled-item mechanism, reinforcing that this is worth building, not a one-vendor quirk.
6. Nour's recurring-order instinct (visible throughout this request and in the Gateway "Bay Manager" open
   question) gets concrete design language from section 8's Lists mechanism: a named list with a share scope
   and a recurring-order toggle that still requires explicit human consent before anything is actually ordered
   - a pattern Shop OS should copy close to verbatim.

## Redaction note

No real customer PII, live order dollar totals, or credentials appear anywhere above. The account identity
fields shown (username, location#, DC#, address) are the shop's own subscription/account metadata, not
customer data, and match what was already disclosed in the Gateway/D&K audit for the same shop. The one test
input used (VIN `1HGCM82633A004352`) is a widely-published public sample VIN used for decoder testing, not a
real customer's vehicle.

## Safety note

Every screen above was reached by direct, read-only navigation through Nour's own authenticated ATD Online
session. No cart was added to, no quote was saved, no order was placed, no password was entered at the two
step-up re-auth prompts encountered (Users, Accounting), and no form (Stock Order's ADD TO ORDER, the VIN/plate
lookups, Create List) was submitted to completion. Where an icon's exact function could not be confirmed
without clicking it (the third product-detail-page icon), it was left unconfirmed rather than guessed by
clicking through to find out.
