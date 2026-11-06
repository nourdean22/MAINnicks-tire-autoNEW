# Shop OS 29: Amazon (automotive parts) UX audit (screen by screen)

Job 2026-11-06-shop-os-amazon-ux-audit. Status: COMPLETE (two passes). Read-only, on-screen navigation of
amazon.com in Nour's browser, same pattern as 21-28. Pass 1 was public and signed out (sections 1-4). Pass 2
was Nour's own **Amazon Business (Prime Business)** account after he signed in himself (section 5). Nothing was
added to a cart, bought, listed, reviewed or saved; no setting was changed. Amazon showed a bot check and a
sign-in wall in pass 1; Nour cleared both himself. Prices, order values, order numbers, addresses, users and
account IDs are not recorded here (chat only), matching 27 and 28.

Evidence tags: **OBSERVED**, **INFERRED**, **UNKNOWN**.

Test vehicle: a sample 2018 Honda CR-V LX FWD 2.4L (no customer data), deliver-to ZIP 44112 (Cleveland).

## 0. Why Amazon is in the set

Amazon is a retail marketplace, not a jobber: no account rep, no route truck, no branch stock. It matters to Shop
OS for three reasons: (1) on name-brand pads it matched or beat the cheapest jobber in the one-job spot check
(chat only); (2) its delivery promise is the clearest of any vendor seen (a date plus an "order within" clock);
(3) its fitment UX is the most polished consumer version of what the counter needs. It is also the slowest
source seen for a car on a lift: the earliest promise was next day with Prime, a later named date without.

## 1. Global structure (OBSERVED)

- Top bar: deliver-to ZIP, department search, account, Returns & Orders, cart.
- Automotive sub-nav: **Amazon Autos, Your Garage, Deals & Rebates, Parts**.
- A store-wide countdown banner in the header on search pages (hh:mm:ss) - the same "order within" clock shown on
  product pages.

## 2. Your Garage (vehicle setup) (OBSERVED)

- Two ways in: **license plate + state**, or **vehicle type / year / make / model**.
- After model, a second step: **"More vehicle information needed"** asking trim, body style, brakes, drive type
  and engine. Dropdowns with only one valid option come **pre-selected**; only the ambiguous attributes need a
  choice.
- The saved vehicle then appears across search ("Filter results by your vehicle: 2018 Honda CR-V | Filter
  results | Change vehicle") and on product pages.
- Side effect left for Nour: the sample CR-V is now in Your Garage on this signed-out browser session.

## 3. Search results (OBSERVED)

- Sort: Featured, price low/high, review, newest, best sellers.
- Facets: **Free Shipping by Amazon**, **Delivery Day: Get It by Tomorrow**, 4 stars & up, Brands (Bosch,
  ACDelco, PowerStop, Bendix, Detroit Axle, Raybestos, TRQ...), price bands, deals/coupons, **Seller**
  (Amazon.com plus third-party sellers), **Automotive Fit Type: Universal / Vehicle Specific**, Department
  (rotors, pads, kits).
- Each result: title, rating and count, "N bought in past month", price, a delivery line per membership ("Join
  Prime to get FREE delivery Sun, Nov 8 / Or Non-members get FREE delivery Wed, Nov 11"), or a range ("FREE
  delivery Nov 10 - 12"), a paid-delivery line on some third-party items, and **low-stock text** ("Only 3 left in
  stock (more on the way)").
- Merchandising blocks (Overall Pick, Best Seller, Customers frequently viewed, Seen on social media) repeat the
  same sponsored kits several times on one page.
- **Fitment leaks (OBSERVED):** with the 2018 CR-V set, the vehicle filter was offered but results were not
  restricted to it by default; a sponsored front rotor listed for older CR-V/Odyssey/Prelude (11.06 in, while the
  2018 front kits are listed at 12.28 in) appeared among the results. Many results are unbranded or
  generic-brand kits. INFERRED: results are only fitment-safe after the shopper clicks "Filter results", and
  sponsored slots are not fitment-gated.

## 4. Product page (OBSERVED, Bosch BE2036H front pads)

- Breadcrumb Automotive > Replacement Parts > Brake System > Brake Pads.
- **Fit badge:** "amazon confirmed fit | This fits 2018 Honda CR-V | See similar products that fit this
  vehicle", plus a popup **"This product fits only if following criteria are met: Position Front"** - the fit is
  conditional and the condition is stated.
- The listing's own bullets still hedge: "vehicle trim level/engine may affect fitment - verify ... with fit
  checker above", and list year ranges by model.
- Buy box: price vs list price and percent off, Amazon's Choice, store-card discount, "Available at a lower price
  from other sellers that may not offer free Prime shipping".
- **Delivery promise:** "FREE delivery Wednesday, November 11. Or Prime members get FREE delivery Tomorrow,
  November 7. Order within 3 hrs 43 mins." Deliver-to ZIP shown, "In Stock", quantity up to 30.
- **Shipper / Seller** fields (here both Amazon.com), **Returns: "FREE refund/replacement until Jan 31, 2027"**
  (a date, not a rule), packaging.
- **Used - Very Good** offer from Amazon Resale beside new; "Other sellers on Amazon: New & Used (8)".
- Specs table (brand, material, position, "Specification Met: OEM"), Frequently bought together (spark plugs and
  an oil filter - not brake parts), customers-also-viewed (rear pads, competing front pads with low-stock text).
- Warranty: only "Manufacturer's warranty can be requested from customer service"; 30-day return guarantee text.
- "Report an issue with this product or seller" and "Would you like to tell us about a lower price?" links.
- Reviews: star histogram visible; review text needs sign-in.

## 5. Signed-in pass: the Amazon Business account (OBSERVED)

**Identity.** Prime Business account named "Moes Euclid Tire and Auto" (Moe's is a current trade name), one
admin, business profile at the shop address. Orders show "Placed by" a person and "Paid by" the business.

**Account menu.** Manage Your Business: Buying Policies & Approvals, Billing & Shipping, Users, Tax Exemption &
licenses, System Integrations. Quick actions: Add Users, Manage Budgets, Set Spending Limits, **Track Receiving
for 3WM**, Simplify Your Reporting. Your Account: Business Settings, Amazon Business Card, Business Analytics,
Prime Business, Subscribe & Save, **Manage Quotes**, Switch Accounts. An "Amazon Business Assistant" AI chat
opens on settings pages.

**Business settings hub.** Billing & shipping (shared payment methods, addresses and delivery preferences,
**Business order info**, Budgets/Blanket POs, **Receiving (3-Way Match)**, checkout defaults); User management
(users, groups, account authority, enhanced security); Buying policies and approvals; Tax exemption and
licenses; System integrations.

**Business order info.** Up to 19 order fields (6 standard, 13 custom) shown to the buyer at checkout, as an open
text field or a pick list, with optional guidance text. Amazon states the values appear on order details,
Business Analytics reports and packing slips, and **the PO number is printed on carrier shipping labels and
physical packing slips**. Current state: one field, "PO Number", on, open text, no guidance.

**Receiving (3-Way Match).** "Track product receiving": mark individual items received / not received.
Current state: **off**. Separately, every delivered order line already has a **"Mark as received"** button.

**Tax exemption.** One exemption on file: type **Reseller**, jurisdiction **Ohio**, status VALID, applying to
"Amazon & Participating Sellers". In one sampled order for a hand tool (not resold), "Estimated tax to be
collected" was $0.00 - i.e. the reseller exemption was applied to a shop-use purchase.

**System integrations.** Configure purchasing system (punchout from systems such as Coupa, SciQuest, Skyward),
**E-Invoicing** ("transmitting invoices and line-item data to your systems"), domain verification, SSO,
UNSPSC classification, SCIM user sync, App Center. None appeared configured. Whether Amazon Business offers an
ordering/reconciliation API this account can use was not shown - UNKNOWN.

**Orders.** Search by item, order **or PO number**; tabs Orders, Buy Again, Not Yet Shipped, Digital, Amazon
Pay, Cancelled; filter by who paid (business or self); **View order reports**; per order: placed date, total,
ship to, placed by, invoice; per line: return-by date ("Eligible through ..."), Track package, Print packing
slip, Mark as received. The account places orders several times a week. What it buys (categories only):
**vehicle-specific small parts** (connector pigtails, coolant hoses, latches, lamps, trim), **shop tools**,
**shop consumables** (towels, receipt paper, tire-changer mount heads, paint markers), and some non-shop items.
Ship-to alternates between the shop and a personal address, including for some vehicle parts.

**Delivery, signed in, to the shop ZIP.** Same pads as section 4: "Prime Tomorrow ... Order within 6 hrs 10
mins", "Shorter shipping distance". Buy Again items show "FREE One-Day" and **"Overnight by 6:00 AM"**. A
Same-Day storefront offers "3 hour delivery" but only for household/office/grocery-type categories, and said
"Delivery for today isn't available right now" at the time checked. No same-day automotive option was seen.

**Fit.** The account's own garage vehicle (not a test vehicle) drove a red **"This does not fit"** badge on the
CR-V pads - the negative fit state is shown as clearly as the positive one.

**Pricing.** On the sampled pads the business price matched the signed-out price; a "Need more than N units?"
quantity-quote link and a Quantity Discounts store exist.

## 6. What Shop OS takes (see 14-STOLEN-MECHANISMS rows 52-60)

- Conditional fit with the condition named ("fits only if Position Front") instead of a yes/no.
- Ask only the missing vehicle attributes; pre-fill any attribute with one valid value.
- A date-plus-countdown promise per offer, and an "arrives by tomorrow" facet - the user-facing form of 26's
  `arrival` and `orderCutoff`.
- Return-by **date** on every line, so returns are chased before they expire.
- Seller and shipper as separate fields; new vs used/reman as a condition field.
- The ticket number in the PO field, so it prints on the box and the packing slip (rows 61-62).
- A received tap per line, which also feeds 26's measured delivery times.
- Resale vs shop-use on every purchase line (row 63) - PARKED: the tax setup is confirmed correct.

What Shop OS rejects: sponsored or unfitted items mixed into fitted results; repeated merchandising blocks;
"frequently bought together" that is not job-aware (Shop OS uses job kits from 26 instead).

## 7. Spot check (chat only)

Same job as 27/28 (2018 CR-V front pads and rotors). Figures were given in chat, not here. Summary: Amazon was
at or below the cheapest jobber on name-brand pads, above it on rotors, and slower than every jobber with a
same-day run.

## 8. Open questions

- Answered: Nour has Amazon Business and uses it several times a week, including for vehicle-specific small
  parts the jobbers apparently do not stock. Amazon is a real **availability** source (tier 3-4 in 26 section 2:
  overnight/next day), not just a price reference; it is never a Quickest Arrival winner for a car on a lift.
- Tax: closed. Nour (2026-11-06) has already reviewed the account's tax setup and it is set up correctly. No
  Shop OS tax feature is needed for Amazon.
- Integration: punchout and e-invoicing are offered; whether Shop OS can act as the "purchasing system" (cXML
  punchout) and whether an ordering/reconciliation API is available to this account is UNKNOWN - ask Amazon
  Business support or the App Center.
