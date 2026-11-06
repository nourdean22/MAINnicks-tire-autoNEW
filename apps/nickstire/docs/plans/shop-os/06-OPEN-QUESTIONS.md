# Shop OS 06: decisions owed, unknowns, and the vendor email

Job 2026-10-26-shop-os.

## 1. Decisions only Nour can make (ranked)

| # | Decision | Recommendation | Why it blocks |
|---|---|---|---|
| 0 | Name a counter lead for the days 1-3 money-leak sheet, and agree to the days 4-7 free-money moves and the days 8-12 bake-off (05-ROADMAP v3) | yes | the v3 roadmap starts here |
| 0a | Evaluate PartsTech shop-portal access separately from developer API access (03 and 20); account creation is not authorized by this planning task | resolve terms first | do not assume a free shop plan grants custom CRM API rights |
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

## 2026-11-06 additions: sourcing and the shop computer

| Question | Current default | Why it blocks |
|---|---|---|
| Which exact supplier accounts and service branches are active for AutoZone, O'Reilly, Parts Authority/IMC, Federated, CPW, D&K, and other tire sources? | Reuse only current accounts; no new account or spend by default | Catalog access does not prove branch stock or order rights |
| Which vendor may be used for an authorized test account, and does its agreement allow API, punchout, order, returns and selected-offer record keeping? | Documented permission before an order adapter | Prevents a brittle or prohibited integration |
| Does a PartsTech developer agreement apply to the Shop OS, and will it permit AutoZone Pro, PA/IMC and D&K/Gateway alongside PartsTech? | Do not select its developer API until written interpretation and any required connection request/waiver are documented | Its published API terms describe exclusive catalog/procurement use plus a written-request and waiver path |
| Which workstation is the front-desk computer, who owns its camera/audio/browser services, and when can a measured cleanup run? | MECHANICS is the candidate; re-probe it; do not touch NicksMax | A cleanup/model install can interrupt counter, camera, phone or Whisper work |
| Is local inference sufficient for phase one, or must the CRM itself work without internet? | Local inference first; full offline CRM is a separate project | Railway still owns the online app/data path |
| Are paid vendor access, model tooling or hardware allowed? | No spend until Nour gives a specific go | The earlier no-spend ruling remains the default |
| Which quote-time, supplier-coverage and accuracy targets should the pilot use? | Measure baseline first; roadmap target is 20% faster common quotes without worse fitment/margin | A faster wrong quote is a failure |
| What does each bookmark do, who uses it, and should its task live in Shop OS? | Prior inventory records 38 bar entries, 3 synced entries, plus 2 unmatched screenshot labels; review public docs and operator-provided redacted screenshots in order of business value | Historical public captures are not authenticated workflows. The recorded security refusal stops this browser route; signed-in behavior remains UNKNOWN. Keep unrelated/personal destinations out of CRM |
| Which finance, payment, bank, insurance, communications and schedule actions should link into CRM, and which should remain separate portals? | Map task and permitted handoff first; customer/operator confirms every financial action | These systems carry separate credentials, terms and customer-consent requirements |

Nour asked for online supplier comparison, computer-connected portal handoffs, shop-PC cleanup and an offline model. The details and decision gates are now in [18-SUPPLIER-DESKTOP-OFFLINE-AI](18-SUPPLIER-DESKTOP-OFFLINE-AI.md); see also [19-CRM-BUILD-PROMPT](19-CRM-BUILD-PROMPT.md).

## Supplier continuation: prioritized unresolved proof (2026-11-06)

All rows below remain UNKNOWN. Roles name the person/team responsible for obtaining evidence, not a claim they have been contacted. No vendor message, form, purchase, account creation or production change was performed.

| Priority / owner | Question and required receipt | Default while unanswered |
|---|---|---|
| P0 / Nour + AutoZone Commercial/electronic-ordering team | Is this single-shop custom CRM eligible for a supported API or cXML/catalog handoff? Obtain current integration guide, entitlement, sandbox, store/branch scope and pricing. 2026-11-06: a Claude in Chrome session captured the My Zone API's shape (endpoints, auth, availability/pricing schema) — useful for designing the offer contract, but it is not eligibility and does not answer this question; see 20-SUPPLIER-INTEGRATION-START. | My Zone operator handoff; user-reported login is not API approval |
| P0 / Nour + PA/IMC rep + approved integration partner | Which production Web Warehouse tenant/account, servicing warehouses and launch/return interface may this CRM use? Does approved Nexpart/Epicor access cover it? | Existing operator bookmark only; no private-endpoint calls or installer reuse |
| P0 / Nour + D&K/Tireweb integration owner | Does D&K approve the current custom client and its portal-derived cart/order operations? How do the bookmarked TreadSearch host and code's B2B host map to the account? | No new live use of that path; portal handoff; leave current production configuration unchanged |
| P0 / developer + each supplier | What is each action's boundary: quote read, cart write, order submit, status read, invoice read, return/credit? Obtain supported operations and representative redacted/synthetic responses. | No prepare call used as a health/quote probe; Gateway prepare can write |
| P0 / Nour + vendors + contract reviewer | Obtain actual current rate, caching, quote/estimate retention, third-party hosting, AI-use, linking/embedding and exit/deletion terms. Are unpurchased quotes allowed in CRM history? | No catalog payload persistence or AI ingestion without permission; metadata-only task and vendor-hosted reference where permitted |
| P0 / Nour + PartsTech/OEC | Does its developer agreement apply? Resolve direct connections, waiver/exclusivity, fees and pre-order estimate retention before adoption. | PartsTech remains a candidate, no assumed free custom-CRM API |
| P1 / counter lead + supplier reps | What do available quantity, can-fill, branch stock, cutoff, pickup-ready, dispatch and arrival mean? Include time zone, update latency, weekends and truck-route/ground distinctions. | Missing quantities/arrival remain UNKNOWN; no fastest/cheapest claim without comparable evidence |
| P1 / counter lead + developer | Which vehicle vocabulary and qualifiers prove exact fit? Include part position, engine/brake options, OE constraints and tire load/speed/run-flat/staggered requirements. | Interchange and size-only matches remain candidates; human verification before selection |
| P1 / purchasing/receiving/finance owners | Who owns partials, substitutions, uncertain submits, shared carts, order-to-invoice allocation, RMA windows, core due dates and actual credits? Obtain workflow and permitted reconciliation data. | Human exception queue; no retry after uncertain submit, no assumed credit or invoice-as-delivery |
| P1 / Nour + counter lead | Confirm all relevant bookmark owners and alias destinations; identify Admin upgrade: eve... and 10/24 FRESH without exposing private URLs. | Preserve complete inventory; unknown labels stay UNKNOWN and outside sourcing |
| P2 / counter lead | Time a common repair-part lookup and tire-set quote, record fitment errors, stock/ETA variance and source coverage, then agree pilot targets. | Existing 20% faster target is a proposal; outcome remains unproven |

### Vendor request addenda (draft only; not sent)

Use section 3's questions separately for each vendor, with its own identity/account confirmation. The older draft's statement that we are an existing customer must be verified for that recipient; do not assert it for every platform.

- AutoZone: request the supported single-shop integration path, cart/quote return, authorized fitment identifiers, branch price/stock, order acknowledgement/status/invoice, return/core scope, retention and fees.
- PA/IMC: reference its public Mitchell 1 transfer/price-check/order pattern and ask for the approved equivalent for this CRM. Clarify the QA-host terms' applicability and permission for linking, importing selected transaction facts and vendor data on the CRM host.
- D&K/Tireweb: request approval or replacement guidance for the existing custom path, account/host mapping, official cost fields, ship-from selection, stock/ETA, cart isolation and support/change notices. Do not attach private payloads or credentials.
- PartsTech/OEC: ask how its order-accounting-only storage restriction supports an unpurchased estimate and whether the three required sources can coexist under the actual agreement. A requested waiver is not a granted waiver.

The current browser refusal remains a hard stop despite the owner's reported login. Use public sources and redacted screenshots Nour chooses to provide. For screenshot evidence, request only the needed control/flow with identifiers already removed; never retain customer/vehicle identifiers, invoice values, credentials or full private URLs. See 20 for the source ledger and proposed screens.
