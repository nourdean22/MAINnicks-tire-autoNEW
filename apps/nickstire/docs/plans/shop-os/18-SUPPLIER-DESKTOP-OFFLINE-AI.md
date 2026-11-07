# Shop OS extension: sourcing, desktop work, and offline AI

**Job:** 2026-11-06 Shop OS plan extension. **State:** design and planning only. No supplier adapter, desktop automation, local model, PC cleanup, or `/system` screen is authorized by this document to run in production.

## Goal

At the counter, let the crew price the exact repair part or tire against every supplier the shop is permitted and configured to use, compare the real delivered or pickup cost and arrival time, then choose an offer and review the supplier order themselves. Keep the CRM, vendor portals, shop PC, and AI connected through explicit, auditable handoffs. Add an offline model only if it improves the shop's real work on the actual front-desk hardware. Do not claim the whole CRM is offline while its database and application still depend on Railway and the internet.

Success means fewer minutes lost searching, fewer parts that arrive late or wrong, better tire availability, protected margin, fewer owner interruptions, and no mistaken order, unauthorized purchase, stale-stock promise, or lost customer/job record.

## Decisions and boundaries

1. **Core ledger remains a day 13-14 decision.** The latest roadmap recommends buying the repair-order ledger and building the shop-specific operating layer at `nickstire.org/system`. The user earlier approved a custom core; the timed vendor bake-off decides. Keep ALG live until the selected path passes the reconciliation and counter-speed gates.
2. **Use permitted supplier interfaces.** Prefer a documented partner API, approved catalog API, punchout cart, or vendor-supported order handoff. Study publicly visible workflows and screenshots from an account Nour is authorized to use. Here, "reverse engineer" means learn the workflow and recreate its useful interaction pattern. It never means scrape behind sign-in, call private endpoints, defeat bot controls, copy licensed catalogs, or violate vendor terms.
3. **No order without a person.** Search, compare, prepare a draft, and open the supplier's supported cart. A person checks the part, quantity, supplier, location, price, core/deposit, ETA, and total, then explicitly places each order. Never auto-buy, auto-substitute, or send a customer quote/text without its existing approval tap.
4. **Keep commercial data bounded.** Each adapter follows its supplier's data, caching, rate, and ordering terms. Retain selected offer/order/invoice evidence needed for the shop's own accounting and reconciliation. Do not build an unrestricted, retained competitor-price database.
5. **The offer set is finite and named.** The UI says "best among connected suppliers that responded" and shows missing, stale, and unavailable suppliers. It never claims best in the market when a source did not respond.
6. **No spend is assumed.** Start with current accounts and no-cost trials already in the roadmap. New API fees, paid local-AI tooling, vendor contracts, accounts, or subscriptions stay parked for Nour's go.
7. **Model inference is optional and non-authoritative.** The database, supplier response, catalog fitment, labor guide, shop price rules, and human approval are authoritative. A model may summarize or draft; it cannot invent compatibility, stock, prices, labor times, safety facts, or approval.

## Supplier candidates to evaluate

The first requested cohort is **AutoZone Pro, Parts Authority/IMC, and the existing D&K/Gateway Tire path**. O'Reilly and other bookmarked sources follow after this cohort. This is a priority list, not proof that the shop has active accounts, API access, approved automation rights, current pricing, or integration. Record each account, branch, supported catalog/order actions, terms, fees, and test evidence in 03-VENDORS and 13-TOOLKIT; unresolved entries stay UNKNOWN. Provider-specific public evidence, existing code reuse, REA availability, and integration gates are tracked in [20-SUPPLIER-INTEGRATION-START](20-SUPPLIER-INTEGRATION-START.md).

## Shop browser bookmark ecosystem

The counter depends on the whole Chrome bookmark bar, its overflow menu, and the portals behind those links. On 2026-11-06 I indexed the shop-profile bookmark metadata matching the supplied screenshot (titles and host names only): **38 top-level bar entries and 3 synced entries**. The 2026-11-05 screenshot also shows two clipped labels, `Admin upgrade: eve...` and `10/24 FRESH`, that do not map to entries in that snapshot; keep both UNKNOWN until their owner identifies them. The screenshot shows the overflow menu is scrollable. A bookmark proves a shortcut exists, not current use, login state, account authority, or integration rights. No password, cookie, customer record, unique document ID, or full search URL is retained here.

| Work area | Saved bookmark labels and safe destination | CRM treatment to evaluate |
|---|---|---|
| Labor and repair information | REAL TIME LABOR (`autolaborexpert.com`) | Replace the ALG/ShopDriver lookup only after MOTOR/licensed labor options are compared. Record labor source, operation, vehicle match, license terms, and estimate-line link. No copying protected labor tables. |
| First requested supplier cohort | AUTOZONE PRO (`autozonepro.com`); gatewire TIRE and `arrel` (`dk7001.treadsearch.com`); Web Warehouse Powered by PA \| IMC (`imcparts.net`) | AutoZone, D&K/Gateway, and Parts Authority/IMC are the first counter search cohort. `arrel` is a second bookmark into the D&K site (checkout path), not a new supplier. See [20-SUPPLIER-INTEGRATION-START](20-SUPPLIER-INTEGRATION-START.md). |
| Other parts catalogs and sources | O'Reilly First Call (`firstcallonline.com`); FEDERATED (`federatedlink.com`); Car Parts Warehouse - Parts-Plus+WebShop (`nexpart.com`); Car Parts Warehouse - CONNECTION (`acdelcoconnection.com`); Premium Guard Filters (`pgfilters.com`); Car-Part.com (`car-part.com`) | Add after the first cohort or where a measured job needs them. Compare official catalog/fitment, grade, branch stock, landed cost, promise, cart, invoice, returns, cores/credits, terms and export. Treat Car-Part as a separate used/recycled-parts workflow; do not merge its interchange or condition evidence with new parts. Premium Guard is a brand source unless a distributor-approved path exists. |
| Tire, wheel and inventory sources | `- Tire Finder` and Capital Tire. (`capitaltire.net`); ATD ONLINE (`atdonline.com`); XPRESS TIRE (`xpress-tire.com`); wheel pros and Welcome to Wheel Pros (`wheelpros.com`, duplicate home shortcut); ELITE TIRE AND WHELLE (`ewwfl.com`); cleveland wholesale tire (`tirebase.io`) | Normalize tire size, load/speed rating, vehicle fit, brand/grade, per-tire vs set price, location, quantity, ETA meaning, installation package, warranty and returns. Keep new tire sourcing separate from shop-inspected used-tire inventory. |
| Customer financing / merchant programs | Acima (`acima.com`); Progressive \| ProgCentral (`progleasing.com`); SNAP Finance (`snapfinance.com`); Koalafi Merchant Dashboard (`koalafi.com`); AFFPORTAL (`americanfirstfinance.com`); Sezzle (`sezzle.com`); SYNCHRONY (`synchronybusiness.com`); Kafene (synced shortcut) | Prefer provider-supported application handoffs. CRM may carry an RO reference and the minimum status needed for staff follow-up; never make a credit decision, silently fill an application, promise approval, or store financing credentials in supplier services. Capture disclosures, consent, result, settlement and refund handoff. |
| Payment, banking, insurance and telecom | CC MACHINE LOGIN (`maverickpayments.com`); U.S. Bank (`usbank.com`); FEDERATED also appears above; Verizon ACC (`verizonwireless.com`); Global Call Settings - Incoming Calls \| Spectrum Voice Manager (`spectrumbusiness.net`) | Keep payment authorization and bank access outside the sourcing adapter. Link to the approved terminal/program or record only an allowed transaction reference and reconciliation result. Phone settings are owner-controlled operations, not CRM automation. Confirm Federated's role with the account owner before categorizing it beyond its parts-catalog use. |
| Customer contact, scheduling and admin | gmail (`mail.google.com`); Work Schedule - Google Docs and an unlabeled Google Docs shortcut (`docs.google.com`) | Use an approved mail/calendar connector only for defined, permissioned tasks. Keep a single schedule source of truth. Customer sends need explicit approval. This plan intentionally omits document IDs, email contents, and saved query parameters. |
| General retail / other references | AMAZON (`amazon.com`); EBAY (`ebay.com`); fiver (`fiverr.com`); DoorDash (`doordash.com`); moe's euclid - Google Search (`google.com`); RealForeclose - Cuyahoga County Sheriff (`ohio.gov`); a GitHub saved-page shortcut | Keep outside repair quoting by default. If an owner identifies a shop use, document it as a manual handoff first. Do not auto-buy or import marketplace catalogs. |
| Screenshot-only / unclear | `Admin upgrade: eve...`; `10/24 FRESH` | Destination, owner, purpose and whether it belongs in Shop OS remain UNKNOWN. |

The bar metadata is a **complete shortcut inventory**, not a complete reverse-engineering pass. REA has so far used isolated launch-mode Chromium with empty storage: Parts Authority's public Web Warehouse entry page was observed; ATD's public login/registration page was observed; the D&K page returned Cloudflare's bot-verification screen; AutoZone Pro returned `ERR_HTTP2_PROTOCOL_ERROR`. A broader multi-site capture exceeded REA's 30-second limit and was not accepted as complete evidence. The live Chrome session exposes no loopback CDP endpoint to REA, so its saved logins and authenticated pages have not been read. An attempt to open Chrome's `chrome://inspect/#remote-debugging` screen was rejected by the computer-use URL policy, which forbids reaching the same result through raw CDP, browser commands, or another browser surface. Treat that as a hard stop in this environment; do not switch browser surfaces or connection methods to inspect this session. Continue with public documentation and redacted screenshots the operator chooses to provide; a logged-in tab alone does not clear the refusal. Never defeat a bot check or infer the private signed-in flow from a public landing page. Evidence IDs and current limits are in [20-SUPPLIER-INTEGRATION-START](20-SUPPLIER-INTEGRATION-START.md).

**Update 2026-11-06:** the hard stop above is specific to the REA/Codex route (isolated launch-mode Chromium, no CDP into the real session). A separate, already-sanctioned connector — Claude in Chrome, used in a Cowork session with Nour's own already-signed-in AutoZonePro tab, operator present throughout — did complete an authenticated capture of AutoZone's My Zone search/product-results flow that same day. It establishes endpoint shapes, auth model and availability/pricing schema only, not account API eligibility; full detail, limits and what was explicitly not stored are in the "Browser evidence captured 2026-11-06 (Claude in Chrome...)" section of [20-SUPPLIER-INTEGRATION-START](20-SUPPLIER-INTEGRATION-START.md). Parts Authority, D&K/Gateway and ATD remain as REA left them above.

The screenshot contains a customer record; never copy its name, phone, email, VIN, tag, ticket number, or page URL into product documentation, research fixtures, prompts, or training data.

### Reverse-engineering workflow for each shortcut

For every listed shortcut, record only: exact label, approved host, shop purpose, operator/owner, frequency and time cost, inputs, outputs, steps, decision points, common failures, approval/spend boundary, data copied, license/terms, integration method, and a screenshot with customer data removed. Observe a normal authorized session and a representative task with the account owner; do not extract cookies, passwords, private APIs, or customer records. Mark a site **candidate**, **public landing observed**, **verified workflow**, **approved integration**, or **not in CRM scope** with a dated evidence receipt. A bookmark alone never counts as an integration. For blocked/slow sites, narrow to one controlled page capture and use official documentation or a visible vendor handoff; do not repeat a timed-out bulk run unchanged.

Turn the inventory into a **counter reference shelf** in the RO workspace: group tools by task, show whether an action is native, connected, or a visible portal handoff, and preserve a direct link for unsupported steps. Prefer one underlying system of record over copying data across sites. Provide explicit return paths to the RO, a source and timestamp for imported facts, and a manual fallback when a portal is down. Do not embed browser credentials or silently automate financial, customer-send, or purchase actions.

## Architecture

```text
Customer / vehicle / concern
        |
        v
One RO and its estimate lines in the selected core ledger
        |
        +--> Sourcing service --> PartsTech/OEC adapter, D&K adapter, approved direct adapters
        |                       --> normalized offers + freshness and source evidence
        |                       --> fitment/arrival/landed-cost ranking
        |                       --> crew chooses offer --> human confirms supplier order
        |
        +--> Customer approval link --> explicit per-line approval receipt
        |
        +--> Tech board --> blocker, bay, job clock, findings/photos --> estimate update
        |
        +--> Invoice/payment record --> existing terminal/program flow --> daily reconciliation
        |
        +--> Event/audit trail --> owner dashboard, returns/cores, supplier score, local AI drafts

Shop PC PWA --> Railway/tRPC and supplier-approved web/API flow (online)
      |         `--> optional local worker pulls a bounded AI job over outbound HTTPS
      `--> optional, separate offline-mode project; never implied by local inference alone
```

The selected repair system owns the operational repair-order ledger. Nickstire owns its customer-facing site, the shop-specific `/system` experience, and its own business reporting. Until cutover, ALG remains the live record. Do not write the same repair order into two ledgers without a named reconciliation owner and a tested handoff.

### Supplier adapter contract

A single sourcing service fans out bounded searches to explicit adapters. Each adapter declares:

- Supported actions: catalog search, fitment, quoted price, stock/branch, delivery or pickup promise, cart creation, order placement, order status, invoice/receipt, return, core, and credit. Unsupported actions are explicit.
- Supported product families, account/location scope, terms URL/date, authentication type, rate limits, cache rules, required credentials by **name only**, last health result, and an owner for failures.
- A normalized offer with supplier and branch IDs; exact supplier SKU/manufacturer/brand/grade; request and fitment inputs; match grade and evidence; quantity requested and available (or `UNKNOWN`); item price, core/deposit, fees, delivery, tax treatment, and total cost; location and distance; promise semantics (pickup ready, dispatch, or arrival at shop); estimated arrival and last-verified time; quote expiry; adapter/source identity; warnings; supported next action.

An adapter cannot turn missing, timed-out, ambiguous, or stale data into zero price, zero distance, or "in stock." It returns `UNKNOWN` or a typed failure with a useful reason. The UI can show partial results while a supplier is slow, but labels them as partial.

### Search and ranking

1. Resolve and confirm the correct customer, vehicle, and job. Use VIN or exact vehicle/tire dimensions when available; do not silently pick among multiple vehicles.
2. For repair parts, send the verified job/vehicle and exact requested specification. Keep OEM/aftermarket grade and brand visible. For tires, match size plus load/speed rating and vehicle fitment; support new tires from suppliers and used tires from the shop's separately inspected, per-unit stock.
3. Query connected sources in parallel under a fixed timeout and rate budget. Preserve which sources were queried, succeeded, failed, timed out, or were not configured.
4. Reject unsafe or incompatible offers first. Then reject offers that cannot meet the job's required-by time if the user set one. Do not promote an uncertain cross-reference as an exact match.
5. Rank valid offers by delivered or pickup-ready time and total landed cost (part/tire price + core/deposit + fees + delivery or driver trip + applicable tax). Incorporate live route time only when it can change the decision and the route service is available. Use observed supplier lateness and a documented shop wait-cost rule as tie-breakers, not an invented ETA.
6. Show at most three clear choices: **Lowest total**, **Fastest ready**, and **Best fit for this job**. One line explains the evidence and trade-off. The labels collapse to fewer options when evidence is insufficient.
7. Retail price and gross-profit guardrails come from shop-owned price rules, not supplier cost plus a guessed markup. If the source cost changes or the offer expires before order, refresh and require the counter person to accept the new numbers.

A simple score is not allowed to hide hard constraints. Safety/fitment and required-by time are gates; price, travel, delivery, supplier reliability, and bay waiting cost are ranking inputs. Never call a distance-only calculation "closest" when route time or supplier availability is unknown.

### Order and reconciliation lifecycle

`searched -> offer selected -> estimate draft -> customer approved (if required) -> order preview -> human submitted -> supplier acknowledged -> partial/backorder/in transit/ready -> received/verified -> installed -> invoiced -> reconciled`.

- Persist the offer snapshot used on the estimate, source time, quote expiry, selected supplier/branch/SKU, and decision receipt only within the supplier's permitted retention scope. If quote retention is unlicensed or UNKNOWN, retain allowed task/audit metadata and use a vendor-hosted reference or re-query; do not copy the payload into history, backups or AI memory. PartsTech's developer agreement limits data storage to order-by-order accounting; resolve the pre-order estimate workflow before adoption (20).
- Before checkout, re-query price/stock where the supplier supports it. Show any change and require a new tap.
- Use an idempotency key and supplier order reference so retries cannot silently create a duplicate order. A timeout after submit is `ORDER_STATUS_UNKNOWN`; check status before retry.
- Record supplier acknowledgement, partial fills/substitutions, delivery/pickup, received quantity, actual invoice cost, returns, cores, and credits against the RO and line.
- Reconcile quote cost against actual cost and promised against actual arrival. Feed this into supplier reliability and realized-cost reporting.
- Build a human-readable, cancel/resolve path for wrong fitment, backorder, stale price, duplicate response, return, core, and supplier outage. Never discard an exception because the vendor webhook did not arrive.

## User experience and screen/flow design

### 1. `/system` search and arrival

One counter search accepts phone, name, plate, VIN, or RO. Results pair customer and vehicle where the evidence supports it. A new walk-in starts with a confirmed vehicle or an explicit "vehicle not known yet" state. Walk-in/first-come order remains visible; creating a record does not invent an appointment.

### 2. `/system/ro/:id` repair-order workspace

- Header: customer, confirmed vehicle, RO, current state, created/updated time, and saved/sync health.
- Left/work area: concern, inspection findings, job cards, estimate lines, approvals, blocker, technician, and promised time.
- Right drawer: contextual parts/tire source search for the selected line. It carries the verified vehicle/job context but lets the user correct it.
- Sticky money bar: proposed, approved, deferred, tax/fees, retail total, supplier cost evidence, gross-profit status, deposit/payment state, and remaining balance. Separate supplier cost from customer-facing price.
- A sourcing offer card shows exact match evidence, brand/grade, branch, stock quantity or UNKNOWN, last checked, price, core/deposit, delivery/pickup promise, route time when available, and the reason it ranked. Show the source name and open-source/portal link.
- Actions: Add to estimate, compare, refresh, open supplier, prepare cart, order preview, mark received. Purchase actions require a clear second review and human tap. No hidden auto-submit.
- If offline or a supplier is unavailable, preserve the draft, show what did and did not sync, and explain the allowed next step. Do not imply an order or approval was saved when it was not.

### 3. Quick tire quote `/system/quote`

Start from vehicle/plate/VIN or manual tire size. Confirm the fitment before ranking. Capture quantity, new/used, intended axle/set, load/speed requirement, customer wait/drop-off, and the time the car needs the tire. Compare connected new-tire suppliers and actual in-house used-tire units. Show per-tire and installed set prices, mounting/balance, TPMS and disposal/other fees, tax, exact stock/arrival, and warranty/condition evidence. Add the chosen quote to one RO with one action. A missing supplier response stays visible as missing; the page never fabricates inventory.

### 4. Supplier drawer and portal handoff

When a supported API/punchout exists, use it. If not, the fallback opens the official portal at the correct supplier, signed-in operator profile, and query context. It may prefill a supported search or copy the SKU and quantity for the operator. Keep the browser window visible, identify the supplier and account, and pause for the person to review and submit. Capture the supplier's returned confirmation/reference only through a permitted, observable mechanism. No background scraping or unrestricted computer-control agent.

### 5. Board, tech, and customer approval

The arrival-order board shows distinct blockers: approval, part/ETA, bay, technician, pickup. The tech view records findings/photos against the job and exposes NEED PART / NEED APPROVAL / NEED INFO / READY QC. The customer link approves or declines exact frozen estimate lines; opening a link is not consent. Only after a person confirms the finding and line does it become a supplier search/order candidate.

### 6. Owner controls and reporting

Settings hold supplier on/off, approved accounts/branches, source timeouts, allowed product classes, retail price floors, and AI lane switches. Secrets stay in Railway or the approved credential store; no secret in a row, browser note, prompt, or repository. Every setting change has actor, old/new values, time, reason, and undo where safe. Reports include searches, source coverage, chosen offer, why it won, actual price/arrival, returns/cores, quote-to-sale, and gross profit; unknown outcomes remain unknown.

## Shop PC and computer-connected workflow

**Candidate:** MECHANICS, the front-desk PC from the 2026-10-30 inventory. The old snapshot says Ryzen 5 7520U, 16 GB RAM, integrated graphics, faster-whisper on CPU; all must be re-read before install or cleanup. NattyNour travels. NicksMax is a separate lot/camera machine; the old snapshot says i5-5350U, 7.9 GB RAM, and CPU saturated by camera work. Do not redirect Shop OS work to NicksMax or change its camera stack.

Before cleanup, inventory installed apps, startup entries, disk use by folder, free RAM, CPU/GPU, active camera/audio/phone services, backup status, and restore path. Get an owner for each process or app. Propose a reversible list first. Preserve vendor/browser profiles and sessions, customer/work data, passwords/keys, device drivers, camera/sign/voice/Whisper workloads, logs needed for incident recovery, and any app owned by another running session. Make one change at a time and verify the front desk, calls, camera, microphone, browser, printing, and Shop OS after it. Deleting files, uninstalling apps, disabling startup services, or changing production/device config is a separately confirmed action; this plan does not authorize those actions.

Keep `/system` as the existing React PWA unless measurements prove a separate desktop shell is worth maintaining. A local computer bridge, if required, is a separate, signed, allowlisted worker. It can open approved vendor sites and perform bounded, visible actions. It cannot execute arbitrary shell commands, read unrelated files, export browser cookies, or place supplier orders without a person.

## Offline model and complete harness

### Truthful offline boundary

A model running on the shop PC can infer locally without a model API. The current Shop OS backend and ledger are planned on Railway, so a PC-local model does **not** make the CRM or its customer/job data usable with no internet. Phase 1 is local inference when the PC is online to the Shop OS queue. Full offline CRM mode is a separate project requiring encrypted local storage, durable outbox, sync/conflict rules, device identity, backup/recovery, offline permissions, and replay tests. Payment capture, supplier orders, customer sends, approvals, and money-changing actions remain unavailable offline unless a later signed design explicitly defines and verifies them.

### Model selection gate

Test plan adopted 2026-11-07 (doc 38): first pull `qwen3.5:4b-q4_K_M` as `nicks-prod-8k`, challenger `lfm3-vl:2b-q4_K_M`,
the 64-case golden set and gates in doc 38 s.3, Windows Ollama settings in its row 11; nothing below is replaced by it.

Do not hard-code Gemma 3 4B or any other model as "best." Gemma 3 4B was a candidate in the October plan, not a verified production choice. Refresh hardware and benchmark a small, legally usable set from publisher sources. Compare CPU and supported iGPU backends, quantizations, real prompt length, concurrent faster-whisper/camera use, RAM headroom, thermal behavior, disk, startup, crash recovery, and license. Choose the smallest model that passes the shop-specific quality and latency gates; if none passes, keep deterministic rules and the approved cloud fallback or no AI for that task.

### Worker and harness

- A local worker pulls a bounded job from the server over outbound HTTPS using lease/heartbeat/claim-before-act semantics. No inbound PC port or VPN is required. Ollama remains loopback-only unless a later security review proves another route necessary.
- Jobs carry only task-minimum fields. Avoid writing customer names, phones, plates, VINs, or full invoices into model logs. Temp content expires/deletes. The server remains the only durable customer-record store in Phase 1.
- Model output is schema-validated, source-linked, and marked `draft`. Invalid/timeout output becomes unavailable/UNKNOWN, not an empty factual answer. Deterministic code owns fitment, arithmetic, price floors, legal rules, stock, and order state.
- Version/pin model digest, quantization, runtime, prompt/eval version, machine, driver/backend, and configuration. Log latency, token rate, memory/CPU/GPU use, fail rate, schema-valid rate, and human correction/rejection, without logging sensitive payloads.
- The golden set covers vehicle/part/tire fitment, ambiguous VINs, stale or contradictory stock, price/core/fee arithmetic, partial results, vendor timeout, no data, unsupported source, customer-facing drafts, work-history summary, task/tool selection, prompt injection in supplier text, and offline/reconnect behavior. Use synthetic or redacted examples and known answers.
- Gate quality on zero invented specs/prices/stock in the safety suite; correct citations/provenance; explicit abstention on UNKNOWN; no unauthorized tool call; and the existing shop-PC limits (median draft under 30 seconds and faster-whisper real-time factor under 0.5 while concurrent). Report p50 and p95. If the model harms whisper, calls, camera, or counter responsiveness, unload it or roll back.

## Delivery order and go/no-go gates

| Stage | Deliverable | Gate |
|---|---|---|
| 0. Reconcile | Refresh the 06 owner choices, vendor account list, screenshots, device inventory, current code/production truth, and active work owners | No guessed supplier, workstation, or credentials; no conflict with an active PC/camera owner |
| 1. Terms and capability | One matrix for each supplier: permitted data/search/order steps, auth, fees, stock/ETA semantics, restrictions, returns/cores, support and exit/export | Written/documented permission and test-account proof before an adapter can order |
| 2. Read-only sourcing | Reuse D&K/Gateway; add approved read-only offers for AutoZone Pro and Parts Authority/IMC when the account's documented interface is authorized; visibly hand off where not | All three source statuses are honest; match/price/stock fixtures pass; no purchase endpoint enabled |
| 3. Counter quoting | Tie repair-part and tire offers to estimate lines, fitment, retail floor, and ETA; compare against current manual time | Timed on real ticket types; target >=20% faster quote without weaker accuracy or margin |
| 4. Order handoff | Preview/order state, idempotent retry, confirmation, receipt/return/core/credit reconciliation | Human approval demonstrated; no duplicate or phantom order in replay |
| 5. Desktop handoff | PWA + visible official portal fallback for unsupported sources | No credential leakage, hidden scrape, or unconfirmed submit; browser outage has manual route |
| 6. PC clean-up and local AI | Baseline, owner-approved reversible cleanup, model bake-off, eval harness, worker/heartbeat/rollback | Shop services remain healthy; quality/latency/resource gates pass; no new spend without go |
| 7. Limited pilot | One counter lane, chosen suppliers, replayed ugly cases, one daily close at a time | Reconcile every money/stock difference; ALG stays live until all original cutover gates pass |
| 8. Optional full offline CRM | Separate architecture and implementation only if measured outage loss justifies it | Encrypted data, conflict-free replay, recovery drill, and approved action policy all proven |

## Success measures and kill conditions

Track quote time; connected-source coverage; verified exact-fit offer rate; availability/ETA accuracy; selected offer's savings versus the next valid offer; supplier cost and delivery variance; wrong/partial/backordered rate; parts-blocked minutes; tire quote-to-sale; margin; return/core/credit recovery; owner interventions; local-model latency/resource cost; and operator overrides. Define numerator, denominator, time window, source, and UNKNOWN handling before publishing a metric.

Stop or roll back on a duplicate supplier order, wrong/unsafe fitment, cost/approval mismatch, customer or vehicle data leak, order made without the person's action, source terms violation, lost ticket, broken camera/call/Whisper path, repeated worker crash, or unexplained daily-close difference. A supplier's silence is not proof that the cheapest or fastest offer was found.

## Benchmark receipt

Benchmarked against: PartsTech/OEC's published catalog/punchout and MOTOR integration path in the existing 03/13 study; Nickstire's live D&K `gatewayTire` / `gatewaySupplierOrder` path; and the screen mechanisms already reviewed in 14 (keyboard-first search, quick tire quote, source explanation, explicit approval). Adopt: one normalized, capability-declared sourcing service and visible ranked offers. Reject: one custom connector per supplier without a shared contract; hidden browser scraping; AI choosing or buying. Current vendor docs, account permissions, current pricing, and exact portal capability must be re-verified from primary sources before implementation; the older toolkit census is dated 2026-10-30.

## Open decisions retained for Nour

The existing 06-OPEN-QUESTIONS decisions still stand: named counter lead, active supplier accounts/branches, PartsTech access/terms, final core ledger after bake-off, crew roles, ALG API-map window, QuickBooks use, and approval roles. New decisions: exact front-desk computer/cleanup window; which supplier accounts may be used for a test; acceptable quote-time and source-coverage target; whether any paid source/model is in scope (default no); and whether a separately funded offline-CRM phase has enough outage value to justify encrypted local customer data.

## Supplier continuation contract (2026-11-06)

The detailed source ledger, AutoZone screen mapping, documented IMC transfer pattern, D&K code gaps, CRM logical records, bookmark alias routing and implementation slices now live in [20-SUPPLIER-INTEGRATION-START](20-SUPPLIER-INTEGRATION-START.md). This is a continuation of the current plan, not a second supplier subsystem.

- **Evidence:** public docs, screenshot-reported affordances, current code, historical REA captures and owner-reported login are distinct. None establishes account API permission. The existing browser refusal stops this session's authenticated inspection; use public sources and operator-provided redacted screenshots.
- **D&K:** reuse only the vendor-approved portions of the existing client. Order payloads are described in code as portal-bundle-derived. `gatewayOrder.prepare` can write the supplier cart when ordering is enabled; never use it as a read-only health/quote probe. Do not change the ordering flag in this planning task.
- **Fitment/stock:** cached retail search and curated-catalog fallback are not fresh wholesale offers. Missing load/speed or vehicle qualifiers remain UNKNOWN; cutoff is not an arrival promise. Mock stock must never enter comparison.
- **Handoffs:** catalog/cart transfer, customer approval, supplier acceptance, physical receipt and payment are separate. Opening a portal cannot create an order acknowledgement. Unsupported prefill means use the operator's approved bookmark and an RO-linked checklist.
- **Retention:** store only vendor-permitted facts, with separate rules for quotes, selected offers, invoices and accounting. Do not assume the generic snapshot/history design overrides PartsTech's order-accounting-only restriction or IMC confidentiality/reuse terms.
- **Scope:** the complete bookmark register above remains intact. Alias shortcuts map to one supplier; used/recycled parts and inspected used tires retain separate fitment/condition evidence. No production behavior, supplier account, cleanup, software installation, customer message or purchase changed during this continuation.
