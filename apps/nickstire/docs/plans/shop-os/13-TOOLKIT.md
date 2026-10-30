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

## 2. Our own services and keys (names only; every "set in prod" is U until a prod read)
| Item | State | Receipt | Next, who |
|---|---|---|---|
| Railway, 3 services | HAVE F | AGENTS.md topology; `apps/worker/DEPLOY.md`; railway CLI 5.64.0 runs here | none |
| TiDB (nickstire), Neon (statenour) | HAVE F | `DATABASE_URL` in nickstire env example; `DATABASE_URL`, `DIRECT_URL` in statenour's | none. Schema work: `nickstire-tidb-ddl` |
| Shop SMS gateway (primary), Twilio (fallback) | HAVE F | names `SHOP_SMS_GATEWAY_USERNAME/_PASSWORD/_URL/_WEBHOOK_SECRET`, `TWILIO_ACCOUNT_SID/_AUTH_TOKEN/_PHONE_NUMBER`; INTEGRATION_REGISTRY | none |
| Vapi (receptionist) | HAVE F | names `VAPI_API_KEY`, `VAPI_WEBHOOK_SECRET`, `VAPI_RECEPTIONIST_ASSISTANT_ID`, `VAPI_FOLLOWUP_ASSISTANT_ID` read in `server/` | none |
| Stripe | HAVE F | names `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PUBLISHABLE_KEY` | none |
| Google login, Maps, Places, Sheets | HAVE F | names `GOOGLE_OAUTH_CLIENT_ID/_SECRET`, `OWNER_OPEN_ID`, `GOOGLE_MAPS_API_KEY`, `GOOGLE_PLACES_API_KEY`, `GOOGLE_SHEETS_CRM_ID` | Sheet sync stays off for /system (09 section 3) |
| AI providers | HAVE F | names `GEMINI_API_KEY`, `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `OLLAMA_BASE_URL/_API_KEY/_MODEL`; UPSTREAMS Ollama NATIVE | Local-model plan: sibling doc 12 |
| Langfuse, Sentry | HAVE F | names `LANGFUSE_PUBLIC_KEY/_SECRET_KEY/_BASE_URL`, `SENTRY_DSN`; UPSTREAMS Langfuse ADOPTED | none |
| Cross-app bridge, cron, email | HAVE F | names `STATENOUR_SYNC_KEY`, `BRIDGE_API_KEY`, `CRON_SECRET`, `RESEND_API_KEY` | none |
| Staff provisioning, checkout permission, tech clock, MFA gate | MISSING (code) | 09 section 2 P0 tasks 1-4; `isAdminMfaRequired()` is OFF | Agent builds after Nour's day 13-14 go |
| New vendor key names (Koalafi private key, PartsTech) | MISSING | names TBD; Nour sets values in Railway himself, never in chat | blocked on vendor issue |
| Bitwarden vault for shop logins | MISSING | memory shop-os-job-2026-10-26, "Owed by Nour"; 0 repo hits | Nour creates it (10 min); agents never type passwords |

## 3. Agent tooling (connected NOW = this session's start lines and tool list, 2026-10-30)
| Item | Connected now | Receipt | Next, who |
|---|---|---|---|
| graphify MCP, vapi-docs MCP (user scope) | yes | start lines "[surface] mcp: user graphify, vapi-docs", "[health] graphify up"; graph is MAIN, not a branch | none |
| Neon, Prisma Remote, Vercel, context7, Twilio docs, Sentry MCP | tools listed; auth not exercised | session tool list | Reads only; infra writes are denied by name (AGENTS.md `infra-mutation-tool`) |
| Gmail, Calendar, Drive, Sheets connectors | tools listed; auth not exercised | session tool list | Any send needs Nour's go |
| Chrome extension, built-in browser, computer-use | tools listed | memory desktop-commander-and-computer-use | computer-use grants are per session |
| Perplexity research route | BLOCKED | memory feedback-research-via-perplexity-chrome (2026-10-22, Chrome policy on the extension) | Nour lifts the site-access setting (3 min), else read primary pages directly |
| Desktop Commander plugin | NO, connect timeout | start-up failure list; `config/agent-os/required-plugins.json` | Nour: `/plugin` manage, or fix later |
| agentic-council, receipts-check plugins | NO, not enabled | "[health] plugins MISSING" start line | Nour: claude.ai Settings > Plugins (2 min) |
| Prisma-Local, telegram, discord, imessage MCP | NO, closed | `knownConnectFailures` in required-plugins.json | Do not retry; alerts use server-side `TELEGRAM_*` names |
| QuickBooks plugin | REJECTED | required-plugins.json `reject` (intuit-quickbooks) | If QBO is used, build on its API (UPSTREAMS 2026-09-23) |
| CLIs | yes | versions run here: gh 2.102.0, railway 5.64.0, pnpm 10.4.1, node 24.19.0, uv 0.13.1, rtk 0.50.0 | repomix not checked |

Skills this build needs (exact names; all in `.claude/skills/` at base 33d02c1a24 unless noted):
| Skill | Use in this build |
|---|---|
| `steal-like-an-artist` | turn each of Nour's screenshots into adopt/adapt/reject with a `Benchmarked against:` line. Machine copy only: absent from repo `.claude/skills/` (its own text says byte-identical repo copy exists; `ls` says no). Manager commits it |
| `reverse-engineer-anything` | our own captures, bundles and devices only; other vendors' screens are observation |
| `prior-art-grep` | grep both apps for a table, tool or env name before building it |
| `plan-gate` | gate pasted plans and the day 13-14 call against UPSTREAMS |
| `nickstire-ios-pwa-primitives` | every /system confirm: two-tap, 48 px, no `window.confirm` |
| `nickstire-tidb-ddl` | repair-order, inventory and tech tables (TiDB row-loss traps) |
| `prod-db-guard` | any script that opens a DB, the ALG import included |
| `shop-pc-remote-session` | driving the front-desk PC; a denied write means the hand-off block |

## 4. Devices and the route to each
| Device | State | Receipt | Route, who |
|---|---|---|---|
| NattyNour (dev laptop) | HAVE F | start health line: claude, codex, vscode, hooks ok; memory nattynour-machine-setup | RAM is the limit (docs and single-file checks only until it frees up) |
| MECHANICS (front-desk PC) | HAVE F | memory office-lane-shop-pc: office camera task runs there; 16 GB | Chrome Remote Desktop, skill `shop-pc-remote-session`; denied write means hand-off block. Future /system counter screen (Nour installs the PWA) |
| NicksMax (lot PC) | U | memory office-lane-shop-pc (offline since 2026-10-16, as of 2026-10-18); lot-vision-v2-2026-10-26 moved the counting to MECHANICS | Owned by the nicksmax session; do not touch |
| Zach's phone (tech view) | U | no test yet; light theme for bright bays is open (06 row 8) | Nour: 10 min outdoor test before /system/tech is built |

## 5. Nour does these, in order (each under 10 minutes unless marked)
1. Send screenshots of the screens you want from each product (replaces the vendor email, PARKED).
2. Sign up PartsTech's free plan and connect the parts accounts (about 20 min; 06 row 0a, the cheapest test in the plan).
3. Answer in one line: card terminal model, QuickBooks yes or no, how many wrenches on a normal day (06 rows 0b, 7).
4. Google Cloud console: is Routes API enabled on the Maps key's project (3 min).
5. Enable `agentic-council` and `receipts-check` (claude.ai Settings > Plugins) and lift the Chrome site-access policy for Perplexity.
6. Create the Bitwarden vault for shop logins; pick an after-6-PM night for the ALG API map; give the crew roles (09, 06 row 3).

## 6. NOT CHECKED
- Searches that came up empty (0 hits, not proof of "no account"): partstech, routes.googleapis, computeRoutes, quickbooks, maverick, tireweb, wheelpros in `apps/nickstire` server/shared/client and `apps/statenour` lib/app.
- Whether any key NAME above is set in Railway (no prod read); Koalafi's reply; Google Cloud console; claude.ai connector auth.
- repomix; Perplexity itself; sibling doc 12 (local AI); the Shopmonkey and Tekmetric trial terms.
- Plan-gate note for the manager: UPSTREAMS lists PartsTech and MOTOR as WATCH (2026-09-23) while 05 days 4-7 reopens PartsTech; record the verdict change there.
