# Shop OS 30: portal network schematics - the wire-level shapes behind audits 21-29

Job 2026-11-07-portal-network-schematics. Status: CURRENT (extend after any new capture). Nour (2026-11-07):
"use the /reverse-engineer-anything in chrome on those pages n do even better ... be as detailed as possible getting
schematics ... dont forget real time labor or alg because i want it all based around that too its my crm". This is
the pass below the UX audits: what each portal's browser actually sends and receives, captured with a fetch/XHR
hook installed in Nour's own logged-in Chrome tabs (passive runtime observation, REA style), plus static reads of
the shipped JavaScript bundles. Read-only throughout: size and part-number searches, one ticket view, no cart, no
order, no form submit, no credential entry. FACT/OBSERVED = seen in the response or bundle this session.
INFERRED = reasoning from it. UNKNOWN = not reached, with the route that would reach it.

**Privacy rule for this file (public repo):** no account numbers, ship-to or tenant ids, tokens, cookies,
customer names, phones, VINs or ticket ids. Field NAMES and shapes only; example values are catalog data.

## 0. Answer first

1. **ALG is Real-Time Labor Guide PRO** (Dowell Systems, `secure.autolaborexperts.com`): one product, one login,
   one API. "Real time labor" and "ALG" in Nour's words are the same system. Its ticket API (`ticket/getTicket`)
   already carries every line item (labor, part, misc) with unit price, markup, quantity, rate, tax and core
   fields. The nickstire mirror holds none of that (doc 17 s.2): the split is recoverable per ticket from this
   endpoint, read-only.
2. Every supplier portal exposes availability as **structured JSON** behind the page, not just rendered text.
   The richest two are O'Reilly (`products/availability`: servicing DC vs linked DC vs surrounding store, with
   `nextRoute.cutoffTime` and `estimatedArrivalTime` per supplier location) and Gateway (`quicksearch/cache`:
   local, regional and national on-hand with a stated `est_delivery_days` per regional warehouse).
3. ATD, Capital, Federated and Parts Authority render availability server-side (full page loads); their tiers
   are read from the DOM, not JSON. ATD's six tiers and Capital's `Available` / `Regional` pair are exact counts
   capped at `99+` / `50+`.
4. Doc 26 s.5's Gateway question is answered: the Regional bucket shows 3-4 `est_delivery_days` per warehouse
   and `trade_region_splitup = true` on every row (STRONG INFERENCE: regional stock is orderable and the order
   splits by site; not tested, no cart action).
5. The one thing still UNKNOWN that the CRM needs most: the ALG **labor-time lookup endpoint** (the bundle names
   `laborTimes` with low/average/high, `getLaborItem`, `laborGuideDetail`; the path lives in the ticket editor's
   lazy chunk, which only loads on Edit). Route to close: Nour opens one ticket's Edit, the hook captures one
   labor search, zero writes.

## 1. Cross-portal wire matrix (OBSERVED unless marked)

| Portal | Host / stack | Search entry | Availability comes back as | Cutoff / ETA source | Price fields |
|---|---|---|---|---|---|
| ALG / Real-Time Pro | `secure.autolaborexperts.com` SPA (React, Vite chunks) over `https://<tenant>.autolaborexperts.com/api/<Controller>/<action>/` | ticket, customer, vehicle (QuickVIN), labor guide | n/a (shop system) | n/a | per line: `unitPrice`, `partMarkup`, `rate`, `quantity`, `subTotal`, `tax`, `total`, `coreValue` |
| Gateway / D&K | `b2b.dktire.com` SPA over `api-b2b.dktire.com` | `POST /quicksearch/cache` (size) | JSON per item: `on_hand`, `trade_region_quantity`, `other_warehouse_quantity`, `trade_region[]` | `/master/get-cut-off-time` + header countdown; `trade_region[].est_delivery_days` | `pricing_data[]`: `selling_price` (cost), `cost_price` (retail 2x), `fet`, `tire_tax`, special/rebate fields, `disable_call_for_price` |
| ATD Online | `www.atdonline.com` server-rendered (`/es-search/refine?text=`; Hybris-style, INFERRED) | keyword/size box, Y/M/M/Trim, VIN | DOM: six tiers per SKU (counts, `99+` cap) | header `ORDER COUNTDOWN` + `/ajax/get/fetch-cutofftimes` (body UNKNOWN, see s.4) | DOM: unit cost (`HIDE UNIT COST` toggle), FET shown as `Missing` when absent |
| Capital Tire | `capitaltire.net` (TCS white-label), server-rendered `/Wholesale/catalog/...Power_Search:<size>` | one box with All/Tires/Wheels/Other | DOM per row: `Available: N` and `Regional: N` (`Out of stock`, `50+` cap) | none on the grid | DOM: `Sell Price`, `Cost`, `FET`, `Display Cost` switch, `Download Price List` |
| Federated / Fisher | `www.federatedlink.com` ASP.NET WebForms | `aces/json/vehicleSelector.aspx` (Y/M/M/Engine JSON), Item Search, `ACES/ShowParts.aspx` | DOM (results grid not reached, s.4) | none shown | DOM; `Hide Cost` checkbox |
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
- `ticketItems[]` (every line, labor and parts alike): `{id, order, type (numeric enum), description,
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

**What the mirror is missing and where it is (FACT):** doc 17 s.2 says line items, hours, margin and declined
lines are not in our database. `ticketItems[]` has unit price, markup, quantity, rate and tech per line;
`showLaborHours` and `rate` give hours = `subTotal / rate` on labor lines (INFERRED); `taxItems` gives the tax
split. `customer.ticketCount` and `recentTicket` are the vendor's own repeat-customer counters. The historical
import era's parts/labor split (2024-01 to 2026-03) came from this same object; the live summary mirror simply
stopped reading it.

**Client routes (FACT, from the bundle's route table; the SPA has 216 lazy chunks):**
- Ticket: `ticket` (new), `ticket/view/<id>`, `abandoned` (In Progress), `recent`, `dataRecovery/ticketSession`,
  `dataRecovery/customer` (auto-saved drafts and deleted-record recovery exist server-side).
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
  `quickVinLookup, quickVinEnabled, quickVinApproved, QuickVinNightlyLog` (a nightly VIN job exists);
  integrations named: QuickBooks Online (`syncQuickbooks`, `qboId` on ticket and customer), Authorize.Net
  (`authorizeNetRegistry`, `getAuthorizeNetReport`), "Motor" (the labor-data source, INFERRED from the name).
- Labor guide (names only, FACT; endpoint path UNKNOWN): `RealTimeLaborGuide`, `RTLaborGuide`, `laborTimes`,
  `laborTimeLowIsActive / laborTimeAverageIsActive / laborTimeHighIsActive`, `getLaborItem`, `laborGuideDetail`,
  `laborGuideMessage`, `getLaborReport`. So a labor lookup returns three times (low, average, high) and the shop
  picks which one is active - the CRM's labor line should carry all three plus the chosen one.

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
  `/master/get-cut-off-time` (body shape UNKNOWN: a page-context fetch without the bearer returned `{}`).
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
  `suppliersWithRoutes` entry, arrival = `nextRoute.estimatedArrivalTime`, order-by = `nextRoute.cutoffTime`;
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
| `locations[].qty` and `orderableByThisAccount` | Gateway `on_hand` / `trade_region[].on_hand` / `other_warehouse_quantity`; O'Reilly `quantityFromStore` / `suppliersWithRoutes[].quantityOnHand` / `suppliersWithoutRoutes[]` (route present = orderable, INFERRED); PA `29 Cleveland / Transfers / Shipping`; Capital `Available` / `Regional`; ATD six tiers |
| `arrival.tier` | ATD tier label; O'Reilly `relationshipToStore` + route presence; Gateway local vs `trade_region[]` vs national; PA tier word |
| `arrival.at`, `arrival.orderBy` | O'Reilly `nextRoute.estimatedArrivalTime`, `nextRoute.cutoffTime` (ISO); Gateway `est_delivery_days` per site + `get-cut-off-time`; ATD named date; PA departure times |
| `orderCutoff` per branch | Gateway `/master/get-cut-off-time`; ATD `fetch-cutofftimes`; PA `Order Cut Off`; O'Reilly `nextRoute.cutoffTime` |
| `priceStatus` | Gateway `disable_call_for_price`; O'Reilly basket `error`/`errorMessage` keys; Capital/PA DOM |
| `core` | O'Reilly `corePrice`; PA `core:`; ALG line `coreValue` + `coreTrackingEnabled` |
| `promo` | Gateway `special_offer_id`, `rebate_*`; O'Reilly `promoApplied`, `promotions/batch`; Capital spotlight facet |
| `rawDescription` | Capital unparsed `~` strings; Gateway `tire_data` text |
| `sourceTags` | O'Reilly `stockingData` flags; Gateway `is_site_product`, `source` |
| Ticket line hooks | ALG `ticketItems[].vendorId`, `partCode`, `partId`, `inventoryStockId`, `technicianId` |

Ranking stays as doc 26 s.2 wrote it. Two additions from the data: (1) ATD already ships "Availability, Cost Low
to High" as a sort, so the counter will recognise the rule; (2) O'Reilly's `allRoutesShareArrival` and
`autoSourceBlocked` are vendor-side hints that the comparison screen should surface instead of recomputing.

## 10. UNKNOWN, with the route to close each

1. ALG labor-time lookup endpoint and its response (low/average/high). Route: Nour opens Edit on any ticket with
   the hook installed, runs one labor search, nothing saved. Zero writes.
2. ALG `jobLabors[]`, `labors[]`, `ticketPayments[]` shapes (empty on the viewed estimate). Route: view one
   closed invoice with a payment.
3. Gateway `get-cut-off-time` and ATD `fetch-cutofftimes` bodies (both returned `{}` without the SPA's auth
   context). Route: hook installed before the dashboard loads, then a reload.
4. Federated results grid transport (JSON vs HTML). Route: pick a model whose `eng[]` is non-empty, proceed, hook
   first.
5. Capital and PA: no JSON feed from the catalog pages; an adapter scrapes the DOM or uses the price-list download
   (`Download Price List` exists on Capital). Whether either vendor offers an API or punchout is UNKNOWN (doc 20
   covers PA's documented punchout for Mitchell 1/ALLDATA).

## 11. For the supplier-compare build (fixture list)

Fixtures a conformance suite can carry, built from the shapes above with catalog-only values: Gateway
`quicksearch/cache` row (local 0, regional > 0, `est_delivery_days` 3 and 4), O'Reilly `availability` row
(store 0, servicing DC 1 with route, linked DCs without route), O'Reilly `pricing/basket` with one `error: true`
item, ATD six-tier card text, Capital row text with `Out of stock` and `50+`, PA row text for each of the three
tier words, ALG `ticketItems[]` labor and part lines. Each fixture names the tier doc 26 expects the adapter to
emit; `UNKNOWN` is a passing answer where the vendor shows nothing.
