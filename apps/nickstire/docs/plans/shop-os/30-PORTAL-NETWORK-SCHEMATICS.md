# Shop OS 30: portal network schematics - the wire-level shapes behind audits 21-29

Job 2026-11-07-portal-network-schematics. Status: CURRENT (extend after any new capture). Nour (2026-11-07):
"use the /reverse-engineer-anything in chrome on those pages n do even better ... be as detailed as possible getting
schematics ... dont forget real time labor or alg because i want it all based around that too its my crm". This is
the pass below the UX audits: what each portal's browser actually sends and receives, captured with a fetch/XHR
hook installed in Nour's own logged-in Chrome tabs (passive runtime observation, REA style), plus static reads of
the shipped JavaScript bundles. Read-only throughout (size and part-number searches, one ticket view, no cart, no
order, no form submit, no credential entry), with one write-bearing exception on 2026-11-07: the ticket editor
wizard PUT `ticket/updateTicketSession/<ticketId>` fired by picking a job (s.0 item 5, s.2 Labor lookup). No
visible line was left, but that session is classed write-bearing and is not repeated under read-only
authorization. FACT/OBSERVED = seen in the response or bundle this session.
INFERRED = reasoning from it. UNKNOWN = not reached, with the route that would reach it.

**Privacy rule for this file (public repo):** no account numbers, ship-to or tenant ids, tokens, cookies,
customer names, phones, VINs or ticket ids. Field NAMES and shapes only; example values are catalog data.

## 0. Answer first

1. **ALG is Real-Time Labor Guide PRO** (Dowell Systems, `secure.autolaborexperts.com`): one product, one login,
   one API. "Real time labor" and "ALG" in Nour's words are the same system. Its ticket API (`ticket/getTicket`)
   already carries every line item (labor, part, misc) with unit price, markup, quantity, rate, tax and core
   fields. The nickstire mirror holds none of that (doc 17 s.2): the split is recoverable per ticket from this
   endpoint, read-only.
2. Two supplier portals expose availability as **structured JSON** behind the page: O'Reilly and Gateway (FACT,
   captured). Federated exposes only its vehicle selector as JSON (s.6); ATD, Capital and Parts Authority were
   observed as rendered DOM only (item 3). The richest two are O'Reilly (`products/availability`: servicing DC
   vs linked DC vs surrounding store, with
   `nextRoute.cutoffTime` and `estimatedArrivalTime` per supplier location) and Gateway (`quicksearch/cache`:
   local, regional and national on-hand with a stated `est_delivery_days` per regional warehouse).
3. ATD, Capital and Parts Authority render availability server-side (full page loads); their tiers are read
   from the DOM, not JSON. Federated's results grid was not reached (s.6), so its transport stays UNKNOWN
   (s.10 item 4). ATD's six tiers and Capital's `Available` / `Regional` pair are counts capped at `99+` /
   `50+`: a capped figure is a lower bound, never an exact quantity (s.10 item 6).
4. Doc 26 s.5's Gateway question is half answered: the Regional bucket shows 3-4 `est_delivery_days` per
   warehouse and `trade_region_splitup = true` on every row (FACT). Whether this account may ORDER regional stock
   stays UNKNOWN: no cart or order response was captured and the flag's meaning is not documented. Ranking logic
   must not present regional rows as actionable until an order flow or vendor documentation says so.
5. SHAPE CAPTURED 2026-11-07, read-only path still UNKNOWN: the ALG **labor-time lookup** is three calls in the ticket editor (s.2 "Labor lookup"):
   `job/searchDsiJobs` (typeahead, returns job ids), then `jobLabor/getJobLabor?Year&model&jobId&engine`
   (`lowTime`, `averageTime`, `highTime`) and `Parts/getSuggestedParts/<jobId>`. Keyed by year, model, engine and
   job id; no VIN needed. Picking a job PUTs the editing session (`ticket/updateTicketSession/<ticketId>`) before
   anything is added to the ticket, so even a read of the time page is one draft write in ALG's eyes.

## 1. Cross-portal wire matrix (OBSERVED unless marked)

| Portal | Host / stack | Search entry | Availability comes back as | Cutoff / ETA source | Price fields |
|---|---|---|---|---|---|
| ALG / Real-Time Pro | `secure.autolaborexperts.com` SPA (React, Vite chunks) over `https://<tenant>.autolaborexperts.com/api/<Controller>/<action>/` | ticket, customer, vehicle (QuickVIN), labor guide | n/a (shop system) | n/a | per line: `unitPrice`, `partMarkup`, `rate`, `quantity`, `subTotal`, `tax`, `total`, `coreValue` |
| Gateway / D&K | `b2b.dktire.com` SPA over `api-b2b.dktire.com` | `POST /quicksearch/cache` (size) | JSON per item: `on_hand`, `trade_region_quantity`, `other_warehouse_quantity`, `trade_region[]` | `/master/get-cut-off-time` + header countdown; `trade_region[].est_delivery_days` | `pricing_data[]`: `selling_price` (cost), `cost_price` (retail 2x), `fet`, `tire_tax`, special/rebate fields, `disable_call_for_price` |
| ATD Online | `www.atdonline.com` server-rendered (`/es-search/refine?text=`; Hybris-style, INFERRED) | keyword/size box, Y/M/M/Trim, VIN | DOM: six tiers per SKU (counts, `99+` cap) | header `ORDER COUNTDOWN` + `/ajax/get/fetch-cutofftimes` (body UNKNOWN, see s.4) | DOM: unit cost (`HIDE UNIT COST` toggle); a `Missing` FET cell is INFERRED to mean no FET (s.4) and is read as UNKNOWN, never 0 |
| Capital Tire | `capitaltire.net` (TCS white-label), server-rendered `/Wholesale/catalog/...Power_Search:<size>` | one box with All/Tires/Wheels/Other | DOM per row: `Available: N` and `Regional: N` (`Out of stock`, `50+` cap) | none on the grid | DOM: `Sell Price`, `Cost`, `FET`, `Display Cost` switch, `Download Price List` |
| Federated / Fisher | `www.federatedlink.com` ASP.NET WebForms | `aces/json/vehicleSelector.aspx` (Y/M/M/Engine JSON), Item Search, `ACES/ShowParts.aspx` | UNKNOWN (results grid not reached, s.6, s.10 item 4) | none shown | DOM; `Hide Cost` checkbox |
| Parts Authority / IMC | `www.imcparts.net` WebSphere Commerce (`/webapp/wcs/stores/servlet/...View`) | `PartNumSearchResultView?partNumber=` | DOM per row: `29 Cleveland, OH: N` / `Transfers : N` / `Shipping : N` + `Other: Yes/NO` | header `Order Cut Off` drop-down (half-hour runs), `SAT. Delivery Available` | DOM: price, `list:`, `core:` |
| O'Reilly Pro | `www.firstcallonline.com` SPA over `/FirstCallOnline/modernized/api/v1/...` and `/api/v1/...` (bearer token; 401 without it) | `product/search?query=` then JSON | JSON `products/availability`: per supplier location with `relationshipToStore` and `nextRoute` | `nextRoute.cutoffTime`, `nextRoute.estimatedArrivalTime` (ISO UTC) | JSON `products/pricing/basket`: `costPrice`, `listPrice`, `customerPrice`, `corePrice`, `promoApplied` |

## 2. ALG / Real-Time Labor Guide PRO (the CRM spine)

**Transport (FACT).** The SPA at `secure.autolaborexperts.com` reads `/config.json` (`cache: no-store`) and calls
a per-shop tenant host `https://<tenant>.autolaborexperts.com/api/...`. Request headers named in the bundle:
`Authorization` (bearer), `X-XSRF-TOKEN`. Third parties loaded: Google Tag Manager, Facebook SDK, Cloudflare
insights. Settings endpoints answer with a bare object; some newer ones answer `{data, error: {code, message,
field}}` (`smtp/settings`, `smtp/verify`, `signature/get`), so the client has two envelope styles.

**Endpoints observed on one ticket view (FACT):**
`ticket/getTicket`, `ticket/listTicketHistory/<ticketId>`, `Attachment/list/<ticketId>`, `signature/get/<id>`,
`SettingsPricing/getSettingsPricingTaxRate/`, `SettingsTicketFormatting/getSettingsTicketFormatting/`,
`SettingsTechnician/getSettingsTechnician/`, `SettingsPayTypes/dropDownlistSettingsPayType/`,
`SettingsDisclaimer/getSettingDisclaimer/`, `Client/getLogo/`, `smtp/settings`, `smtp/verify`; on the app shell
`account`, `SystemAdminTools/getCurrentAnnouncement`.

**`ticket/getTicket` shape (FACT, key names; one ticket = estimate or invoice):**
- header: `id, ticketType, workflowStep, estimateNumber, invoiceNumber, estimateDate, invoiceDate, promisedDate,
  poNumber, description, complaint, notes, rateType, returnParts, showLaborHours, showSeparateCharges,
  isTaxExempt, taxExemptLineItems, salesTaxOptionType, taxRate, maxTaxAmount, laborTaxRate, partsTaxRate,
  miscellaneousTaxRate, estimatePaymentMethod, estimateCharge, authorizedContact, otherAuthorizedPersonPhone,
  originalEstimateAmount, increaseAuthorizedBy, manuallySorted, customerModified, hasTicket, useExisting,
  accountsReceivableId, syncQuickbooks, qboId`
- totals: `totalLaborAmount, totalPartsAmount, totalMiscellaneousAmount, subTotalAmount, totalTaxes, totalAmount,
  amountDue, paymentReceived, alwaysMiscellaneousChargesAdded, taxItems, taxRates, settingsTaxRates`
- `vehicle: {id, customVehicleId, year, makeId, makeName, modelId, modelName, engineId, engineName, isCustom,
  mileageIn, mileageOut, unitType, tag, state, vin, vehicleNumber, notes, createdDate}`
- `customer: {id, accountsReceivableId, isCommercial, isTaxExempt, firstName, lastName, companyName, email,
  ticketCount, recentTicket, addressLine1, addressLine2, city, state, postalCode, primaryNumber, secondaryNumber,
  ternaryNumber, createdDate, updatedDate, creditLimit, balanceDue, accountNumber, isActive, qboId}`
- `ticketItems[]` (every line, labor and parts alike): `{id, order, type (numeric enum; the values that mean
  labor, part and miscellaneous were NOT observed, so line classification stays UNKNOWN, s.10 item 7), description,
  technicianId, technicianName, partId, partCode, vendorId, jobLaborId, packageJobId, miscellaneousChargeId,
  miscellaneousChargeVersion, unitPrice, partMarkup, quantity, rate, subTotal, taxRate, taxRates[], tax, total,
  isTaxable, inInventory, inventoryStockId, inventoryUsed, coreTrackingEnabled, coreTrackingId, coreValue,
  returned, refunded, fifoLayers[]}`
- `jobLabors[]`, `labors[]`, `ticketPayments[]` (empty on the viewed estimate; shapes UNKNOWN)
- `ticket/listTicketHistory` rows: `{id, ticketId, createdDate, staffName, action, description, ticketItemType,
  partCode, total}` - an audit trail per ticket, with the staff member.
- `dropDownlistSettingsPayType`: 12 x `{key, text, value}`.
- Technician settings: `technicianTrackingEnabled`, `technicianPartsTrackingEnabled` (both exist; per-line
  `technicianId` is where tech attribution lands).

**Labor lookup (FACT, captured 2026-11-07 in the ticket editor, hook on, Add never clicked):**
- Route: `ticket/view/<id>` -> Edit (client-side) -> `ticket/jobCategory/<id>/true` -> Job Search box -> pick ->
  `ticket/time/<id>/true`. Opening Edit fires about 40 settings reads first (`SettingsTicketWorkflow`,
  `SettingsQuickVin`, `SettingsTicketDefaults`, `SettingsVendor`, `client/getSettingsVersion`, `SettingsTaxRates`
  x2, `SettingsLaborRates/listSettingsLaborRatesDropdown`, `SettingsTicketNumber`, `MiscellaneousCharge` x3,
  `SettingsPayTypes`, `ticket/getTicketSessions`, `SettingsPricing/getSettingsPricing`).
- `GET job/searchDsiJobs?model&engine&year&jobName` -> `[{key, text, value}]` (`value` = job id; "exhaust" 10 rows,
  "exhaust pipe" 2, "exhaust pipes" 0: plain substring match, no stemming; DSI = Dowell Systems).
- Picking a result: `PUT ticket/updateTicketSession/<ticketId>` (the wizard's draft; the ticket line is not added
  until the Add button), then `GET settingsPricing/getActiveLaborRates/` -> `number[]`,
  `GET job/getJobRequiresEngine/<jobId>` -> `boolean`,
  `GET jobLabor/getJobLabor?Year&model&jobId&engine` -> `{id, lowTime, averageTime, highTime, laborHash,
  hasJobAddon, hasJobComment, shopTimeId, customTime, customRate, jobAddons[], comments[]}`,
  `GET Parts/getSuggestedParts/<jobId>` -> `[{partCode, partDesc, quantity, unitPrice, retailPrice, markup,
  vendorId, vendorName, partId, quantityInStock, coreTrackingEnabled, coreValue, inventoryPart}]`.
- The time page shows High / Average / Low / Custom cards (hours x the chosen rate type = amount) with an Add
  button each; on a 2007 3.5L sedan, intermediate exhaust pipe: 0.9 / 0.7 / 0.6 h at the shop's primary rate.
- For the CRM: the labor key is (year, model, engine, jobId) and the job id comes only from the typeahead, so a
  board that promises hours must carry the job id per line or re-search by name; suggested parts ride with the job.
  Whether the three GETs answer without the wizard's `updateTicketSession` PUT is UNKNOWN: they were only seen
  after it. Until a standalone GET is proven, this is a captured shape, not a read-only path, and the no-write rule
  (doc 32 s.6 rule 1) means the board shows no ALG hours: a line's hours stay UNKNOWN and non-promissory. The
  repo's `server/routers/autoLabor.ts` is a hard-coded range per repair category (no year, model or engine), a
  rough aid and not a vehicle-specific source.
- Trap: a full page load of `/recent` in the logged-in tab ended the session (06:33 ET); the in-app buttons
  (View/Manage, Edit, the wizard steps) are client-side routing and keep it. Every probe from code is the former.

**Printed documents (FACT, one estimate and one invoice PDF downloaded 2026-11-07, customer fields not kept):**
the estimate PDF carries the `estimateDisclaimers` copy (a sales pitch: "you left with a known problem", "we do
not guess, we verify", no terms); the invoice PDF carries `invoiceDisclaimers`, eight paragraphs that are the
shop's policy constants: 1 year limited parts warranty, 90 day limited labor warranty, used tires 7 day replacement
against a defect at sale, new tires manufacturer warranty only, no road hazard or mileage warranty unless written,
alignment is a setting service, lug torque recheck within 24 hours or 25-50 miles, customer checks fluids after
pickup, no liability for theft, weather or consequential costs, storage $25.00 per day on unclaimed vehicles,
payment equals acceptance. Signer "Moe's Euclid Tire N Auto LLC dba Nick's Tire & Auto"; the logo on both forms
is still the Moe's one. Labor lines print a price with no hours on both forms. Any receptionist, quote, approval
or pickup copy that mentions them reads the warranty and policy fact keys in `server/services/businessFacts.ts`
(the runtime source; SHOP-SOUL rule 1: linked, never retyped), each on the channels its `channels` list allows:
`refund.policy` and `storage.policy` are voice and web only, so no text message quotes them. Routine sends do not
raise terms unasked (quote-only-if-asked rule). Doc 33 is the dated verbatim capture the seeds are checked
against; this paragraph is the summary.

**What the mirror is missing and where it is (FACT):** doc 17 s.2 says line items, hours, margin and declined
lines are not in our database. `ticketItems[]` has unit price, markup, quantity, rate and tech per line;
`showLaborHours` and `rate` give hours = `subTotal / rate` on labor lines (INFERRED); `taxItems` gives the tax
split. `customer.ticketCount` and `recentTicket` are the vendor's own repeat-customer counters. Where the
historical import era's parts/labor split (2024-01 to 2026-03) came from is UNKNOWN (doc 17 calls it a historical
import; `docs/CURRENT-TRUTH.md` names `listTicketSessions` as the line-item endpoint Wave 99 found). The live
mirror reads the summary endpoint `listRecentTickets` first and stops there (`shopDriverMirror.ts:377-384`).
Restoring the split means one extra `getTicket` call per ticket per import, and `CURRENT-TRUTH.md` records that
such probes collide with SHOP-PROTECT (they can kick the shop's browser login out of ALG). That is an operator
decision with a price, not a mapper-only change.

**Client routes (FACT, from the bundle's route table; the SPA has 216 lazy chunks):**
- Ticket: `ticket` (new), `ticket/view/<id>`, `abandoned` (In Progress), `recent`, `dataRecovery/ticketSession`,
  `dataRecovery/customer`. Those two names are FACT from the route table only; whether recovery is server-backed,
  enabled for this tenant, or whether ticket and customer drafts are auto-saved is UNKNOWN (no recovery request
  was observed). The CRM designs its own draft durability regardless.
- Customer and vehicle chunks: `CustomerIndex, CustomerSearch, CustomerDetails, CustomerForm,
  EditCustomerDetails, MergeCustomers, CustomerExportSelection, CustomerVehicleSelection, CustomerVehicleForm,
  DeletedVehicle, CustomVehicles, PickCustomVehicleYear, VinDisplay, CustomerReminder, AutomaticReminders,
  AppointmentFormModal, CustomerLogin` (a customer-facing login exists).
- Inventory and purchasing: `InventoryIndex, InventoryPartItemForm, PurchasePartItemForm, BulkInventoryPurchase,
  InventoryStockLocationSelect, CoreTrackingIndex, AddVendor, PartDetails, PackageJobs, UpdatePackageJobs`,
  route `inventory/bulkOrder`.
- Accounts receivable: `ARIndex, ARForm, ARPaymentForm, ARTicketSearch`, routes `settings/accountsReceivable`,
  `settings/accountsReceivableDisclaimers`, `reports/AccountsReceivable`, `reports/AgingReport`.
- Settings routes: `settings/company, companyLogo, pricing, laborRates, salesTax, payTypes, ticket, formatting,
  numbers, inputDefaults, ticketDefaults, invoiceDisclaimers, estimateDisclaimers, workFlow, ticketPath,
  manufacturers, customVehicles, advanced, quickvin, packageJobs, miscCharges, techs, partsMarkup, vendors,
  import, paymentProcessing, selectableComments, inventory, texting, emailSetup, qbo, shophours,
  AutomaticReminders`, `staff/addStaff`.
- Reports routes: `reports/totalSales, laborSales, partSales, miscCharges, tax, payType, paymentsReceived,
  technician, vendor, cardTransaction, inventoryTransaction, inventorySalesSummary, inventoryRecommended,
  inventoryPurchases, inventoryOrderList, currentInventoryValue, inventoryPhysicalCountSheet, coreTracking`.
- Texting: route `texting/inbox` and settings `settings/texting`; the bundle's QuickVIN store names
  `quickVinLookup, quickVinEnabled, quickVinApproved, QuickVinNightlyLog` (client names only; whether a nightly
  server job exists or is enabled for this account is UNKNOWN until a schedule, request or run is observed);
  integrations named: QuickBooks Online (`syncQuickbooks`, `qboId` on ticket and customer), Authorize.Net
  (`authorizeNetRegistry`, `getAuthorizeNetReport`), "Motor" (the labor-data source, INFERRED from the name).
- Labor guide (bundle names, FACT): `RealTimeLaborGuide`, `RTLaborGuide`, `laborTimes`,
  `laborTimeLowIsActive / laborTimeAverageIsActive / laborTimeHighIsActive`, `getLaborItem`, `laborGuideDetail`,
  `laborGuideMessage`, `getLaborReport`. The endpoints and the response shape were captured 2026-11-07 (s.2
  "Labor lookup": `job/searchDsiJobs`, `jobLabor/getJobLabor`, `Parts/getSuggestedParts`; low, average and high
  hours per job); the three `...IsActive` names most likely mark which of the three time cards is selected
  (INFERRED, not verified). Still UNKNOWN: whether those GETs answer without the editor's PUT (s.10 item 1), so the
  CRM's labor line contract is shaped but has no read-only path yet.

**For the CRM (INFERRED from the above):** model the ticket exactly as `getTicket` does (one `ticketItems[]`
with a type enum, totals on the header, tax split, history rows with staff), keep ALG's `estimate -> invoice`
numbering pair and `workflowStep`, and add what ALG lacks (doc 21): scheduling, crew logins, supplier offers
attached to a line (`vendorId` + `partCode` are the hooks), decline reasons per line.

## 3. Gateway / D&K (b2b.dktire.com) - OBSERVED on two size searches

- `POST api-b2b.dktire.com/quicksearch/cache` returns an array (288 rows for 275/65R18, 108 after the default
  in-stock filter; the portal lists on-hand-0 rows last). Repo client: `server/services/gatewayClient.ts`
  (`searchTiresBySize`, `pickWholesaleCost`).
- Stock per row: `on_hand` (Local On Hand), `trade_region_quantity` (Regional), `other_warehouse_quantity`
  (National), `total_qty`, `trade_region_est_delivery_days` (4 on every row), `national_region_est_delivery_days`
  (0 = none), `trade_region_splitup` (true on every row), `trade_region[] = [{site_id, site_name (Monroe, OH /
  Madison, TN), on_hand, est_delivery_days 3 or 4}]`.
- Distribution for 275/65R18 (288 rows): local 0 on 236, 1-3 on 10, 4-11 on 27, 12-49 on 11, 50+ on 4; local 0
  but regional > 0 on 78; nothing anywhere on 158. Regional is a real second tier with a stated day count.
- UI hides `Regional On Hand` and `National On Hand` by default (column menu "See more details": Cost + FET, FET,
  LRSR, National On Hand, Ply Rating, Regional On Hand). The counter sees Local only unless they switch it on.
- `pricing_data[]` (one entry per ship-to): `selling_price` = Nick's cost, `cost_price` = retail (2x, the shop's
  own +100% rule, doc 22), `*_with_fet`, `fet`, `tire_tax`, `special_pricing_comment`, `special_offer_id`,
  `disable_call_for_price` (true on all 288 = priced), `rebate_*` (level names, payout, next-level qty),
  `hide_pgm_cost_price`, `taxable`, `delivery_mode`.
- Item meta: `source` DOMESTIC/INTERNATIONAL, `invent_lrsr`, `invent_ply`, `pattern`, `rating`, `invent_utqg`,
  `invent_tread_depth`, `invent_tread_wear_warrenty` (sic), `tire_data` (brand, display name, approved rim width,
  diameter, features text, images), `make_logo_url`, `is_site_product`, major/minor category.
- Cutoff: header "ORDER COUNTDOWN Seville, OH - 1d 19h 23m - Local Delivery 9 November, MONDAY" from
  `/master/get-cut-off-time`. Shape already consumed by `server/services/gatewaySupplierOrder.ts` `readCutoff`:
  `GET /master/get-cut-off-time?global_ship_to=` returns `{cutofftime[]: {site_id, cut_off_time | cutoff_time}}`;
  pick the entry by `site_id`, else the first. What that parser does not establish is the value's date and
  timezone semantics (s.10 item 3); a page-context fetch without the bearer returned `{}`.
  Servicing warehouse = Seville, OH (the shelf tier).
- Other endpoints: `/master/user-details`, `/order/get-site-list-by-shipto`, `/quicksearch/get-recent-search`,
  `/get-consumer-rebates`, `/dashboard/get-program-dashboard`, `/settings/*`.

## 4. ATD Online - OBSERVED on `es-search/refine?text=2256517` (88 results)

- Server-rendered; the only XHRs are `product-type/product-type`, `ajax/get/fetch-cutofftimes`,
  `ajax/get/sessionCartEntryCount`, `ajax/get/unreadMessagesCount`, `ajax/get/orderApprovalCount`.
- Per SKU card (`es-search-product-header-card--product-availability`), six tiers in this order with a count
  each, capped at `99+`: `Pickup`, `Today, Delivery`, `Tomorrow`, `<named weekday date>` (Mon 11/9 on a Friday
  night), `Multi-Day`, `National` with the note `3-5 Business Days`. Example: a 225/65R17 touring tire showed
  7 Pickup, 0 Today, 0 Tomorrow, 7 Mon 11/9, 99+ Multi-Day, 99+ National.
- Price block: unit cost, then `Missing` (INFERRED: the FET cell when no FET applies; the class is
  `...cost-details`). `HIDE UNIT COST` toggles cost; `COMPARE SELECTED`; per-row `Add to List`, `Create List`,
  `Create Package`, `Freight Cost`, `ADD TO CART`, `BUY NOW` (one-click order with PO, customer name, comments,
  delivery options, `Est Delivery Date`, `In Stock Total`, `Freight`, `Order Total`).
- Sort options worth copying: `Availability, Cost Low to High` and `On-Hand, Cost Low to High` (availability
  tier first, then price: exactly doc 26's ranking rule, already shipped by a distributor).
- Facets: Availability `All / Local / Local+ / National`, Value Buys, My Brands, Brand.
- Header: `ORDER COUNTDOWN 48h 41m - Local delivery Monday`; DC `225 CANTON`. The cutoff body is UNKNOWN
  (page-context GET returned `{}`; it likely wants the session's POST shape).

## 5. Capital Tire - OBSERVED on `Power_Search:2256517` (51 results, 2 pages)

- Server-rendered grid; the only XHRs are `set_timezone_offset`, the catalog `_shell_load:1` fragment and
  analytics. No JSON offer feed from the page.
- Per row: brand, size, line, `Part #`, Sidewall, Load Range, Load Index, Speed Rating, Type, UTQG, Warranty
  (`Std.: 55000`), Subclass; `Sell Price`, `Cost`, `FET`; `Available: N | Out of stock | 50+`, `Regional: N |
  Out of stock | 50+`; `Order`; `Compare` checkbox. Unparsed rows exist (`225/65R17~NEX~N Priz S~B/4 BW 102V
  TL`, `Speed Rating: Not Specified`) - doc 26's `rawDescription` fallback.
- Cost is exactly half of Sell Price on every row (the shop's 2x rule applied vendor-side, doc 24).
- Facets: active spotlight (rebates), manufacturer, line, width/ratio/rim, run flat, sidewall, load range, speed,
  load index, subclass, `In Stock / Not in Stock`, ten warehouses (Indianapolis, Dayton, Columbus, South Bend,
  Birch Run, Ferndale, Grand Rapids, Dover, Macedonia, Toledo). Sort keys include `Available` and `Regional`.
- Header: Ship To line, cart count, `Quick Order`, `Review Order`, `Download Price List`, `Display Cost`.

## 6. Federated / Fisher - OBSERVED on the ACES catalog

- `aces/json/vehicleSelector.aspx` answers `{yer[], mak[], mod[], eng[]}` of `{NodeID, NodeValue, NodeRegion,
  NodeRank?}` (59 years; 25 models for one make; `eng` empty for the picked model, so the engine step was
  "Proceed to Catalog - No engine selection").
- Other calls: `cart/carthtml.aspx` (cart as HTML fragment), `ws/CommonWebServices.aspx/GetImages`, `_sc`.
- Item Search for a filter number returned `No results found` (Fisher's catalog keys on its own lines).
- The parts results grid (`ACES/ShowParts.aspx`) was not reached: the engine-less proceed step raised "Please
  complete vehicle selection" twice. UNKNOWN whether the grid is JSON-backed. Doc 25 already has its columns
  (Alt Locations across 12 stores/warehouses, Cost N/A rows).

## 7. Parts Authority / IMC Web Warehouse - OBSERVED on `PartNumSearchResultView?partNumber=`

- WebSphere Commerce, server-rendered; XHRs are only FullStory, AppDynamics and analytics.
- Per row: brand, SKU, description, `Also Fits`, `Confirm Fitment`, stock as ONE of `29 Cleveland, OH : N`,
  `Transfers : N`, `Shipping : N` (the first non-zero tier is the one shown), `Other: Yes/NO`, price, `list:`,
  `core: n/a`, quality icons, `OEM / OES / SPL` badges, `Positions: Main`, `REPLACED BY <sku>` in the
  description, qty box, `add` (grey `not in stock` when the branch has 0).
- Stock filter facet: `My Branch Only / Include Local Transfers / All branches / All including Non Stock`
  (the four-tier model in the vendor's own words). Quality Rating facet: Best / Better / Good.
- Header: `Order Cut Off` drop-down (half-hour runs with countdown, doc 27), `SAT. Delivery Available`,
  `Branch Preferences`, `Active Cart: Default`, `Hide Prices`, `My Parts Authority`, `my jobs`.

## 8. O'Reilly Pro / First Call Online - OBSERVED on `product/search?query=` (JSON SPA)

- Auth: `/FirstCallOnline/session/user` then bearer-token calls; a page-context GET without the token answers
  `401 {fault: {faultstring, detail: {errorcode}}}` (Apigee-style).
- Shop context: `modernized/api/v1/shops/<n>/company` `{companyId, accountName, accountStatus, address,
  isDemoAccount, preferences: {isPoVisible, isPoRequired, isGarageBayIdVisible, isGarageBayIdRequired,
  isVehicleFleetIdVisible, isVehicleFleetIdRequired}, active, createdTimestamp, modifiedTimestamp, version}`;
  `shops/users/<n>`; `customer-master/<n>`; `stores/addresses` (4 x `{locationNumber, street, city, state}`);
  `api/v1/stock-orders/shops/<n>/count`.
- Catalog: `GET /api/v1/products` (161 KB for one query; 15 products). Product = `{productKey: {line,
  itemNumber}, partTypes[]: {partTypeId, partName, requiredVehicleData, pdfURL, kitPartLookupType,
  brandPartTypes[]}, itemMaster: {warehouseSellQuantity, bulk, nonStock, unitOfMeasure, jobberUnitOfMeasure,
  warrantyShortDescription, warrantyLongtDescription (sic, HTML)}, productDescription, partNumberDisplay,
  partTypeDescription, longDescription, shortDescription, orderQuantity, fitCompatibility, vehicleApplications[],
  manufacturer: {name, code, logo, features}, brand: {name, code, logo}, images[]: {imageOrientationId,
  imageOrientationDescription, partNumberImage, representationDescription, primaryImage}, attributes[]:
  {attributeId, attributeDescription, valueId, valueDescription, retain}, partCrossSell[], documents[]:
  {documentId, documentDescription, documentFilename, isVideo}}`. No price or stock on the product: those are
  two separate batch calls keyed by `{line, itemNumber}`.
- **Availability** `modernized/api/v1/products/availability` (array, one per product): `{product: {line,
  itemNumber, quantityRequested}, availability: {quantityRequested, quantityFromStore, quantityOutOfStock,
  quantityOnHandWithRoutes, quantityToSourceWithRoutes, quantityOnHandWithoutRoutes,
  quantityToSourceWithoutRoutes, suppliersWithRoutes[]: {supplierLocationNumber, quantityOnHand,
  quantityToSource, relationshipToStore, nextRoute: {storeNumber, supplierNumber, supplierCity, cutoffTime,
  estimatedArrivalTime}}, suppliersWithoutRoutes[]: {supplierLocationNumber, quantityOnHand, quantityToSource,
  relationshipToStore}}, stockingData: {nonStocking, stocking, specialOrder, onOrder, onBackOrder},
  sourcingMetaData: {allRoutesShareArrival, excludedSuppliersCanFillRequested, autoSourceBlocked, best...}}`.
  `relationshipToStore` values seen: `SERVICING_DC`, `LINKED_DC`, `SURROUNDING_STORE`. Example: a filter with 0
  at the store, 1 at the servicing DC (Twinsburg) with `cutoffTime` 14:55Z and `estimatedArrivalTime` 17:35Z the
  same day, plus 1 each at two linked DCs and a surrounding store with no route. This is the exact "In Network -
  In Store By / If Ordered By" pair from doc 28, as data: tier 1 = `quantityFromStore > 0`; tier 2/3 = a
  `suppliersWithRoutes` entry, in-store time = `nextRoute.estimatedArrivalTime` (kept as `arrival.inStoreBy`; the
  store-to-shop run is a separate, unmeasured leg, so shop `arrival.at` stays UNKNOWN, s.9), order-by =
  `nextRoute.cutoffTime`;
  tier 5 = only `suppliersWithoutRoutes`.
- **Pricing** `api/v1/products/pricing/basket`: `{baskets[]: {basketId, extendedBasketCostPrice,
  extendedBasketCustomerPrice, kitPromoApplied, extendedBasketSavingsAmount, items[]: {productKey, quantity,
  costPrice, extendedCostPrice, corePrice, listPrice, customerPrice, promoApplied, currencyCode, error,
  errorMessage}}}`. The page's own basket reported `error: true, "Missing pricing for 6 items of 15 expected"`
  with the missing `{line, item}` keys: unpriced rows are a normal state and are listed by key (doc 26
  `priceStatus: not_priced`, now with the vendor's own flag).
- `modernized/api/v1/products/promotions/batch` (1.4 KB, shape not captured).
- Rendered vocabulary (doc 28) maps to the data above: `Available Now` = `quantityFromStore`; `In Network` =
  `quantityOnHandWithRoutes`; `Call for Availability` = no routes.

## 9. What this changes in doc 26's contract

| Doc 26 field | Vendor field that feeds it (OBSERVED) |
|---|---|
| `locations[].qty` and `orderableByThisAccount` | Only per-location data feeds `locations[]`: Gateway `on_hand` (the servicing warehouse) and `trade_region[]` rows (named `site_id` / `site_name`); O'Reilly `quantityFromStore` / `suppliersWithRoutes[].quantityOnHand` / `suppliersWithoutRoutes[]` (named supplier locations); PA `29 Cleveland` (home branch); Capital `Available` (home branch = Macedonia is a STRONG INFERENCE from one modal's totals, doc 24; the adapter keeps it inferred until a branch id confirms it) and the per-warehouse stock doc 24 describes (s.5 saw only the ten-warehouse facet). Gateway `other_warehouse_quantity` (National) and Capital's grid `Regional` are aggregates with no warehouse identity and go to `availabilityTiers`, never to an invented branch. `orderableByThisAccount` is `yes` for Capital's home warehouse (OBSERVED, doc 24: the quantity stepper exists only on Macedonia, every other warehouse shows `-` = `no`, and checkout exposes Finalize Order) and for Gateway's servicing-warehouse `on_hand` (PROVEN 2026-10-18: a read-only probe with the shop login showed `cart_write` + `order_write`, `docs/operations/REALITY-LEDGER.md` row "Admin places the supplier order"; `trade_region[]` and national stock stay UNKNOWN), and stays UNKNOWN for every other vendor until a cart or order response is captured: an O'Reilly route proves a scheduled route exists, not that this account may order from it (`autoSourceBlocked` can be set on a routed source). A capped `99+` / `50+` maps to `qty: {atLeast: n}` (doc 26 s.3, amended), never to the bare number |
| `availabilityTiers` (new, doc 26 s.3 amended) | ATD's six delivery-time counts, PA `Transfers` / `Shipping`, Gateway `other_warehouse_quantity` (National) and Capital's grid `Regional` are aggregate fulfillment buckets with no branch code, name, kind or per-location orderability; they are kept as typed tier totals here with `orderable: UNKNOWN` (doc 26 s.3) and never turned into invented `locations[]` rows; a tier is display-only and never ranked until an order response confirms this account may draw on it |
| `arrival.tier` (doc 26 enum only: `pickup_now, today, tomorrow, named_date, multi_day, national, unknown`) | ATD labels (s.4): `Pickup` -> `pickup_now`, `Today, Delivery` -> `today`, `Tomorrow` -> `tomorrow`, the weekday-date label -> `named_date` (with `onDate`), `Multi-Day` -> `multi_day`, `National` -> `national`. O'Reilly: `quantityFromStore > 0` -> `pickup_now`; a `suppliersWithRoutes[]` entry -> `today` / `tomorrow` / `named_date` by the calendar date of `inStoreBy` (the shop leg stays separate, see `arrival.at`); `suppliersWithoutRoutes[]` only -> `unknown`; `relationshipToStore` (`SERVICING_DC`, `LINKED_DC`, `SURROUNDING_STORE`) is kept in `inventoryMeta`, never emitted as a tier. Gateway: `on_hand > 0` -> `named_date` from the header's `Local Delivery <date>` when present, else `unknown`; `trade_region[]` with `est_delivery_days` -> `multi_day`; `other_warehouse_quantity` only -> `national`. Capital: `unknown` (no ETA anywhere, doc 24). PA: `Transfers` / `Shipping` are fulfillment words, not timings: they feed `availabilityTiers` and `fulfillmentMode`, and PA `arrival.tier` stays `unknown` until PA shows a time |
| `arrival.at`, `arrival.orderBy`, `arrival.inStoreBy`, `arrival.relativeDays`, `arrival.onDate` (the last three added to doc 26 s.3 by this doc) | O'Reilly `nextRoute.cutoffTime` (ISO) feeds `orderBy`; `nextRoute.estimatedArrivalTime` is the time the part reaches the O'Reilly store and feeds `arrival.inStoreBy`, not `at`: the store-to-shop run is a separate leg, so `at` stays UNKNOWN until that run time is measured (doc 26 "Arrival = departure + route time"). ATD shows a date label only (`Mon 11/9`, no year, time or timezone): it feeds `arrival.tier: named_date` and `arrival.onDate` (date-only, doc 26 s.3 amended), and `at` stays UNKNOWN. PA: `Submit By` and `My Branch Departure` differ per source (home, Lorain, Huron) and feed doc 26's per-location `submitBy` and `departsMyBranchAt`; offer-level `arrival.orderBy` stays UNKNOWN for PA, and `arrival.at` stays UNKNOWN until the branch-to-shop route time is known (doc 27 s.3a). Gateway: `est_delivery_days` is a relative integer whose base instant, business-day and timezone rules were not captured, so it feeds `arrival.relativeDays` and `at` stays UNKNOWN; the `get-cut-off-time` value is a local time string with no date or zone (the repo parser's fixture is `3:00 PM`), so it is kept as `orderCutoffRaw` (doc 26 s.3 amended) and `orderBy` stays UNKNOWN until its date, zone and DST semantics are established (s.10 item 3). Quickest Arrival ranks an exact `at` by time and a partial promise only coarsely against its own kind (doc 26 s.3) |
| `orderCutoff` per branch | Gateway `/master/get-cut-off-time` feeds `orderCutoffRaw` only (shape in s.3, time-only value); ATD: only the header countdown is OBSERVED, the `fetch-cutofftimes` response mapping is UNKNOWN until an authenticated capture (s.10 item 3); PA `Order Cut Off`; O'Reilly `nextRoute.cutoffTime` |
| `priceStatus` | Gateway `disable_call_for_price`; O'Reilly basket `error`/`errorMessage` keys; Capital/PA DOM |
| `core` | O'Reilly `corePrice`; PA `core:`; ALG line `coreValue` + `coreTrackingEnabled` |
| `promo` | Gateway `special_offer_id`, `rebate_*`; Capital spotlight facet. O'Reilly: `promoApplied` is a boolean only and the `promotions/batch` shape was not captured (s.8), so the `{programId, name}` object stays UNKNOWN for O'Reilly |
| `rawDescription` | Capital unparsed `~` strings; Gateway `tire_data` text |
| `sourceTags` | No vendor field. Provenance (`supplier_live` / `cached` / `manual`) comes from the adapter's own fetch or cache path. O'Reilly `stockingData` and Gateway `is_site_product` / `source` describe stocking and product classification, not how a figure was verified; they go in `inventoryMeta` (doc 26 s.3, added by this doc) |
| Ticket line hooks | ALG `ticketItems[].vendorId`, `partCode`, `partId`, `inventoryStockId`, `technicianId` |

Ranking stays as doc 26 s.2 wrote it. Two additions from the data: (1) ATD already ships "Availability, Cost Low
to High" as a sort, so the counter will recognise the rule; (2) O'Reilly's `allRoutesShareArrival` and
`autoSourceBlocked` are vendor-side hints that the comparison screen should surface instead of recomputing.

## 10. UNKNOWN, with the route to close each

1. SHAPE CAPTURED 2026-11-07 (s.2 "Labor lookup"): `job/searchDsiJobs` + `jobLabor/getJobLabor` +
   `Parts/getSuggestedParts`. Still UNKNOWN: whether those GETs answer standalone (they were only seen after the
   wizard's `updateTicketSession` PUT, so no read-only path is proven yet; route: one GET replayed with the
   session's headers and no PUT, on Nour's go), what `laborHash`, `shopTimeId` and `jobAddons[]` hold on a job
   with add-ons, and whether the PUT left a visible draft on the counter's screen (un-added; check the ticket).
2. ALG `jobLabors[]`, `labors[]`, `ticketPayments[]` shapes (empty on the viewed estimate). Route: view one
   closed invoice with a payment.
3. Gateway `get-cut-off-time`: the response shape is known from `gatewaySupplierOrder.ts` `readCutoff` (s.3); what
   stays UNKNOWN is the value's date and timezone semantics. ATD `fetch-cutofftimes` body: UNKNOWN (returned `{}`
   without the SPA's auth context). Route for both: hook installed before the dashboard loads, then a reload.
4. Federated results grid transport (JSON vs HTML). Route: pick a model whose `eng[]` is non-empty, proceed, hook
   first.
5. The portal boundary applies to every vendor, JSON or not. Gateway's custom API (authorization unverified,
   doc 20) and O'Reilly's bearer endpoints (an approved API or punchout request is still required, doc 20) are
   fixtures only until permission is confirmed, with doc 10's visible handoff in the meantime. The operator call
   is doc 20's open vendor-authorization question (Gateway unverified, O'Reilly API or punchout required); the
   concrete plan that follows this PR (doc 32) will carry it as a named decision. Capital and PA have no JSON feed from the catalog pages. Per the plan's portal boundary
   (doc 03 s."For every supplier", doc 10 "Portal handoff"), the adapter does NOT scrape these authenticated pages: PA goes through its
   documented punchout (doc 20) and Capital through a visible operator handoff or a vendor-approved export (the
   `Download Price List` control exists on Capital; its terms are unread). Whether either vendor offers an API is
   UNKNOWN.
6. Capped stock (`99+`, `50+`) has no slot in doc 26's `locations[].qty` (number or UNKNOWN). Amended in doc 26
   s.3: `qty` may be `{atLeast: n}`; it ranks as in stock and never prints as an exact count.
7. ALG `ticketItems[].type` enum values for labor, part and miscellaneous lines. Route: one viewed ticket that
   carries all three line kinds, then read `type` per line against the on-screen section. Until then the ALG
   import and the conformance fixtures classify lines UNKNOWN; the restored labor/part split is not computed.

## 11. For the supplier-compare build (fixture list)

Fixtures a conformance suite can carry, built from the shapes above with catalog-only values: Gateway
`quicksearch/cache` row (local 0, regional > 0, `est_delivery_days` 3 and 4), O'Reilly `availability` row
(store 0, servicing DC 1 with route, linked DCs without route), O'Reilly `pricing/basket` with one `error: true`
item, ATD six-tier card text, Capital row text with `Out of stock` and `50+`, PA row text for each of the three
tier words, ALG `ticketItems[]` rows with `type` left unclassified (the numeric enum is UNKNOWN, s.10 item 7, so
the fixture asserts the raw fields, never a line kind). Each fixture names the tier doc 26 expects the adapter to
emit; `UNKNOWN` is a passing answer where the vendor shows nothing.
