# Shop OS 13: toolkit (what we hold, what is missing, what Nour decides)

Job 2026-10-30-shop-os-toolkit. Census only; no install, no prod read, no secret value (env var NAMES only). F = fact with
receipt, C = claim, U = unknown (never zero). A key NAME in an env example is not proof it is set in production
(AGENTS.md), so those rows say "set in prod: U". PARKED = needs a vendor reply; Nour (2026-10-30) sends screenshots of the
screens he wants instead of vendor emails (06 row 2); emails stay ready if the build reaches the parts drawer.

## 1. Shop accounts and vendor APIs
| Item | State | Receipt | Next, who |
|---|---|---|---|
| D&K Tire (Gateway) | HAVE F | `server/services/gatewayClient.ts`, `gatewaySupplierOrder.ts`; names `GATEWAY_TIRE_USERNAME/_PASSWORD/_SHIP_TO`, `GATEWAY_ORDERING_ENABLED`; `dkClient.ts` is an unused mock | Reuse. Ordering stays an admin one-tap (protected op) |
| Kafene | HAVE code F | `server/services/kafene/*`; names `KAFENE_API_KEY/_MERCHANT_ID/_STORE_ID/_ENVIRONMENT`; memory kafene-portal-client-decisions | Set in prod: U. Nour reads merchant portal Integrations |
| Snap Finance | HAVE code F | names `SNAP_FINANCE_API_KEY/_MERCHANT_ID/_WEBHOOK_SECRET` read in `server/` | Set in prod: U |
| Koalafi | PARTIAL | keyless apply link live (`shared/financing.ts`); memory koalafi-direct-api-state | `KOALAFI_PRIVATE_API_KEY` MISSING; asked 2026-10-19; Nour checks the inbox reply |
| Acima, AFF, Sezzle, Progressive, Synchrony | link only | no key NAME in env examples or `process.env` reads | DECIDE: which 3 programs earn it (finance log, 05 days 4-7) |
| PartsTech | MISSING | 0 code hits, no account known (06 row 0a) | Nour signs up the free plan, connects parts accounts. Partner API: PARKED |
| O'Reilly API, MOTOR labor, Tireweb, TireBase, Wheel Pros, Xpress, Elite | MISSING | 0 code hits (TireFinderLegacy.tsx text only) | PARKED until the parts drawer; screenshots first |
| Google Routes API | U | 0 hits for routes.googleapis or computeRoutes; `GOOGLE_MAPS_API_KEY` named (INTEGRATION_REGISTRY) | Nour: Cloud console, is Routes API enabled on that project |
| Maverick card terminal | U | 0 code hits; terminal model and API unknown (03) | Nour tells the model; API question PARKED |
| QuickBooks Online | U | 0 code hits; UPSTREAMS ADOPT-CANDIDATE 2026-09-23 | Nour: does the shop use it (06 row 7) |
| ALG / ShopDriver Elite | HAVE mirror F | names `ALG_USERNAME/_PASSWORD`, `AUTO_LABOR_*`; one login at a time (memory shop-os-job-2026-10-26) | Nour picks an after-6-PM night and signs in himself |
| Shopmonkey, Tekmetric, Shop-Ware trials | MISSING | UPSTREAMS WATCH, operator decision (2026-09-23) | Nour, days 8-12 only (05) |
