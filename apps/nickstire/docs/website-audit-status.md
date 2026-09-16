# Website Audit — Status (2026-08-19)

What the old site audits flagged vs what is actually fixed. Evidence =
merged commits or live QA this session; "open" = nobody fixed it yet.

## Fixed (verified)

| Item | Evidence |
|---|---|
| Registry snippet prices contradicted canon (`/tires` desc "from $60", `/used-tires-cleveland` title $25 vs desc $40 in the SAME snippet) | war-room batch #1709 (2026-08-19) |
| Homepage meta description drift (registry ≠ Home.tsx SEOHead → SERP snippet ≠ social card); unified + Sunday differentiator added, title untouched | #1709 |
| Tire silo orphaned from its own hub — /tires linked NONE of /used-tires-cleveland, /new-tires-cleveland, /tire-prices-cleveland | #1709 (hub→silo links; consolidation decision gated on 28d read ≈ 2026-09-16) |
| Footer linked three 301s (/general-repair, /appointment, /estimate) + "View all 150+ locations" copy on a one-location shop | #1709 |
| 4 zero-inlink orphan pages adopted into footer (/warranties, /check-engine-light-diagnostic, /tire-storage, /hybrid-ev-repair) | #1709 |
| robots.txt disallowed /loyalty + /referral — paths that don't exist (live: /rewards, /refer, both meant to be crawled) | #1709 |
| 7 redirecting URLs prerendered (unservable HTML + permanent false MISSING alarm) → prerender:false, /estimate pattern | #1709 |
| prerender soft-404 recovery crash — esc/escReplace scoped inside if(routeInfo) while the H1-insert block outside calls it; 10 blog routes died + lost files on regen | #1709 (hoisted; 335/337, 0 failures) |
| Review-request scheduler could only text the SHOP (client hardcodes own number on tel: click) + SMS-spam vector (caller-controlled phone on publicProcedure) | #1709 (deleted; prod: review_requests had 1 row EVER) |
| AggregateRating emitted twice with different values for the same @id (ReviewsPage live 1706 vs schema floor 1700) | #1709 (stable floor in all structured data) |
| conversionEvents in-memory ring buffer (500 events lost per deploy, duplicated customer_events insert) | #1709 (deleted; recentEvents reads customer_events) |
| Shadowed client/public/llms.txt (dynamic handler always wins; static copy unreachable) | #1709 |
| 7 review-reply drafts sat invisible since 08-11 | #1709 (drafts-waiting banner in GrowthSection) |
| False "36-month/36,000-mile" warranty → 12mo everywhere | frontface audit wave `66d5fda6` (2026-06-03) |
| False founding "2005"/"20yr" → 2018/1,700+ reviews | same wave |
| Geo-coords reverting bug (patch-prerender) | removed, same wave |
| Tire pricing centralized (used "from $25 installed", new "from $89") | `BUSINESS.usedTires/newTires`, ~45 files swept |
| Family-owned → family-run | `c0e190e0` |
| RoundupTile 404s (4/7 competitor routes) | route-map `15c47e10` |
| Booking lie (fake slot booking) → FCFS drop-off card | wave 181.92 |
| /tires claim safety (reservation language, estimates honesty) | PRs #42/#44/#45 + cockpit copy |
| Checkout copy contradiction ("No charge until we confirm" vs Pay Now) | PR #42/#46 lineage |
| Phone consistency (216) 862-0005 | `BUSINESS.phone` shared constant |

## Fixed 2026-09-07 (PR #2173 → `f2bcf949d`, program doc `QUALITY-PROGRAM-2026-09-07.md`)

| Item | Evidence |
|---|---|
| Soft 404: unknown URL answered 200 with the home title + `index, follow` | `server/_core/spaFallback.ts`; 24 tests incl. real-HTTP wiring |
| Home HTML cached 24 h (express.static served `/` as a file; every other route was 5 min) | `index: false` in `server/_core/vite.ts` |
| `og:image` on a CloudFront PNG returning 403; SEOHead default was a 1672×941 WebP | `/og-image.jpg` 1200×630 from both places |
| Sitemap `lastmod` = today on every URL | omitted for static routes; real `updatedAt` for DB articles |
| `ai.txt`, `llms-full.txt`, `business-data.json`, 3 `*-schema.json` orphaned + contradicting canon (city "Euclid", oil $39/$69) | deleted; the two txt paths 301 → `/llms.txt` |
| 21 city pages minted a distinct rated entity with `aggregateRating` twice per page | canonical `@id` reference, no rating |
| Two `WebSite` nodes on `/` | one, in index.html |
| CSP `connect-src` blocked three GA4 beacon hosts (probed in real Chrome) | Google's documented wildcards added |
| Privacy policy never named Meta | sections 5 + 8 rewritten |
| robots.txt `Crawl-delay: 1` + `?utm_` disallows | `server/_core/robots.ts` + operator switch for training crawlers |
| Manifest "Book Now" on an FCFS shop, "1685+ reviews", "#1" | rewritten |
| /emissions meta description 168 > 165 chars | trimmed (163) |
| Lighthouse: 5 contrast failures, 6 label-in-name mismatches on hero CTAs (+ the footer review link, follow-up PR) | fixed |
| Admin Shop Pulse rendered a failed shop-floor read as "$0 · SLOW DAY" | "Shop floor · unknown" state |

## Fixed 2026-09-08 (release closure — outside review of the merged program)

- **Billed-sales rolling windows spanned 8 and 31 dates** under "7 days" / "30 days" labels: `salesWindow()`
  ran `[today−N, tomorrow)`. Now `[today−N, today)` — exactly N completed Eastern days ending yesterday;
  month-to-date still includes today. Definition version bumped to v2; `shopSales.test.ts` counts the dates
  across month, year, leap-day and both DST boundaries instead of pinning endpoint literals (the old test
  pinned an eight-day pair and called it seven).
- **The prerender regen wrote to production.** `PRERENDER_MODE=true` skips crons, but every rendered page still
  fired `POST /api/analytics/conversion`, which inserted a `customer_events` row. Guarded (204, no write), and the same guard now covers the other two
  DB-writing public sinks (`/api/track-abandoned`, `/api/uber-code`), each with a control/canary pair over real
  HTTP (`server/analyticsPrerenderGuard.test.ts`). Owner item remains: a
  read-only `DATABASE_URL_PRERENDER_RO` so the credential is the second lock.
- **Regression tests the fixes lacked:** city-page JSON-LD (no FAQPage, no aggregateRating, `#localbusiness`
  references, canary-checked); footer Google-reviews link accessible name equals its visible text; share-image
  parity across index.html, `SEOHead`'s default and the 1200×630 JPEG on disk.
- **Research corrections in the program doc:** IndexNow participants (Bing, Amazon, Naver, Seznam, Yandex,
  Yep — not "Bing only"); the BrightLocal study did not cover Perplexity; Yelp prohibits review solicitation;
  cookie consent recorded as an applicability decision with flip conditions; SPA `page_view` must be confirmed
  in DebugView before adding an emitter; "you don't pay until you say yes" flagged against the $59.99
  diagnostic fee for owner confirmation.
- **Security hardening (follow-up PR):** production `script-src` no longer carries `'unsafe-inline'` — the one
  inline analytics loader is allowed by sha256 hash, computed at boot from the served `index.html` and pinned
  identical across all 336 prerendered snapshots by test; `cf-connecting-ip` was a client-chosen rate-limit key
  while Cloudflare is not in front (rotating it defeated the 10/h form limit — proven, then closed behind
  `TRUST_CLOUDFLARE_HEADERS`); `/.well-known/security.txt` (RFC 9116) added with a 180-day Expires.
- **Mobile page top (follow-up PR):** the "StickyTrustBar" was never visible — static at y=0 under the fixed nav
  cluster (membership band when open, red closed-banner when closed; measured with `elementFromPoint`) — and a
  phone showed no address or phone number above the fold. Replaced by `ShopStrip` inside the fixed cluster
  (open/closed + "Closes 6 PM"/"Opens tomorrow 8 AM", address → directions, `tel:`, rating); the membership band
  is desktop-only now; the fixed red closed-banner (which also pushed the nav down 56px for a 37px strip) is gone,
  its Emergency button moved into the strip and reaches the same form through a window event. `shopHours` was the
  visitor's local clock with a second hard-coded schedule — now Eastern time from `BUSINESS.hours.structured`.
- **Service pages:** a written-estimate ticket after the pricing tiers (the page's own tiers, verbatim; approval
  line; Ohio repair-rule sentence). A same-day pass paraphrased the AEO default's "you don't pay until you say
  yes" as a fee-safety fix; **reverted** — it is the canonical Repair Haiku (brand-voice kernel, SMS, voice, 100+
  pages) and the diagnostic fee is itself quoted in writing before it is charged. Any change to that promise is the
  owner's, made in `shared/voice.ts`.
- **Promo toast over the hero on phones (follow-up PR):** `NotificationBar` rendered from the first frame at a fixed
  84px above the mobile CTA bar, i.e. on top of the hero's "Talk to a human" card at 375×812. On phones it now
  waits until the visitor scrolls past 60% of the first screen (control/canary test); desktop unchanged. Still
  open: the emergency + chat floating buttons overlap the cards' right edge while the shop is closed.

## Open (honest list)

| Item | Detail | Size |
|---|---|---|
| Used-tire price channel split | phone/SMS/IG/voice + AI price-validator still quote "$60 used" vs site "from $25 installed" (`igAutopost.ts:683` et al). Site-side copy is now fully canon (#1709); the remaining split is the PHONE/SMS/IG channel. **Owner pricing decision required first.** | decision + small PR |
| Off-site entity fracture (operator queue) | Five colliding identities at/around 17625 Euclid: Birdeye "Moe's" profile w/ **1,763 reviews UNCLAIMED** (excluded from the ranked list AI engines cite), live legacy Google Sites microsite listed as the official website by BBB/Birdeye/AutoTechIQ, BBB phone WRONG (682-0005), Monro ghost owns the address on Yelp, Facebook display name still Moe's. **Entity Continuity File + canonical GBP identity FIRST (Moe's→Nick's = major name change per Google policy), then claim/correct.** War-room artifact §16 has the sequence. | operator, zero code |
| GBP access chain | **Half resolved 2026-09-16.** The re-Connect is DONE and verified (token fingerprint changed and exchanges at HTTP 200 with `business.manage`), so the "granted by nourdean22, manages zero businesses" half no longer applies. **Only the API project quota=0 remains** — measured, not assumed: HTTP 429 from both `mybusinessaccountmanagement` and `businessprofileperformance`, so the [access form](https://support.google.com/business/contact/api_default) is the only path. Still blocks `gbp.performance`, the map-pack scoreboard, GBP posting and review replies. **Does NOT block review ingest** — that runs on the Places API, a different product with its own quota, and it is live (2026-09-16: "5 reviews synced, 1 urgent"). | operator |
| Tire-silo consolidation | GATED: read the hub→silo link test ≈ 2026-09-16 (decision rule in war-room artifact §11). Do not 301 anything before that read. | decision + M PR |
| Sitewide title unification (PR-3) | prerender overwrites desc/og unconditionally from registry but <title> only on a default-list match — /tires, /brakes, /financing SEOHead titles still diverge from registry og:title. Needs its own protected-core PR + validator rule. | M PR |
| llms.txt canon derivation | dynamic handler verified canon-correct 2026-08-19 but hardcoded (drift risk); derive from BUSINESS + routes. (llms-full.txt + ai.txt were RETIRED 2026-09-07 — they had drifted from canon; `/llms.txt` is the only facts file now.) | S-M PR |
| /tires search size duplication | input self-concatenates → cache miss → silent catalog fallback (live QA 2026-06-10). In `TireFinder.tsx` — owned by open PR #43's author; do not collide | small fix in #43's domain |
| Off-palette hardcoded hex | DiagnosePage, SharePage, TrackJob, WomensSafety | hygiene PR |
| Chrome pages without PageLayout | TrackJob, Booking, CustomerPortal, Landing — possibly intentional | owner call |
| Google Reviews API / Place ID reliability | code exists (`server/google-reviews.ts`); prod failure rate unverified — check Railway logs for `[GoogleReviews] Failed to fetch` | verify then fix |
| Prerendered HTML staleness | regenerates weekly via CI; live hydration is correct meanwhile | known tradeoff |
| Popup aggressiveness | 3 friction popups already removed (181.92); current popup state acceptable per CRO audit — re-audit only if bounce data says so | watch |

## Rule for fixes

Copy/CTA/link/meta fixes ship freely in small PRs. Anything touching
payment flow, schema, or large visuals gets its own scoped PR.
