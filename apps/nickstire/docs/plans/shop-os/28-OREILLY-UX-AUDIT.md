# Shop OS 28: O'Reilly Pro (First Call Online) UX audit (screen by screen)

Job 2026-11-06-shop-os-oreilly-ux-audit. Status: COMPLETE (one pass). Read-only, on-screen navigation of Nour's
own authenticated O'Reilly Pro account (firstcallonline.com), same pattern as 21-27. O'Reilly is one of Nour's
four main parts vendors (with Parts Authority, AutoZone and Federated). No item was added, no order placed, no
customer, employee, return or setting saved. Prices, stock counts, sales figures and order values are not
recorded (chat only), matching 27.

Evidence tags: **OBSERVED**, **INFERRED**, **UNKNOWN**.

## 0. Identity

- Account name "moes euclid tire and auto" (shown twice in the top bar: company and shop), 17625 Euclid Ave. Moe's
  is a current trade name (Nour, 2026-11-06). Account number, phone and username not copied here.
- One web user, role **Company Manager**, security type WEB; "No Shop Managers Found".
- Servicing store phone shown on "Call for Pricing and Availability" rows (not copied).

## 1. Global structure

- Top bar: company / shop names, **Chat for Help**, language (English/Español), user, Logout. A docked "Chat For
  Help" tab on the right of every page.
- Main nav: **Catalog Lookup | Stock Order | Manage Customers | Quotes & Orders | Part Interchange**.
- Under it: the **vehicle selector** (shows the current vehicle), a product/part #/brand search, and **Go To
  Quote** (the cart is a quote).
- Home: tabs **Recent Vehicles** (date, VIN, plate, state, vehicle - customer data, not copied) / **Recent
  Quotes** / **Recent Orders**; **Request Return**; **Current Promotions** with dates and **Enroll Now**
  (November ACDelco, Q4 Parts Payoff); Marketing and Promotions (O'Reilly Pro mobile app, ePublications, **Shop
  Referral**, Real World Training website).
- Footer: MSDS, Credit Application, **Team Viewer** (remote support), Contact Us, **Statements and Earn-backs**,
  **Drop Box Slip** (PDF), **Vehicle Inspection Form** (PDF), **Labor Claims**, **Account Dashboard**.

## 2. Vehicle lookup

Add Vehicle panel: **license plate + state** (Go), **Year / Make / Model** (year grid back to 1942, makes include
heavy-duty and bus makers), then **Engine (optional)** with full descriptor (e.g. "L4 - 2.4L 2356cc 144ci GAS DI
type K24W9 - 4 valve DOHC"), then **Submodel (optional)** (EX, LX, "Don't know or show all"), or **VIN**. Once set,
the vehicle panel shows attributes, **Edit Vehicle Attributes**, **Vehicle Data/Specs**, **Add Customer** (ties the
vehicle to one of the shop's customers), Change Vehicle, Clear Vehicle.

**Side effect (OBSERVED):** setting the test vehicle immediately created an **"In Progress" quote for 2018 Honda
CR-V** under Quotes & Orders (empty). O'Reilly scopes the working basket to the vehicle, like Parts Authority.

## 3. Part selection

Tabs **Most Popular | All Part Types | Package Jobs**. Clicking part types adds them to a **Part Types Selected**
list (trash icon per type, Clear All, **Get Parts**). Bundles carry a **SAVE** badge (A/C Kits, Brake Kits). Before
results it asks for missing attributes per part type: "Select Brake Pads Position: Front / Rear / Don't know or
show all", then the same for rotors.

## 4. Results

One section per part type ("Brake Rotor - Showing 3 Results") with **Compare Brands** (a PDF brand comparison
chart), **Vehicle Data/Specs**, **Filter Results**, and sort **Relevance / Price low-high / high-low /
Availability**. A promo banner on top (house-brand brake kits from a fixed price).

Per row: image, name + line code + part #, description, **warranty in plain words** ("2 YEAR LIMITED WARRANTY",
"Limited Lifetime Warranty", "Contact Store for Warranty Details"), More Information (full specs incl. **discard
thickness**), **Availability**, **List and Cost** each/per set, qty (pre-filled 2 for rotors), **Add To Quote**,
**Add to Stock Order**, Feedback.

**Availability states (OBSERVED):**

| State | What it says |
|---|---|
| In the servicing store | "**n Available Now**" |
| In O'Reilly's network | "**n In Network** - **In Store By: Tomorrow at 7:30 AM** - **If Ordered By: 5:25 PM**" |
| Not stocked / special | "**Call for Pricing and Availability**" + store phone (no price shown) |
| Interchange / substitute | "**May Use: BB SC2036**" (house-brand alternative) |

So O'Reilly gives an ETA with its own cutoff per SKU for network stock (arrive at the store next morning if
ordered by the evening cutoff); store stock is "now" and the store-to-shop delivery leg is separate (section 5).

## 5. Quotes, orders and delivery tracking

- **Quote page:** New Quote, Add (vehicle), Add Parts / Supplies, Print, Update, Delete Quote; "Last Save"
  stamp; one section per vehicle with **Vehicle Actions: Quick Add, Add Parts, Add Labor, Add Other, Vehicle Info,
  Delete Vehicle** (several vehicles on one quote). **Quote Summary:** P.O. #, **Store Message**, **Delivery Type
  (Pickup / Delivery)**, Payment Type (Cash - fixed), **Return Type (No Returns / New Return / Core Return /
  Warranty Return / Multiple Returns)**, Total, **Place Order**. Returns ride back with the delivery driver.
- **Quotes & Orders search:** free text (vehicle, name, order #, description), search type, date range; table
  Date, **Vehicle / Customer**, Order # / Invoice #, PO Number, **Created By**, Description, **Order Status**
  ("Delivery Details" link).
- **Delivery Details (order tracker, OBSERVED on a past order):** a four-step timeline **Order Placed -> Order
  Processed -> Out For Delivery -> Delivered** with timestamps and "No Signature"; vehicle header; lines with
  availability at order time, list/cost; **Order Summary:** invoice #, ordered by + time, order confirmation,
  **Delivery Type**, **Sourcing Type ("Suggested Sourcing")**, payment type, totals; **Shop Info**. The example
  order placed mid-afternoon Saturday showed Delivered the next day.
- **Activity Log:** date, shop, user, target, category, event, description (logins with browser string, "Quote
  Ordered - Order placed, Amount ..."), filter by category and dates, **Export CSV**.

## 6. Manage Customers (O'Reilly's mini CRM)

Search customers by vehicle, name, phone; date range; **Add Customer**; **Recent Customers** table: Last
Service Date, Vehicle YMM, Engine, Name, Description, License Plate. **Unused** (no results). O'Reilly is inviting
the shop to keep its customer list in the parts portal - the same encroachment as Federated's labor quote (14 row
32).

## 7. Stock Order and Part Interchange

- **Stock Order:** Quick Order (part search + qty), named Stock Orders list (Show All, **Add Stock Order**); none.
  Every result row also has "Add to Stock Order".
- **Part Interchange:** a 3-step wizard - enter part # -> confirm part type -> choose the source manufacturer
  (Advance Auto, Bosch, Carquest, or show all) - then the O'Reilly match with "Matches: Advance Auto", "**May
  Use**" house-brand alternative, and "**Fit not Determined**" against the current vehicle. Banner: "Interchange
  is to be used as a guide only! Application must be verified."

## 8. Account management

Menu: **Account Dashboard, User Preferences, Shop Management, Labor Claims, Activity Log**; **Company
Preferences**.

- **Account Dashboard:** YTD purchases gauge, current-month sales, **Earn-back** table (Electronic Earn-back
  **1%** on **E-Sales**, amount earned, YTD), View Earn-backs, Invoices search. (Figures not recorded; YTD
  O'Reilly volume is small relative to the other vendors - INFERRED from the gauge.)
- **User Preferences:** password/security question, name, email, username, site background, email language.
- **Shop Management:** shop overview (status Active, managers, phone), **Shop Employees** with type, security,
  password-reset date, **Add Employee**.
- **Shop Preferences (viewed, not saved):** Shop info; **Rates and Prices** - **Labor Rate**, **Tax Rate for
  Labor**, **Tax Rate for Parts**, **pricing method: List Price / Percentage Markup-Markdown / Pricing Matrix**,
  **Hide costs by default**; **Record Keeping** - show PO on orders, **PO Required**, **PO Mask** (pattern syntax:
  N digit, A letter, ? optional, quoted literals, max 22 chars), **Garage (Bay) identifiers on orders**, **Fleet
  identifiers on orders**; **Labor Guide Integration** ("for labor estimates on the quote page").
- **Labor Claims:** page did not render content in this pass (UNKNOWN; by name, warranty labor reimbursement
  claims).

## 9. Not reached

Plate and VIN lookup (customer data), Statements and Earn-backs detail, Request Return flow, Recent Quotes/Orders
tabs in detail, Company Preferences, Labor Claims content, Package Jobs contents, Compare Brands PDF, mobile app,
Shop Referral, anything that would save, order or return. API/integration documentation was not visible in the
portal (the plan's earlier note that O'Reilly offers a direct API to single shops remains unverified here).

## 10. What changes elsewhere in the plan

1. [14-STOLEN-MECHANISMS](14-STOLEN-MECHANISMS.md) rows 45-51.
2. [03-VENDORS](03-VENDORS.md): O'Reilly gives per-SKU network ETA with a cutoff ("In Store By ... If Ordered
   By ...") and a delivered/not-delivered tracker, but not the store-to-shop run times Parts Authority gives.
3. [26-VENDOR-SCHEMATICS](26-VENDOR-SCHEMATICS.md): add `arrival.inStoreBy` + `orderBy` for network stock,
   `callForPrice` status, `returnTypeOnOrder`, `bayId` and `fleetId` on orders, the 4-step delivery status, and
   earn-back as a VendorProgram.
4. Rule reinforced: like Federated (row 32), O'Reilly offers customer lists, labor lines and labor-guide quotes
   inside its portal. Shop OS owns customers, labor and quotes; vendor portals only receive parts orders.

## Redaction note

No prices, stock counts, sales/earn-back figures, VINs, plates, recent vehicles, phone, account number or
username recorded. Test inputs: a generic vehicle (2018 Honda CR-V) and a competitor part number.

## Safety note

Read-only, on-screen navigation of Nour's own session. **One side effect:** selecting the test vehicle created an
empty "In Progress" quote for 2018 Honda CR-V (visible in Quotes & Orders). It was left in place (deleting data is
Nour's call) - he can open Go To Quote > Delete Quote. Shop Preferences, User Preferences and the Vehicle Actions
menu were opened and closed without saving. No password entered, no chat started.
