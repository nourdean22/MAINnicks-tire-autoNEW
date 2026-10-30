# Shop OS 13: toolkit (what we hold, what is missing, what Nour decides)

Job 2026-10-30-shop-os-toolkit. Census only: no install, no prod read, no secret value (env var NAMES only). F = fact with
receipt, U = unknown. A key NAME in an env example is not proof it is set in prod (AGENTS.md): "set in prod: U".
PARKED = needs a vendor reply; Nour sends screenshots instead of vendor emails (2026-10-30, 06 row 2).

## 1. Shop accounts and vendor APIs
| Item | State | Receipt | Next, who |
|---|---|---|---|
| D&K Tire (Gateway) | HAVE F | `server/services/gatewayClient.ts`, `gatewaySupplierOrder.ts`; names `GATEWAY_TIRE_USERNAME/_PASSWORD/_SHIP_TO`, `GATEWAY_ORDERING_ENABLED`; `dkClient.ts` is an unused mock | Reuse. Ordering stays an admin one-tap |
| Kafene | HAVE code F | `server/services/kafene/*`; names `KAFENE_API_KEY/_MERCHANT_ID/_STORE_ID/_ENVIRONMENT`; memory kafene-portal-client-decisions; migrations 0147, 0148 (`kafene_leases`) STILL OWED (`truth_os.md`) | Nour taps admin Run Migrations; vars set in prod: U |
| Snap Finance | PARTIAL | names `SNAP_FINANCE_*` read, but no public merchant API (`server/services/snapFinanceSync.ts:16`); endpoint unverified | Vendor probe before any reuse |
| Koalafi | PARTIAL | keyless apply link live (`shared/financing.ts`); memory koalafi-direct-api-state | `KOALAFI_PRIVATE_API_KEY` MISSING; asked 2026-10-19; Nour checks the reply |
| Acima, AFF | link only | apply links in `shared/financing.ts`; no key NAME | DECIDE: which 3 programs earn it (finance log, 05 days 4-7) |
| Sezzle, Progressive, Synchrony | MISSING | no entry in `shared/financing.ts` | Candidates only; no route exists |
| PartsTech | MISSING | 0 code hits, no account known (06 row 0a) | Nour signs up the free plan, connects parts accounts. Partner API: PARKED |
| O'Reilly API, MOTOR labor, Tireweb, TireBase, Wheel Pros, Xpress, Elite | MISSING | 0 code hits (TireFinderLegacy.tsx text only) | PARKED until the parts drawer |
| Google Routes API | U | 0 code hits; `GOOGLE_MAPS_API_KEY` named (INTEGRATION_REGISTRY) | Nour: Cloud console, is Routes API enabled |
| Maverick card terminal | U | 0 code hits; model, API unknown (03) | Settings entry; API PARKED |
| QuickBooks Online | U | 0 code hits; UPSTREAMS ADOPT-CANDIDATE 2026-09-23 | Settings entry later, not a blocker |
| ALG / ShopDriver Elite | HAVE mirror F | names `ALG_USERNAME/_PASSWORD`, `AUTO_LABOR_*`; one login at a time (memory shop-os-job-2026-10-26) | Nour picks an after-6-PM night, signs in himself |
| Shopmonkey, Tekmetric, Shop-Ware trials | MISSING | UPSTREAMS WATCH, operator decision (2026-09-23) | Nour, days 8-12 only (05) |

## 2. Our own services and keys (names only; "set in prod" is U until a prod read)
| Item | State | Receipt | Next, who |
|---|---|---|---|
| Railway (3 services), TiDB, Neon | HAVE F | AGENTS.md topology; `apps/worker/DEPLOY.md`; `DATABASE_URL`, `DIRECT_URL`; railway CLI 5.64.0 here | Schema work: `nickstire-tidb-ddl` |
| Shop SMS gateway (primary), Twilio (fallback) | HAVE F | names `SHOP_SMS_GATEWAY_USERNAME/_PASSWORD/_URL/_WEBHOOK_SECRET`, `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_PHONE_NUMBER` | none |
| Vapi, Stripe | HAVE F | names `VAPI_API_KEY`, `VAPI_WEBHOOK_SECRET`, `VAPI_RECEPTIONIST_ASSISTANT_ID`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` | none |
| AI providers | HAVE F | names `GEMINI_API_KEY`, `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `OLLAMA_BASE_URL/_API_KEY/_MODEL` | Local-model plan: `12-LOCAL-AI-AND-MESH.md` (sibling PR, not on main yet) |
| Langfuse, Sentry, bridge, cron | HAVE F | names `LANGFUSE_*`, `SENTRY_DSN`, `STATENOUR_SYNC_KEY`, `BRIDGE_API_KEY`, `CRON_SECRET` | none |
| Email (Resend) | PARTIAL | `RESEND_API_KEY`; `docs/CURRENT-TRUTH.md:488`: domain verification failed until DNS records are added | Nour adds the DNS records at the DNS provider |
| MFA gate | EXISTS, OFF | `server/services/adminSecurity.ts`: `ADMIN_MFA_REQUIRED=1` re-arms it | Turn on for staff roles after a phone setup test (09 P0 task 4) |
| Staff provisioning, checkout permission, tech clock | MISSING (code) | 09 section 2 P0 tasks 1-3. Good practice rows, not gates | Agent builds after the day 13-14 go |
| Owner Settings screen in /system (techs, bays, roles, hours, prices) | DECIDE | Nour 2026-10-30: edit staff count and the rest any time; replaces hard-coded facts in `shared/business.ts` | Recommend yes. Tech count, crew roles, counter lead become entries, not blockers |
| New vendor key names (Koalafi private key, PartsTech) | MISSING | names TBD; Nour sets values in Railway himself | blocked on vendor |
| Bitwarden vault for shop logins | MISSING | memory shop-os-job-2026-10-26 "Owed by Nour"; 0 repo hits | Nour creates it (10 min); agents never type passwords |

## 2b. Google accounts (role words only; public repo)
| Account or asset | Holds today | Receipt | Next, who |
|---|---|---|---|
| Shop-location account | GBP owner, the StateNour Google grant, Eufy cameras, vendor bookmarks | INTEGRATION_REGISTRY GBP state 2026-09-16; memory nour-accounts-ceo-vs-location, office-lane-shop-pc; 03 | Ruling: owns Drive, Sheets, any Workspace data /system writes |
| CEO account | Nour's real calendar; this agent's Gmail and Drive connector | memory nour-accounts-ceo-vs-location; koalafi-direct-api-state (request sent from it) | needs view access to the above |
| CRM sheet (vendor health reads the same ID) | owner account: U | names `GOOGLE_SHEETS_CRM_ID` + `GOOGLE_SERVICE_ACCOUNT_EMAIL/_KEY` (`server/sheets-sync.ts:75`, `vendorHealth.ts:226`); login `GOOGLE_OAUTH_CLIENT_ID/_SECRET`. `GOOGLE_SPREADSHEET_ID`, `GOOGLE_DRIVE_TOKEN`, `GOOGLE_WORKSPACE_CLI_TOKEN`: env example only, no reader | Nour checks which account owns the sheet |
| CEO visibility | MISSING | no shared folder known | Nour, 3 min: signed in as the shop-location account, make Drive folder "Shop OS", share it with the CEO account as Viewer |

## 3. Agent tooling (connected NOW = this session's start lines and tool list, 2026-10-30)
| Item | Connected now | Receipt | Next, who |
|---|---|---|---|
| graphify MCP, vapi-docs MCP (user scope) | yes | start lines "[surface] mcp: user graphify, vapi-docs", "[health] graphify up"; graph is MAIN | none |
| Neon, Prisma Remote, Vercel, context7, Twilio docs, Sentry MCP; Gmail, Calendar, Drive, Sheets | tools listed; auth not exercised | session tool list | Reads only (infra writes denied); sends need Nour's go |
| Chrome extension, built-in browser, computer-use | tools listed | memory desktop-commander-and-computer-use | computer-use grants are per session |
| Perplexity research route | BLOCKED | memory feedback-research-via-perplexity-chrome (2026-10-22, Chrome policy) | Nour lifts the site-access setting (3 min) |
| Desktop Commander plugin | NO, connect timeout | start-up failure list; required-plugins.json | Nour: `/plugin` manage |
| agentic-council, receipts-check plugins | NO, not enabled | "[health] plugins MISSING" start line | Nour: claude.ai Settings > Plugins (2 min) |
| avoid-ai-writing, pr-review-toolkit, hookify plugins | not flagged missing | required-plugins.json:7-9; start health line lists only the two above | none |
| Prisma-Local, telegram, discord, imessage MCP | NO, closed | `knownConnectFailures` in required-plugins.json | Do not retry |
| QuickBooks plugin | REJECTED | required-plugins.json `reject` (intuit-quickbooks) | If QBO is used, build on its API (UPSTREAMS) |
| CLIs | yes | versions run here: gh 2.102.0, railway 5.64.0, pnpm 10.4.1, node 24.19.0, uv 0.13.1, rtk 0.50.0 | repomix not checked |

Skills this build needs (exact names; in `.claude/skills/` at base 33d02c1a24 unless noted):
| Skill | Use in this build |
|---|---|
| `steal-like-an-artist` | each screenshot becomes adopt/adapt/reject plus a `Benchmarked against:` line. Machine copy only, absent from repo `.claude/skills/`; manager commits it |
| `reverse-engineer-anything` | our own captures, bundles, devices only |
| `prior-art-grep` | grep both apps for a table, tool or env name first |
| `plan-gate` | gate the day 13-14 call against UPSTREAMS |
| `nickstire-ios-pwa-primitives` | every /system confirm: two-tap, 48 px, no `window.confirm` |
| `nickstire-tidb-ddl` | repair-order, inventory, tech tables |
| `prod-db-guard` | any script that opens a DB, the ALG import included |
| `shop-pc-remote-session` | front-desk PC driving; a denied write means the hand-off block |

## 4. Devices and the route to each
| Device | State | Receipt | Route, who |
|---|---|---|---|
| NattyNour (dev laptop) | HAVE F | start health line: claude, codex, vscode, hooks ok | RAM is the limit: docs and single-file checks only |
| MECHANICS (front-desk PC) | HAVE F | memory office-lane-shop-pc: office camera task runs there | Chrome Remote Desktop, `shop-pc-remote-session`. Future /system counter: Nour installs the PWA |
| NicksMax (lot PC) | U | memory office-lane-shop-pc (offline as of 2026-10-18) | nicksmax session owns it; do not touch |
| Zach's phone (tech view) | U | no test yet; light theme open (06 row 8) | Nour: 10 min outdoor test before /system/tech |

## 5. Nour does these, in order (under 10 minutes each)
1. Send screenshots of the screens you want from each product.
2. Sign up PartsTech's free plan, connect the parts accounts (06 row 0a).
3. Make the "Shop OS" Drive folder and share it with the CEO account (2b).
4. Google Cloud console: is Routes API enabled on the Maps key's project.
5. Enable `agentic-council` and `receipts-check`; lift the Chrome site-access policy for Perplexity.
6. Create the Bitwarden vault; pick an after-6-PM night for the ALG API map.
Prerequisite: name a counter lead for the days 1-3 money-leak sheet (06 row 0). Settings entries later, not blockers: tech count, crew roles, card terminal model, QuickBooks.

## 6. NOT CHECKED
- Empty searches (0 hits, not proof of "no account"): partstech, routes.googleapis, computeRoutes, quickbooks, maverick, tireweb, wheelpros in both apps' code.
- Any key NAME set in Railway (no prod read); Koalafi's reply; Google Cloud console; Drive ownership; connector auth; repomix; trial terms.
- Manager: UPSTREAMS holds PartsTech and MOTOR as WATCH while 05 days 4-7 reopens PartsTech; record the change.
