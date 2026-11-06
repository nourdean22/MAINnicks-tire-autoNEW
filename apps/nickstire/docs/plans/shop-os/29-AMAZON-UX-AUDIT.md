# Shop OS 29: Amazon (automotive parts) UX audit (screen by screen)

Job 2026-11-06-shop-os-amazon-ux-audit. Status: PARTIAL (public, signed-out pass). Read-only, on-screen
navigation of amazon.com in Nour's browser, same pattern as 21-28. Nothing was added to a cart, bought, listed
or reviewed. Amazon showed a bot check ("Continue shopping") and later a sign-in wall; Nour cleared both himself -
nothing was bypassed and no sign-in was done for him. The page still said "Hello, sign in" at the end, so
**every account-side feature (Amazon Business pricing, approvals, lists, orders, invoices, returns, tax
exemption) is UNKNOWN** until a signed-in pass. Prices and stock counts are not recorded here (chat only),
matching 27 and 28.

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

## 5. What a shop gets that a consumer does not

UNKNOWN in this pass (needs Nour signed in, ideally to an Amazon Business account): business pricing and
quantity discounts, purchase approvals, multi-user accounts, PO fields, invoices and tax exemption, order and
return history, and any API/punchout. Amazon Business is listed in the footer; nothing beyond that was observed.

## 6. What Shop OS takes (see 14-STOLEN-MECHANISMS rows 52-60)

- Conditional fit with the condition named ("fits only if Position Front") instead of a yes/no.
- Ask only the missing vehicle attributes; pre-fill any attribute with one valid value.
- A date-plus-countdown promise per offer, and an "arrives by tomorrow" facet - the user-facing form of 26's
  `arrival` and `orderCutoff`.
- Return-by **date** on every line, so returns are chased before they expire.
- Seller and shipper as separate fields; new vs used/reman as a condition field.

What Shop OS rejects: sponsored or unfitted items mixed into fitted results; repeated merchandising blocks;
"frequently bought together" that is not job-aware (Shop OS uses job kits from 26 instead).

## 7. Spot check (chat only)

Same job as 27/28 (2018 CR-V front pads and rotors). Figures were given in chat, not here. Summary: Amazon was
at or below the cheapest jobber on name-brand pads, above it on rotors, and slower than every jobber with a
same-day run.

## 8. Open questions

- Does Nour have, or want, an Amazon Business account? If yes, a signed-in pass for pricing, approvals, invoices,
  returns and tax exemption.
- Is Amazon a real third source for planned (next-day) jobs and shop supplies, or only a price reference? Shop OS
  should treat it as `fulfillmentMode: ship` with a named date and never as a Quickest Arrival winner for a car
  on a lift.
