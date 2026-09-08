# Nick's Tire quality program — public site + /admin

**Written 2026-09-07 against production `61d31ff53` (six PRs past the `195c496dd` the plan recorded).**

**Current state (2026-09-08).** #2173 (16 defects) merged as `f2bcf949d` and deployed 20:14 ET 2026-09-07; the ten
live GET checks in §11 passed at 20:15 ET. Follow-up #2179 (self-audit: `originalUrl` 404, robots literals,
route-parity canary) merged as `cfdcad9be`, deployed. Snapshot regeneration from a post-#2179 `main` landed as `2336d313d`
(run `34173664386`, 00:49 UTC 2026-09-08; the first attempt failed at `git push` because #2179 landed mid-run).
**That commit is the first crawler-visible snapshot with the fixes** — checked by tree content, not by
assumption: the Parma snapshot at `f2bcf949d` and `cfdcad9be` still carried one JSON-LD `FAQPage` node and the
WebP `og:image`; at `2336d313d` it carries zero and `/og-image.jpg`. The in-PR regen (`8c0be63d5`) predated
both fixes in the tree, so "regenerated in the PR" had not made them crawler-visible — the earlier draft of this
document said it had. It reaches the live site with the next Railway deploy that includes `2336d313d`
(the skip-ci-tagged regen commit DID deploy on Railway — `/api/health` reported `2336d313d` by 21:20 ET; the
20:51 probe recorded in §15 simply preceded its build. One early probe is not evidence of "no deploy"). This PR (release closure) fixes the sales-window cardinality defect, guards the prerender regen
against production writes, adds the three regression tests an outside review asked for, and corrects the
research errors listed in §2/§5/§6. §15 is the release record.
Evidence grades: **VERIFIED** = measured live, read in code, or quoted from a primary vendor page ·
**PLAUSIBLE** = reputable secondary source or inference from a primary · **UNVERIFIED** = nobody has
checked. Every count carries its denominator (base-rate rule). Nothing here was applied to production;
this branch ships code, a PR, and a runtime-verification list.

## 0 · The answer

1. **Phase 1 is three slices done and two partial, not "on track"** (slice 1 DONE · 2 PARTIAL · 3 DONE with one
   residual · 4 DONE with one gap · 5 PARTIAL; the table in §3 carries the evidence). Slice 1 is done and tested.
   Slice 2 shipped the honest number — whose rolling windows spanned 8 and 31 dates until 2026-09-08, caught by an
   outside review — but **no reconciliation mechanism exists** (`reconciledToShopReport` is a hard-coded
   `false` with no code path that flips it). Slice 3 closed two live bypasses and left one disarmed
   (`REEL_LEGACY_PUBLISH_ENABLED`, unset in prod, verified across 410 Railway variables). Slice 4 is
   code-complete with a veto-parity gap. Slice 5 built a read-only ledger with **zero UI consumers** and no
   drawdown gate. Detail in §3.
2. **The public site's foundation is better than both outside reports assumed** — prerender serves
   336 pages with full JSON-LD to every documented answer-engine crawler (measured with GET, not HEAD),
   security headers are already strong, HTTPS/HSTS are live, titles are unique, alt text is type-enforced.
   The real defects were narrower and mostly silent: a soft 404, a 24-hour cache on the home HTML, a
   broken social-share image (HTTP 403), a fabricated sitemap `lastmod`, a self-serving star rating
   emitted twice on 21 city pages, six contradictory machine-readable "AI fact" files, and a CSP that
   blocks three Google Analytics beacon hosts. **All of those are fixed on this branch** (§1).
3. **The two research questions with the biggest downstream cost both came back "no":** no cookie
   banner is required for this business under its current facts (US-only; the conditions that would flip
   the decision are in §6), and no major engine reads `llms.txt`/`ai.txt`
   (Google says so in writing). Do not build either. The Google Business Profile Local Posts API is
   **alive** (docs updated 2026-08-28); the prior "dead since 2024" belief was wrong.
4. **What decides AI representation for a Cleveland tire shop is off-site**: Google Business Profile
   for Google surfaces, Yelp for ChatGPT (and for Perplexity through its own Yelp feed), the website as the
   first-party bucket. Code can
   only make the site *eligible* and *consistent*; §5 is the ordered list.
5. **Design: the site is not vibecoded, but it is over-decorated in places and thin on the one thing a
   walk-in shop needs on a phone** — address, hours, open-now above the fold on mobile. §4 gives the
   system: sign yellow as a material, the written estimate as the trust motif, real photos only.

## 1 · What this branch changes (implemented + tested; not deployed; not runtime-verified)

| # | Defect (VERIFIED live before fix) | Fix on this branch | Test / receipt |
|---|---|---|---|
| 1 | Unknown URLs answered **200** with the home `<title>` and `robots: index, follow` (soft 404). NotFound.tsx set noindex only after hydration, invisible to non-JS crawlers. | `server/_core/spaFallback.ts`: registry + declared dynamic prefixes decide 200/404/301; unknown → **404** + noindex + canonical `/`; mis-cased twins (`/Tires`) → 301. One exported handler serves dev and prod. Validator Rule 5 pins App.tsx ↔ prefix list in both directions. | `server/spaFallback.test.ts` 23 tests: 17 pure (every registry path stays 200; canary pair) + 6 over real HTTP through an `app.use("*")` mount — see the self-audit note below · `validate:routes` 0 errors |
| 2 | Home HTML served with `Cache-Control: public, max-age=86400` (express.static answered `/` as a file). A deploy could take a day to reach a returning phone. | `express.static(..., { index: false })` so `/` takes the 5-minute must-revalidate path like every other route. | same test file; header path read in code |
| 3 | `og:image` / `twitter:image` pointed at a CloudFront PNG returning **403** — every shared link rendered imageless. | `client/public/og-image.jpg` (1200×630, 127 KB, real storefront photo) + tags updated. | `curl -I https://nickstire.org/og-image.jpg` → 200 after deploy |
| 4 | Sitemap `<lastmod>` = today's date on every URL, every day (Google: ignored once "consistently" wrong; Bing: "may disregard"). | Static routes omit the tag; DB articles emit real `updatedAt`. | `server/sitemap.test.ts` 6 green |
| 5 | Six orphaned public files contradicted canon: city "Euclid" vs "Cleveland" (44112 is Cleveland; matches the Google listing), oil change $39/$69 vs $49/$80, "Last verified" 2026-05-02 / 2026-03-30, "#1"/"highest-rated" superlatives, generic-named 5-star "reviews". No code, doc, or crawler spec referenced them. | Deleted `business-data.json`, `services-schema.json`, `reviews-schema.json`, `howto-schemas.json`, `ai.txt`, `llms-full.txt`; `/ai.txt` and `/llms-full.txt` 301 → `/llms.txt` (the one generated source). | `git rm` ×6; redirect handlers in `server/_core/index.ts` |
| 6 | `llms.txt` said "Financing" (house rule: "Payment programs, never financing"). | Wording fixed, URL unchanged. | text diff |
| 7 | 21 city pages each minted a **distinct** rated entity (`"… — Serving Parma"`) with `aggregateRating` twice per page — the exact self-serving-rating pattern NeighborhoodPage was already repaired for. Google: an entity that controls its own reviews is ineligible for stars; "Don't mark up content that is not visible." | CityPage now references the canonical `@id`, one name, no rating; `Service.provider` is an `@id` reference. | `client/src/__tests__/prerender-indexability-consistency.test.ts` 5 green; Rich Results Test after deploy |
| 8 | Two conflicting `WebSite` nodes on the home page (index.html with SearchAction; Home.tsx without). | One node in `index.html` (SearchAction target `/tires?size=` is a real param); `alternateName` merged. | home-v2 + smoke tests 12 green |
| 9 | `includeHowTo` / `includeServices` props were lies: no HowTo node has ever been emitted; `hasOfferCatalog` is unconditional. Five call sites believed otherwise. | Props removed; call sites updated; stale comment corrected (the JSON files it said "404 silently" served 200). | typecheck exit 0 |
| 10 | CSP `connect-src` allowed only `www.google-analytics.com`; **live probe in real Chrome**: `region1.google-analytics.com`, `analytics.google.com`, `stats.g.doubleclick.net` all `Failed to fetch`; no GA4 `/g/collect` beacon observed during page load. | Added Google's documented wildcards to `connect-src`; Permissions-Policy gains `usb midi display-capture browsing-topics` (not `payment` — Stripe). | post-deploy: DevTools shows `/g/collect` 204 and zero "Refused to connect" |
| 11 | Privacy policy never named Meta although the Meta Pixel + CAPI fire on every visit (Meta Business Tools Terms require notice + opt-out pointer; Google Analytics ToS requires the partner-sites link). | Section 5 names Meta; Section 8 rewritten with GA4 + Meta + Ahrefs disclosures and opt-out links. | brand-voice lint 0 violations |
| 12 | robots.txt: `Crawl-delay: 1` (Bing "Slow" tier, buys nothing), `Disallow: /*?utm_*` (Google: "Don't use robots.txt for canonicalization"), every crawler open. | `server/_core/robots.ts`: private disallows kept; Bytespider + cohere-ai blocked; **operator switch** `ROBOTS_BLOCK_AI_TRAINING_CRAWLERS=true` blocks GPTBot/ClaudeBot/CCBot/Applebot-Extended/MistralAI-Training only — never the search/answer agents (structural disjointness test). Default off = current behaviour. | `server/robotsTxt.test.ts` 11 tests |
| 13 | Manifest: "Book Now" shortcut on a first-come-first-served shop; "1685+ reviews" (stale) and "#1" (banned claim). | "Drop Off", "Find Tires", count-free description. | text diff |
| 14 | Lighthouse 13.4.1 mobile: 5 contrast failures (footer text at 20–40% opacity, red triage button 3.8:1) and 6 label-in-name mismatches on hero CTAs (`aria-label` did not contain the visible text; WCAG 2.5.3). | Footer/legal text ≥55% opacity, red-600 button (4.8:1), aria-labels now start with the visible text. | re-run Lighthouse after deploy; expect a11y ≥ 98 |
| 15 | `/emissions` description 168 chars > 165 cap (validator warning). | trimmed. | `validate:routes` 0 warnings |
| 16 | Admin Money → Shop Pulse rendered a **failed** shop-floor read as "$0 · 0% · SLOW DAY" — the writer-side fix in #2163 pushed `shopFloor` into `_unavailableCounts`, but this consumer never read it. | `ShopPulseMood` renders "Shop floor · unknown" when the count is unavailable. | typecheck; visual pass after deploy (authed) |

**Receipts:** `tsc --noEmit` exit 0 (twice) · targeted vitest 46 + 143 + 36 + 11 passed, 0 failed ·
`validate:routes` 145 App routes / 195 registry / 0 errors · `lint:source` passed · `lint:brand-voice` 0
violations · `prerender:check` 336 present / 0 missing · `prerender:semantic-check` OK · `pnpm run verify`
**stopped at `lint:orphans`** with a pnpm `dlx` cache error for `knip` (`ERR_PNPM_NO_IMPORTER_MANIFEST_FOUND`
in the dlx cache — machine-environmental, not this diff; gates after it were run individually) ·
`migrations:check` skipped (no `DATABASE_URL` in this worktree; the diff carries no migration).
Full-suite result is appended to the PR body.

**Self-audit catch, after the PR was open (fixed in the same PR, commit `6f32d186a`).** Inside
`app.use("*", handler)` Express rewrites `req.path` to `/` for every request; only `req.originalUrl`
survives the mount (probed: `GET /this-does-not-exist?x=1` → `path "/"`, `baseUrl
"/this-does-not-exist"`). The first version of the 404 resolver was keyed on `req.path`, so in
production it would have answered 200 for everything while its 17 pure-function tests stayed green —
the silent-instrument shape this repo keeps meeting. The handler now reads `originalUrl`, and the test
file mounts the real handler on a wildcard and speaks HTTP to it; mutating it back to `req.path` fails
3 of those 6 tests (planted, confirmed, restored). Rule worth keeping: a catch-all's decision is tested
**through the mount**, never only as a pure function.

**Post-merge self-audit (follow-up PR, same day).** Three more misses, none of them found by a gate:
(a) [fixed inside #2173 itself, commit `c4105d71e` — not in the follow-up PR] `SEOHead` still wrote the 1672×941 WebP storefront as `og:image` on every prerendered page — link-preview
bots read the snapshot, not index.html, so the 403 fix had only reached human visitors; default now
`/og-image.jpg` (`c4105d71e`). (b) The 21 city pages emitted a `FAQPage` whose four questions were never
rendered on the page — invisible markup, which Google's structured-data policy forbids; removed. (c) The footer
review link's `aria-label` did not contain its visible text (the sixth Lighthouse label-in-name hit); removed
so the accessible name comes from the content. Also recorded: the serving contract in `docs/CURRENT-TRUTH.md`,
the robots switch in `.env.example`, and a machine-readable `Updated:` line in the session ledger.

**Not touched on purpose:** anything under `server/services/reel*`, `server/cron/jobs/dailyReelPost.ts`,
`server/routers/content.ts`, `instagramAdmin.ts`, reel tests, `docs/reel-packs/` — another session owns
the reel lane today. Two reel findings are handed off in §3.

## 2 · The two outside reports, fact-checked

The report pasted mid-session got the direction right (allow search agents, no banner, real photos,
FCFS everywhere) and several specifics wrong. Corrections that change what engineering does:

| Report claim | Verdict | Evidence |
|---|---|---|
| "Add missing Open Graph and Twitter cards" | **Wrong premise.** Both exist on every page. The defect was the image URL returning 403. | live `curl` of `/` and `/brakes` |
| "Configure CSP and HSTS as per best practice" | **Already live** (CSP, HSTS preload, COOP, CORP, XFO, nosniff, Referrer-Policy). Real gap was `connect-src` (fixed) and `'unsafe-inline'` in `script-src` — closed 2026-09-08 with sha256 hashes of the single inline loader (no nonce needed: the served HTML is static and identical across all snapshots). | headers captured 2026-09-07; `server/securityHeaders.test.ts` |
| "Verify LCP, FID, CLS" | **FID was replaced by INP on 2024-03-12.** Thresholds: LCP ≤ 2.5 s, INP ≤ 200 ms, CLS ≤ 0.1 at p75. | web.dev/articles/vitals |
| "WCAG 2.2 AA 1.4.11" for target size / focus | **Wrong number.** 1.4.11 is Non-text Contrast (2.1). Target size is 2.5.8 (24×24 CSS px at AA); 44 px is AAA 2.5.5. | w3.org/WAI/standards-guidelines/wcag/new-in-22 |
| "Consider a PWA shell" / "add install banner icons" | **Already shipped**: service worker (network-first navigations after a 2026-08-01 incident), manifest with 192/512 + maskable icons. | `client/public/sw.js`, `manifest.json` |
| "Add structured data for reviews/ratings" | **Contrary to Google's doc.** Self-controlled reviews on LocalBusiness are ineligible for stars; the existing site-wide rating was the defect (#7 above). | review-snippet doc, 2026-07-24 |
| "FAQPage schema on any Q&A content" | **Retired for all sites 2026-05-07**; harmless, not a lever. | Search Central changelog May/June 2026 |
| "Use IndexNow for AI freshness" | **Bing, Amazon, Naver, Seznam, Yandex and Yep** — Google is not a participant (an earlier draft of this row said "Bing only"; corrected 2026-09-08). The site already serves an IndexNow key file; whether anything submits URLs is UNVERIFIED (grep: only the key handler). | indexnow.org/faq |
| "Fresh GBP posts boost visibility" | **Unsupported as a ranking claim.** Google's local ranking page: relevance, distance, prominence (links, reviews). Posts are fine for customers; don't budget them as SEO. | support.google.com/business/answer/7091 |
| "Grok Imagine v1.5 ~$0.14/s, ¼ of Veo 3.1" | **Contradicted.** xAI's model page lists a single $0.080/s for v1.5 and $0.050/s for v1 — no per-resolution tiers are published there (re-checked 2026-09-08 after a second outside report asserted tiers); Veo 3.1 Standard $0.40/s, Fast $0.10–0.12/s, Lite $0.05–0.08/s. | docs.x.ai/developers/pricing · ai.google.dev pricing 2026-09-04 |
| "Seedance 1080p ~$0.49/s" | **UNVERIFIED on any primary page.** BytePlus: Seedance 1.0 Pro ≈ $0.122/s at 1080p; Runway resells Seedance 2 at $0.40/s 1080p. | docs.byteplus.com · docs.dev.runwayml.com |
| "GPT-image-2 ~$0.10/s" | **Category error** — an image model priced per token ($30 / 1M output tokens; ≈ $0.01–0.13 per image). | developers.openai.com/api/docs/pricing |
| "LTX-2.5 fine-tune free on a desktop GPU" | Model exists (2026-01-06), community license free under $10M revenue; **inference** at ~12 GB fp8 is documented, **fine-tuning VRAM is not**. The operator's machine has an Intel Arc iGPU — none of it runs locally here. | huggingface.co/Lightricks/LTX-2.5 |
| "Sales card now pulls from the authoritative ShopDriver report" | **False.** The card says "Billed", `reconciledToShopReport=false`, and no reconciliation code exists. | `server/services/shopSales.ts:120,244` |
| "Move help content into a CMS", "Hootsuite-like integration", "central reconciliation sheet" | **Reject** — new platforms where first-party code exists (registry-driven pages, Graph API publisher, `shopSales` contract). | AGENTS.md prior-art rule; `docs/UPSTREAMS.md` |
| "GPTJSON" | Not a thing. | — |

The earlier FRONTIER-SCAN context, calibrated: over-built/under-organized admin — **still true** (18
sections, 10 marked NOT AUDITED in `docs/ADMIN-COVERAGE-2026-09-07.md`); armed automations — **true**
(nine of ten side-effect flags ON as of 2026-08-16; re-probe with `scripts/probe-live-send-flags.mjs`);
"GBP Local Posts API dead" — **refuted** (v4 `localPosts` documented 2026-08-28; it was the Q&A API that
was discontinued 2025-11-03; access is form-gated, quota currently 0); "Higgsfield Cloud API consumes
consumer credits" — **not supported**: API credits expire one year after purchase, subscription credits
reset at renewal, the MCP/CLI lane explicitly spends plan credits; treat the pools as separate until the
operator reads the Cloud dashboard billing tab.

## 3 · Phase 1 stress-test — the five slices against the code

| Slice | Status | What is true in code | Contradiction / gap |
|---|---|---|---|
| 1 Decision Inbox retired · neutral `dismissed` · stated-concern provenance · review-recovery recurrence | **DONE** | Home + morning brief both dropped the queue; `dismissed` terminal state without consent side-effects; `captureStatedConcern` requires `heardFrom: "customer"` literal and writes `operator_relayed`; only customer-sourced concerns end a recovery rail; complaint key is `phone10` with `reopenIfTerminal` for a genuinely new complaint. Tests: `neutralDismissal`, `ros083BriefPriorities`, `opportunities-section`. | The plan text "must not key forever by phone" vs. the shipped design, which **does** key by phone and relies on `reopenIfTerminal` to let a new complaint through. The requirement is met; the wording differs. Keep the mechanism, fix the plan wording. |
| 2 One sales contract · honest availability · through-date · arithmetic · GATED reconciliation | **PARTIAL** | `shopSales.ts` single SQL, ET calendar windows (rolling windows corrected 2026-09-08 to exactly 7 / 30 completed days ending yesterday — v1 ran to tomorrow and spanned 8 / 31 dates under 7 / 30 labels; the test now counts dates), discriminated union (no `$0` on failure), "Billed", through-date always shown. `METRICS-CONTRACT.md` documents basis and exclusions. | **Reconciliation not built**: `reconciledToShopReport` hard-coded false, no comparator, no operator action. A third revenue implementation (`admin-stats.ts` shopFloor) and a fourth (`masterIntelligence` pacing) still exist; the shopFloor consumer defect is fixed on this branch (#16). |
| 3 Durable masters · head-of-line repair · close bypasses | **DONE, one residual** | Masters go to S3 (`S3_BUCKET` set, verified 2026-09-07) + `media_assets` checksum; key-based Higgsfield client independent of any login; drain scans 25 candidates and skips rather than pins; canary/live-test routes now pass the approval gate and derive AI disclosure from stored paths. | `publishReel` legacy direct publisher remains, disarmed by `REEL_LEGACY_PUBLISH_ENABLED` (**unset in prod, verified**). Handoff to the reel session: delete it and update `reelPublishSafety.test.ts` + `adminPermissionCoverage.test.ts`. **Second residual (outside review, 2026-09-08):** the drain's 25-candidate scan is a fixed window over the oldest jobs, so 25 consecutive condemned or blocked jobs starve every job behind them — the skip removed *pinning*, not *starvation*. Reel-session handoff: exclude vetoed jobs from the candidate query, or page past skipped ones; add a test that plants 26 blocked jobs ahead of one publishable job and asserts it publishes. |
| 4 Approval ≠ scheduling intent ≠ delivery authorization · digest binding · 72h TTL | **DONE, one gap** | Caption sha256 + `media_assets.checksumSha256` bound; a stable URL is not proof of unchanged bytes; explicit publish window suppresses the TTL; `publication_intended_at` on the job; 0118 applied and wired (#2164). | Approval write path and queue view veto on job-ID (`auditPublishBlock`) only; the drain additionally vetoes on content similarity (`condemnedContentProblem`). An operator can "approve" a reel the drain will never publish, with no reason shown. Handoff to the reel session. |
| 5 Durable recovery ledger · reconcile by job ID · GATED Higgsfield drawdown | **PARTIAL** | Read-only ledger reconciles `generation_reservations.action_id = reel_job_<id>`, keeps `providerOps` append-only, reports unknowns honestly. | One cost row per job, not per paid attempt (stated in the module). **Zero client callers** of `instagramAdmin.reelRecoveryLedger`. No spend gate reads it; the only pre-spend gate is `generationLedger.reserve(dailyBudgetUsd)`, which is prior art. Drawdown remains operator-gated and undesigned. |

Corrections to the plan's own risk list: "approvals currently have 72h TTL conflicting with long
pre-scheduling" — **resolved by #2164** (window suppresses TTL). "Reconcile recovery counts by unique job
IDs" — **done** but at one-row-per-job granularity. "Meta publishing architecture does not prove runtime
health" — **still true**: the last confirmed Instagram publish date is a prod fact nobody re-read this
session; the daily reel cron routine in the other tool was disabled 2026-09-07 with ~192 packs and zero
published reels.

## 4 · Design audit and the Nick's Tire visual system

### 4.1 Screenshot-1 checklist, measured (client/src, public pages)

| Pattern | Finding | Verdict |
|---|---|---|
| Purple-to-blue gradients | 0. `bg-gradient` appears 37× in 29 files, almost all photo scrims (dark overlays on hero photos). | Fine; keep scrims, ban hue gradients |
| Gradient hero text | `bg-clip-text` 0 matches | Clean |
| Emojis in headings | 0 inside any h1/h2 (3 files use pictographs as list glyphs) | Clean |
| Inter everywhere | No. Barlow Condensed (display) · DM Sans (body) · JetBrains Mono (numbers), kept in sync by comment contract | Keep |
| Colored-border cards | Tonal cards (`border-red-500/30` triage, `border-white/15` hero lanes) | Acceptable in the triage card only; hero lanes: see 4.3 |
| Glassmorphism | `backdrop-blur` 56× in 38 files; the hero's four intent lanes are frosted panels over a photo | **Over-used**; keep blur to ≤2 surfaces (nav, sticky CTA) |
| Low-contrast dark mode | Footer/legal at 20–40% opacity; red button 3.8:1 | Fixed (#14); audit remaining `text-foreground/40` at ≤12 px |
| Generic three-icon rows | Present on several service templates (VERIFY count in `FocusedServicePage`) | Replace with the "ticket" block (4.3) |
| Badge-over-headline | Present on some landing sections (VERIFY) | Remove where the badge only says "trusted" |
| Lucide everywhere | 256 imports / 253 files | Keep Lucide for UI chrome; add 8 custom automotive glyphs for brand moments |
| Untouched shadcn | 51 components under `components/ui`; marketing CTAs are hand-rolled per call site | Admin: fine. Public: consolidate CTAs into one `Cta` component with two variants |
| Fade-on-scroll / motion | `FadeIn` component; framer-motion in 44 files; `motion-safe:` used in the hero | Keep entrance fades ≤ 200 ms, none tied to scroll position; honour `prefers-reduced-motion` everywhere (WCAG C39) |
| Cursor-following beams | Not found (UNVERIFIED — no grep for spotlight/beam yet) | Ban |
| Buttons that only fade on hover | `hover:opacity-90` on city CTAs | Replace with the inversion rule (4.3) |
| Em-dash-heavy copy | ≈1,100 in ~85 public page files; Home.tsx 49, DiagnosePage 59, HomeLegacy 75 | **Yes.** Cut by half in customer copy; a period is the shop's voice |
| Buzzword copy | brand-voice lint enforced (52 rules); 28 remaining hits are verified false positives | Keep the lint hard |
| Decorative serif italics · Space Grotesk + Instrument Serif · grain-over-gradient | None | Clean |

Verdict: **not synthetic, not cheap; over-designed in the hero and thin on shop facts**. The mobile hero
hides the open-now widget (`hidden lg:flex`) and shows no street address before the fold.

### 4.2 Direction — "The sign and the ticket"

Two real objects carry the brand: the **yellow sign** on Euclid Ave (already the hero photo) and the
**written estimate** every customer gets before a wrench moves. The system uses the first as a material and
the second as the trust motif.

- **Color** — sign yellow `#FDB913` as a solid material (fills, rules, stamps), never a gradient; rubber
  black `#0A0A0A` ground; **estimate paper** `#F4F1EA` for light sections (quotes, hours, prices);
  one utility red for "stop driving" warnings only. No purple, no blue accent (the report's "one accent
  blue" is rejected: the sign has none).
- **Type** — Barlow Condensed 700–900 for headlines (uppercase, tight); DM Sans 400/500 body at 16–17 px,
  65–75 characters per line; JetBrains Mono for every number a customer reads (prices, hours, phone,
  mileage) so figures look like a ticket, not marketing. Scale: 14 / 16 / 18 / 22 / 28 / 36 / 48 / 64.
- **Rhythm** — 8-pt grid; section padding 48 (mobile) / 96 (desktop); cards 16 / 24; one max content
  width (72 rem) and one narrow reading width (44 rem).
- **The ticket block** — a paper-colored card with ruled lines and mono figures that appears on every
  service page in the same place: *what it costs from, what's included, what we check, what you pay
  before work starts (nothing)*. It replaces three-icon rows and "trusted" badges.
- **The shop strip** — on every page, above the fold on mobile: `Open now · closes 6 PM` (server
  time, already computed in `shopStatus`), `17625 Euclid Ave` (map link), `(216) 862-0005` (tel), `Walk
  in, no appointment`. One row, mono figures, yellow rule. This is the single largest conversion gap
  the audit found on mobile.
- **Icons** — Lucide 1.5-px stroke for chrome; a custom 8-glyph automotive set in the same stroke
  (tire, lug nut, brake disc, oil drop, battery, check-engine, keys, tread gauge) reserved for the ticket
  block and service headers. No filled emoji-style icons.
- **Photography** — real only, on any customer surface (see §4.4). Photo scrims stay; frosted panels go.
- **Interaction states** — solid buttons invert on hover (yellow → black with yellow text; black →
  yellow border), 2-px yellow focus ring offset 2 px on every focusable, `active` scale 0.98, no
  opacity-only hovers. Minimum target 44×44 on the public site (WCAG 2.5.8 requires 24; the shop's
  customers use gloves and phones), 48×48 in admin.
- **Motion** — entrance fade/slide ≤ 200 ms, once; no scroll-linked effects; `prefers-reduced-motion`
  → no transform animation at all.
- **Density** — customer pages: one idea per screen on mobile, the ticket block and the shop strip always
  reachable. Admin: dense by design (tables, mono numbers, 12–13 px labels ≥ 60% opacity).

Feasibility: everything above is Tailwind 4 tokens + one component (`ShopStrip`) + one refactor
(`Cta`). No new dependency. DFII: aesthetic 8, fit 9, feasibility 9, performance 9, risk 2.

### 4.3 Copy and voice

Principles: first person plural, plain verbs, a number only with its basis, no superlative without an
external award, no invented timelines, no "financing". Sentences end; em-dashes are for one aside per
paragraph at most.

Trust language that is **already true and verifiable in canon** (`shared/business.ts`):
- "Written estimate before any work. Nothing is charged until you approve it." — **owner confirmation needed
  before this line is used anywhere.** The price list carries a $59.99 diagnostic fee (credited toward the
  repair); "you don't pay until you say yes" is false if the diagnostic is charged when a customer declines
  the repair. Ohio Admin. Code 109:4-3-13 requires the written estimate and prior authorization — the first
  sentence already promises exactly that, and is the safe half.
- "Open 7 days. Walk in — first come, first served." (one dash, deliberate)
- "12-month warranty on installed parts, 90 days on labor, in writing."
- "Same corner on Euclid Ave since 2018."
- "We show you the worn part before we replace it."
- "Used tires from $25 installed on select 12-inch sizes; most sizes $40–80." (the two-tier price is
  intentional; do not "fix" it)

Language to retire or qualify: "Cleveland's #1", "highest-rated", "best tire deal" (unless quoting a
review, attributed), "1,700+ reviews" as a hard-coded string in 20 places — derive from
`BUSINESS.reviews` (Places count with admin override) or write "as of <month year>".

### 4.4 Photography and image strategy

Capture (owner/staff phone is enough; landscape 3:2 and a 9:16 crop of each): storefront in four
conditions (day, dusk, snow, rain — three exist), the bays with cars on lifts, hands doing a plug repair,
a tread-depth gauge on a real tire, the written estimate on the counter, the waiting area, the street
context toward Euclid Ave, tire stacks, the team at the counter (with consent), customers only with a
signed release. Export AVIF + WebP + JPEG fallback; keep `-mobile` variants (the component's
`disableMobile` default is tracked debt). Alt text names the place and the action ("Technician plugging
a tire at Nick's Tire & Auto, Euclid Ave").

AI imagery: never a person presented as a customer or staff (FTC 16 CFR 255.2(c) requires "actual
consumers" or a clear disclosure); B-roll of tires and tools is acceptable only in social where it is
disclosed. On Instagram set `is_ai_generated=true` on any AI reel (Meta requires the disclosure for
photorealistic AI video and may penalize omission).

### 4.5 Conversion architecture (first-come-first-served)

Primary actions, in this order, on every page: **Call · Directions · Drop off (how it works) · Text**.
One primary CTA per page; the sticky mobile bar (`SiteMobileCTA`, exists) carries Call + Directions +
Text. The shop strip (4.2) carries hours and address. "No appointment" appears in the strip, the drop-off
card, and the footer. Quote and tire-finder forms are secondary paths and must say when a human replies.
Nothing on the public site may imply reservation, slot, or booking; `/booking` is the drop-off page and
should be renamed in a Phase 2 redirect (`/drop-off`, 301 from `/booking`).

## 5 · Local SEO and AI discovery — ordered by evidence

**VERIFIED practices (do these; they also decide AI answers):**
1. **Google Business Profile** is the dominant cited source in AI Overviews and AI Mode (BrightLocal
   2026-08-26: 108,018 GBP citations vs 12,194 Yelp in AI Overviews across 60,970 checks). Operator
   queue from `docs/website-audit-status.md` still stands: resolve the Moe's/Nick's identity fracture,
   correct the BBB phone, reconnect the API as the profile owner, then submit the Basic API Access form
   (profile verified 60+ days, website listed). No "Walk-ins welcome" attribute is documented — put
   first-come-first-served in the description and do not add a booking link.
2. **Yelp** is the most-cited source in ChatGPT (BrightLocal, 2026-08-26 — that study covered AI Overviews,
   AI Mode and ChatGPT, **not** Perplexity; Perplexity's Yelp integration is a separate, documented feed).
   Claim the free page; the Birdeye "Moe's" profile with 1,763 reviews is unclaimed. **Yelp's content
   guidelines prohibit soliciting reviews** — claim and maintain the listing, never ask customers for Yelp
   reviews; the review ask in item 4 is a Google ask only.
3. **Bing Places** (free; October 2025 relaunch imports from GBP) and **Bing Webmaster Tools** (import
   from Search Console; the AI Performance report shows Copilot citations, grounding queries, Local
   intent). This is the only first-party AI-citation instrument that names the shop.
4. **Reviews**: ask every customer (generalized solicitation is carved out of the FTC rule), never
   gate by sentiment, never incentivize, reply to all (Google's guidance), keep the request link on the
   receipt. The site's own review count must not outrun Google's.
5. **Crawlable HTML with the facts in it**: prerender already carries name, address, phone, hours,
   prices in JSON-LD and text to every documented answer agent (measured). Keep the `LocalBusinessSchema`
   as the only emitter; `["AutoRepair","TireShop"]` is valid JSON-LD (TireShop sits under `Store`, not
   `AutomotiveBusiness`); run the Rich Results Test on one city page after deploy.
6. **Sitemaps + Search Console + Bing**: honest `lastmod` (fixed), submit both webmaster tools, read
   the GSC **Generative AI performance** report (impressions in AI Overviews / AI Mode, worldwide since
   2026-08-31).
7. **robots.txt**: all search/answer agents allowed by inheritance from `*`; training crawlers are an
   owner switch (§1 #12). Google-Extended stays allowed (it also governs Gemini-app grounding).
8. **Neighborhood pages**: 59 exist, all `noindex`, deliberately; the 21 city pages are indexable and
   templated. Google's doorway definition applies to "substantially similar pages … that funnel users to
   one page." Keep the 21 only if each carries something true of that place (drive time and route,
   jobs commonly seen from there, a photo, a review from there). Otherwise fold to `/areas-served`.

**PLAUSIBLE (cheap, do after the above):** self-contained one-to-two-sentence answers under H2/H3
headings (Microsoft's stated preference for AI inclusion); IndexNow submissions on publish (Bing, Amazon, Naver, Seznam, Yandex, Yep — not Google;
the key file already exists; wire the POST); CARFAX Car Care listing (free, auto-specific); Apple
Business (free place card; migrated to the new platform 2026-03).

**SPECULATIVE (do not spend on):** `llms.txt`/`ai.txt` beyond the one generated file (Google: "Google
Search itself doesn't use them"; Ahrefs May 2026: 97% of such files receive zero requests); "AEO"
markup; any vendor promising AI-ranking placement.

**Monitoring:** (a) GSC generative-AI report; (b) Bing Webmaster AI Performance; (c) GA4's native
"AI Assistant" channel (referrers chatgpt.com, perplexity.ai, copilot.microsoft.com, gemini.google.com,
claude.ai — expect single-digit sessions/month; app traffic lands in Direct); (d) server log UA counts
by published IP list (`OAI-SearchBot`, `PerplexityBot`, `Claude-SearchBot`, `bingbot` = eligibility;
`ChatGPT-User`, `Perplexity-User`, `Claude-User` = a real question touched the page); (e) a fixed
15-prompt panel run monthly, logged-out, Cleveland location set, recording mentioned / facts correct /
sources cited. Attribution limit: none of these prove causation; they show presence and accuracy.

## 6 · Security, privacy, accessibility, performance gates

| Gate | Current (VERIFIED) | Target | Placement |
|---|---|---|---|
| HTTPS + HSTS | 301 http→https; HSTS 2 y, includeSubDomains, preload flag; **not submitted** to hstspreload.org (status unknown) | Fix `www` DNS first (currently NXDOMAIN — customers typing www get nothing), then submit | Owner: DNS + submit |
| CSP | allowlist + `'unsafe-inline'` (bypassable shape); connect-src fixed here | **DONE 2026-09-08** — production `script-src` carries `'sha256-…'` of the one inline loader instead of `'unsafe-inline'` (dev keeps it for Vite HMR); `CSP_ALLOW_UNSAFE_INLINE_SCRIPTS=true` is the no-deploy fallback. A nonce was not needed: every served HTML document is static and shares one inline script (parity test over all 336 snapshots). Verify after deploy: DevTools console shows no "Refused to execute inline script" on `/`, `/tires`, `/book`. | done · `securityHeaders.test.ts` (control/canary) |
| Other headers | COOP same-origin, CORP same-site, XFO DENY, nosniff, Referrer strict-origin-when-cross-origin, X-XSS-Protection 0 (correct), Permissions-Policy extended here | keep; no COEP (Maps iframe) | done |
| Cookie consent | none; **not required under the current facts** — an applicability decision, not a permanent verdict: US-only shop; Ohio has no comprehensive privacy law; CCPA thresholds not met; Google/Meta terms satisfied by disclosure; EDPB treats incidental EU visits as out of scope. **Flips if** the site or its ads target EEA/UK/CH visitors, a state law without a revenue threshold applies, or Google/Meta consent terms change | privacy policy disclosure (done); re-decide on any flip condition | done / conditional |
| SMS/TCPA | STOP handling exists in `smsGateway.ts`/`sms.ts`; consent records per `SMS-REVENUE-AGENT-OS.md` | audit against the five rules: written consent for marketing; service texts on transaction consent; opt-out within 10 business days (do it instantly), one confirmation text within 5 min, treat STOP as global; quiet hours 8–9 local for marketing; 5-year consent/DNC records; 10DLC brand+campaign registered; any AI-voice outbound call = "artificial voice" needing prior express consent | Phase 2 audit (read-only) |
| Forms / abuse | zod validation thorough; IP rate limit 10/h per endpoint; rate-limit key preferred `cf-connecting-ip` while Cloudflare proxy is OFF (server header `railway-hikari`) → spoofable (**closed 2026-09-08**: honoured only under `TRUST_CLOUDFLARE_HEADERS=true`; proven through the real form limiter — 12 rotating header values = one bucket = a 429); `x-real-ip` is still honoured and its Railway semantics are unverified; no honeypot/CAPTCHA | verify what Railway sets (`x-forwarded-for` vs `x-real-ip`) with one logged request before touching `TRUST_PROXY`; add a honeypot field to booking/lead/callback; Turnstile only if spam is observed | Phase 2 (protected: lead/booking persistence) |
| Sessions / CSRF | tRPC + admin MFA freshness gate; server-side permission map fail-closed for mutations | confirm cookie flags (`__Host-`, SameSite) and an Origin check on mutations | VERIFY |
| Source maps | `sourcemap:false` — nothing leaks; Sentry stack traces are minified | hidden maps uploaded to Sentry with release = git SHA, deleted after upload | Phase 2 |
| Uptime | Railway health check gates deploys only; no external monitor known | UptimeRobot free (commercial use allowed per 2026-05-26 terms) on `/api/health` at 5 min with phone alert | Owner: 10 minutes |
| Backups | TiDB tier UNVERIFIED (free Starter = 1 day retention, no PITR, restore only to a new instance) | know the tier; enable PITR if Essential/Dedicated; one dated restore-to-new-instance drill | Owner |
| Accessibility | Lighthouse a11y 96 → fixes here; skip link, lang, headings not re-audited | WCAG 2.2 AA: 2.5.8 target size, 2.4.11 focus not obscured (sticky bar), 3.3.7 redundant entry on forms, reduced motion; re-run Lighthouse + one keyboard-only pass per template | Phase 2 |
| Performance | Lab: preload-matched hero, deferred analytics, immutable assets; field data unavailable today (PSI quota) | CWV at p75: LCP ≤ 2.5 s, INP ≤ 200 ms, CLS ≤ 0.1; self-host the three fonts as WOFF2 (cache partitioning killed the shared-cache argument); AVIF variants; keep framer-motion out of the critical path (July P1-9 still open) | Phase 2 |
| Best-practices score 73 | Meta pixel third-party cookie (unfixable while the pixel exists), console errors from blocked hosts (CSP, fixed) | ≥ 90 after deploy | verify |

## 7 · Admin IA and mobile operator ergonomics

Verified today: no bottom navigation or thumb-zone pattern; `min-h-[44px]` sprinkled in ~10 files with
no shared utility; the `_unavailableCounts` UNKNOWN pattern is correct where used and was missing in one
money consumer (fixed here); the audit trail has two real mechanisms (`autonomy_audit_events`,
`receipts_json`) and at least one bypass (`tireOrders.status` set with no actor/timestamp); permissions
are enforced server-side with a fail-closed default for unmapped mutations; kill switches are env flags
that default safe in code but were measured live-ON in prod.

Program (Phase 2, in order):
1. **Daily four on the thumb**: bottom bar for Today · Customers · Tires · Follow-ups; everything else
   behind "More". Registry-driven, so it is one file.
2. **One `TouchTarget` utility** (48×48) and a lint that fails a new `<button>` under it.
3. **UNKNOWN is mandatory for money**: a test that walks every rendered dollar figure's data source and
   fails if the consumer does not consult its availability flag.
4. **Live switch panel**: read-only surface of the ten side-effect flags as the running service sees
   them (the probe script exists; surface it), with the last-changed date. No toggles.
5. **Audit trail parity**: every admin mutation writes actor + timestamp; start with `tireOrders`.
6. **Retire/merge by evidence, not line count**: `leads` (769 lines over 2 rows all-time) is the first
   MERGE candidate; open it before deciding.
7. **Sales reconciliation (slice 2 completion)**: an operator-supplied ALG export for one closed period,
   compared line-by-line by a read-only script that prints matched / missing / extra and only then flips
   `reconciledToShopReport` for that period. Never a new probe.

## 8 · Social creative production and publishing

Reels **and** static/carousel posts run through the same four states, kept distinct in code
(`shared/reelApproval.ts` already does this for reels): **creative approval** (bytes: caption sha256 +
asset checksum) · **scheduling intent** (`publication_intended_at`) · **delivery authorization** (an
explicit window the human saw, which suppresses the 72 h TTL) · **confirmed publication** (Instagram
media id + permalink + our S3 master). A pack, a brief, or a rendered file is not success; only the last
state is.

Platform facts to design against (Meta, VERIFIED): Reels 3 s–15 min, 9:16, ≤ 300 MB, H.264/HEVC + AAC;
JPEG only for images; carousels 2–10 items, no Reels inside; 100 published posts and 400 containers per
rolling 24 h; containers expire after 24 h; media URL must be public when Meta fetches it; **no native
scheduling** — the server holds the item; `is_ai_generated` parameter since 2026-06-22; safe zone 14%
top / 35% bottom / 6% sides; recommend ≤ 3 min; watermarked or recycled content is not recommended to
non-followers. GBP posts: video ≤ 30 s / 75 MB / ≥ 720p, no phone numbers in the text, "auto-generated
content" discouraged.

Quality review before approval (one checklist, both formats): claim safety (existing lint), originality
memory (exists), safe-zone overlay check, real-photo-or-disclosed-AI rule, caption ≤ 2,200 chars and
≤ 5 hashtags (house cap), a human who can name the customer benefit in one sentence. Storytelling beats:
the estimate on the counter, the worn part in the customer's hand, the snow-day storefront, "what we
told the customer they did **not** need" — these are the shop's actual differentiators and need no AI.

Owned media: every approved master lives in S3 with its checksum (already true); platform `media_url`s
expire (Meta: "will not return the media when the content has been deleted or has expired"); provider
output URLs expire (Higgsfield ≥ 7 days, Runway 24–48 h, Veo 2 days, Sora 1 hour, fal ≥ 7 days). Copy on
success, never link.

## 9 · Bounded provider benchmark and replacement process

Run once, in a fixed frame, with real briefs; decide from the table, not the demo.

1. **Inputs**: three existing Nick's briefs from `docs/reel-packs/` (one tire, one brake, one seasonal),
   one static carousel brief. Same script, same shot list, same voice track for every provider.
2. **Providers** (verified pricing pages): Higgsfield Cloud API (~$0.063/credit derived; ≥ 7-day URLs) ·
   fal.ai (Kling 2.5 Turbo Pro $0.07/s, Wan 2.5 $0.05/s; URLs configurable to never expire) · Google
   Veo 3.1 Fast $0.10–0.12/s (2-day URLs, 8 s clips, 9:16) · xAI Grok Imagine v1.5 $0.08/s · MiniMax H3
   $0.08/s · Runway Gen-4 Turbo $0.05/s (24–48 h URLs) · OpenAI Sora 2 $0.10/s (1-hour URLs). Voice:
   ElevenLabs $0.05–0.10 per 1k chars.
3. **Measure per provider**: cost per **approved master** (all attempts, including rejects); cost per
   **confirmed publication**; operator review minutes to approval; repair ability (can one beat be
   regenerated without re-rendering the reel?); URL durability and webhook support; failure/NSFW-refusal
   rate on shop content; whether people appear (must not).
4. **Decision rule**: lowest cost per confirmed publication among providers whose approved-master rate
   is ≥ the current lane's, with ≥ 7-day output retention or a webhook. Ties go to the one with fewer
   review minutes.
5. **Higgsfield**: consumer subscription credits **reset at renewal and do not roll over**; credit packs
   expire 90 days; the MCP/CLI lane spends plan credits. Drawdown = spend the current cycle's allowance on
   benchmark briefs (bounded authorization: N credits, listed briefs, no publishing) before the renewal
   date, cancel after the last full cycle unless step 4 picks it. The Cloud API is a separate,
   key-based balance (credits expire after one year) — do not buy Cloud credits to "use up" the
   subscription.

## 10 · Analytics and measurement — observed vs estimated

**Observed conversions** (a real person did a thing on our surface): tel: taps (`trackPhoneClick` → GA4
+ Pixel + `call_events` row with one shared event id), directions taps (`directions_click` on the
mobile bar and the Contact address), sms: taps, form submits (durable `customer_events`), inbound calls
(VAPI/call tracking), walk-ins that become invoices (ALG mirror). **Estimated attribution** (a model
guessed why): GA4 channel grouping, Meta's modeled conversions, the in-app `revenueAttribution`
`evidenceLevel: observed | inferred | verified` — the vocabulary already exists; every admin surface that
shows attribution must print the level next to the number.

Event taxonomy (keep GA4 and Pixel names identical): `call_click{source}`, `directions_click{source}`,
`sms_click{source}`, `form_submit{form,source}`, `tire_search{size}`, `quote_request`, `page_view` on
SPA route change (T-1 from July: `trackPageView` still has no caller — VERIFY, then wire). No PII in
parameters. Never rank revenue urgency on `invoices.paymentStatus` (unreliable, memory rule).

Monthly reconciliation: ALG/ShopDriver billed total vs `shopSales` for the same closed period (§7 item
7); observed conversions vs GA4 counts (expect GA4 lower by ad-blocker share; a gap that grows is a
tagging break, not a business change).

## 11 · Rollout and runtime verification

1. Merge this PR; wait for `/api/health` `uptime` to reset.
2. `curl -s -o /dev/null -w "%{http_code}" https://nickstire.org/this-page-does-not-exist-xyz` → **404**;
   `curl -sI -A Googlebot https://nickstire.org/brakes` is not the test — use **GET** (HEAD skips the
   prerender middleware by design): `curl -s -A "Googlebot/2.1" https://nickstire.org/brakes | grep -c ld+json` ≥ 4.
3. `curl -sI https://nickstire.org/` → `Cache-Control: public, max-age=300, s-maxage=300, must-revalidate`.
4. `curl -sI https://nickstire.org/og-image.jpg` → 200 image/jpeg; paste the home URL into a Facebook
   share preview.
5. `curl -s https://nickstire.org/sitemap.xml | grep -c lastmod` → equals the number of DB-published
   blog articles, not 100+.
6. `curl -s https://nickstire.org/robots.txt` — no Crawl-delay, no utm lines, Bytespider blocked, GPTBot
   not blocked (switch off). `/ai.txt` → 301 to `/llms.txt`.
7. DevTools on the home page: `/g/collect` requests present with 204; zero "Refused to connect".
8. Trigger `.github/workflows/prerender-refresh.yml` (`workflow_dispatch`) so the 336 prerendered
   copies pick up the new `og:image`, the city-page schema and the `alternateName` — the weekly Monday
   run would otherwise leave crawlers on the old markup for up to a week.
9. Rich Results Test on `/parma-auto-repair` (one entity, no rating) and `/` (one WebSite).
10. Lighthouse mobile on `/`: a11y ≥ 98, best-practices ≥ 90; note remaining label-in-name hits.
11. Authed admin: Money → Shop Pulse renders; force a shop-floor read failure in a test environment to
    see "Shop floor · unknown".
12. Search Console: after 7 days, Coverage shows "Not found (404)" for junk URLs instead of "Duplicate,
    Google chose different canonical".

## 12 · Coverage matrix — KEEP / REPAIR / MERGE / MOVE / RETIRE / VERIFY

| Surface | Disposition | Why |
|---|---|---|
| Prerender + bot middleware + answer-engine list | KEEP | Measured working; contract test present |
| Route registry + validator | KEEP (+ Rule 5 added) | Single truth for sitemap/prerender/404 |
| Home hero intent router | REPAIR | Frosted panels → solid ticket-style lanes; add the shop strip on mobile |
| ShopStatusWidget (open-now) | MOVE | Desktop-only aside → the shop strip on every page, both breakpoints |
| 21 city pages | VERIFY → REPAIR or MERGE | Doorway test per page (§5 item 8) |
| 59 neighborhood pages (noindex) | KEEP | Already excluded from sitemaps; harmless |
| `/booking` drop-off page | REPAIR | Rename to `/drop-off`, 301 old path; manifest shortcut fixed here |
| `/tires` finder + `/tire-prices-cleveland` | KEEP | Real utility; the SearchAction target |
| Blog (120+ static + DB articles) | VERIFY | Spot-check 10 for factual drift and dates; sitemap now honest |
| `llms.txt` (generated) | REPAIR | Derive from `BUSINESS` + registry (tracked open since 2026-08-19) |
| ai.txt / llms-full.txt / 4 schema JSON files | RETIRED | Contradictory, orphaned, unread |
| Privacy / Terms | KEEP (+ disclosure fix) | SMS program terms already thorough |
| Manifest + service worker | KEEP | Network-first navigations; consider a second manifest for admin (low) |
| Security headers middleware | KEEP (+ connect-src) | Nonce CSP is Phase 2 |
| Rate limiters | REPAIRED 2026-09-08 + VERIFY | `cf-connecting-ip` now gated by `TRUST_CLOUDFLARE_HEADERS`; `x-real-ip` semantics on Railway still unverified |
| Forms (booking/lead/callback/careers/qa) | REPAIR (Phase 2) | Honeypot; keep zod |
| GA4 / Pixel / CAPI wiring | KEEP + VERIFY | Beacons after CSP fix; SPA page_view caller |
| Admin home (Sales card, Opportunities, Exceptions) | KEEP | Phase 1 work; keep "Billed" until reconciled |
| Admin Money → Shop Pulse | REPAIR (done) | Unknown state |
| `admin-stats.shopFloor` + `masterIntelligence` pacing | MERGE (Phase 2) | Third and fourth revenue implementations |
| Reel approval / drain / recovery ledger | KEEP + handoff | Owned by the reel session today |
| Legacy `publishReel` | RETIRE (handoff) | Disarmed in prod; delete with its two tests |
| Decision Inbox | RETIRED (done) | Do not resurrect under another name |
| Higgsfield subscription lane | VERIFY → RETIRE | Benchmark first (§9), drawdown gated |
| Google Business Profile API integration | VERIFY | Alive; access form is the gate (quota 0) |
| Cookie banner | DO NOT BUILD | Not required |

## 13 · Classification

**VERIFIED CURRENT DEFECTS — fixed on this branch:** §1 rows 1–16.

**VERIFIED CURRENT DEFECTS — open, owner or another session:** `www` NXDOMAIN (owner DNS); HSTS not
submitted (after DNS); reconciliation not built (slice 2); recovery ledger has no consumer and no gate
(slice 5); approval-time veto parity (reel session); legacy `publishReel` (reel session); mobile hero
lacks address/hours/open-now (Phase 2 design); no external uptime monitor (owner); `llms.txt` hard-coded
(Phase 2); `x-real-ip` vs Railway proxy state (verify first — the `cf-connecting-ip` half closed 2026-09-08); no honeypot (Phase 2).

**NEEDS RUNTIME VERIFICATION:** §11 items 2–12; GA4 beacons after deploy; SPA `page_view` on route change
(GA4 enhanced measurement may already emit it on history changes — confirm one event per navigation in
DebugView BEFORE adding an emitter, or every route change double-counts); `DATABASE_URL_PRERENDER_RO`
exists in the workflow secrets with read-only grants (owner action — the workflow silently falls back to
the read-write `DATABASE_URL`; the analytics write path is now guarded in code, the credential is the second lock);
IndexNow submitter existence; TiDB backup tier and one restore drill; 10DLC registration status; STOP
handling against the five rules; live values of the ten side-effect flags (re-run the probe script,
never quote a doc); last confirmed Instagram publish date; Google Reviews API failure rate in Railway
logs; whether Cloudflare is in front of the origin today.

**OPTIONAL / EXPERIMENTAL:** ~~`security.txt`~~ (shipped 2026-09-08 at `/.well-known/security.txt`: contact page + public phone, 180-day Expires from boot — no new mailbox needed; `/security.txt` 301s);
EEA geofence for tags; second manifest for admin; Spanish pages (no demand data); Turnstile (only if
spam is observed); IndexNow wiring (Bing-family benefit, no Google); Apple Business / CARFAX / Nextdoor listings (free,
low effort, unmeasured); a `/drop-off` rename.

## SEND THIS TO THE CODING AGENT NOW

Continue the current five slices **without restarting or restructuring anything**. Correct only the
high-confidence contradictions listed here: (a) slice 2 is not reconciled — keep "Billed" and build the
read-only, operator-export-driven comparison before any flag flips; (b) slice 4's approval write path and
queue view must apply the same content-similarity veto the drain applies, so an approval cannot succeed
on a job that can never publish; (c) slice 3's legacy `publishReel` route is disarmed in prod and has no
client caller — delete it and update its two tests; (d) slice 5's ledger needs one read-only admin
mount before any drawdown is designed; drawdown itself stays operator-gated. Do not let the current
branch balloon: the public-site fixes in this document's §1 are already on branch
`claude/nicks-tire-quality-audit-544da2` and must not be re-done. Track everything else in this
document — public-site design system, local SEO and AI-discovery work, accessibility, security
(honeypot, `x-real-ip` trust — the hash CSP and the `cf-connecting-ip` key shipped 2026-09-08), performance (self-hosted fonts, AVIF, framer-motion off the
critical path), and the social provider benchmark — as Phase 2/3 backlog items with their acceptance
tests, not as scope for this branch. Report every item in one of five states, separately:
**implemented · tested · awaiting authorization · deployed · runtime-verified**. Never merge a state up
a level without the receipt for it. The mission is excellence in looks, words, imagery, conversion,
trust, technical quality and operations, delivered as evidence-driven, prioritized work, not perfection
theater.

## Sources (primary pages read 2026-09-07)

Google: developers.google.com/search/docs/appearance/ai-features · …/fundamentals/ai-optimization-guide ·
…/crawling-indexing/google-common-crawlers · …/crawling-indexing/robots/robots_txt · …/crawling-indexing/
sitemaps/build-sitemap · …/crawling-indexing/consolidate-duplicate-urls · …/appearance/structured-data/
local-business · …/appearance/structured-data/review-snippet · …/appearance/structured-data/sd-policies ·
developers.google.com/search/updates (FAQ retirement) · …/essentials/spam-policies · …/fundamentals/
creating-helpful-content · support.google.com/business/answer/7091 · developers.google.com/my-business/
content/posts-data (2026-08-28) · developers.google.com/tag-platform/security/guides/csp ·
web.dev/articles/vitals · web.dev/articles/http-cache · web.dev/articles/strict-csp ·
support.google.com/webmasters/answer/16984139. OpenAI: developers.openai.com/api/docs/bots · …/pricing.
Anthropic: support.claude.com (crawler article). Perplexity: docs.perplexity.ai/guides/bots. Microsoft:
blogs.bing.com (AI Performance, Feb + June 2026; lastmod 2023/2025; crawl-delay), learn.microsoft.com
copilot-studio public-websites, about.ads.microsoft.com Oct-2025 inclusion guidance, indexnow.org/faq.
Apple, Meta, Amazon, DuckDuckGo, Mistral, Common Crawl, Cohere crawler pages. schema.org TireShop /
AutoRepair / AutomotiveBusiness · W3C JSON-LD 1.1 §3.5. W3C WCAG 2.2 "What's new" + Technique C39.
FTC 16 CFR 465 (govinfo) · 16 CFR 255.2 · ftc.gov Q&A. FCC 12-21, 24-17, 24-24, DA 25-312, DA 25-621,
DA 26-12 (docs.fcc.gov) · 47 CFR 64.1200 (LII) · 16 CFR 310.5 · CTIA Messaging Principles 2023.
Ohio Revised Code ch. 4719 · oag.ca.gov/privacy/ccpa · EDPB Guidelines 3/2018 · Google Analytics ToS ·
Meta Business Tools Terms · hstspreload.org · MDN (COOP/COEP/CORP/Permissions-Policy/X-XSS-Protection) ·
OWASP cheat sheets (session, CSRF, DoS, file upload, logging) · Cloudflare Turnstile docs ·
docs.sentry.io (Vite source maps, releases) · docs.railway.com/reference/healthchecks ·
uptimerobot.com/pricing + terms · docs.pingcap.com backup docs. Meta: developers.facebook.com content
publishing + ig-user/media + changelog; facebook.com/business/ads-guide Reels; creators.instagram.com
originality guidelines and FAQ; about.fb.com AI labeling posts. Higgsfield: docs.higgsfield.ai (billing,
requests, rate limits), higgsfield.ai help center (credits). fal.ai/pricing · docs.dev.runwayml.com ·
lumalabs.ai/api/pricing · ai.google.dev/gemini-api/docs/veo + pricing · developers.openai.com video
guide · platform.minimax.io pricing · docs.x.ai/developers/pricing · elevenlabs.io/pricing/api ·
huggingface.co/Lightricks/LTX-2.5. Studies: BrightLocal 2026-08-26 and 2026-03-10, Yext 2025-10-09,
Foundation × AirOps Q4 2025, Ahrefs 2025-12-12 and 2026-03-02, Semrush 2026-06-26, SparkToro 2026-06-09.

---

## 15 · Release record

One row per link in the chain, because "shipped" has meant three different things in this repo (merged,
deployed, and crawler-visible) and each has silently failed to imply the next. Times are ET.

| Step | Evidence |
|---|---|
| Source | PR #2173 `nickstire/quality-program`, 16 defects, 7 commits ending `8c0be63d5` (in-PR regen) |
| Merge | squash `f2bcf949d` on `main`, 2026-09-07 ~20:05 |
| Deploy | Railway `MAINnicks-tire-auto` SUCCESS on `f2bcf949d`, 20:14; `/api/health` served the new SHA |
| Live checks | 10 read-only GETs at 20:15 (§11): 404+noindex+no-cache on an unknown path · `/Tires` 301 · home `max-age=300` · `/og-image.jpg` 200 JPEG 1200×630 · sitemap `<lastmod>` 11 (was 100+) · robots clean · `/ai.txt` 301 · CSP carries the four GA4 hosts · `/admin` noindex · bot GET returns `X-Prerendered: true` |
| Follow-up | PR #2179 (self-audit: `originalUrl` 404, robots literals, parity canary) squash `cfdcad9be`, deployed |
| Crawler-visible | regen on `main` after #2179: run `34172453611` FAILED at `git push` (non-fast-forward: #2179 landed mid-run — the workflow commits on a stale base and does not rebase); re-dispatched as run `34173664386` from `622426951`, landed as `2336d313d` (337 files) at 00:49 UTC 2026-09-08. **Tree-content check of `prerendered/parma-auto-repair/index.html`:** `f2bcf949d` and `cfdcad9be` → 1 JSON-LD `FAQPage` node, WebP `og:image`; `2336d313d` → 0 nodes, `/og-image.jpg`, 0 `aggregateRating`, 2 `#localbusiness` refs. So the in-PR regen had NOT carried the share-image fix (it predated it in the tree) and the FAQ removal only existed from #2179 — the first draft of this row claimed otherwise. Live at 20:51 ET the site still served `cfdcad9be` (bot GET: WebP + 1 FAQPage) — the regen commit's Railway build had not finished; by 21:20 ET `/api/health` reported `2336d313d` and a bot-UA GET of `/parma-auto-repair` returned `X-Prerendered: true`, **0** `"@type":"FAQPage"` nodes, **0** `aggregateRating`, `og:image` = `/og-image.jpg`. That is the crawler-visible verification for #2173/#2179. Bot responses are cached `max-age=3600` by the prerender middleware. **Trap met while closing this row:** GitHub skips every workflow for a push whose head commit message contains the skip-ci token ANYWHERE — including inside a quoted sentence in the body — so never spell the token out in a commit message or a PR body that a squash merge might copy. |
| Release closure | PR #2182: sales windows v2 (7/30 dates), prerender write guard on all three DB-writing public sinks + canaries, three regression tests (city schema, footer accessible name, share-image parity), research corrections (§2/§5/§6/§13). Squash-merged as `081f517f7` 2026-09-08 ~21:15 ET; deploy verification is the health SHA + the §11 GETs, recorded in `.remember/now.md` when done. |
| Security hardening | follow-up PR (same day): production `script-src` is hash-based (the one inline analytics loader; 336/336 snapshots share its hash, pinned by test), `cf-connecting-ip` honoured only under `TRUST_CLOUDFLARE_HEADERS=true`, `/.well-known/security.txt` (RFC 9116) with a 180-day Expires. Tests: `securityHeaders.test.ts` 8 · `rateLimitEdgeTrust.test.ts` 2 · `securityTxt.test.ts` 5. |

**What "verified" means per row:** Merge = `git log origin/main`; Deploy = Railway deployment status + health
SHA; Live = GET responses captured by `verify-deploy.sh` (10/10); Crawler-visible = a `[skip ci]` regen commit
on `main` whose city-page snapshot has no `FAQPage` and a `.jpg` `og:image` — check with a bot-UA GET, never HEAD.

**Owner-side, not automatable:** create `DATABASE_URL_PRERENDER_RO` (TiDB user with SELECT only) and add it to
the workflow secrets; until then the regen holds the read-write credential and the code guard is the only lock.
