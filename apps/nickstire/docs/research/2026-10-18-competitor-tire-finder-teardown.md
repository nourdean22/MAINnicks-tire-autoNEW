# Competitor tire finder teardown - 2026-10-18

Spike, read-only. Sites walked in the built-in browser on 2026-10-18 with a 2018 Honda Civic LX sedan
(OE 215/55R16). Two Perplexity Pro research threads in Chrome for vendors, pricing and conversion
evidence. Labels: FACT = seen on the source page today; CLAIM = Perplexity or a third party, not
re-read by us; UNKNOWN = not established.

## Answer

nickstire.org/tires searches by tire size only. Every year/make/model form we reached (Discount Tire,
Tire Rack, Firestone, Belle Tire, Walmart) leads with the vehicle; size is the second option. Mavis
and Goodyear were read from their tire pages only, not walked to the form; Costco was blocked. A customer who does not know
their size gets "Call the shop" from us (FACT, live page today). That is the biggest gap.

## Top 5 gaps, ranked by expected extra cars

| # | Gap | Who does it | What we would build | Effort | Cost |
|---|---|---|---|---|---|
| 1 | No vehicle picker | Discount Tire, Tire Rack, Firestone, Belle Tire, Walmart (seen) | Year > make > model > body type ("4 Dr Sedan", Belle Tire style, not trim codes like "LX-P") > OE size list > existing size results. Keep size search beside it. Keep "staff confirms fitment". Remember the vehicle on return visits. | 2-3 days (client + one server proxy route) | BUILT (#3148, live 2026-10-18) on D&K's own b2b quicksearch through the Gateway Tire login we already pay for: $0, no new vendor. Wheel-Size Basic ($450/yr, 5,000 hits/day, FACT developer.wheel-size.com) was the plan until a live probe showed D&K answers for our account. |
| 2 | Results are one flat list | Discount Tire | Three cards on top: "Factory match", "Our pick", "Lowest price", each with the installed price for 4. Full list below. | 1 day (client) | none |
| 3 | No year/make/model pages for Google | Belle Tire (`/tire-finder/2018/honda/civic` is a real page titled "Find Tires For Your 2018 Honda Civic"), Walmart (pages per make) | Prerendered vehicle pages, same pattern as our 40+ `/tires/<size>` pages. | 2 days + prerender | Not built. With D&K as the data source the open question moved: whether D&K's b2b terms allow cached make/model lists on public SEO pages (UNKNOWN; ask the Gateway rep before building). |
| 4 | Not in any online installer network | Tire Rack (10,000+ installers), SimpleTire, Priority Tire | Operator decision, no code. SimpleTire pays the shop $15-$24 per tire within 48 h (FACT, simpletire.com/installer-signup). Catch: "commit to in-taking the customer within 15 min of appointment time" (FACT) conflicts with first-come-first-served. Tire Rack Recommended Installer: phone 800-428-8355 x4195, requires their Price Pledge (CLAIM). | 0 code; 1 call each | $0 to join SimpleTire (CLAIM) |
| 5 | Quote does not travel | Discount Tire, Mavis, Firestone | "Text me this quote" and "Call about these tires" buttons that carry tire, qty, total and vehicle into the existing lead flow; payment programs and a price-match request shown next to the total, not only on /financing. Copy must say "Payment Programs", never "financing" (app brand rule). | 1-2 days | none (any customer SMS send stays operator-approved) |

Deferred: license-plate lookup. Discount Tire, Walmart and Costco have it, but it needs a paid
plate-to-VIN service on top of fitment data (Auto.dev from $599/month + $0.055 per call, CLAIM;
DriveRight Data is quote-only, CLAIM). Revisit after #1 shows how many people use vehicle search.

## Site by site (FACT unless marked)

| Site | Finder steps | Data source seen in network calls | Other levers on the page |
|---|---|---|---|
| Discount Tire | Vehicle > Trim (19 trims for a Civic, "Need help finding trim?") > OE size list ("O.E 215/55 R16", "optional sizes", "I can't find it") > What are you shopping for (tires / wheels / package) > Treadwell 2-question guide or all results | Own GraphQL proxy (`getYears`, `storeByIp`); vendor hidden | Store auto-set from IP before any click; plate lookup on step 1; saved vehicle with photo; results open with 3 cards (O.E. $170, Our recommendation $199, Lowest price $51) then "93 tire results from $51, these tires fit your vehicle"; "Get your tires INSTALLED TODAY" banner |
| Tire Rack | Year / make / model dropdowns + optional ZIP for "shipping and installer options" | Own fitment database (`/survey/ValidationServlet?autoYear=2018&autoMake=Honda`) | Free shipping to 10,000+ installers; free 2-year road hazard; pay later / 0% financing; tire decision guide |
| Firestone | Year, make, model, submodel and ZIP on one form ("ZIP code is needed for local pricing") | Own API (`/bsro/services/vehicle/get-makes?year=2018`) | Tire decision guide; lifetime rotations; 6-month financing + 5% off first purchase; My Garage |
| Goodyear | Find your tires; shop by vehicle type (truck, SUV, car, crossover, minivan) | not captured | Price match; 60-day satisfaction guarantee; online purchase support |
| Belle Tire | One question per screen: year (type-ahead) > make > model > body type; every step is its own URL | not captured | $100 manufacturer rebate banner; schedule service next to find tires |
| Mavis / NTB | NTB now redirects to mavis.com/ntb (one platform) | not captured | Price headline "All-season from $61.49, size 215/65R16"; same-day appointment; price match; extra $50 online-only on top of brand rebates; store card $25 back per tire |
| Walmart | Year > make > model > sub model > tire size; plate search; size search | not captured | "Buy tires & book install"; OnePay Later; links to 25 common sizes and every vehicle make |
| Costco | BLOCKED: tire pages returned an empty list and a 404 in this browser after 3 tries | - | Package per Perplexity (CLAIM, cites tires.costco): install at no extra charge, 5-year road hazard, lifetime rotation, balancing, flat repair, nitrogen |

Vendor note: no chain exposed a third-party fitment vendor; Discount Tire, Tire Rack and Firestone
all proxy through their own servers. Which vendor a chain licenses is UNKNOWN.

## What we already do better (keep it loud)

- New-tire install package included in the price (the page says chains charge about $266 for it).
- Used tires from $25 installed; plug repair from $25.
- Walk-in 7 days, Sundays 9-4.
- 4.9 stars, 1,715+ reviews, shown at the top of /tires.

## Our current code (for the build)

- `/tires` = `client/src/pages/TireFinderV2.tsx` (size only). `gatewayTire.publicSearch` takes `size`
  only (`server/routers/gatewayTire.ts:241`).
- The old vehicle tab lives in `client/src/pages/TireFinderLegacy.tsx:569-685`: an Ezytire widget
  whose default host is `test.ezytiredemo.com`; in production it showed only if
  `VITE_EZYTIRE_BASE_URL` was set (not checked in Railway). Treat it as retired.

## Evidence on conversion (honest version)

Perplexity found no public tire-specific study proving vehicle search beats size search, or that plate
lookup or good/better/best lifts sales by a set amount (UNKNOWN). The strongest general evidence is
checkout research: 40% of abandoners cite extra costs, 12% could not see the total up front (CLAIM,
Baymard via Perplexity). That supports showing the installed price for the set, which we already do.
Measure after shipping: searches by vehicle vs size, no-result rate, quote > call/text > arrival.

## Payment Programs provider APIs (Perplexity, 2026-10-18, CLAIM unless we read the doc page)

Nick's lists five providers (Kafene first, then Acima, Snap, Koalafi, American First Finance), all as apply links today.
Operator rule: never mark an order paid on a browser callback; prequalification, approval, signed agreement,
delivery/capture and funding are separate states at every provider.

| Provider | Website can create the application | Cart amount + items | Decision webhook | Funding trigger | Docs / sandbox |
|---|---|---|---|---|---|
| Koalafi | yes, GraphQL `apply` (Direct API) or hosted modal (hybrid) | `updateOrderItems`, `isLeaseable` flags; non-leasable items (install, fees) max 20% of the total | `lease.changed` (Ed25519-signed) | `markOrderDelivered` after the tires are on the car | docs.koalafi.com/docs/direct-api; sandbox endpoint published; headers public-dealer-id + private-api-key |
| Snap Finance | yes, Create/Update Application | `cartInformation` totals, tax, items with leasable flag | application-status webhooks (HTTPS listener) | Capture Application (flow-dependent) | developer.snapfinance.com; sandbox creds from devsupport@snapfinance.com; client id + secret, JWT |
| Acima | REST API + sandbox exist; endpoint docs only on request | UNKNOWN | UNKNOWN | UNKNOWN | acima.com/en/ecommerce inquiry form |
| American First Finance | partner API v2 described; current contract unverified | UNKNOWN | UNKNOWN | UNKNOWN | affapiv2.docs.apiary.io (not fully retrievable) |
| Kafene (featured) | yes, through its JS checkout SDK modal (`kafene.init` / `openCheckout`): apply, approve, sign, pay inside our page; a headless server-side application endpoint is UNKNOWN | yes, SDK passes items (id, name, price, qty), shipping, customer contact, order id; cart total checked against the merchant approval limit | SDK approved/completed callbacks; async webhooks UNKNOWN for the current Partner API | Partner API lease activation with the delivery date; funding = 100% of pre-tax merchandise less fees, ACH Mon-Fri, in the bank within 2 business days, 12:30 PM ET cutoff | sdk.kafene.com/docs/setup-guide (public); partner-docs.kafene.com (login); partner-api.kafene.com + staging-partner-api.kafene.com; auth = Merchant ID + Store ID + API key -> short-lived token; sandbox creds from the account manager; text-to-apply link in use (merchant MER-2PD3F, store STR-4ARMW); portal merchant.kafene.com; support merchants@kafene.com, (855) 206-4040 |

Kafene build plan (wave 3, after Nour gets credentials): embed the Kafene checkout modal on the order confirmation step
as a payment choice beside the card button; on the SDK "completed" callback store the Kafene application id on the
tire order (new column) and mark paymentStatus "lease_pending"; after install, the admin's "Mark installed" calls the
Partner API activation with the install date (one tap, protected); funding lands in about 2 business days. Never mark
paid on the browser callback alone; confirm by Partner API status lookup.

Fit with the shop: a tire order is mostly leasable goods (tires) plus install, which Nick's bundles free, so the
Koalafi 20% non-leasable rule is not a problem for tire orders; a labor-heavy repair invoice would be.

What to ask each provider (one message): "Provision our location for website-originated applications tied to a
cart; confirm eligible tires, parts, installation and labor; give sandbox credentials; document prequalification vs
final approval, agreement signing, signed decision webhooks, and the delivery/capture call that starts funding."

## Provider apply pages: what each accepts without merchant keys (manager RE, 2026-10-18, FACT unless marked)

Method: each provider's public apply bundle downloaded with curl and read for URL-parameter reads; Koalafi checked on
screen in the built-in browser with a fake number (216-555-0100, nothing submitted). Kafene's merchant portal and
application bundles were read the same way (no self-serve key path; integrations page gated to e-commerce stores; no
customer-side return hook; application link reads only its own JWT `t`).

| Provider | Our link today | URL parameters the apply app reads | Usable now | Keyed path (not in hand) |
|---|---|---|---|---|
| Kafene (featured) | gokafene.com/nKVEWWv (JWT for MER-2PD3F / STR-4ARMW) | t, token, userToken, redirect (internal), email_sent | none: hence `kafene.applyStarted` (order note + staff Telegram + admin lease row) | checkout SDK + Partner API, Merchant ID / Store ID / API key, e-commerce stores only |
| Koalafi | s.koalafi.com/GWPaPM -> epply.koalafi.com/?dealerPublicId=04fe63e5-...&cm=Text | dealerPublicId, pdi, orderId, phone, cm, appFlowType, language (en, es), referrer, launchPage, reviewPage, deviceType, parentDomain, hybridToken, oobaToken, contractToken | `phone=` prefills the first screen (seen on screen); loading the page already creates a Koalafi order, so never open it from automation | Direct API GraphQL (public-dealer-id + private-api-key): apply, updateOrderItems, markOrderDelivered starts funding; webhook lease.changed |
| Snap Finance | getsnap.snapfinance.com/lease/en-US/consumer/apply?ep=store-locator&merchantId=490295617&externalMerchantId=77661 | per entry point: merchantId, externalMerchantId, storeMerchantId, utm_*; ep=store-locator-prequal is the prequalification entry; uxId/paramId are Snap-issued | utm tags only; no phone, email or amount prefill | Platform API (client id + secret, JWT), sandbox from devsupport@snapfinance.com |
| American First Finance | americanfirstfinance.com/app/?dealer=25207&loc=1&src=UA&usetextpin=Y | dealer, loc, src, usetextpin, lang (sp), amount, currency, reference, return_url, oid, otype, osource, utm_content, cp_cust, cp_ftrack, clearapp, theme, statusCallbackUrl | amount + reference are copied into the application payload (tag the application with the set total and order number; display to the applicant INFERRED); return_url is host-allow-listed to americanfirstfinance.com, so no return to nickstire.org; statusCallbackUrl forwarded in the payload only, use UNKNOWN | partner API v2 (apiary), contract unverified |
| Acima | apply.acima.com/?app_id=lo&location_guid=loca-436877bd-...&utm_medium=merchant&utm_source=web | every query parameter is forwarded into the app's routes; app_id=lp routes to lease prequal | nothing beyond the location link; no phone, email or name prefill found | e-commerce REST API + sandbox by inquiry |

Built in #3152: `providerApplyUrl()` in `shared/financing.ts`; the order modal's Koalafi link carries `phone=` and the
American First link `amount=` and `reference=<order number>`. Operator note from the Koalafi screen: the dealer name there is
still "Moes Tire and Auto Euclid"; rename it in the Koalafi dealer portal.

### Kafene merchant portal, read from its public bundle (merchant.kafene.com, 2026-10-18, FACT)

- Backend `https://ingress.kafene.com/v1/`; bearer from `POST auth/login`, which can answer `request_otp_verification` and then
  needs `merchants/request-otp` + `merchants/verify-otp` (one-time code to the merchant phone on file).
- Portal operations seen: `applications/verify-phone-number` (Open Approval Lookup), `merchants/send-sms` (Text Application),
  `applications/all/merchant` (list with status counts), `applications/set-app-to-create-invoice`, `get-pricing-tiers`,
  `calculate-estimate`, `get-contract`, `cancel-application`, `add-lease-length`, `merchants/stores|employees|permissions`.
- `merchant.kafene.com/integrations`: "Only e-commerce stores are eligible to manage integrations"; no Add button. Keys come
  from the rep (support chat 2026-10-18: eligibility goes to the sales rep). The customer application page reads only its own
  JWT (`t`) and an internal `redirect`; no merchant return URL and no prefill parameters.
- Not built, decided 2026-10-18: a server-side portal client. Kafene's Cloudflare answers "VPNs are not allowed" to every
  kafene.com host from a VPN or datacenter exit (FACT from this machine's WireGuard exit, AS212238 Datacamp; Railway's egress is
  a datacenter too, STRONG INFERENCE), and device trust is a FingerprintJS Pro cookie (30 days) a server cannot carry, so a
  server client would be blocked or OTP-challenged every login. The main bundle's store actions are mapped (token in
  `Authorization`, JWT `exp` read client-side, no refresh; `applications/transferable-app { phoneNumber }` is the approval
  lookup; `merchants/request-otp|verify-otp` gate the /team page, not login); the request bodies live in lazy route chunks that
  the block kept unread. Nour chose the deep link: the admin order card's "Open Kafene portal (copies phone)" button.

REA (`rea-agents` 6.5.0, `analyze-web-bundle` through a headless Chrome) on the competitor tabs: Discount Tire exposed 107
GraphQL operation names and 38 routes (getFitment, getVehicleDetails, getSeoMake/Model/TrimDesc, storeByIp,
getCompanyVehicleLookUpByLPOrVIN, cart and quote operations, `/quotes/:quoteToken`); Firestone 12 endpoints under
`/bsro/services/`; Tire Rack's bundle gave nothing (1 script parsed). Useful mostly as a map of what a chain's finder
does; the manual bundle reads above found the parameters REA did not.

### Kafene merchant-portal wire contract (read from the public bundles 2026-10-18, FACT unless marked)

This is the PORTAL contract: it needs an employee login (email + password + the login OTP), residential egress and the
browser's device cookies. The three Partner API keys (Merchant ID, Store ID, API key) unlock a different host and auth,
`partner-api.kafene.com` `/v2/auth/token` (`server/services/kafene/partnerApi.ts`, already built), never this one; a keyed
integration goes there. Kept for a future portal-login client only. Base `https://ingress.kafene.com/v1/`; the
token goes in `Authorization: <token>` as stored; requests carry cookies (`withCredentials`), which is how the FingerprintJS
Pro device cookies (`fp_visitor_id`, `fp_request_id` on `.kafene.com`, 30 days) reach the API. No refresh endpoint; the JWT
`exp` is read client-side and a 403 `session_revoked` logs out. Learning mode (`production-learning-api.kafene.com`) is a
sandbox reachable only from a logged-in prod session (`learning/handoff` then `learning/exchange`).

| Call | Body | Reads |
|---|---|---|
| `POST auth/login` | `{ email, password }`; on error `type: "request_otp_verification"` (`details.recipient_last_four_digits`) the same call again with `login_token: "<6 digits>"`; resend = the first call again (30 s cooldown) | `data.login_data.{ user, token }`; nothing else marks the device trusted client-side (server-side, tied to the fingerprint cookies, INFERRED) |
| `POST applications/transferable-app` | `{ phoneNumber: "<10 digits>" }` (the dashboard's approval lookup tile, Statsig gate `transfer_approval_tile`) | `{ id, userId, firstName, lastName, phoneNumber, email, language, remainingApprovalAmount, expiredAt, storeName }`; errors `transferable_application_not_found`, `_insufficient_remaining_approval` (under $300), `_no_active_approval` (`details[0]`), `_declined`, `_merchant_categories_mismatch` |
| transfer chain | `POST applications/otp-sms { userId, phoneNumber, email, language }` (the CUSTOMER gets the code) -> `POST applications/otp-verify { token, userId, phoneNumber }` -> `POST applications/{appId}/transfer-remaining-approval { storeId, teamMemberId, merchantId, source: "merchant_dashboard", requestSource: "lookup" }` | the moved application |
| `POST merchants/send-sms` (text to apply) | `{ phone_number, store_id, employee_id, language: "English" }`; `store_id` from `POST merchants/stores { merchant_id }` (`stores_data[]`, active), `employee_id` from `POST merchants/employees { store_id }` (`employees_data[]`), phone must reduce to 10 digits | success only |
| `POST applications/all/merchant` | `{ page, query, application_status: string[] | null, funding_status: ["Funded"] | null, from, to, store_id | null, sales_persons }` | `data.applications_data.{ applications, current_page, item_count, page_count, status_counts }`; row fields include `id, first_name, last_name, phone_number, application_status, is_expired, expiration_date, approval_amount, remainingApprovalAmount, asset_price, store_id, updated_at, is_text_to_apply_app, lease_id, lease_signing_date, delivery_confirmation_date`. `application_status` values (Kafene's Applications page, knowledge.kafene.com/using-the-applications-page, read 2026-10-18): Incomplete, Cancelled, Expired (an approval expires after 45 days), Denied, Customer Action Required (security questions or sign agreement), Decision Pending, Enter Merchandise Details, Pre-Qualified, Approved (select lease option), Pending Delivery (set, confirm or awaiting delivery), Completed. Funded is NOT a status: it is the `$` indicator on a Completed row, and the list filters it through the separate `funding_status: ["Funded"]` field, never through `application_status` |
| `POST applications/{id}/add-item` (create invoice) | `{ item_id: [{ model_num, description, price, item_condition: "New", damage }], kafene_downpayment: 0, merchant_downpayment: 0, shipping_cost, asset_price, products_to_delete: [], loan: false, storeId }`; total at least $300 | then `POST applications/get-potential-pricing { application_id }` -> `pricing_data`, and `POST applications/add-lease-length { application_id, lease_length, hard_pull_needed: false, pricing_id, epo1_extension_days: 30 | null }` |
| `POST lease/{lease_id}/activate` | `{ sales_person, delivery_date: "YYYY-MM-DD", mark_as_delivered?: true }` (needs `can_set_delivery_date`) | Two cases (knowledge.kafene.com/scheduling-and-managing-merchandise-delivery, read 2026-10-18): a future `delivery_date` without `mark_as_delivered` only SCHEDULES delivery and the lease stays Pending Delivery, not funded; `mark_as_delivered: true` (same day, or later through Update Delivery) completes the lease and schedules funding. A client must never treat a scheduled lease as funded |
| `POST applications/set-app-to-create-invoice` | `{ application_id }`: a rollback to the invoice step, not a lock | |
| `PUT applications/cancel-application` | `{ application_id }` | |

Deep links the portal honours: `/applications?search=<text>` pre-fills the list search (whether it matches a phone is
NOT CHECKED); `/applications/<id>`; nothing opens the lookup tile with a phone. `applications/verify-phone-number` has no
caller in the merchant chunks (the applicant form uses it). Still unknown: the token lifetime and whether device trust
survives for a client without the fingerprint cookies (one real login would show both).

### Koalafi Direct API, modal and webhook contract (read from docs.koalafi.com `/docs/<slug>.md` 2026-10-19, FACT unless marked)

Method: the integration guide fetched as Markdown from the docs site's own `.md` endpoint (38 slugs tried from the saved
HTML nav and `/llms.txt`, 34 fetched; `apply`, `javascript-sdk`, `create-an-order` and `lto-testing-scenarios` are 404, the
live slugs are `sdk`, `create-order`, `lto-only-testing-scenarios`); 25 of the 34 read in full for this section (the
brick-and-mortar checkout pages, the two testing-scenario walkthroughs, banners, messaging, introduction and the plugin
index were fetched and skimmed, not read line by line). Nothing was sent to Koalafi's live API:
with no sandbox credential there is nothing a probe could prove, and the hosted apply page creates an order on load.

**The key is the gate, and it is not in the portal.** Every documented call in the guides, `createOrder` and `apply`
included, is shown with both headers (`public-dealer-id`, `private-api-key`). The docs name an "unprotected" class
authorized by the public id alone but list no member of it, so which calls are keyless is UNKNOWN until a sandbox key
exists. "During dealer onboarding you will be issued a public dealer id and a private api key" (docs/authentication). The
dealer portal (dealer.koalafi.com, store 67848, Store Details read 2026-10-19: Overview, Settings and Integrations in full; QR Code and Hang Tags
hold the hosted apply link and the text-to-apply keyword) offers no API key: Integrations shows only STORE PUBLIC ID (the `dealerPublicId` already in our
apply link) and a STORIS point-of-sale username and password (a different product; never copied). Webhook endpoints are
registered by "your Koalafi integration contact", not self-serve (docs/setting-up-your-webhook). Channel without a phone
call: integrations_support@koalafi.com (named on seven of the pages).

**No dormant client was built, on purpose.** A Direct API client that cannot be run against the sandbox is tested only
against our reading of these pages (the mocks-unlike-production trap); the keyed build is one PR, written TDD against the
sandbox the day the key exists (plan at the end of this section). What is live today without a key: the hosted apply link
with `phone=` prefill from the order modal and /tires, every click recorded by `financing.trackApplication`
(`financing_clicks` + the Sheet + the activity ledger), the Koalafi row on /financing.

Hosts: sandbox `https://application-edge-service.sandbox.koalafi.com/query` (the host root is a GraphQL playground with a
docs tab, sandbox only); production `https://application-edge-service.koalafi.com/query`. Optional `correlation-id` (a GUID)
is echoed into Koalafi's logs. GraphQL answers HTTP 200 on application errors: check `errors` (schema and validation,
`data: null`) and then each operation's error union by `__typename`; `FatalError` means retry unchanged.

Three integration types (docs/choose-your-integration-type): platform plugins (Magento, WooCommerce, Shopify; not us),
**Modal** (our design: Koalafi's iframe collects SSN, date of birth, bank and card data, so none of it touches our server),
and Direct API (we draw every screen and the card, SSN and bank fields pass through our server).

Modal SDK (docs/sdk): `<script src="https://ecomm-sdk.koalafi.com/koalafiSdk.js">` (sandbox
`https://ecomm-sdk.sandbox.koalafi.com/koalafiSdk.js`); `koalafiSdk.openModal({ orderId, pdi })` (hybrid flows add
`hybridToken` from the `x-hybrid-token` response header of `apply` or `customer`). The promise resolves
`{ orderId, approvalStatus: "preApproved", approvalAmount }` when approved with no items on the order, or `{ orderId }` when
the lease is signed; it rejects `{ orderId, reasonCode, reason }` with codes 1 genericError, 2 hardDecline, 3 ineligible,
4 cartAmtNotMet, 5 noCartItems, 6 cartAmtTooHigh, 7 generalCloseModal, 8 nonLeaseableTooHigh, 9 genericCartValidationErr.
A `closeModal` window event fires on every close, signed or not, so the order is read server-side after it.

| Operation (GraphQL) | Input | Returns | Error union |
|---|---|---|---|
| `createOrder(input: NewOrder)` | all optional: `details.customer { firstName, lastName, emailAddress, cellPhone (10 digits) }`, `items[]`, `shippingAmnt`, `taxAmnt` ("0.00"; only with items) | `order.id` (UUID; the session id for everything after) | FatalError, BadRequest, UnauthorizedError |
| `apply(input: ApplyInput)` | ecomm: `customer { firstName, lastName, cellPhone, emailAddress, taxpayerIdentificationNumber, birthDate YYYY-MM-DD, billingAddress { line1, line2, city, state, zip } }`, `employment { monthlyIncome }`, `orderId` (optional, created and returned if absent), `items` (optional), `analytics.directIntegrationChannel "online"`; B&M adds `payPeriod`, `lastPayDate`, `isPaidViaDirectDeposit`, `bankAccount`, `paymentInfo` | `orderId`, `canContinueInKoalafiUi`, `application.lease { id (= applicationId), displayId, status "preApproved", maxLeaseAmount, options [{ leaseTerm, approvedAmount, applicationFee, earlyBuyoutDiscount, sacTerm }] }`, `offerDetails { maxApprovalAmount, approvalLanguage, recurringPaymentDetails }` | `applicationErrors`: DenialError, FatalError, BadRequest, OrderNotFound, HardDecline (final; letter by mail), SoftDecline `{ declineField, appId, displayText }` (fix and resubmit; the third soft decline becomes hard), Ineligible `{ canContinueWithKoalafi, displayText }`, NotFound, LeaseRestricted (a state without leases), CartValidation `{ validationErrType, approvalType, approvedAmount, displayText }` (approved, cart wrong). Decline copy shown to the customer stays vague (fraud) |
| `order(id)` | the order UUID | `application.lease { id, status, amount, options, cartValidationDetails }`, `details { customer + billing/shipping addresses, items, shippingAmnt, taxAmnt }` | none documented |
| `customer(input: CustomerSearchInput)` | `{ cellPhone, taxIDLast4 }` | `orderId`, `customers[]`, `eligibility { displayText, canContinueWithKoalafi, offerDetails { approvalType, approvalLanguage, maxApprovalAmount }, application.lease { id, displayId, status } }` (the counter's "does this shopper hold an open approval" lookup) | `customerSearchErrors` |
| `updateOrderItems(input)` | `{ orderId, items [{ sku, price "0.00" (2 decimals, > 0), quantity, displayName, itemUrl, itemImageUrl, isLeaseable, category "merchandise" or "service" }], shippingAmnt, taxAmnt }`; send the whole cart once, right before the modal; coupons applied to item prices first | `order` | `orderErrors`: CartValidation (`validationErrType`: BadCartRequest, CartTotalDoesNotMeetMinimum, CartTotalExceedsApproval, CartTotalExceedsMaximum ($10,000), NonLeaseableItemsTotal (over 20%), ServiceFeesTooHigh (over 20%)), CartMinNotMet ($300 on this page; the apply-errors page says $200: which is current is UNKNOWN), ServiceFeesTooHigh, FatalError, BadRequest ("application already has docs signed" = the approval was already used; refuse a new order), NotFound (deprecated) |
| `updateOrderAddress(input)` | `{ orderId, billingAddress, shippingAddress }` (pass billing as shipping when there is none) | `order` | FatalError, BadRequest, NotFound |
| Direct-API checkout chain (ecomm, after preApproved; the Modal does all of this inside its iframe) | `updateEmployment { applicationId, paymentFrequency, lastPayDate, nextPayDate }`; `updateBankAccount { applicationId, bankAccount { accountNumber, routingNumber } }` (optional); `updateDebitInfo { applicationId, debitDetails { cardholderFirstName, cardholderLastName, cardNumber, expirationDate YYYY-MM } }` (authorizes the initial payment: preApproved becomes approved); `generateLeaseContract` then `signLeaseAgreement { applicationId, isSigned: true }` | `generateLeaseContract.details { welcomeLetter, leaseAgreement, summary { leaseTerm, leaseAmount, cashPlusPrice, cashPlusTerm, initialPaymentAmount, paymentFrequency, totalCostOfOwnership, scheduledPaymentAmounts } }` | BusinessError (dates), SoftDecline (internet-only bank; card data), HardDecline (third bad attempt), PrepaidCardError (prepaid cards refused), NotSigned. Any cart change after this repeats the whole chain |
| `markOrderDelivered(input)` | `{ orderId, estimatedDeliveryDate YYYY-MM-DD }` | errors only | FatalError (retry), InvalidApp, NotFound, BadRequest. This is Koalafi's "activate": it funds the lease and starts the customer's payments. For a tire order: after the tires are on the car |
| `refundOrCancelOrder(input)` | `{ applicationId, modificationReason "refund" or "cancel", adjustmentAmount "300.00" (at most the lease amount) }` | `transactionId` | FatalError, BadRequest |

Lease statuses (docs/application-statuses): draft, pending, preApproved (initial payment not yet authorized), approved,
errorsFound (`declineField`, `declineReason`), declined, expired (only from lookups), docsReady, docsSigned (place the
merchant order and keep the `orderId`), readyForFunding (delivered), approvedForFunding, funded. Our lifecycle:
apply -> preApproved -> (modal authorizes the initial payment) approved -> docsReady -> docsSigned -> we install ->
markOrderDelivered -> readyForFunding -> approvedForFunding -> funded.

Webhooks (docs/webhooks, updated 2026-06): one event, `lease.changed`, POST JSON
`{ type, version "1", timestamp (RFC 3339), data { leaseId, leaseDisplayId, orderIds[], newStatus, previousStatus,
publicDealerId, approvedAmount, financedAmount, customerSorID } }`, signed per RFC 9421 with Ed25519: `Content-Digest`
(`sha-256=:<base64>:` of the raw body), `Signature-Input`
(`sig1=("content-digest" "@method" "@target-uri" "content-type" "message-id");keyid="koalafi-prod";created=...;expires=...`),
`Signature` (base64), `Message-Id` (the idempotency key; the same event can arrive twice). The public key comes from
GraphQL `dealer { webhookConfig { signingKey { algorithm "ED25519", keyId, publicKey } } }` (`publicKey` is base64 behind a
`whpk_` prefix). Reject an unknown `keyid`, a future `created` or a past `expires`; answer 2xx at once and process after.
The sandbox fires one event per status transition.

Sandbox test data (docs/test-data, docs/using-our-api): every applicant is approved by default; each test needs a unique
10-digit phone and SSN (increment both); ecomm soft decline = billing line 2 `011000536` with zip `32034`, decline = line 2
`011000390` with zip `32034`; routing numbers in the Postman environment: 011000028 high approval, 011001234 hard decline,
011001276 soft decline, 011000536 soft decline (identity). The public Postman collection is marked outdated by Koalafi.

Business rules: cart $300 to $10,000 (SDK rejection codes 4 and 6); non-leasable items (installation, fees, warranties,
gift cards, non-physical goods, weapons) at most 20% of the total, so a tire order with free install is fine and a
labor-heavy repair is not; service fees at most 20% of the subtotal; prices 2 decimals above $0.00; an approval is
single-use (docs signed = used); ecomm vs brick-and-mortar is a partner-level setting Koalafi configures (ask which we
are: a B&M app can be finished in the dealer portal, an ecomm app only through the API or the modal).

Build plan for the day the key exists (one PR, mirrors the Kafene lane, TDD against the sandbox): env
`KOALAFI_PUBLIC_DEALER_ID`, `KOALAFI_PRIVATE_API_KEY`, `KOALAFI_ENV` (sandbox or production); server
`services/koalafi/directApi.ts` (createOrder with the customer and the cart, `order` after the modal closes,
markOrderDelivered on the admin's "installed" tap behind confirmDialog, refundOrCancelOrder on admin cancel) and a `koalafi`
router shaped like `kafene` (public config and start, admin deliver, cancel, status; every call answers `disabled` without
the env); client `KoalafiCheckout.tsx` loading the SDK once and calling `openModal({ orderId, pdi })`, never marking the
order paid on the browser promise: "lease signed" is `order.application.lease.status === "docsSigned"` read server-side;
a webhook route verifying `Content-Digest`, the Ed25519 signature and `Message-Id` before touching the lease row.

Dealer-portal facts (dealer.koalafi.com, 2026-10-19, FACT): store 67848; customers can also
text the keyword on the store's hang tags to Koalafi's text-to-apply number (a /financing copy candidate, no code; the
exact keyword and number are on the Hang Tags tab); "Copy Application Form URL" is the same hosted apply link we use;
the merchant dashboard is a separate app at merchant.koalafi.com/dashboard/applications. On the Settings tab the
FRIENDLY NAME is still "Moes Tire and Auto Euclid": the 2026-10-19 Edit > Save to "Nick's Tire & Auto" did not persist
(the field read the old value after a reload); the "Reset Password" button sits beside "Copy Application Form URL" on that
page, so the rename is Nour's own click. A later `rea`-style bundle read of the dealer portal is not needed: nothing it
exposes replaces the key.

## Sources

- docs.koalafi.com integration guide, fetched as `/docs/<slug>.md` 2026-10-19 (25 of these read in full, see Method): introduction, getting-started, key-concepts-1,
  choose-your-integration-type, authentication, using-our-api, direct-api, create-order, apply-for-financing,
  lease-approval-checkout, lease-approval-checkout-bm, lease-flow-from-pre-approved-docs-signed, completing-an-order,
  order-lookup, refunds-and-cancellations, hybrid-custom-apply-modal, in-store-checkout, sdk, use-our-experience,
  approval-first, shop-first, webhooks, setting-up-your-webhook, verifying-webhooks, application-statuses,
  handling-common-errors, test-data, testing-scenarios, lto-only-testing-scenarios, buttons, banners,
  promoting-koalafi-lease-to-own-on-your-website, ecommerce-site-plugins; plus `/llms.txt`
- dealer.koalafi.com Store Details (Nour's login, read in his Chrome 2026-10-19; nothing submitted except the rename attempt)
- Perplexity thread 1 (vendors, pricing): https://www.perplexity.ai/search/5538eeb0-3f75-44ad-9f50-074279f481d4
- Perplexity thread 2 (conversion, installer networks, Costco): https://www.perplexity.ai/search/9066841a-df16-40ea-9e92-775ea240b11b
- https://developer.wheel-size.com/ pricing section, read 2026-10-18
- https://www.simpletire.com/installer-signup, read 2026-10-18
- Live pages walked 2026-10-18: discounttire.com, tirerack.com, firestonecompleteautocare.com/tires,
  goodyear.com/en-us/tires, belletire.com/tire-finder, mavis.com, mavis.com/ntb, walmart.com/cp/tires/1077064,
  nickstire.org/tires
