# Shop OS 27: Parts Authority / IMC Web Warehouse UX audit (screen by screen)

Job 2026-11-06-shop-os-parts-authority-ux-audit. Status: COMPLETE (one pass). Read-only, on-screen navigation of
Nour's own authenticated IMC Web Warehouse account (imcparts.net, "Web Warehouse Powered by PA | IMC"), same
pattern as [21](21-ALG-UX-AUDIT.md)-[25](25-FEDERATED-UX-AUDIT.md). Nour ranks Parts Authority as the most
important parts vendor: "usually the least expensive and have the most stuff and one of the fastest" (with
AutoZone, Federated and O'Reilly). No item was added to the cart, no job saved, no order, lost-sale report or
setting submitted.

Evidence tags: **OBSERVED**, **INFERRED**, **UNKNOWN**. Terms caution: 20-SUPPLIER-INTEGRATION-START (PA-T) notes
IMC terms restrict extraction, reuse and disclosure of price and inventory. This file therefore records screens,
fields and mechanisms only - **no prices, stock counts per SKU, or order values** - and the price comparison Nour
asked about stays out of the repo.

## 0. Identity

- Header: **"MOE'S EUCLID TIRE"**, ACCT# visible in the header (account number not copied here). Moe's is a
  current trade name (Nour, 2026-11-06).
- Home branch: **29 Cleveland, OH** (Primary). Store ID 10651 is IMC's Web Warehouse store, not the shop.
- Links: My Account, Sign Out, **Hide Prices** (one-click counter-safe mode, like 24 and 25), **My Parts
  Authority** (separate my.partsauthority.com portal, not opened), live chat bubble (not started).

## 1. Global structure

- Tabs: **home | catalog | universal accessories | fast order | my account | my jobs**; header part-number search
  (yellow) on every page; cart icon with count.
- **"Order Cut Off" dropdown in the header on every page** (OBSERVED): "Cut Off for today" lists the remaining
  runs from the home branch - at 14:43 it showed **15:00, 15:30, 16:00, 16:30, 17:00 - 29 Cleveland, OH**, with a
  bubble "The next order cut off is in ... 17 min". A real order placed 11:18 the previous day shows "This order
  will be on the Thu, Nov 5 2026, 11:30 AM truck!" - so runs appear to leave **about every 30 minutes through the
  day** (INFERRED from one day's list plus one order; earlier slots drop off the list as they pass).
- **"SAT. Delivery Available"** banner on search, fast order and accessories pages.
- Home page: vehicle search (USA / Canada / Mexico checkboxes, "Customize My Makes"; Automotive or Motorcycle;
  Year, Make, Model type-ahead; **VIN or state + plate** with one Search; **Recent Vehicles / VINs** dropdown -
  20 recent vehicles, most with full VIN, which is customer data and not copied); **Spotlight Items** carousel
  (in-stock count, price, part #, qty stepper, Add to Cart); quick links **Current Deliveries Status**, **Track
  Orders & Invoices**, Change Password, **Track Returns**; panels **Order Cut Off**, **my jobs**, **Recent Orders &
  Invoices**; vendor promo banner.

## 2. Catalog flow

1. Vehicle chips across the top: Year > Make > Model, then Submodel and Engine filled in as chips (**2018 / Honda
   / CR-V / LX / L4 2.4L DOHC / GAS Naturally Aspirated / K24W9 / Sport Utility / Reset**). Engine selection is
   mandatory before results ("Engine selection is mandatory").
2. Catalog source tabs: **All Parts | Popular Parts | AM Catalog | OE Catalog** ("narrow down the part types you
   prefer to see by choosing alternate catalogs; we default to All Parts").
3. Left: **Categories** or **Repair Jobs**. Repair Jobs (24): Belts and Related, Brake Friction, Brake Hydraulics,
   Clutch, Cooling System, **Crash - Car Front End / Rear End / SUV Front End / Truck Front End**, Drive Belt,
   Driveshaft, Engine Intermediate Shaft Bearing Job, Exhaust, Exterior Bulb, Filter, **Major Service**, Minor
   Service, Mount, Shock Absorber/Strut, Steering, Suspension, Switch/Sensor, Timing, Valve Grind. A job lists its
   part types as checkboxes (Major Service: belts, filters, trans fluid/filter, cabin filter, intake and valve cover
   gaskets, drain plug and gasket, O2 sensor, PCV, spark plugs, wipers...), not pre-checked.
4. Middle: **Quick Selections** tiles (A/C Kits, Front & Rear Pads & Rotors, Front Pads & Rotors, Rear Pads &
   Rotors). Picking "Front Pads & Rotors" checks **position-level** part types (Brake Rotor Set: Front; Brake Rotor:
   Front Left, Front Right, Front; Brake Pad Set: Front).
5. Right: **My Selections** - a saved checklist of the shop's usual part types, sortable, clearable.
6. **Advance Filter**: Submodel (EX-L, EX, LX, Touring) and Engine. Then **Display Parts**.

## 3. Results page (the core screen)

**Header strip:** "**Active Cart: 2018 Honda CR-V**" (Add/Modify) and **Branch Preferences**. Applied-filter chips
(Stock x, Position x).

**Left filter rail:**
- **Stock Filter:** My Branch Only / **Include Local Transfers** (default on vehicle searches) / All branches /
  All including Non Stock.
- Part Term (Brake Pad Set, Brake Rotor Set, Brake Rotor).
- **Quality Rating:** Ultra Premium (4 cars), Best (3), Better (2), Good (1), with counts - a built-in
  Good/Better/Best grade on every SKU.
- Position with counts (Front Left / Front Right / Front and Rear / Front / Rear Left / Rear Right / Rear).
- **Brand** with counts (35 brands for this vehicle's brake parts).
- Drive Type, Friction Type, Outside Diameter, Rotor Category (Black Hat, Coated, Painted, Performance, Value).

**Per part type, an OE header row:** **OE Number**, Fitment (trim), **OE List Price**, **Qty** (per vehicle - 2
rotors, 1 pad set), OE Note ("Includes Pin Clips and Shims"), **Add'l OE's**, plus **View Diagram** and **lost
sale** buttons. Every aftermarket option is shown against the OE part and OE price.

**Per SKU row:** brand logo and name; image; SKU; **quality icons**; **Also Fits**; description + **Info**;
**in stock?** - either "29 Cleveland, OH: n" or a yellow "**Transfers: n**" or orange "**Shipping: n**", plus
"**Other: Yes/NO**" (link); **price, list, core**; a **qty box pre-filled with the OE quantity per vehicle (2
for rotors)**; add (greyed "not in stock" when nothing can be had); **add to my jobs**. Below some rows: structured
attributes (friction material, wear sensor type/included, hardware included, shims, lubricant) and **Vendor
Fitment / Vendor Comment**.

Default results on the vehicle search only show what is local or a local transfer; a part-number search
defaulted to **All branches**.

### 3a. Item Availability ("Other: Yes") - the delivery promise

Modal "Item Availability for <SKU>": columns **Plant | available Qty | Submit By | My Branch Departure**, local
time, with **CLICK TO REFRESH AVAILABILITY**, **Qty Needed** and add. For the test rotor (OBSERVED, Fri Nov 6):

| Plant | Submit By | My Branch Departure |
|---|---|---|
| 29 Cleveland, OH (home) | 3:00 PM Fri | 3:00 PM Fri |
| 32 Lorain, OH | 3:30 PM Fri | 4:30 PM Fri |
| 34 Huron, OH | 4:15 PM Fri | 9:30 AM Sat |
| 11 more (MD, CT, NY x3, GA, NJ, FL, CA x3, OR) | Shipping | Shipping |

This is the only vendor of six that answers "**if I order now, when does it leave my branch**" per source
location. "My Branch Departure" is the truck from the home branch to the shop, so arrival = departure + the
route's drive time (route time itself UNKNOWN).

### 3b. Branch Preferences

"Customer Branch Preference": ~35 branches with a checkbox each (all checked), each tagged with how it can reach
the shop - **P Primary** (29 Cleveland), **T Transfer** (32 Lorain, 34 Huron), **S Shipping**, **D DoorDash**
(many branches, incl. Lorain). Save Changes & Close (not saved). DoorDash as a fulfillment mode is new across
all six audits.

### 3c. View Diagram

Exploded OE diagram for the part type (front brake corner): numbered callouts, the searched parts highlighted,
and a side list of **every part in the diagram with OE # and OE list price** (brake rotor, wheel hub, lug stud,
wheel bearing, snap ring, dust shield, caliper, pad set, hose, ABS sensor and bracket), each with a checkbox and
**Display Parts** to search them. It surfaces the parts that go with the job (hub, bearing, dust shield).

### 3d. Report Lost Sale (opened, closed, not submitted)

Reason: **Too Expensive / Need Genuine / Not Stocked / Wrong Brand / Other Reason** (+ free text), and the **OE
Numbers** for the part type as checkboxes. "Need Genuine" makes OE demand visible to the vendor.

### 3e. Info (product page)

Images, Part Notes, SKU, Brand, **Ordered As Part #**, **Weight**, **Quantity Required**, home-branch qty, **Alt
Inventory**, price/list/core, qty + add, add to my jobs; then Description and a long **Specifications** table
(for the rotor: category, diameter, material, **discard thickness**, nominal thickness, construction, coating,
height, bolt holes, ABS ring, vented, center hole, bolt circle...). Discard thickness is exactly what a tech
needs to decide machine vs replace.

### 3f. Part-number search

Header search with a competitor number (`PXD2036H`, an Advance Auto pad number) returned IMC equivalents across
brands with **"Fits 2018 CR-V"** badges against the active cart's vehicle, quality icons, stock as branch qty,
Transfers or Shipping, and greyed "not in stock" buttons. Cross-reference and fitment check in one step.

## 4. Carts and jobs

- **Multiple shopping carts, named by Year Make Model** (My Account > Shopping Cart Type: Multiple = Yes, names =
  Year Make Model, or User Defined). The vehicle you look up becomes the "Active Cart" - one cart per car in the
  bays. Selecting the test vehicle made "2018 Honda CR-V" the active cart (empty; no item added).
- **Shopping Cart** page: items, plus **"Save These For Later"** (brand, SKU, name, unit/list price, qty, **ships
  from**, extended, remove, add to cart) - several suspension parts were saved there by shop staff, shipping from
  a California plant.
- **Fast Order Form:** part # + quantity rows (brand, image, description, in stock, price fill in), then **Add All
  Items to "my jobs"** or **Add All Items to My Cart**.
- **My Jobs:** named saved part lists ("Add New Job (enter job name)"); none defined.
- **Universal accessories:** non-vehicle catalog (A/C service, adhesives, batteries, brake service, cleaning,
  engine oil, fluids, fuses, hand tools, lifts...) with keyword search.

## 5. Delivery tracking, orders, returns

- **Current Deliveries Status** (NEW badge): live table **Origin Branch # | Run # | ETA | Dispatch Time | Driver #
  - Driver Name | Invoice Count | Action**. Empty at the time of the pass (no truck out to the shop). This is a
  live "where is my part" view by truck run.
- **Order Details:** order #, PO #, order date/time, invoice #, tracking #, "**Shipped from 29 Cleveland, OH via
  OUR TRUCK**", "**This order will be on the <date, time> truck!**", lines (brand, image, part #, description, unit
  price, list, core, qty, status, extended), subtotal, freight, core charge, tax, "This is not an invoice".
- **View Orders & Invoices:** search by Order Date / Part Number / Order Number / Invoice Date / Invoice Number /
  PO Number; default last 3 days. Eight orders in the last three days (all Invoiced; PO numbers mostly blank).
- **Track My Returns:** search by RMA date / Part Number / RMA Number / Credit Memo Date / Credit Memo Number / PO
  Number; columns Return Order #, date, status, # of lines, total.

## 6. Account settings (viewed, nothing saved)

My Account menu: Customize Homepage, Customer Preferences, Current Deliveries Status, View Order & Invoices,
Change My Password, Update Shopping Cart Type, Track My Returns, Favorite Brands, **Truck Cut Off Alarm
Settings**, Customize My Makes, **Shop Management Integration** (ALLDATA, Mitchell 1, R.O. Writer).

- **Shipping Preferences:** Will Call (checked), FedEx and UPS (Next Day Air / Next Day Saver / Ground) - shown
  greyed (INFERRED: set by IMC, not the shop).
- **Favorite Brands:** 1,483 brands to tick; default view Favorite / Euro / All; none ticked.
- **Delivery Truck Cut Off Alarm:** Yes/No (currently No) - an alarm before each truck cutoff.

## 7. Shop-management punchout (public pages linked from the account)

- **Mitchell 1 Manager SE:** install IMC catalog, add IMC vendor with Web Warehouse login; on a work order, decode
  the VIN, click **IMC** -> Web Warehouse opens **with the vehicle loaded** -> shop as usual -> cart **Transfer**
  -> parts land on the work order -> **Price Check** -> **Order Parts**. "For IMC non delivery customers (non truck
  customers), default delivery option will be GROUND."
- **ALLDATA Manage Online:** same pattern - vehicle passed in, cart **Transfer**, **Add to Document**, **Inquiry**
  (inventory check), **Order**. Requires IMC to enable the account as an ALLDATA user.
- R.O. Writer: PDF guide (not opened).

IMC already runs a documented "vehicle in, basket back, human orders" handshake with three shop systems. This is
the strongest signal yet that IMC will connect to Shop OS the same way if asked (20 PA-2).

## 8. Not reached

My Parts Authority portal; live chat; R.O. Writer guide; Popular Parts tab; Customize Homepage; Plate lookup
(customer data); placing, transferring or saving anything; Saturday delivery details; route drive time from the
branch to the shop; whether DoorDash can be chosen per order.

## 9. What changes elsewhere in the plan

1. [14-STOLEN-MECHANISMS](14-STOLEN-MECHANISMS.md) rows 36-44.
2. [03-VENDORS](03-VENDORS.md): Parts Authority answers the "quickest" half on its own - per-location submit-by and
   departure times, a run every ~30 minutes, Saturday delivery, live run tracking. It becomes the reference for the
   arrival fields; the "ETA unknown" rule still applies to Capital Tire and Federated.
3. [26-VENDOR-SCHEMATICS](26-VENDOR-SCHEMATICS.md): new column and fields (`submitBy`, `departsMyBranchAt`,
   fulfillment modes incl. transfer and doordash, OE reference price/qty, quality grade, vehicle-scoped carts).
4. [20-SUPPLIER-INTEGRATION-START](20-SUPPLIER-INTEGRATION-START.md): signed-in Web Warehouse flows are now
   observed (not just the login page), and the ALLDATA punchout joins Mitchell 1 as evidence. Ask IMC for the
   Mitchell 1/ALLDATA-style handshake for Shop OS before any other PA work.

## Redaction note

No prices, per-SKU stock counts, order or return values, VINs, plates, recent-vehicle list, driver names or the
account number are recorded. Order and invoice numbers are not copied. Test inputs: a generic vehicle (2018 Honda
CR-V) and a competitor part number.

## Safety note

Read-only, on-screen navigation of Nour's own session. Dialogs for Branch Preferences, Shipping Preferences,
Shopping Cart Type, Favorite Brands, the cut-off alarm and Report Lost Sale were opened and closed without saving.
The only side effect: looking up the test vehicle made "2018 Honda CR-V" the active (empty) cart, and the catalog
tab was toggled to OE and back to All Parts. No password entered.
