# NICKSTIRE FULL-SPECTRUM AUDIT — 2026-07-03

Read-only pass. Zero code changes. All paths relative to `apps/nickstire/` unless prefixed. Six parallel evidence sweeps + manual verification of conflicts; every P0/P1 carries file:line.

---

## STOP THE BLEEDING

**Secrets in git history — rotation still outstanding.** `docs/MIGRATION_AUDIT.md` was redacted in HEAD (PR #49), but per `truth_os.md` ("Safety/correctness fixes that must hold") the leaked Stripe secret, TiDB URL, and vendor passwords **remain in git history**. This is a standing owner-urgent action item, not a new finding: rotate the Stripe secret key, TiDB credentials, and vendor passwords, then confirm in `truth_os.md`. No new committed secrets found in the working tree (`git ls-files apps/nickstire | grep -i env` → only `.env.example`; client grep clean).

---

## Executive Verdict

**Grade: B-.** The site's foundation is strong — prerendering SHIPPED (340 committed bot-served pages), security is unusually well-hardened (zero P0/P1), and the quote server pipeline is genuinely robust. But the business is **flying blind on its highest-intent conversion**: the Text-Me-Quote widget fires zero analytics on any channel and drops UTM attribution, while Meta CAPI is dormant — so ad spend is being optimized against a signal that excludes the main lead magnet. A second structural landmine: 32 of 86 SQL migrations exist only by hand-application and would be silently missing on any fresh database. **The ONE thing: make the quote funnel visible to GA4/Pixel/CAPI with UTM attached — everything else compounds from measured money.**

## Scorecard

| Phase | Grade | Top finding |
|---|---|---|
| 1 · Revenue paths | B | Quote widget (TextMeQuote) untracked on all channels; phone/financing/address paths otherwise solid |
| 2 · SEO/SSR | A- | Prerender **SHIPPED** (340 pages, bot middleware, per-route meta, 96 JS-less links); NAP locality conflict is the blemish |
| 3 · Performance | B- | framer-motion in the critical bundle on every page; 24 images >300KB (~9.5MB); hero LCP path itself well-tuned |
| 4 · Tracking | D | Money-path event coverage is Swiss cheese; CAPI dormant; SPA route changes send no page_view |
| 5 · Security | A- | No P0/P1; spoofable rate-limit key, `/api/bridge/diag` SELECT executor, CSP `unsafe-inline` |
| 6 · Database | C | Migration journal drift (32 orphan SQL files) = P0 rebuild risk; runner marks broken migrations "applied" |
| 7 · Code health | B- | 320 `: any`, TireFinder.tsx 2,684 LOC, 46-file `scratch/` committed; near-zero ts-ignore |
| 8 · PWA/Mobile | B+ | Manifest/touch targets/SW mostly right; 5 `alert()` calls in admin (iOS-suppressed); no offline fallback page |
| 9 · Ops | B- | No global Express error middleware; cron failures logged but never alerted; Sentry no-ops without `SENTRY_DSN` |

## Phase 2 verdict (required): **SHIPPED**

- 340 git-tracked `prerendered/*/index.html` files with real per-route content (e.g. `prerendered/brakes/index.html`, 218KB: correct title, meta, full JSON-LD graph).
- Served in prod: `server/_core/index.ts:1081-1090` wires `createPrerenderMiddleware()` before `serveStatic` (`:1097`); `server/prerender-middleware.ts:20-53,110-116` matches 28 bot UAs and `sendFile`s with `X-Prerendered: true`.
- Railway never runs puppeteer: `scripts/build-maybe-prerender.mjs:18-25` skips unless `PRERENDER_ON_BUILD` is set — committed files ship as-is (nixpacks has no Chrome; the default-skip design makes that a non-issue).
- Sitemaps generated from the same `shared/routes.ts:1288-1291` registry that drives prerendering (`server/_core/index.ts:392-423,516,532,553`), all four referenced in robots.txt (`:451-454`).
- Residual risk is **freshness only**: stale `prerendered/` after route/content changes; guarded by `scripts/check-prerender.mjs` + `verify-prerender.yml` (≤5-missing threshold).

The master-prompt premise ("SSR fix exists only as a prompt/branch that never merged") is **outdated** — recorded here as the ground-rule-6 discrepancy, resolved in favor of observed reality.

## P0 Findings

**P0-1 · Quote funnel is analytically invisible on every channel**
- **File:** `client/src/components/conversion/TextMeQuote.tsx:50-77`; server gate `server/routers/lead.ts:228`
- **Evidence:** `onSuccess` only sets `submitted=true`. `mutation.mutate({name, phone, problem, source})` sends no `pixelEventId`, no `pixelUserData`, no `getUtmData()` spread — so no GA4 event, no Pixel `Lead`, and the server CAPI branch (`if (input.pixelEventId)`, lead.ts:228) never fires. Leads land with `utmSource=NULL`. Contrast the fully-wired reference implementation in `client/src/components/LeadPopup.tsx:147-159`.
- **Revenue impact:** the highest-intent CTA on the homepage and every service page produces zero conversion signal to Google/Meta and zero paid-traffic attribution — ad optimization and budget decisions are running on a dataset that excludes the main lead magnet.
- **Fix:** copy the LeadPopup wiring into TextMeQuote — fire GA4 event + `trackLeadSubmission` (Pixel `Lead` with eventID), pass `pixelEventId` + `pixelUserData` + `...getUtmData()` in the mutation payload. Definition of done: a test submit produces a GA4 event, a Pixel Lead, a CAPI Lead with matching event_id, and a `leads` row with populated UTM. **Effort: S**

**P0-2 · Migration journal drift: 32 of 86 SQL files are orphans a fresh deploy will never apply**
- **File:** `scripts/db-migrate.ts:225` (`for (const entry of journal.entries)`); `drizzle/meta/_journal.json` (54 entries) vs `drizzle/*.sql` (86 files)
- **Evidence:** journal skips 0038, 0039, 0046, 0051, 0057–0074 and all duplicate-numbered files — including load-bearing ones (`0065_ig_autopost_log`, `0071_scheduled_posts`, `0072_unpaid_invoice_recovery`, `0074_social_studio_memory`). The runner warns about journal-entries-missing-files (`:205-210`) but is silent on the inverse. Prod works only because these were hand-applied.
- **Risk impact:** any DB rebuild, disaster recovery, or staging clone comes up missing tables that `drizzle/schema.ts` and live server code reference → runtime `ER_NO_SUCH_TABLE` across crons, social pipeline, and invoice recovery. This is silent data-layer debt on the money system.
- **Fix:** register every orphan SQL file in `_journal.json` in correct order (or fold them into journaled equivalents), and add an orphan-file check to `db-migrate.ts` that fails loudly when `drizzle/*.sql` ⊄ journal. Definition of done: file count == journal count and the runner errors on any future orphan. **Effort: M**

## P1 Findings

**P1-1 · Meta CAPI is dormant by construction until its token is set**
- **File:** `server/meta-capi.ts:40-42,128-134`
- **Evidence:** `getAccessToken()` returns `process.env.META_CAPI_ACCESS_TOKEN || null`; when null every `sendCAPIEvent` resolves `{success:false}` at debug level. Dedup design is otherwise correct (client eventID → `event_id`, pixel `958472373260171` matches both sides: `client/index.html:157` / `meta-capi.ts:35`).
- **Impact:** all server-side conversion recovery (the 30–40% of pixel events lost to ad blockers/iOS) is off; measurement is silently lying low.
- **Fix:** set `META_CAPI_ACCESS_TOKEN` on Railway, verify a Lead event in Meta Events Manager shows "server" + deduplicated, and change the token-missing path to log at warn-once level. **Effort: S**

**P1-2 · Google Sheets CRM writes fail silently — retry and failure-log never engage**
- **File:** `server/sheets-sync.ts:128-162,181`; caller `server/routers/lead.ts:168-197`
- **Evidence:** `appendRow` returns `false` on failure instead of throwing; the caller's `withRetry(...).catch(logIntegrationFailure)` therefore never retries and never records to `integration_failures`. The code comment at `sheets-sync.ts:136` admits "silent CRM data drops at scale". (Primary `leads` DB insert is safe — only the Sheets mirror drops.)
- **Fix:** make `appendRow` throw on failure so the existing retry + integration-failure logging engage. Definition of done: a forced Sheets failure produces an `integration_failures` row and retry attempts. **Effort: S**

**P1-3 · NAP locality conflict: "Euclid" vs "Cleveland" in simultaneous structured data**
- **Files:** `client/public/business-data.json:13`, `services-schema.json:15`, `reviews-schema.json:9`, `ai.txt:15`, `llms-full.txt:5,161` (all `Euclid`) vs `client/src/components/LocalBusinessSchema.tsx:65` + `shared/business.ts:41-43` (`Cleveland`); "East Cleveland" in prose (`client/src/pages/About.tsx:463`, `compare/ConradsAlternative.tsx:30`)
- **Evidence:** Google receives two conflicting `addressLocality` values in structured data on the same domain; street `17625 Euclid Ave` and zip `44112` are consistent everywhere.
- **Impact:** corrupts local-entity reconciliation for a business whose revenue depends on the local pack; also conflicts with GBP NAP consistency the Growth tab tracks.
- **Fix:** pick the GBP-registered locality, set it in `shared/business.ts`, and regenerate the three static JSON files + ai/llms txt from that single source (then `pnpm run regen`). Definition of done: one locality across all schema emitters, verified in prerendered output. **Effort: S**

**P1-4 · Directions click is completely untracked; tel-click CAPI leg is dead code**
- **Files:** `client/src/pages/Contact.tsx:163-170` (bare `<a href>`); `client/src/lib/metaPixel.ts:239` (`trackDirectionsClick` — zero callers); `server/meta-capi.ts:293` (`sendContactEvent` — zero callers); `server/routers/admin.ts:1755-1768` (logCall stores the eventId but never sends CAPI)
- **Evidence:** the tel path fires GA4 + Pixel Contact + `call_events` (verified: `client/src/components/SEO.tsx:187-260` dynamically imports `trackPhoneCall` and chains the same event_id into `callTracking.logCall`) — but the stored eventId is never forwarded to CAPI despite `sendContactEvent` existing for exactly that. Directions clicks reach no channel at all.
- **Fix:** call `sendContactEvent` from `callTracking.logCall` with the stored eventId; wire `trackDirectionsClick` + a GA4 event onto the directions anchors (Contact page + SiteMobileCTA). **Effort: S**

**P1-5 · Migration runner records broken migrations as applied**
- **File:** `scripts/db-migrate.ts:59-85,166-175,251-262`
- **Evidence:** `TOLERATED_CODES` treats `ER_BAD_FIELD_ERROR`, `ER_NO_SUCH_TABLE`, `ER_CANT_DROP_FIELD_OR_KEY` and the substring "doesn't exist" as no-ops, then records the migration hash as applied (`:262`). A typo'd column name is silently marked done and never retried.
- **Fix:** narrow tolerance to idempotency-specific codes on re-run only (duplicate column/key/table-exists), and fail hard on `ER_BAD_FIELD_ERROR`/`ER_NO_SUCH_TABLE` during first application. **Effort: S**

**P1-6 · No global Express error middleware**
- **File:** `server/_core/index.ts` — no 4-arg `(err, req, res, next)` handler exists (grep confirmed)
- **Evidence:** raw REST/webhook routes rely on per-handler try/catch; an async throw in an unwrapped handler hits Express's default handler (stack-trace leak in non-prod, bare 500s, no telemetry). tRPC has its own formatter; the REST surface does not.
- **Fix:** add a terminal error middleware after all routes: log via `server/lib/logger.ts`, record to `errorTelemetry`, return a generic 500 JSON. **Effort: S**

**P1-7 · Nav labels the funnel "Financing" — violating the shop's own claim-safety rule and Acima placement guidance**
- **Files:** `client/src/components/SiteNavbar.tsx:22` (`{label:"Financing"}`) vs `client/src/pages/Financing.tsx:604` ("Payment Programs"); `docs/acima-strategy-and-compliance.md:142-147`
- **Evidence:** the standing brand rule (AGENTS.md §6: "Payment Programs not financing") and the shop's own Acima compliance doc (no commingling under a "financing" header) are both contradicted by the nav label, while the four lenders render grouped (`Financing.tsx:279-392`).
- **Impact:** merchant-guideline exposure with Acima plus internal rule inconsistency on a revenue path.
- **Fix:** rename the nav label (and any breadcrumb/route-title emitters) to "Payment Programs"; review lender grouping against the compliance doc. Definition of done: zero customer-facing "financing" labels; `lint:brand-voice` green. **Effort: S**

**P1-8 · `pnpm run verify` doesn't gate what actually breaks production**
- **Files:** `package.json:28,37`; `tsconfig.typecheck.json:7-9`; `scripts/lint-source.mjs:7-14`
- **Evidence:** `lint` prettier-checks only 4 doc files — no linter runs on `client/` or `server/` source; `typecheck:raw` excludes all tests; migrations are entirely outside the gate (P0-2 invisible to a green verify); `: any` / raw-SQL counts are soft warnings only.
- **Fix:** add a migration-journal parity check and an orphan-SQL check to verify; expand lint to source (even prettier-only initially). **Effort: M**

**P1-9 · framer-motion ships in the critical bundle on every page**
- **Files:** `client/src/App.tsx:6,173-180`; `client/src/pages/Home.tsx` (eager import, App.tsx:37); `client/src/components/SiteMobileCTA.tsx:24`; `vite.config.ts:67-103` (only `vendor-react` split; `chunkSizeWarningLimit: 1500` hides warnings)
- **Evidence:** App wraps every route in `<AnimatePresence><motion.div>`; Home + the global CTA bar import it eagerly → the animation library loads before LCP for the 4G mobile searcher. (Its worst CWV effect was already neutralized via `initial={false}`, App.tsx:164-172 — the payload cost remains.)
- **Fix:** replace the route-transition wrapper + SiteMobileCTA animation with CSS transitions, or isolate framer-motion into a lazy vendor chunk; lower `chunkSizeWarningLimit` to surface regressions. **Effort: M**

## P2/P3 Findings (compressed)

| ID | Sev | Finding | File:lines |
|---|---|---|---|
| T-1 | P2 | SPA route changes send no GA4 page_view (`trackPageView` has zero callers) | `client/src/lib/ga4.ts:189`, `client/index.html:166` |
| T-2 | P2 | No consent gating / Consent Mode; 3 trackers fire unconditionally | `client/index.html:127-176` |
| T-3 | P3 | 8 dead pixel wrappers (booking, callback, fleet, tire-search, directions…) — attribution intent unrealized | `client/src/lib/metaPixel.ts:91-249` |
| T-4 | P3 | CallbackModal sends no pixel/UTM though the server CAPI path is ready | `client/src/components/CallbackModal.tsx:65-69` vs `server/routers/callback.ts:174-186` |
| S-1 | P2 | Rate-limit key trusts spoofable `cf-connecting-ip` unless CF-only ingress enforced | `server/middleware/rateLimiters.ts:4-13` |
| S-2 | P2 | `/api/bridge/diag` = arbitrary-SELECT executor behind one shared key (guards present; cross-table reads possible) | `server/_core/bridge-routes.ts:670-706` |
| S-3 | P2 | CSP `script-src 'unsafe-inline'` negates most XSS defense (GA/Pixel justification) | `server/middleware/securityHeaders.ts:48-64` |
| S-4 | P3 | Webhooks not rate-limited (all signature-verified — low value target) | `server/_core/index.ts:668,768,1015` |
| S-5 | P3 | VAPI webhook = static shared secret, replayable (no nonce/timestamp) | `server/routes/webhooks/vapi.ts:39-65` |
| S-6 | P3 | Verify `VITE_GOOGLE_MAPS_API_KEY` is referrer-restricted; verify SSE `sseHandler` rejects non-admin | `client/src/components/Map.tsx:89`, `server/routes/adminRoutes.ts:38-41` |
| D-1 | P2 | `getBookingByPhone` leading-wildcard LIKE + REPLACE wrapper → unusable index, full scan on public status lookup | `server/db.ts:510-527` |
| D-2 | P2 | Logical FKs are bare ints — no `references()`, no cascade semantics (TiDB-typical, but orphaning is silent) | `drizzle/schema.ts:666,827` |
| D-3 | P2 | N+1 await-in-loop across ~8 cron jobs (bounded by batch sizes) | `server/cron/jobs/crossSellOutreach.ts:217,242,285` et al. |
| O-1 | P2 | Cron failures logged (`logTierJob "failed"`) but no Telegram/Sentry alert on arbitrary failure; inner catches return "skipped" | `server/cron/scheduler.ts:196-199,236,316,672` |
| O-2 | P2 | Sentry is a silent no-op unless `SENTRY_DSN` set — verify on Railway or it's a dead dependency | `server/lib/sentry.ts:34-38,91` |
| O-3 | P2 | Duplicate `unhandledRejection` handlers; `uncaughtException` hard-exits without the SIGTERM drain path | `server/lib/logger.ts:147-156` vs `server/_core/index.ts:1131-1159` |
| W-1 | P2 | 5 raw `alert()` calls in admin — silently suppressed in iOS PWA, operator gets no feedback | `client/src/pages/admin/outreach/SmsOrchestratorSection.tsx:117,120,128,142,144` |
| W-2 | P2 | SW pre-cached HTML shell can serve a stale app version; no offline fallback page | `client/public/sw.js:12-21,66-76` |
| C-1 | P2 | 320 `: any` (client 129 / server 191); worst: `routers/content.ts` (18), `routers/admin.ts` (15) | multiple |
| C-2 | P2 | Oversized files: `TireFinder.tsx` 2,684 LOC (customer-facing), `routers/admin.ts` 1,976, `cron/scheduler.ts` 1,904 | multiple |
| C-3 | P2 | 21 empty catch blocks (client 6 / server 15) | `services/igAutopost.ts`, `components/LeadPopup.tsx` et al. |
| C-4 | P2 | Committed dead weight: 46-file `scratch/`, `out.mp4`, 0-byte `font.ttf`, `fix_escapes.cjs`, `fix_test.cjs`, stale `AUDIT_REPORT.md` | app root (`git ls-files`) |
| P-1 | P2 | 24 images >300KB (~9.5MB) in `client/public` (mobile variants exist; desktop/full-size cost) | `client/public/photos/*` |
| P-2 | P3 | HTML cache `max-age=3600` delays deploy propagation up to 1h | `server/_core/vite.ts:207` |
| R-1 | P3 | `PayInvoice.tsx` tel link non-canonical format (`tel:2168620005`, no +1) and untracked | `client/src/pages/PayInvoice.tsx:176` |
| R-2 | P3 | `SiteMap.tsx` hardcoded tel link untracked | `client/src/pages/SiteMap.tsx:186` |
| R-3 | P3 | `Financing.tsx` `href={provider?.applyUrl \|\| "#"}` — latent dead link if provider lists drift | `client/src/pages/Financing.tsx:357,383` |
| R-4 | P3 | Internal "Moe's" residue: ops inbox `moeseuclid@gmail.com` in notification/payment pipeline (customer-facing Moe's pages are intentional SEO bridges) | `server/email-notify.ts:9,781,804`, `server/services/payments.ts:343` |
| R-5 | P3 | `lead.ts` source-remap trap: unknown client `source` strings silently remapped | `server/routers/lead.ts:116-118` |
| P-3 | P3 | `/my-garage` disallowed in robots.txt yet still prerendered (wasted file) | `server/_core/index.ts:426-455` |

## Event Tracking Matrix

| Revenue action | GA4 | Meta Pixel | Meta CAPI (server) | CRM/lead store |
|---|---|---|---|---|
| Quote submit (TextMeQuote) | **MISSING** (`TextMeQuote.tsx:50-77`) | **MISSING** (ibid.) | **MISSING** (`lead.ts:228` gate never fed) | FIRING — DB+Sheets+email+Telegram (`lead.ts:120-141`) but **UTM NULL** |
| tel: click | FIRING (`SEO.tsx:206`, `ga4.ts:61`) | FIRING w/ eventID (`SEO.tsx:223→metaPixel.ts:144`) | **MISSING** — `sendContactEvent` zero callers (`meta-capi.ts:293`) | FIRING — `call_events` w/ UTM+eventId (`admin.ts:1756`) |
| Financing click | **MISSING** (`Financing.tsx:582-591`) | **MISSING** | **MISSING** | FIRING w/ UTM (`financing.trackApplication`) |
| Directions click | **MISSING** (`Contact.tsx:163-170`) | **MISSING** (wrapper dead) | **MISSING** | **MISSING** |
| Lead popup | n/a | FIRING (`LeadPopup.tsx:147-159`) | FIRING* (token-gated, P1-1) | FIRING |
| Booking submit | **BROKEN** — no customer caller sends pixelEventIds | **BROKEN** (`metaPixel.ts:91` dead) | CONDITIONAL (`booking.ts:391-430`, never fed) | wired server-side |

\* CAPI cells only fire once `META_CAPI_ACCESS_TOKEN` is set (P1-1).

## Fix Queue (RANKED)

Score = (revenue×3 + risk×2 + speed×1) / effort (S=1, M=2, L=3). Scales 0–5.

| # | Fix | Branch | rev | risk | spd | eff | Score |
|---|---|---|---|---|---|---|---|
| 1 | Wire TextMeQuote: GA4 + Pixel Lead + pixelEventId/UserData + UTM in payload (P0-1) | `nickstire/audit-fix-01-quote-tracking` | 5 | 2 | 1 | S | (15+4+1)/1 = **20.0** |
| 2 | Unify NAP locality across static JSON/ai.txt/llms + business.ts, regen prerender (P1-3) | `nickstire/audit-fix-02-nap-locality` | 4 | 2 | 1 | S | (12+4+1)/1 = **17.0** |
| 3 | Make `appendRow` throw → Sheets failures retry + log to integration_failures (P1-2) | `nickstire/audit-fix-03-sheets-fail-loud` | 3 | 3 | 1 | S | (9+6+1)/1 = **16.0** |
| 4 | Set `META_CAPI_ACCESS_TOKEN` + verify dedup live in Events Manager (P1-1) | `nickstire/audit-fix-04-capi-arm` | 4 | 1 | 1 | S | (12+2+1)/1 = **15.0** |
| 5 | Nav "Financing" → "Payment Programs" + Acima placement review (P1-7) | `nickstire/audit-fix-05-payment-programs-label` | 2 | 3 | 1 | S | (6+6+1)/1 = **13.0** |
| 6 | Global Express error middleware + narrow migration-runner tolerated codes (P1-6 + P1-5) | `nickstire/audit-fix-06-error-hardening` | 1 | 4 | 1 | S | (3+8+1)/1 = **12.0** |
| 7 | Tel-click CAPI (`sendContactEvent` from logCall) + directions tracking (P1-4) | `nickstire/audit-fix-07-call-directions-capi` | 3 | 1 | 1 | S | (9+2+1)/1 = **12.0 → force-ranked below #6** (risk-weighted; #6 protects money, #7 measures it) |
| 8 | GA4 page_view on wouter route change (T-1) | `nickstire/audit-fix-08-spa-pageview` | 2 | 1 | 1 | S | (6+2+1)/1 = **9.0** |
| 9 | Compress/resize the 24 >300KB images; keep responsive variants (P-1) | `nickstire/audit-fix-09-image-diet` | 1 | 1 | 3 | S | (3+2+3)/1 = **8.0** |
| 10 | Reconcile migration journal + orphan-check in db-migrate + verify gate (P0-2, P1-8) | `nickstire/audit-fix-10-migration-journal` | 1 | 5 | 1 | M | (3+10+1)/2 = **7.0** |

Note on #10: it scores low on impact÷effort because it costs nothing until the day it costs everything — **its P0 severity stands independent of rank; do not let it fall off the board.** Items 1, 4, and 7 together answer "does this make the phone ring or protect money": they make every dollar of ad spend measurable against the actions that ring the phone.

## What I Did NOT Audit

- **Live production behavior** — no requests were made to nickstire.org; everything is code-level. Actual GSC indexation counts, real CWV field data, and whether `META_CAPI_ACCESS_TOKEN`/`SENTRY_DSN` are set on Railway are unverifiable from the repo.
- **The VAPI/SMS conversation quality layer** (prompts, call outcomes) — logic wiring only, not efficacy.
- **`pnpm audit` CVE sweep** — not run (read-only pass; `scripts/security-scan.ps1` exists for this); lockfile versions were not cross-checked against advisory databases.
- **Admin UX beyond primitives** — admin sections were checked for alert()/size/`any` only, not workflow correctness.
- **Forgotten Factor:** this audit did not test the *interaction* between the SW cache and prerender freshness (a returning mobile visitor may see a staler shell than Googlebot sees pages), and it did not audit `packages/` workspace deps (`@nour/gbp-publisher`, `@nour/utils`) that nickstire imports — a defect there is invisible to this pass.

## Open Questions

1. Is `META_CAPI_ACCESS_TOKEN` set on Railway? (Code path says all CAPI is a no-op without it — unverifiable from repo.)
2. Is `SENTRY_DSN` set on Railway? (Otherwise every `captureException` is a silent no-op.)
3. Have the git-history secrets (Stripe/TiDB/vendor) been rotated since `docs/MIGRATION_AUDIT.md` was redacted? `truth_os.md` still lists rotation as owner-urgent.
4. Is origin ingress Cloudflare-only at the network layer? (Determines whether the `cf-connecting-ip` rate-limit key is P2 or P3.)
5. Which locality is registered on the Google Business Profile — Euclid or Cleveland? (Decides the winning side of P1-3.)

---

*QA pass completed: every P0/P1 carries file:line; no "consider/might want to" phrasing; `git status` clean apart from `AUDIT/` artifacts; fix queue force-ranked with math shown.*
