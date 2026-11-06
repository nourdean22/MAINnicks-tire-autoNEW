# Shop OS 03: vendors (who we buy from and how each one plugs in)

Job 2026-10-26-shop-os. The vendor list began from the shop's Chrome bookmarks (read 2026-10-26, FACT).
Spend per vendor is UNKNOWN until ALG ticket lines are mapped (04-DATA-MAP section 3). Older integration paths
from research R1, R6, R7 (02-RESEARCH) are historical leads, not current account proof. "Via PartsTech" means
PartsTech documentation listed a supplier; account connection and permissions still need a current receipt.

## Parts

| Vendor | Portal we use | Best path | What the shop must provide | Next step |
|---|---|---|---|---|
| O'Reilly | firstcallonline.com | Public Integration Hub accepts new direct API/punchout ordering-and-invoicing requests and invoice-only connections; account approval required | Account number + recent electronic-order invoice + approved partner/test access | Later cohort; request current integration scope when prioritized |
| AutoZone | autozonepro.com | First cohort: ask for account-approved API/cXML punchout; PartsTech only after its exclusivity terms are resolved | AutoZone Pro account/PIN + servicing store + approved partner/test access | Request current integration docs from AutoZone Commercial |
| Parts Authority / IMC | IMC Web Warehouse | First cohort: ask for approved IMC, WHI/Nexpart or Epicor/AConneX path; no standalone public API verified | IMC account + servicing location + approved partner/test access | Confirm current portal, integration rights, branch and vendor terms |
| Federated Auto Parts | federatedlink.com | Via PartsTech (rep-initiated approval) | Account number from an invoice; ask the rep | Ask the Federated rep |
| Car Parts Warehouse (Parts Plus) | Nexpart WebShop + ACDelco Connection | Via PartsTech (CPW advertises it) or WHI Nexpart NEXLINK | WebShop credentials + servicing branch (Euclid: 23520 St. Clair Ave, CLAIM) | Ask CPW which branch serves us |
| Premium Guard | pgfilters.com | Brand catalog only; buy through a distributor | none | No integration |
| Car-Part.com (used OEM) | car-part.com | iPro is a human-operated workflow; automation, extraction and bulk price/availability use need prior written approval under its current agreement | Separate account and written integration approval for any automation | Keep as visible operator handoff unless written permission changes the path |
| Amazon, eBay | web | Manual purchase lines | none | No integration |

## Tires and wheels

| Vendor | Portal we use | Best path | Next step |
|---|---|---|---|
| D&K Tire (Gateway) | D&K/Gateway portal | Existing code in Nickstire: `gatewayClient.ts`, `gatewayTire.ts`, `gatewaySupplierOrder.ts`, and `gatewayOrder.ts` (search, cart and protected order path); live account health and custom API permission not verified in this pass | Reuse after authorized health and D&K permission confirmation; exclude `dkClient.ts` simulated stock from supplier truth; verify callers before any removal |
| ATD | atdonline.com | PartsTech paid tier, Tireweb, TireBase (CLAIM) | Price PartsTech's paid tier vs Tireweb |
| Capital Tire | capitaltire.net | PartsTech free tier, Tireweb (CLAIM) | Connect in PartsTech |
| Cleveland Wholesale Tire | tireaccess.tirebase.io | TireBase publishes a platform API; this vendor/account's access and permitted scope are UNKNOWN | Ask the distributor/TireBase for tenant API access, data scope and terms |
| Wheel Pros | dl.wheelpros.com | Gated API path: dealer account, Data Portal registration, then explicit API approval | Request approved product, stock, price and order scope |
| Xpress Tire | dealer.xpress-tire.com | UNKNOWN (name matches in Tireweb/PartsTech are not confirmed) | Ask the rep which platform they use |
| Elite Tire and Wheel | shop.ewwfl.com | B2B portal only (CLAIM) | Ask for a feed or API |

## Labor and repair data

| Source | Plan |
|---|---|
| Real-Time Labor Guide / ShopDriver Elite (Dowell Systems) | Replace. Its labor content is licensed to us as users, not ours to copy. |
| MOTOR via PartsTech (`/taxonomy/labor`, maintenance schedules, fluids, specs) | Primary (FACT: in PartsTech's OpenAPI v2.021.1); MOTOR answers must carry MOTOR's compliance link |
| MOTOR direct (DaaS) | Fallback; quote only |
| Mitchell 1 ProDemand | Ruled out: no single-facility software integrations (CLAIM, R2) |

## Money, phone and accounts already in use (bookmarks, FACT; paths from R10, CLAIM)

| What | Vendor | Path |
|---|---|---|
| Card machine | Maverick Payments | REST API + hosted forms exist; terminal push UNKNOWN; ask Maverick for our terminal model |
| Payment programs | Acima, Snap, Koalafi, American First Finance, Progressive, Sezzle, Synchrony, Kafene | Real APIs: Snap, Koalafi, AFF, Sezzle; the rest partner-gated; several already linked in nickstire |
| Shop phone | Spectrum Business Voice | No public call API; screen pop by forwarding through Twilio (already used) or porting |
| Mobile texting | Verizon | Automated texts need a registered route (UPSTREAMS 2026-09-23) |

## Contract traps to settle before writing adapters
1. PartsTech exclusivity is PUBLIC-DOC evidence in its published developer API agreement, not an account-specific finding. Resolve applicability and any written waiver/non-exclusive terms before selecting that API; see 20.
2. PartsTech: no caching beyond per-order accounting; the history we keep is our own order lines.
3. Wheel Pros and Tireweb: order permission is separate from search permission.

## One email to all of them
The request text is in 06-OPEN-QUESTIONS section 3.

## 2026-11-06: source-priority and adapter rule

The 2026-10-30 toolkit census is historical and must be re-read before implementation. **First cohort (Nour, 2026-11-06): D&K/Gateway Tire, AutoZone Pro, and Parts Authority/IMC.** Reuse the current D&K tire code; pursue approved read-only interfaces for AutoZone and PA/IMC; keep a visible portal route for a source whose approved interface is not yet available. PartsTech/OEC remains a candidate aggregator only after its current contract is checked: the published developer agreement describes aftermarket catalog/procurement exclusivity and a written request/waiver process for unconnected suppliers. Confirm applicability to Nickstire and the three named sources in writing. Do not assume the aggregator path can coexist with all direct catalog connections. Add O'Reilly, Federated, CPW, ATD, Capital, Tireweb/TireBase and Wheel Pros after the first cohort or when owner evidence makes one the best next source. A bookmark is not API permission.

For every supplier, maintain a capability row for catalog/fitment, price, branch quantity, ETA meaning, cart/order, order status, invoice, returns, cores/credits, auth, fees, rate limits, cache rules, account locations, and export/exit path. Prefer an official API or approved punchout. A portal-only fallback is a visible operator handoff. Never scrape private pages or retain prices beyond the vendor's terms. See the adapter and offer contract in [18-SUPPLIER-DESKTOP-OFFLINE-AI](18-SUPPLIER-DESKTOP-OFFLINE-AI.md).

Provider-specific evidence, known code paths, PartsTech exclusivity risk, REA status and the unanswered vendor questions are in [20-SUPPLIER-INTEGRATION-START](20-SUPPLIER-INTEGRATION-START.md). Public documentation is not a substitute for the shop's current terms, account permission or approved test access.

### Browser bookmark discovery

The 2026-11-06 inventory read found 38 Chrome bar shortcuts and 3 synced shortcuts, plus two unmatched labels visible in the screenshot. [18-SUPPLIER-DESKTOP-OFFLINE-AI](18-SUPPLIER-DESKTOP-OFFLINE-AI.md) now lists every label, safe host, category, and proposed Shop OS treatment. REA confirmed public entry surfaces for PA/IMC and ATD; D&K is behind a bot-verification page, AutoZone errored in the isolated browser, and PartsPlus/Nexpart timed out. These are not account/API findings. The recorded browser security refusal stops authenticated inspection through this route, including alternate surfaces or connection methods. Continue with public documentation and operator-provided redacted screenshots; account-specific terms and signed-in flows remain UNKNOWN. Keep payment, financing, email, schedule, banking and phone access separate from the sourcing adapter. A shortcut is not proof of current account access, API/automation rights, or suitability for CRM integration.

## Current first-cohort capability gate (2026-11-06)

PUBLIC-DOC = documented product capability; REPOSITORY = source behavior only. Every account-specific cell without proof is UNKNOWN. The detailed dated source register and exact screen/flow requirements are in [20](20-SUPPLIER-INTEGRATION-START.md).

| Capability | AutoZone Pro | Parts Authority / IMC | D&K / Gateway |
|---|---|---|---|
| Vehicle/catalog lookup | PUBLIC-DOC + screenshot-reported My Zone controls; custom access UNKNOWN | PUBLIC-DOC: Web Warehouse / Epicor / Nexpart; custom access UNKNOWN | REPOSITORY: size search; approved account use UNKNOWN |
| Price, quantity, branch | Account values, branch semantics and freshness UNKNOWN | Catalog docs describe real-time inventory; local branch semantics UNKNOWN | Code parses pricing rows/quantity; first-row cost semantics need vendor confirmation |
| Fitment proof | VIN/plate/interchange controls do not prove exact match | Documented vehicle transfer; qualifiers/mapping for this CRM UNKNOWN | Brand/model/size matching exists; complete load/speed/OE qualifiers not proven |
| ETA | Public tracking described; account/API arrival semantics UNKNOWN | Truck route versus ground shipment must be confirmed | Cutoff available in code; arrival promise UNKNOWN |
| Cart versus purchase | Saved Carts visible in reported screenshot; supported return UNKNOWN | PUBLIC-DOC: Transfer then Price Check then separate Order Parts in Mitchell 1 | REPOSITORY: prepare can mutate cart; submit separate and guarded |
| Order status / invoice | Visible status/invoice area; permitted transport UNKNOWN | Custom interface/coverage UNKNOWN | Current code has submit outcome; end-to-end status/invoice sync not demonstrated |
| Returns / core / credit | Public return workflow described; API scope UNKNOWN | Account policy, RMA and credit feed UNKNOWN | Supported interface and policy UNKNOWN |
| Auth / permitted interface | Partner/API/punchout request; actual scope UNKNOWN | Approved partner launch/return or network path; actual scope UNKNOWN | Existing bearer client is code evidence; portal-derived order payloads are not vendor approval |
| Rate / cache / fees / exit | UNKNOWN; request current terms | UNKNOWN; QA-host terms flag extraction, confidentiality and linking restrictions pending actual agreement | UNKNOWN; request D&K/Tireweb terms, current docs and host/account mapping |
| Default planned disposition | Operator portal handoff pending approved integration | Operator's existing bookmark pending integration and linking/data-use clarification | Operator portal handoff pending permission review; reuse approved code, no duplicate client |

Public IMC corroboration is now available on [imcparts.net FAQ](https://www.imcparts.net/faq/index.shtml), [catalog compatibility](https://www.imcparts.net/imcAdvantages/index.shtml) and [Mitchell 1 walkthrough](https://www.imcparts.net/shopMgmt/index.shtml); QA-host links in earlier research are historical leads. No account facts were obtained from private pages.

The complete bar/overflow/synced inventory stays in 18, with each sourcing label routed in 20. Deduplicate shortcut aliases into one supplier identity. Older claims above about aggregator tiers, labor licenses and finance APIs remain historical leads until current approval/entitlement is verified. In particular, PartsTech shop-portal access does not establish developer API rights, and its retention rule can block storing unpurchased comparison history.
