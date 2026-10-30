# Shop OS 16: Claude/ChatGPT inside the CRM, full owner controls, customer profiles

Job 2026-10-30-shop-os-ai-controls-customer360. Docs only. FACT = path, or url read 2026-10-30; CLAIM = not opened
at the source; UNKNOWN. Cites 01, 09, 13, 15.

## Summary (phone screen)

| Ask | Recommendation | Nour decides |
|---|---|---|
| A. Claude and ChatGPT in the CRM | Mostly built: statenour's locked MCP server, the Ask assistant, the `admin_proposals` queue. Connect Claude read-only, then a tool that files proposals you tap. ChatGPT needs OAuth | read-only Claude now? customer names in chats? ChatGPT too? |
| B. Every control in /system | One Settings screen on the existing `shop_settings` table, a typed key list and a change history with undo. Secrets stay in Railway; legal floors are not settings | yes to the screen; who besides you may edit |
| C. Customer profile searcher | No lawful tool finds a private person's Instagram or Facebook from a phone or name. Build the profile from what they give us and what they do on our pages; clean the phone list with Twilio Lookup | ask for handles at the counter? run the lookup pass? |

## A. Claude and ChatGPT inside the CRM

**What exists (FACT)**
- statenour MCP server: `apps/statenour/app/api/mcp/route.ts`, origin check before auth, bearer token per client
  (`lib/agent-bridge/auth.ts`), default-deny scopes `read` and `tasks`, business writes hard-denied
  (`lib/agent-bridge/scopes.ts`). Shop tools in the catalog: `findCustomer`, `getShopSnapshot`, `getEstimateLeaks`,
  `queryNickstire` (`lib/ai/tools/catalog.ts:173-195`); only the middle two are in the `read` scope (`scopes.ts:90`). "Zero measured callers" on 2026-08-27
  (scopes.ts header): BUILT; callers UNKNOWN. Plan: statenour `docs/MCP-PLAN.md`.
- nickstire Ask assistant: `server/routers/nick/assistant.ts`, owner and manager, reads through existing procedures,
  actions are cards you tap (PRs 3300, 3306; 01 s.7 extends it into /system).
- Approve-before-run queue: `admin_proposals` (`drizzle/0111_admin_proposals.sql`), statuses draft to executed, source
  `ai_agent` allowed, executors registered in `server/services/proposals.ts:116` (callback, booking request).

**What the clients allow (FACT)**
- ChatGPT: OAuth 2.1 or no auth; it cannot "present custom API keys" (developers.openai.com/apps-sdk/build/auth).
  So today's bearer-token server cannot be added to ChatGPT as is.
- Claude: custom connectors on Free to Enterprise; add request headers "if your MCP server authenticates with an API
  key, bearer token" (support.claude.com/en/articles/11175166). Should connect today (INFERENCE, untested). One header token = one
  shared identity (`read-client`): fine on Nour's account; a Team plan needs per-user OAuth.
- MCP spec: clients "MUST consider tool annotations to be untrusted" (modelcontextprotocol.io spec 2025-06-18, tools).
  So a "read only" label is not a guard; the server's scope list is.

| Option | Mechanism | Stolen from | Cost | Risk | Kill criterion | Verdict |
|---|---|---|---|---|---|---|
| A1 copilot in /system | Ask panel on every /system screen; tap-to-run cards | 01 s.7; PR 3300 | in 01's build days; per-token cost already paid | low | median ask over 20 s across 20 asks (memory admin-assistant) | already planned, not new |
| A2 Claude reads the CRM | Claude connector, header token, scope `read`; add `findCustomer` and `queryNickstire` to `READ_TOOLS`, then ticket and board reads; Nour's own account only | Stripe MCP agent keys "with only the permissions the client needs" (docs.stripe.com/mcp) | 1 day; $0 (Nour's Claude plan) | token leak exposes reads: rotate, audit rows exist | not used 3 times in 14 days | DO NOW |
| A3 Claude/ChatGPT propose writes | one tool `proposeShopAction` calls `createProposal` (validates, audits, writes draft) then `submitForReview` (`proposals.ts:191,338`); you approve in /admin Approvals. The client's own approve button never counts | Stripe "Human confirmation": approve in the Dashboard, 24 h expiry, "separate from your MCP client's tool-approval setting" | 2 days | you reject a wrong one | any write executes without a tap: remove the tool | DO after A2 |
| A4 ChatGPT too | add OAuth 2.1 (CIMD or DCR) on the same server, Google sign-in as identity | ChatGPT auth page above; Stripe offers OAuth and keys side by side | 3-5 days | new auth surface | under weekly use after 30 days | only if you want ChatGPT |

Benchmarked against: Stripe MCP (docs.stripe.com/mcp, 2026-10-30); adopted: server-side approval, narrow keys,
revocable sessions; rejected: one generic write tool (`stripe_api_write`) because our writes must map to named executors.

Kept: 01 s.7 (no send, order or edit without a tap); MCP-PLAN tier 4 (no SMS, payments, deletes).
Bridge rule (doc 15 a4, PR 3390): every new /system table gets one read tool in this catalog.

**Nour decides:** (1) connect Claude read-only now; (2) may customer names and phones show in your Claude chats, or
masked (first name, last 4 digits)? Chats live in Anthropic's history, outside our database (01 s.9); (3) ChatGPT too.

## B. Every control, option and edit inside /system

Nour, 2026-10-30: "how many ompleyees n all that i should be able to edit and do whatever i want with whenever i want".
Doc 13 recommends a Settings screen; doc 15 a6 says no route is scheduled. This section says what goes on it.

**What exists (FACT)**
- `shop_settings` key/value table (`drizzle/schema.ts:1175`): categories pricing, contact, hours, sms, general; keeps
  only the last `updatedBy`, no history. Owner values in it: `laborRate` (5 readers), `tireMarkup`, `tirePriceFloors`,
  `vapi_transfer_presets` (edited via `server/routers/vapi.ts:1240`). About 15 other writers park machine state in the
  same table (cron observer, reel rotation, Nick memory, SEO drafts): owner keys must be fenced off from them.
- 75 feature flags (`server/services/featureFlags.ts`), toggled on the Settings flags panel
  (`client/src/pages/admin/settings/FeatureFlagsPanel.tsx`) with an audit row per flip (`server/routers/featureFlags.ts:52`).
- Social autonomy policy: versioned, schema-checked, every number bounded (`server/services/autonomyControl.ts:34`).
- Hard-coded: hours, phone, address, discount programs (`shared/business.ts:72,31,40,304`); tax 0.08 in `gatewayTire.ts:745,994`,
  `quoteEngine.ts:75`, `WalkInCalculatorSection.tsx:23`, `email-notify.ts:758`; hours again in `gemini.ts:76`,
  `shopStatus.ts:53`; text window 8 AM-8 PM (`server/sms.ts:585`). B1 replaces every one in the same change.
- 605 `process.env` reads in non-test `server/` files (git grep count): changing one needs Railway and a redeploy.
- Six roles exist (`shared/adminPermissions.ts`); no screen onboards a crew login (09 s.1, P0 task 1).

| Knob | Lives now | Should live |
|---|---|---|
| Crew, roles, count, pay type, bays and lifts | nowhere / one-row prod write | staff screen (09 P0 task 1) + settings |
| Hours, holidays, phone, address | `shared/business.ts` (deploy) | settings, effective date; public pages rebuild on change |
| Labor rate, tire markup, price floors, tax | `shop_settings` / code, 5 tax places | settings, one key each, history |
| Tire packages, canned jobs, discounts | code, ALG | their own tables with a screen (01) |
| Text templates, caps, send window | code, env, flags | settings inside legal floors |
| AI provider per lane, payment programs, vendors on/off | env, `shared/financing.ts`, `GATEWAY_ORDERING_ENABLED` | settings from an allowed list |
| Alert routing (who gets which ping) | env | settings |
| API keys, passwords, DB URLs | Railway | STAY in Railway: never in a screen or table |
| Legal floors (marketing calls 8 AM-9 PM local, 47 CFR 64.1200(c)(1), CLAIM; Ohio 10% approval line; consent) | code | NOT settings; a setting may be stricter, never looser |

| Option | Mechanism | Stolen from | Cost | Risk | Kill criterion | Verdict |
|---|---|---|---|---|---|---|
| B1 typed settings on `shop_settings` | each owner key declared once in code (type, bounds, default, who may edit; crons may not write it); every save appends a history row (who, old, new, when) with one-tap undo; new values apply forward only | Shopify: "The store activity log records changes made by the store owner, users, apps, and channels." (help.shopify.com/en/manual/shopify-admin/activity-logs); Tekmetric tax applies forward only (CLAIM, 403); our autonomy policy | 3-4 days | bad price: bounds, undo | after 30 days you still ask an agent to edit an on-screen value | DO, with the /system build |
| B2 more flags and env | keep adding env vars and flags | status quo | 0 | needs Railway and a deploy; not from a phone | n/a | REJECT |
| B3 settings of a bought core | if 05's day 13-14 decision buys the ledger, its screens own RO settings; B1 owns the rest | 05-ROADMAP v3 | vendor price | two places to look | n/a | only if the core is bought |

Benchmarked against: Shopify admin roles and activity log (help.shopify.com, 2026-10-30); adopted: a log of who
changed what, custom roles; rejected: a role builder, because six fixed roles cover a 5-person crew.

**Nour decides:** (1) Settings screen yes (doc 13 recommends yes); (2) who else may edit (proposal: only you; managers
may change hours).

## C. Customer profile searcher (outreach, reporting, knowing our customers)

**What exists (FACT)** customer record with timeline and history (memory idea-crm-unified-customer-record); identity
verdicts computed on read (`server/services/identityResolution.ts`); per-purpose consent ledger, mode off to enforce
(`server/services/consentLedger.ts`); `review_requests`, `review_pipeline`; report skills `shop-retention-report`,
`nicks-demand-report`, `gbp-local-report`. No social handle column on customers (schema grep, 0 hits).

| Source | What it gives | Platform terms (quote, url) | Allowed? |
|---|---|---|---|
| Find a person's IG/FB by phone or name | nothing: Business Discovery covers only "Instagram Business or Creator IG User", by `username` | developers.facebook.com/docs/instagram-platform (ig-user business_discovery) | NO lookup exists |
| Scraping IG or FB | n/a | "You may not access or collect data from our Products using automated means (without our prior permission)" (facebook.com/terms.php, eff. 2025-01-01); "You will not engage in Automated Data Collection without first obtaining Meta's express written permission" (facebook.com/legal/automated_data_collection_terms) | NO |
| Comments on our posts | `from.username` (ig-comment ref) | Platform Terms 3.a.v bans "Processing Platform Data without valid User consent in order to build or augment user profiles for any purpose." (developers.facebook.com/terms/dfc_platform_terms) | reply YES; attach to a customer only with their consent |
| Google reviews of our shop | `displayName`, photo, `isAnonymous`; no phone or email (GBP reviews ref) | API content "must be stored temporarily for no more than 30 calendar days" (developers.google.com/my-business/content/policies) | read YES; keep `reviewId` and re-fetch (no permalink field); a name match is an inference |
| Twilio Lookup on our own list | Caller Name (CNAM) $0.01, Line Type $0.008, Reassigned Number $0.02 each at low volume; no social data (twilio.com Lookup docs and pricing) | Twilio AUP: NOT CHECKED | YES; flags landlines and reassigned numbers before a text |
| Paid enrichment (People Data Labs) | `facebook_url`, `linkedin_url`, `twitter_url`; no Instagram field; free tier hides contact data, Pro from $98/mo (docs.peopledatalabs.com/docs/fields, pricing page) | PDL terms: NOT CHECKED; Meta-sourced data: 3.a.iv bans "Selling, licensing, or purchasing Platform Data." | not for consumers |

Law (finding a profile grants no consent): marketing texts by autodialer need prior express written consent
(47 CFR 64.1200(a)(2), law.cornell.edu); email: "You must honor a recipient's opt-out request within 10 business days"
(ftc.gov CAN-SPAM guide). Ohio has no comprehensive consumer privacy law in force (CLAIM, secondary sources). Nour's
"dont worry about safeguards" covers the FTC Safeguards Rule only; terms and consent still hold.

| Option | Mechanism | Stolen from | Cost | Risk | Kill criterion | Verdict |
|---|---|---|---|---|---|---|
| C1 profile from what they give us | card: visits, vehicles, declines, consent, reviews, plus a handle the customer gives (counter or a reply), in its own customer-linked field (platform, source, date); the consent event stays a separate ledger row | Meta Platform Terms 3.a.v (consent first); our consent ledger | 2 days | low | under 1 in 10 asked give a handle after 60 days | DO |
| C2 Twilio Lookup pass | line type and CNAM on active customers; reassigned check needs a last-verified date per number (consent date) and `no_data_available` counts as UNKNOWN | Twilio Lookup v2 packages | under $0.04 per number | none for social; cost only | under 5% of numbers change anything: stop re-checking | DO, needs your spend go |
| C3 paid consumer enrichment | append social URLs from phone or email | PDL person schema | $98+/mo | profile building without consent; terms unchecked | n/a | REJECT; reopen for fleet accounts (businesses) |

Benchmarked against: Meta Platform Terms and Instagram Graph API (2026-10-30); adopted: consent before linking;
rejected: lookup by phone, because no Meta API offers it.

Reporting runs on our own data (the three report skills), never on outside profiles.
Outreach needs per-purpose consent ENFORCED first: the ledger defaults off (`consentLedger.ts:114`) and marketing is gated only
when `SMS_CONSENT_GATE=enforce` (`sms.ts:2467`); prod values UNKNOWN. Turn both on before any C1 outreach.

**Nour decides:** (1) ask for social handles at the counter; (2) go on the Lookup spend; (3) which outreach first.

## What Nour sends next
1. Screenshots of the ALG settings screens you use, so B's key list matches.
2. The first outreach you want: win-back, declined work, reviews or follow us (C).

## NOT CHECKED (manager queries)
- Tekmetric help (403): "Tekmetric set up taxes existing repair orders".
- OpenAI help (403): "ChatGPT developer mode MCP plans write confirmation".
- Instagram terms (script page): "Instagram terms of use automated collection".
- PDL and Twilio use policies; Instagram 24-hour DM window; Ohio HB 345 / HB 801 status.
