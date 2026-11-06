# Shop OS sourcing, desktop and offline AI implementation plan

> **For agentic workers:** Use the repo's approved native implementation workflow only after Nour chooses the ledger path and the required vendor/account/device go is present. Work one deliverable at a time; do not parallelize work that touches the same supplier contract, order state, or UI flow.

**Goal:** Add reliable supplier comparisons and human-controlled ordering to the Shop OS, plus a measured local-AI worker and safe shop-PC readiness path.

**Architecture:** Nickstire's selected ledger stays authoritative. A shared sourcing service fans out to permitted vendor adapters, normalizes and ranks verified offers, attaches the winning snapshot to an estimate line, then prepares an order for a person to submit. The optional local worker pulls bounded AI jobs over outbound HTTPS; full offline CRM is separate.

**Tech Stack:** Existing nickstire Vite/React PWA, tRPC, Drizzle/TiDB, Node/TypeScript, existing `gatewayTire` / `gatewaySupplierOrder`, existing event and proposal patterns, vendor-approved APIs/punchout; Ollama only if the real-device benchmark passes.

**Spec:** `apps/nickstire/docs/plans/shop-os/18-SUPPLIER-DESKTOP-OFFLINE-AI.md`

## Global Constraints

- Keep ALG live until the selected ledger passes all roadmap cutover gates.
- Use official/approved vendor interfaces and honor each account, license, cache, and rate term.
- No supplier order, spend, customer send, payment/refund, production write, credential edit, production config change, destructive schema change, or cutover without Nour's specific go.
- No AI-generated fitment, labor time, retail price, stock, safety finding, or approval.
- Missing/stale evidence is UNKNOWN; never normalize it to zero or in-stock.
- All supplier checkout is human-confirmed; retries are idempotent and unknown submit results are reconciled before retry.
- Do not store customer data or supplier secrets on a shop PC for Phase 1; minimize local job payloads.
- Do not touch NicksMax or its camera/voice stack without its current owning session and an explicit handoff.
- Do not call local inference an offline CRM; full offline data and sync needs its own approved design.
- No new spend by default. Verify vendor/model license and current terms from primary sources before build.

## Review Focus

- Ambiguous or conflicting fitment -> block exact-match wording and require a human resolution.
- Stale stock, unknown branch, ambiguous ETA, partial availability -> show UNKNOWN/partial and make no ready-time promise.
- Timeout after a possible order -> reconcile the supplier status using the original idempotency/reference before any retry.
- Price/core/fee/quantity changes after approval -> preserve the old quote evidence and require new approval if the customer total changes.
- Internet or worker failure mid-save -> preserve the draft, show sync state honestly, prevent offline money/order actions, and recover without duplicates.

---

### Task 0: Close prerequisites and capability map

**Files:** Modify `apps/nickstire/docs/plans/shop-os/06-OPEN-QUESTIONS.md` and `13-TOOLKIT.md`; maintain `18-SUPPLIER-DESKTOP-OFFLINE-AI.md`.

- [ ] Re-read graph, active worktrees/PRs, current routes, migrations, vendor adapters, production truth, and device ownership.
- [ ] For each supplier, record account/branch, permitted catalog/price/stock/order/return actions, auth, fees, promise semantics, terms, rate/cache limits, data export, and owner. Mark unknown fields UNKNOWN.
- [ ] Get documented permission and test-account evidence before enabling any order-capable adapter.
- [ ] Re-measure the front-desk PC and identify camera, phone, microphone, printer, browser and Whisper owners before proposing cleanup/model changes.

**Acceptance:** no adapter is called available solely because a URL or key name exists; every status has a dated receipt or UNKNOWN.

### Task 1: Define the normalized sourcing contract

**Files:** Create `apps/nickstire/server/services/sourcing/types.ts`, `offerValidation.ts`, and `offerValidation.test.ts`.

**Interfaces:** `SupplierSearchRequest` contains confirmed vehicle, job, required-by time, quantity, product family and request time. `SupplierOffer` carries supplier/branch/SKU, fitment evidence, requested/available quantity, item/core/fee/delivery/tax cost, total, promise kind/ETA, route evidence, freshness/expiry, match grade, warnings and supported actions. `SupplierSourceResult` is one of `ok`, `partial`, `timeout`, `unauthenticated`, `unsupported`, or `error` with a safe message.

- [ ] Test missing availability, stale offer, ambiguous fitment, invalid money, partial quantity and wrong promise semantics.
- [ ] Validate exact/acceptable fitment before ranking; unknown values remain nullable with reasons.
- [ ] Enforce adapter terms metadata and cache expiry.

**Acceptance:** incomplete evidence cannot be shown as exact or available.

### Task 2: Add bounded read-only adapter dispatch

**Files:** Create `apps/nickstire/server/services/sourcing/searchSupplierOffers.ts`; extend existing Gateway flow only after graph recall and code review; add `searchSupplierOffers.test.ts`.

- [ ] Reuse D&K/Gateway authentication and mapping without duplicating session handling.
- [ ] Add one best-supported aggregator or direct supplier only after Task 0 confirms terms and test access.
- [ ] Query sources in bounded parallelism with per-source timeout, cancellation, request ID, redacted logs, and independent failure result.
- [ ] Test no sources configured, timeout plus success, all fail, auth expiry, rate limit and partial results.
- [ ] Prove this read-only task cannot reach an order endpoint.

**Acceptance:** users see connected/partial/failed/unknown coverage and can continue safely when a source is down.

### Task 3: Implement fitment-first ranking and reason lines

**Files:** Create `rankSupplierOffers.ts`, `landedCost.ts`, and `rankSupplierOffers.test.ts` in `apps/nickstire/server/services/sourcing/`.

- [ ] Gate on exact compatibility and required-by time before ranking.
- [ ] Compute item + core/deposit + fees + delivery/driver + tax only from verified fields.
- [ ] Use route time only if fresh and decision-changing; use real supplier lateness history as a documented tie-breaker.
- [ ] Return `lowest_total`, `fastest_ready`, and `best_for_job` only when evidence supports each.
- [ ] Test price ties, closest-versus-fastest, changed traffic, unknown cost, expiry and one-source wording.

**Acceptance:** every rank has a short explanation grounded in its evidence; no fabricated best claim.

### Task 4: Attach offers to repair estimates and tire quotes

**Files:** Inspect current routes first; implement in the actual `/system` route and existing tire flow; add route/UI tests for selected offer, refresh, partial/empty/error, keyboard, 390px phone, exact tire fitment and inspected used-tire units.

- [ ] Show supplier evidence in a drawer on the selected estimate line and freeze the chosen source/time with the draft.
- [ ] Keep customer retail price from shop rules and supplier cost/margin separate.
- [ ] Refresh before checkout; price/stock change cannot silently mutate an approved customer estimate.
- [ ] For tires, resolve vehicle or manual size, confirm load/speed rating, set quantity and show installed price/fees. Used tires are actual inspected shop units, not vendor catalog offers.
- [ ] Use existing iOS PWA-safe confirmation patterns and honest saved/unsynced state.

**Acceptance:** faster common quoting with no worse fitment, availability, margin, approval or save behavior.

### Task 5: Add supplier order preview, commit gate and reconciliation

**Files:** Add an order service/route only after documented supplier permission; adapt existing `gatewaySupplierOrder` when it is the correct owner; add tests for idempotency, timeout-after-submit, partial fill, price change, cancellation, return/core/credit.

- [ ] Preview supplier/account/branch/SKU/fitment/quantity/core/fees/total/ETA/RO.
- [ ] Require a human final submit tap; require new customer approval when approved work total changes.
- [ ] Persist supplier request and response reference with redacted secrets. Reconcile status before retrying unknown outcomes.
- [ ] Reconcile received qty, actual cost, return, core and credit; show unresolved variance at daily close.

**Acceptance:** retries never create duplicate orders; every monetary difference reconciles or remains visibly open.

### Task 6: Add visible computer-assisted portal handoff

**Files:** No local bridge unless existing browser tools and vendor terms cannot meet the flow. If needed, isolate a signed allowlisted bridge and add tests for allowed host/action, wrong-domain block, hidden-submit refusal, no credential payload, expiry and cancel.

- [ ] Prefer opening the official portal with copied search/SKU/quantity. If UI automation is allowed, keep it visible and pause before checkout.
- [ ] Never use arbitrary shell, cookie export, hidden endpoint, background scraping or model-controlled purchases.
- [ ] Mark operator-entered portal data as unverified until a permitted confirmation receipt is attached.

**Acceptance:** operator sees and can cancel every computer action; no purchase occurs without their tap.

### Task 7: Clean and qualify the front-desk PC

**Files:** Update the device runbook in `12-LOCAL-AI-AND-MESH.md` and statuses in `13-TOOLKIT.md`; no OS change before a specific operator go.

- [ ] Inventory apps/startup/disk/RAM/CPU/GPU/drivers and camera/sign/voice/Whisper/browser/printer workflows and owners.
- [ ] Produce a reversible ranked cleanup list with before/after measures and recovery path.
- [ ] Preserve sessions, credentials, customer/work data, drivers, needed logs, camera/voice/Whisper and other session-owned apps.
- [ ] Apply one approved change at a time and verify shop functions; retain rollback proof.
- [ ] Keep NicksMax out of scope without its owner's handoff.

**Acceptance:** measurable performance or storage gain while all required shop workflows stay healthy.

### Task 8: Benchmark local models and add a bounded worker only if they pass

**Files:** Extend existing AI provider/queue path only after current callers and lease patterns are inspected; eval fixtures use synthetic or redacted inputs.

- [ ] Refresh hardware and read official model/runtime licenses.
- [ ] Benchmark a small candidate set with fixed prompts; record digest, quantization, backend, p50/p95, resource use, Whisper RTF, schema validity, grounding, UNKNOWN abstention, human corrections, upkeep and cost.
- [ ] If none passes, retain deterministic rules and the approved cloud/no-AI path. Do not choose a model by name or TOPS claim.
- [ ] If one passes, implement outbound worker pull, lease, heartbeat, idempotent completion, expiry, data minimization, schema validator and rollback.
- [ ] Test offline, duplicate claim, expiry, crash/restart, bad schema, missing source and model unload.

**Acceptance:** median draft under 30 seconds; Whisper RTF under 0.5 while concurrent; zero invented safety/price/fitment facts in the fixed eval.

### Task 9: Treat full offline CRM as a separate project

- [ ] Measure outages and actual shop cost before architecture.
- [ ] If justified, design encrypted minimal local cache, durable outbox, device identity, sync/conflict/replay, expiry, backup/restore and audit.
- [ ] Default to limited read and unsent draft only. Prohibit payments, orders, customer sends, approval and price changes offline until separately approved and reconciled.
- [ ] Replay loss before/during/after save and verify no lost/duplicate RO, line, payment or order.

**Acceptance:** labeled offline mode survives restart, syncs once, reconciles conflicts and passes a shop-owned outage drill.

### Task 10: Run a controlled pilot and retain the cutover gate

- [ ] Rehearse 20 ugly cases, including wrong fit, stale price, partial stock, duplicate retry, return/core, terminal down, late webhook and restart.
- [ ] Pilot one counter lane with ALG live and a named person reconciling each close.
- [ ] Measure quote time, source coverage/accuracy, parts-blocked minutes, margin, owner touches, wrong orders, promised-versus-actual arrival and close variance.
- [ ] Cut over only after every existing 7-close, outage, export, speed, margin, owner-intervention and reconciliation gate passes.

**Acceptance:** recorded business outcome with no unexplained money/data difference; otherwise roll back and fix the failed gate.
