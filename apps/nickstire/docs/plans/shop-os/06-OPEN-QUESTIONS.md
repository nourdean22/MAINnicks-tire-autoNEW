# Shop OS 06: decisions owed, unknowns, and the vendor email

Job 2026-10-26-shop-os.

## 1. Decisions only Nour can make (ranked)

| # | Decision | Recommendation | Why it blocks |
|---|---|---|---|
| 0 | Name a counter lead for the days 1-3 money-leak sheet, and agree to the days 4-7 free-money moves and the days 8-12 bake-off (05-ROADMAP v3) | yes | the v3 roadmap starts here |
| 0a | Sign the shop up for PartsTech's free plan and connect the parts accounts (account steps in 03-VENDORS) | this week | the cheapest test in the whole plan |
| 0b | How many people turn wrenches on a normal day? | tell us | dispatch and the board depend on it |
| 1 | Approach A (build in nickstire, /system), B (Shopmonkey + our AI) or C (keep ALG). APPROVED A on 2026-10-26; the days 13-14 decision can confirm A or switch to A-hybrid (buy the core, build our layer) | decide on days 13-14 with the bake-off results | everything else |
| 2 | Send the vendor emails (section 3) from the shop inbox, or let an agent draft them | send this week | parts and labor data take weeks to approve |
| 3 | Crew roles (09-ACCESS section 2) and create their Google logins | front_desk for Mash and Manny, tech for Zach | nobody but Nour can use /system until then |
| 4 | Pick a night for the ALG API map (needs your ALG sign-in after 6 PM) | this week | P0 data move |
| 5 | Lane-based first come, first served (08-IDEAS #6) | yes, published to customers | changes how the shop explains its line |
| 6 | Ask the shop's lawyer whether the finance-program referrals bring the shop under the FTC Safeguards Rule | ask | sets how strict the data rules must be |
| 7 | Does the shop use QuickBooks Online? | tell us | P4 export |
| 8 | Light theme for the tech phone? | test first | P2 tech view |

## 2. Unknowns we are carrying (each has an owner)

| Unknown | How it gets answered |
|---|---|
| PartsTech fees, single-shop approval, exclusivity waiver | PartsTech/OEC reply |
| MOTOR price for one location | MOTOR reply |
| What ALG returns for ticket lines, vehicles, canned jobs, inventory | API map night |
| Which parts vendor the shop spends the most with | ALG ticket lines (supplier per line), after import |
| Whether Maverick's terminal can take an amount pushed from the invoice | Maverick reply |
| Xpress Tire and Elite Tire and Wheel integration paths | rep calls |
| Ohio tax treatment details (fees, cores) | shop's accountant |
| Why Sunday shows almost no closed tickets | read ALG ticket dates after import |

## 3. The vendor email (one text, send to each; built from research R1, R6, R10)

To: PartsTech/OEC partner team; O'Reilly (integrations@oreillyauto.com); MOTOR sales; Tireweb partners; Wheel Pros
(data@wheelpros.com); Maverick Payments support.

Subject: In-house software integration request, Nick's Tire & Auto (Cleveland)

We are a single-location independent tire and auto repair shop in Cleveland, Ohio, and an existing customer. We are
building employee-only software for our own estimates, repair orders and purchasing. It is not a public catalog, a
marketplace or a product we resell.

1. Do you approve this use, and which integration can we use: punchout, catalog or price-and-availability API,
   ordering, invoicing, delivery tracking?
2. Please send the implementation guide, authentication method, test environment and production approval steps.
3. Does availability give an exact quantity and the store or warehouse, or only "can fill this quantity"?
4. Do your time fields mean order cutoff, dispatch, or estimated arrival at our shop?
5. Which order confirmations, partial fills, returns and core credits come back electronically?
6. What are the setup, monthly, per-transaction and minimum fees?
7. Are there exclusivity, caching or record-keeping limits? We also buy from other suppliers.
8. Which Cleveland-area stores or warehouses can our account reach?

Thank you,
[Name], Nick's Tire & Auto, [shop phone]

Per-vendor extra line:
- PartsTech: "Please confirm the MOTOR labor and maintenance-schedule endpoints are available to us, and whether
  D&K Tire and O'Reilly direct connections can stay alongside PartsTech."
- O'Reilly: "We are requesting the single-location direct API or punchout listed on your Integration Hub."
- Maverick: "Which semi-integrated or cloud terminal API works with our exact terminal model, and can you create
  invoice-specific payment links with a result webhook?"
- Wheel Pros: "We are requesting product, inventory, dealer pricing and order API access."
