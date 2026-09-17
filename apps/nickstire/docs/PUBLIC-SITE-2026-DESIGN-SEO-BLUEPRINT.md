# nickstire.org — 2026 Design/SEO/Local-Conversion Blueprint

**Updated: 2026-09-17.** Research pass grounded in the live site, fresh `origin/main`, and current (Sept 2026) Google guidance. Produced from a scratch-workspace Claude session; cross-checked against a parallel technical pass the operator shared mid-research (attributed as "parallel pass" below where its specific claims aren't independently re-verified here).

## Shipped from this blueprint (2026-09-17)

This document was research; these are the parts that became code the same day.
Everything else below remains a proposal, not a claim about production.

| # | Change | PR | State |
|---|---|---|---|
| 1 | Tire-size pages stop asserting `InStock` / `lowPrice` / `highPrice` nothing backs | #2404 | MERGED · snapshots regenerated, crawler-visible |
| 2 | Ticker no longer calls an 83-day-old review "New"; review age bounded and computed in SQL | #2405 | MERGED |
| 3 | One breadcrumb per city page; one business entity on `/contact`; invented stock removed from tire-size FAQ prose | #2406 | open |

**Three defects in this document were wrong and are corrected in place below:**
`trackPageView` must NOT be wired (Enhanced Measurement already emits SPA
page_view — measured live, 3→4 `/g/collect` beacons across one soft
navigation); the used-tire two-tier price is deliberate policy, not a conflict;
and "axe-core would have caught the H1 bug" was never verified. The sitemap
figure was also wrong in every earlier report — it is **412** `<loc>` entries in
a flat `<urlset>`, not 108 or ~190.

**Still blocked on operator authority:** the `www.nickstire.org` DNS record
(zone SOA is `ns1.globaldomaingroup.com`, not Railway) and the stale "Moe's"
branding on Nick's own `facebook.com/nickstireeuclid` page plus Yelp/BBB/Birdeye.

## Evidence key
`[LIVE]` I personally browsed/screenshotted/inspected nickstire.org this session · `[REPO]` read from current `origin/main` source, with file:line · `[WEB]` verified via search against current (Sept 2026) Google/W3C documentation · `[HIST]` established design/usability canon · `[INFER]` reasonable synthesis, not directly verified · `[SPEC]` explicit hypothesis, not a claim · `[PARALLEL]` reported by the operator's parallel research pass, not independently re-verified here.

---

## 1. Executive thesis

Nick's does not need a redesign. It needs **subtraction, concentration, and enforcement of a design system it already has but doesn't consistently follow.** `[INFER]`, converging from three independent sources: the repo's own Sept 2026 quality-program audit, the operator's parallel pass, and my own live/code verification.

The site already has the thing competitors can't copy: **"Pull up for tires. Drop off for repairs."** `[LIVE]` — a headline that *is* the operating model, not a slogan bolted onto one. National chains split intent as Find Tires / Schedule Service; Nick's genuinely runs first-come-first-served, so its interface should say that, not borrow the chains' scheduling language. The site mostly already does this (`GET TIRES NOW` / `Something's wrong` / `Dropping off` / `Talk to a human`) `[LIVE]`. The job now is to protect that distinctiveness while fixing real, specific, verified defects — not to import generic patterns from automotive-template land or SaaS-land.

Three convergent facts should set the whole strategy:
- **Traffic is not the bottleneck.** ~776 clicks / ~194k impressions in 5.5 months, home page = 61% of clicks `[LIVE-doc, ledger 2026-09-08]`. The site has enormous URL surface area (~260 public routes, counted below) earning almost none of it.
- **The URL surface is mostly dormant, and the site already knows it.** Of 121 neighborhood-page entries in code, **zero** are currently set to index `[REPO]`. 12 were deliberately reverted from indexed in a prior session for lack of content justification `[LIVE-doc]`.
- **What's built is often meaningfully better than what's graded.** A prior CEO audit scored the site D+ (66/100) `[LIVE-doc, dated ~2026-07-03]`; a fresh Lighthouse pass this session scored Accessibility 100, SEO 100, Best Practices 92, Agentic Browsing 100 `[LIVE, this session]`. Don't design against a stale diagnosis.

The single sentence for the top of an implementation brief: **make nickstire.org read, unmistakably, as the actual Euclid Avenue shop turned into the clearest, fastest local-service interface in Cleveland — and stop spending engineering effort on URLs Google has already told you it doesn't want.**

---

## 2. Current live-site audit `[LIVE — this session, mobile 375×812 and desktop]`

**What's already there, above the fold, on a phone, in the first few seconds** (verified by direct screenshot + accessibility-tree read of nickstire.org just now):
- Identity: wordmark, "Nick's Tire & Auto."
- Status: `🟢 Open · Closes 6 PM`.
- Proof: `★4.9 · 1,712+ Google reviews`.
- Location: `17625 Euclid Ave, Cleveland` — tap-to-directions link, already wired to a real Google Maps destination URL.
- Contact: `(216) 862-0005` — tap-to-call, already a `tel:` link.
- Headline: **"Pull up for tires. Drop off for repairs."**
- Concrete, specific subhead: hours, used-tire pricing band, "written estimate before any wrench moves."
- Primary CTA: `GET TIRES NOW` (large, high-contrast, goes to `/tires`).
- Three task-shaped secondary actions: "Something's wrong" (→ `/diagnose`), "Dropping off" (→ in-page drop-off flow), "Talk to a human" (→ `tel:`).

This is a genuinely strong "first 5–15 seconds" pattern — identity, location, open-state, phone, directions, and proof are all present without scrolling, on mobile. It substantially satisfies what the brief asked a high-trust auto shop site to communicate immediately.

**What's also there, further down, and worth protecting:** an explicit explanation of *why* there are cones and no appointments ("The Cones Mean Keep Moving"); a direct, named comparison to chains ("Chains close Sunday. Nick's runs 9 to 4"); a used-tire trust block (4-point exam, free mount/balance); a symptom-triage grid (grinding brakes → `/brakes`, check-engine light → `/diagnostics`, bald tires → `/tires`, weak AC → `/ac-repair`, failed E-Check → `/emissions`) each paired with a specific written-estimate promise; three real Google review excerpts with a footnote disarming the "are these real" objection ("Yes, all real. Google catches fakes faster than we do."); and — genuinely unusual for a shop this size — **live Uber/Lyft deep links generated from the shop's own GPS coordinates**, plus an SMS deep link with a pre-filled message. None of this is generic; all of it should survive any redesign untouched in substance.

**Verified defects found this session, independent of any document:**
1. **H1 accessible name is duplicated.** `read_page` (accessibility tree) reports the hero heading's computed name as `"Pull up for tires.Pull up for tires.Drop off for repairs.Drop off for repairs."` A direct DOM inspection (`document.querySelector('h1').outerHTML`) shows why: the heading uses a split-letter reveal animation with a visually-hidden (`sr-only`-style) span carrying the real phrase for assistive tech, alongside `aria-hidden="true"` spans for each animated letter. The animation copy *is* correctly `aria-hidden`, but the accessible-name computation for the parent `<h1>` is still picking up both — a known edge case in how some browsers compute accessible names when `aria-hidden` is applied to nested leaf nodes rather than one wrapping container. **Practical effect:** a screen-reader user hears the hero headline announced twice — verbose and unprofessional, not incomprehensible. **Fix:** put `aria-hidden="true"` on the single outer wrapper of the whole animated treatment (not per-letter), and set an explicit `aria-label` on the `<h1>` itself so the accessible name never depends on descendant-filtering at all. This is the standard, more robust pattern for split-text animations. Automated Lighthouse didn't catch this (its a11y pass scored 100/100) — automated tools reliably catch roughly a third to half of WCAG issues `[HIST]`; this is exactly the kind of redundant-but-not-technically-failing issue that slips through, which is the argument for adding `axe-core` in CI (§23) plus a manual screen-reader pass, not for trusting a 100 score alone.
2. **Client-side route transitions show a full-screen black loading spinner.** Navigating from the homepage to `/tires` or `/contact` in a real browser (not a bot user-agent) briefly shows a blank screen with a "LOADING..." spinner before content appears. This is explained precisely by the repo (§3): every route except `Home` is `React.lazy()`-loaded behind one shared `<Suspense fallback={<PageLoader/>}>` `[REPO]`. This is expected SPA behavior, not a bug, but it's a real UX regression on every internal click: identity, status, phone, and directions all disappear during the transition. A first-come-first-served shop whose top mobile priority is "phone/directions always reachable" shouldn't have a page state where they briefly aren't.
3. **Lighthouse (mobile, homepage, this session): Accessibility 100, Best Practices 92 (3 failing audits, not itemized in this pass), SEO 100, Agentic Browsing 100.** CLS measured at **0.00** in a live performance trace — excellent. The same trace reported `Metrics (field / real users): n/a – no data for this page in CrUX` — Google's own real-user dataset has no field data for this origin. **The cause is not established.** Insufficient eligible Chrome traffic is the most common reason, but CrUX eligibility has other conditions and this was not proven either way; do not repeat "it's low traffic" as a finding. What *is* established is the consequence: Nick's cannot see its own field LCP or INP, and the fix is first-party RUM (§22), not waiting on Google.
4. **`www.nickstire.org` does not resolve — re-verified with DNS tooling.** `curl --max-time 12 https://www.nickstire.org/` returns **exit code 6 ("couldn't resolve host")** with `http_code=000`; a type-A query returns no address, and a CNAME query returns the zone SOA instead of a record. The apex resolves normally (`nickstire.org` → `t9i4z184.up.railway.app` → `69.46.46.94`) and `http://` 301s to `https://` correctly. **The zone's authoritative nameserver is `ns1.globaldomaingroup.com`** — so the missing record is added in that DNS panel, not in Railway. Anyone who types "www.", or follows a business card, legacy citation, or external link in that form, loses the visit before the site can load. Cheap to fix, real acquisition leak, P0.
5. **Prerendering is confirmed working in production.** Googlebot, Bingbot, `facebookexternalhit`, and GPTBot user-agents all receive `x-prerendered: true` plus a fully-rendered ~154KB document with title, meta, H1, and JSON-LD in the raw HTML; a plain browser UA fetched without a JS engine gets the ~15KB SPA shell, which is expected and correct. Both classic search crawlers and AI crawlers see real content.
6. **Three live structured-data defects** (detail and the correct remedy in §17): `aggregateRating` is present on the homepage, **entirely absent on six pages that share the same `#localbusiness` entity ID** (`/brakes`, `/oil-change`, `/alignment`, `/tires`, `/about`, `/cleveland-auto-repair`), and present in a third, malformed shape on `/contact` (string-typed values, missing `worstRating`, and an `AutoRepair` block carrying no `@id`, so it doesn't link to the shared entity at all); `/cleveland-auto-repair` emits **two conflicting `BreadcrumbList` blocks**; and breadcrumb depth is inconsistent across peer service pages (`/alignment` ships a 3-level trail, `/brakes`/`/oil-change`/`/tires` ship flat 2-level ones with no URL on the final item).
7. **Live review-count figures disagree across surfaces:** homepage JSON-LD says `reviewCount: 1700`, `/contact` JSON-LD says `"1711"`, and the visible homepage copy I screenshotted says `1,712+`. Most likely three snapshots taken at different times — which is exactly the argument for one canonical, dated source rather than figures embedded per surface.

**Independently confirmed strengths (live fetch, literal HTML):** all sampled pages return 200 with exactly one H1, a unique self-referencing canonical, consistent `robots` directives (`index, follow, max-image-preview:large`), and a viewport meta; titles and descriptions are **unique across all sampled URLs including programmatic city pages** — no templated duplication despite 80+ location URLs in the sitemap; 100% descriptive image alt-text coverage; correct use of `AutoRepair`/`TireShop`, `GeoCoordinates`, `OpeningHoursSpecification`, and `OfferCatalog`; complete Open Graph/Twitter Card tags; and the FTC-driven oil-change price disclosure is present and not regressed (live copy pairs the promotional price with "Most vehicles. Pricing varies by vehicle and parts. Call for exact quote."). Used-tire pricing is consistently qualified with the "$40-80 most sizes" band **everywhere it appears on-site** — meta, OG, hero copy, and JSON-LD — so the pricing inconsistency flagged in §24 is a site-vs-phone/SMS channel problem, not an on-site one.

---

## 3. Verified repo audit `[REPO — origin/main via nourdean22/MAINnicks-tire-autoNEW, confirmed live remote, apps/nickstire]`

The codebase is materially more sophisticated than a typical local-shop stack, and most of what a generic recommendation list would propose already exists. Route inventory, counted directly from `client/src/App.tsx`'s route table and the `shared/*.ts` data files it reads:

| Template | Count | Source |
|---|---:|---|
| `Home.tsx` | 1 (eager-loaded, the only non-lazy page) | `App.tsx:37,185` |
| `CityPage.tsx` | 21 | `shared/cities.ts` |
| `NeighborhoodPage.tsx` | 121 defined, **0 indexed** | `shared/neighborhoods.ts` (only 12 entries even set `indexed`, all 12 are `false`) |
| `GenericServicePage.tsx` | 12 routes (17 service entries total; some feed metadata only) | `shared/services.ts` |
| `ProblemPage.tsx` | 13 | `App.tsx:332-353` |
| `TireSizePage.tsx` | dynamic `/tires/:size`, 30 sizes prerendered | `App.tsx:389` |
| `TireBrandPage.tsx` | 5 | `App.tsx:215-219` |
| `CompareHub` + comparison pages | 1 hub + 14 | `App.tsx:431-445` |
| Bespoke single-route pages | ~15 (Brakes, Alignment, Diagnostics, TireFinderV2 at `/tires`, AutoRepairNearMe, MoesTireBridge ×4 aliases, SundayMuffler ×3 aliases) | `App.tsx` |
| Utility/account pages | ~20 (Contact, About, FAQ, Reviews, Blog, Guides, Booking ×2 routes, Financing, Fleet, Loyalty, CustomerPortal, MyGarage, three estimators, StatusTracker, InspectionReport, SharePage, PayInvoice, AreasServed, SiteMap, Careers, WomensSafety, Privacy, Terms) | `App.tsx` |

That's roughly **260 public routes.** Combined with the GSC evidence in §5, the conclusion is unambiguous: this is not a site short on URLs.

**Structured data — checked against current source, not the old doc.** Single emitter (`client/src/components/LocalBusinessSchema.tsx`), `@type: ["AutoRepair","TireShop"]`, one canonical `@id = /#localbusiness`. Two previously-reported bugs are **confirmed fixed in current code**, not just claimed fixed in a doc: duplicate `aggregateRating` (now gated behind an `includeReviews` flag that defaults `false`) and duplicate `WebSite` nodes (the sole surviving duplicate lives in `HomeLegacy.tsx`, which nothing imports — dead code, never rendered, harmless). An FAQPage block that was built into `CityPage.tsx` but never actually rendered was removed — a good call independent of the fix, since FAQ rich results no longer appear in Google Search at all (§4).

**The exact "duplicate neighborhood page" bug, named precisely.** `shared/neighborhoods.ts:426` defines `slug: "lakewood-auto-repair"` — identical to the Lakewood entry in `shared/cities.ts:53`. Because `App.tsx` registers the explicit `CityPage` route for that slug *before* the `NEIGHBORHOODS.map()` loop that would generate the `NeighborhoodPage` variant, and `wouter`'s `<Switch>` renders only the first match, the neighborhood version is **permanently shadowed dead code** — it can never render, independent of its `indexed` flag. Checking all 121 neighborhood slugs against all 21 city slugs found this is the *only* exact collision; several other neighborhoods share a city *name* with a differently-slugged city page (Beachwood, Mayfield Heights, Garfield Heights, Maple Heights, Parma Heights, Shaker Heights, Warrensville Heights, Bedford) without a literal routing collision — those are a softer content-cannibalization risk, already flagged internally, not a code bug.

**Sitemap/robots/canonical/prerender**, all verified against source: sitemap generated server-side per-request (`server/_core/index.ts:546+`), `lastmod` now honest (omitted for static routes, real `updatedAt` for DB-backed blog posts). `robots.txt` (`server/_core/robots.ts`) disallows private paths for all user-agents and hard-blocks known scrapers; an `ROBOTS_BLOCK_AI_TRAINING_CRAWLERS` switch to block `GPTBot`/`ClaudeBot`/`CCBot`/`Applebot-Extended`/`MistralAI-Training` exists and is fully wired but **defaults off** — currently nothing is blocked. That's a real business decision the operator hasn't consciously made either way (§24). Canonical tags are component-managed (`SEO.tsx`) and correctly removed on unmount. The tracked prerender snapshot is refreshed weekly by a GitHub Actions workflow (Mondays 08:00 UTC, manual dispatch available) — the workflow file itself documents a real open risk: it runs against the read-write production `DATABASE_URL` unless a not-yet-provisioned read-only credential exists. 404 handling correctly reads `req.originalUrl` inside an Express catch-all (a documented prior gotcha). None of this needs to be rebuilt; it needs the one missing credential and the AI-crawler decision.

**Built-but-not-wired, precisely** (the maturity-discipline framing the brief asked for):
- `ga4.ts`'s `trackPageView` is fully built, exported, and has **zero callers** anywhere except its own test. SPA client-side route changes currently fire no GA4 `page_view` — a real, confirmed measurement gap, cheap to close.
- `HomeLegacy.tsx` and `TireFinderLegacy.tsx` are complete, unrouted rollback references. Harmless; worth deleting for hygiene once nobody needs the rollback path.
- The legacy `trackPhoneClick` in `client/src/lib/analytics.ts` is `@deprecated`, dead in production, kept alive only because one test exercises it.
- The neighborhood `indexed: true` mechanism is fully wired end-to-end and currently used by nobody (0/121) — this reads as **discipline, not neglect**: the capability exists for the day a neighborhood page earns real content, and nobody has forced a page live without justification.

**Already-installed capability, verified directly from `package.json`** (not inferred): Radix UI primitives (24 packages), TanStack Query v5, tRPC v11, Framer Motion 12.23, lucide-react, react-hook-form 7.64 + Zod v4, wouter 3.7 (router — not React Router), Puppeteer 24.40 (drives the prerender pipeline), Sharp 0.35 (image processing), Tailwind CSS v4 (CSS-native `@theme` config, no `tailwind.config` file), Sentry (`@sentry/node` — error tracking already wired), Twilio 5.13 and Resend 6.10 (SMS/email already live, matching the "text the shop" link and "we text when it's done" copy), Stripe 21.0, `googleapis` 171.4 (backs a real `gsc:report` npm script that already pulls Search Console data programmatically), and `beasties` 0.5.3 (the maintained critical-CSS-inlining tool, already a devDependency — worth confirming it's actually wired into the build, since its presence alone doesn't prove it's active). This list matters directly for §23: most of what a generic report would tell you to "add" is already here.

---

## 4. Google/GSC/SEO: confirmed guidance vs. folklore `[WEB — verified this session against current Google Search Central documentation]`

**Confirmed, current, and load-bearing for this project:**

- **Local ranking runs on relevance, distance, and prominence** — Google's own stated framework, not a third party's. Prominence is built from how complete and accurate a business's information is (including on its own website), review signals, and links; distance isn't optimizable; relevance is served by matching real user intent with real page content. `[WEB]` Any "signal-weighting percentage breakdown" you see in industry roundups (e.g., "GBP signals 32%, on-page 19%...") is a practitioner correlation study, not Google-confirmed — useful directionally, not to be treated as ground truth.
- **FAQ rich results are gone.** They stopped appearing in Google Search on May 7, 2026; Google removed the FAQ search-appearance filter, the rich-result report, and Rich Results Test support in June; Search Console API support for it was removed in August. `[WEB]` FAQPage markup itself is still valid schema.org and won't cause errors — it just produces no visible SERP enhancement anymore. **Implication:** keep FAQs for real customers and for query coverage; stop treating FAQPage schema as a rich-result investment. Removing the unrendered FAQPage block from `CityPage.tsx` (§3) was the right call for the right reason even before this was confirmed.
- **Self-serving reviews cannot earn organic review stars.** Google's structured-data policy explicitly excludes `LocalBusiness`/`Organization` review/`AggregateRating` markup where the reviews are about your own business and collected on your own site — including via an embedded third-party widget. `[WEB]` This restriction does not apply to `Product` schema. **Implication:** Nick's homepage review display (real excerpts, "Yes, all real" disclaimer) is correctly built for *trust*, not for gaming stars — and no amount of markup engineering will make Google show organic stars for it. Don't spend engineering time chasing that; the `includeReviews`-gated `aggregateRating` in `LocalBusinessSchema.tsx` should stay off by default for exactly this reason.
- **`llms.txt` has no Google Search effect, confirmed by Google itself.** June 2026 Search Central documentation update: llms.txt files "do not help or hurt rankings" and aren't used for Google Search's AI features either. `[WEB]` Keep the file if something else consumes it; it is not a Google SEO lever. The repo's own internal guidance independently reached the identical conclusion ("do not expand llms.txt/ai.txt beyond the one generated file") `[REPO-doc]` — worth noting as a case where in-house judgment and later official guidance agreed.
- **Product/Offer structured data has a real, narrow use case.** Google's current guidance distinguishes product *snippets* (informational, no direct purchase) from *merchant listings* (purchasable, with required `price`/`priceCurrency`/`availability`/`condition`, and a diagnostics check that structured-data price must match what's shown on the page). `[WEB]` **Implication for §12:** Product/Offer markup is appropriate for individual tire SKUs with a real, live price and stock count — not for the `/tires` category page or a generic "used from $25" banner.
- **`AutoRepair` and `TireShop` are both real, more-specific schema.org types than generic `LocalBusiness`**, and Google's own guidance favors the most specific applicable type. `[WEB]` Nick's already uses both types together on one entity, which is a defensible, correctly-specific choice.

**Folklore or lower-confidence claims to actively resist:**
- There is no confirmed mechanism by which more indexed URLs, by themselves, improve local prominence. The 260-route/near-zero-impression reality in §5 is the empirical rebuttal to "more pages help."
- Treat any specific weighted-percentage local-ranking-factor breakdown as a correlation study, not Google-confirmed guidance, when citing it externally.

---

## 5. The biggest GSC opportunity — read the evidence, don't add more pages `[PARALLEL, partially corroborated]`

The operator's parallel research pass reported a page-family breakdown from the site's own GSC data that I have not re-pulled myself (Ahrefs' GSC/keyword tools returned "API units limit reached, 0 left" for this account when I tried — a real tooling constraint for this session, not a data gap on Nick's side; a live Ahrefs project for `nickstire.org` does exist, project ID `9619097`, owned by `nourdean22@gmail.com`, but with 0 rank-tracked keywords configured). The reported table:

| Page family | Routes | Routes with ≥1 impression | Zero-impression routes | 90d impressions | Clicks |
|---|---:|---:|---:|---:|---:|
| City | 21 | 11 | 10 | 9,742 | 31 |
| Neighborhood | 120 | 7 | 113 | 28 | 0 |
| Tire size | 30 | 4 | 26 | 54 | 1 |
| Problem pages | 13 | 0 | 13 | 0 | 0 |

I did **not** independently re-pull this from GSC this session, so it carries a `[PARALLEL]` tag — but it is strongly corroborated by evidence I *did* verify independently: the code-confirmed route counts above match almost exactly (121 neighborhood vs. reported 120; 30 tire-size matches exactly; 13 problem pages matches exactly), and it's directionally identical to the ledger's own independently-recorded finding from 2026-09-03 that whole-site clicks (~776) are dwarfed by impressions (~194k) concentrated on nationally-miscompeting "near me" queries for `/oil-change` and `/brakes`. Three independent evidence sources — a 2026-09-03 session, this table, and my own code audit — agree on the same conclusion: **the neighborhood and problem-page layers are functionally invisible to Google, and the code itself already treats them as not-ready-to-index.** Treat the specific numbers in the table as reported-not-reverified; treat the *conclusion* as high-confidence.

**What this means operationally:** don't build more pages in these two families. Before adding anything, run the actual current GSC pull (`pnpm run script gsc-report.ts` already exists — see §22) and classify every neighborhood and problem-page route as KEEP (real, distinct local content) / MERGE (fold into the owning city or service hub) / REDIRECT (301 to the best real destination) / prune. Given the code already shows 0/121 neighborhoods indexed and 0 problem pages with any impressions, the honest default for most of this layer is redirect-or-prune, not rescue.

---

## 6. Competitive/reference design study `[LIVE web research this session, via dispatched agent — see method notes below]`

Six real, currently-operating competitors in the Euclid/Cleveland-east-side market were identified and assessed from their live public sites (one, Firestone, blocked automated fetch and is assessed from secondary listings only): **Best Buy Tire & Automotive Service / Confident Tire** (Euclid location), **AutoCheck Complete Car Care** (same corridor, 21217 Euclid Ave), **Euclid Tire and Service** (est. 1960), **Firestone Complete Auto Care**, **Platinum Auto Inc**, and **Auto City Auto Repair & Detail**.

**The clearest, best-evidenced finding:** every competitor examined has a decent-to-strong real reputation (roughly 4.4–4.9 stars across the set, per third-party listings) that **none of them surface prominently on their own homepage.** Nick's "4.9 · 1,712+ Google reviews," shown above the fold with real excerpts, is a genuine and currently uncontested advantage in this specific market — not a cosmetic nicety, a real competitive gap. Firestone's chain-typical complaint pattern (pricing/upsell surprises, per aggregated third-party reviews) is close to a perfect match for what Nick's "written estimate — you don't pay until you say yes" promise already counters; that promise is well-aimed and should stay prominent, not be treated as generic trust copy to trim.

**Two transferable mechanisms worth stealing (not copying):**
1. Best Buy Tire's simple 4-step "How It Works" visual explainer, reducing first-visit anxiety for anyone unfamiliar with the shop's process.
2. AutoCheck's vehicle make/model photo gallery, functioning as an implicit "we work on your car" compatibility signal.

**Open competitive territory, confirmed by absence:** no competitor in this set runs a real, actively-maintained local content hub. Best Buy Tire's blog exists but reads stale (posts dated in the future — evidence nobody maintains it); the rest have none. A genuinely dated, shop-voice local content pipeline (brake-noise causes, tire-wear patterns, Ohio E-Check prep) is real white space, not a guess — and matches the informational-intent clusters in §9.

**One concrete, low-effort finding worth acting on directly:** a Facebook page at `facebook.com/nickstireeuclid`, titled "Moe's Euclid Tire & Auto," surfaced in this research. The URL slug strongly suggests this is **Nick's own legacy page**, not a competitor — carrying pre-rename branding. This is a small, real off-site NAP-consistency defect, independently corroborated by the repo's own documentation of a broader off-site identity problem (§3, §26): stale "Moe's"-branded listings persist on Yelp, BBB, and Birdeye even though the GBP itself is already correctly owned and updated. Fixing this Facebook page specifically, and auditing the other three, is cheap, real, and directly serves local prominence — with zero code involved.

---

## 7. Historical design principles worth stealing `[HIST]`

Four durable ideas outrank most 2026 trend-chasing for this specific brief:

- **Match the interface to the real world (Nielsen).** "Pull up," "drop keys," "stay in your car," "written estimate" are concepts the user already has; "Begin Your Automotive Journey" is not. The current copy already mostly does this — protect it against drift toward generic SaaS verbs.
- **Visibility of system status (Nielsen).** An auto shop has a genuine, literal system-status signal most businesses don't: OPEN/CLOSED, hours until close, bays free. Treating that as a first-class, always-visible UI element (as `ShopStrip` already does) is not decoration — it's exactly the heuristic Nielsen names, applied to a domain where it's unusually load-bearing.
- **Swiss/International Typographic Style.** Strong grid, sparse and disciplined palette, typography doing the communicative work, real photography over illustration, asymmetric layout used deliberately. The existing "EUCLID GRIT" direction (§8) is already reaching for this; the job is enforcing it, not replacing it.
- **Aesthetic minimalism / restraint (Nielsen; also the frontend-design studio principle "spend your boldness in one place").** Every competing promotional element weakens the ones that matter. The live homepage currently stacks a membership promo, status bar, hero, and multiple CTA clusters before the fold resolves — not broken, but worth testing a leaner top-chrome sequence (§14, Experiment A) rather than asserting it should simply be cut.

---

## 8. Ideal visual/design system — refine "EUCLID GRIT," don't replace it `[REPO facts + HIST + INFER synthesis]`

The repo already names and partially codifies a direction: **EUCLID GRIT** — industrial-editorial, anchored in real photography, explicitly rejecting glassmorphism, 3D/Spline scenes, variable-serif headlines, floating-island navbars, and generic SaaS chrome (`docs/DESIGN_PHILOSOPHY.md`). That's the right target. The job here is reconciling *declared* against *built*, and giving the existing system's strongest elements more room, per the frontend-design discipline of spending boldness in one place rather than distributing it across everything.

**Real, current tokens (verified in code, not proposed):**
- `brand-yellow #FDB913` · `brand-red #ef4444` (reserve red for true warnings/emergency only) · `bg-deep oklch(0.06 0.004 260)` (a near-black navy, not pure black) · `fg-primary #F5F5F5` · `fg-body #D4D4D4`.
- Forbidden, by the system's own rule: pure white/black, slate-grey, purple/violet or emerald-blue gradients, decorative (non-functional) yellow.
- Typography: **Barlow Condensed 700–900** for display/headings, **DM Sans** for body, **JetBrains Mono** for numbers (tire sizes, prices, status figures) — verified as the current live-code standard, superseding an older, vaguer "slab-grotesque" spec. The monospace-for-numbers choice reads as generic SaaS chrome in a vacuum; here it's motivated by a real subject-matter metaphor (shop tickets, invoices, tire-sidewall codes) and should be framed and used that way — sparingly, on numerals specifically, never as a body face.
- Shipped components worth protecting and extending, not reinventing: `ShopStrip` (the live open/closed+hours+address+phone bar), the written-estimate "ticket" block, Double-Bezel cards, a Magnetic Button micro-interaction, Eyebrow tags.

**One real, specific drift to fix, not a new rule to invent:** the design philosophy declares glassmorphism rejected; the Sept 2026 code audit found `backdrop-blur` used 56 times across 38 files. The audit's own verdict — reduce to ≤2 surfaces sitewide — is correct and already internally agreed; it just hasn't been enforced. This is the single highest-leverage "make the declared system real" fix available, because it's a search-and-reduce task against an already-agreed target, not a new design decision.

**What NOT to do, restated from the frontend-design discipline applied to this specific system:** don't add ALL-CAPS eyebrows to every card (use them only where they encode real information — "THE SERVICE" before a service name is fine because it's a real category label, not decoration); don't let JetBrains Mono migrate into anything but numerals; don't add gradient washes, generic rounded-card kits, or a fourth accent color. The existing constraint set is already correctly opinionated — the risk is dilution over time, not a wrong starting direction.

---

## 9. Page-by-page IA and page archetypes

Six archetypes cover the ~260-route site; new pages should be new *instances* of these, not new templates:

| Archetype | Job | Existing template(s) |
|---|---|---|
| Home | Route intent to the right next action | `Home.tsx` |
| Service | Answer one mechanical problem, end in a written estimate | `FocusedServicePage`-style (Brakes, Alignment, Diagnostics), `GenericServicePage` |
| Tires | Find a size, see an installed price, request or call | `TireFinderV2` at `/tires`, `TireSizePage`, `TireBrandPage` |
| Local | Capture real, demonstrated local/service-area intent | `CityPage` (keep), `NeighborhoodPage` (prune to justified entries only) |
| Guide | Answer one real customer question in the shop's own voice | `GuidePage` (exists; underused — see §6, §26) |
| Trust/Contact | Reviews, about, contact, warranty, financing | `Contact`, `About`, `Reviews`, `Financing`, `AreasServed` |

**Internal-link hierarchy** should route weight down from Home into the six service/tire hubs and a short list of real-demand cities, rather than every page linking laterally to dozens of siblings equally. `ProblemPage` (13 routes, 0 impressions per §5) is the clearest candidate for folding into Guide content or the owning Service hub rather than standing alone.

---

## 10. Homepage blueprint — desktop & mobile

**Mobile (protect what's shipped; refine sequencing):**
1. Nav (wordmark + menu)
2. `ShopStrip` — open/closed, hours, address→directions, phone (already shipped, keep exactly as the anchor of the whole page)
3. H1 — fix the accessible-name bug (§2); keep the copy
4. One-line proof (rating + review count + "open 7 days")
5. Primary CTA (`GET TIRES NOW`)
6. The three task cards (Something's wrong / Dropping off / Talk to a human)
7. *Then* — not before step 3 — the membership/promo band, so identity and the primary action resolve before any secondary offer competes for attention (Experiment A, §30)

**Desktop:** same information order, wider canvas used for the real storefront photo as hero background (already in use) plus room for the symptom-triage grid to sit in view without scrolling past the fold entirely — verify this doesn't currently require an unusually tall first screen at common desktop breakpoints.

A visitor should know **who, what, where, whether-open, why-trust, and what-to-tap** within the first screen, on both. The current build gets close to this; the main risk is offer/membership content competing with that sequence before it resolves.

---

## 11. Service-page blueprint

Reinforce the existing `FocusedServicePage`/`GenericServicePage` architecture rather than building a new template:
1. Service identity (e.g., "Brake Repair in Cleveland")
2. Immediate, concrete answer ("Free brake check. We show you the worn part and give you the written price before repairs start" — only where still operationally true)
3. Action cluster: call, directions
4. Symptom list specific to the service
5. What happens at Nick's, as a real numbered sequence (inspect → show customer → written estimate → customer approves → repair — this genuinely *is* a sequence, so numbering it is earned, not decorative, per §8's rule)
6. Real shop photography for that service, not stock
7. Pricing: exact where stable; otherwise "free check → written price," never a vague placeholder
8. Reviews relevant to that service where available
9. FAQ (useful content; no rich-result expectation per §4)
10. Related service links — only where genuinely relevant, not a full sibling list

---

## 12. Tires-page blueprint

The highest-value single page on the site (it's the destination of the homepage's primary CTA). Above the fold: a size search, framed the way the two dominant national players frame it (fitment/price-first) but running on Nick's actual inventory and installed pricing, not a lead-gen form. Each result should show size, condition (new/used), installed price, current stock, and what's included (mount/balance/valve stem) — and, per §4's verified structured-data guidance, **individual SKU-level results with real price and stock are exactly the case where `Product`/`Offer` markup is appropriate** — the category page itself should not carry it. Below the fold: new-vs-used education, the inspection standard, Sunday availability, payment/financing options (Acima framed correctly as lease-to-own, never "financing" — §24), and directions.

---

## 13. Contact/location/trust blueprint

Deliberately the simplest page on the site: identity, address, live open/closed state, call and directions as the only two primary actions, today's + full week's hours, the real storefront photo (a customer driving there should recognize the building before arriving — this makes the existing photography strategy functional UX, not branding), the cone/pull-up explanation, phone, rating, and the drop-off procedure. No new content is required here beyond what's already documented as existing; the job is making sure it's this focused, not adding to it.

---

## 14. Mobile call/directions/conversion system

Call and Directions should be treated with the same design weight local-service sites should give the equivalent of an ecommerce "Buy" button — which the current `ShopStrip` already does by keeping both persistently visible near the top. **Constraint, verified this session:** WCAG 2.2's Target Size (Minimum) success criterion (2.5.8, AA) requires interactive targets at least 24×24 CSS pixels unless adequately spaced from neighbors; a separate criterion (Focus Not Obscured, 2.4.11) requires that a sticky/fixed layer never fully hide a keyboard-focused control `[WEB]`. If the repo's internal standard is already a stricter 48×48px touch target (reported by the parallel pass; not independently re-confirmed against source this session), keep the stricter internal rule — it's appropriate for a mobile-heavy, often-on-the-move audience and already exceeds the accessibility minimum.

---

## 15. Typography / color / spacing / photo / icon / motion specification

- **Type:** Barlow Condensed 700–900 (display), DM Sans (body), JetBrains Mono (numerals only) — all verified current (§8). Keep line lengths under ~80 characters for body copy `[HIST]`.
- **Color:** the five verified tokens in §8; red reserved for genuine warnings.
- **Spacing:** the Sept 2026 code audit proposes an 8-point rhythm (48px mobile / 96px desktop section spacing) as a newer direction alongside the older ad-hoc Tailwind-class approach — treat the 8pt system as the target and migrate toward it deliberately, not as a already-finished fact.
- **Photography:** real storefront, bays, tire racks, the cone line, tools, vehicles on lifts — already the stated and largely-followed strategy (`Home.tsx` already ships responsive `<picture>`+`srcSet` hero images with `fetchPriority="high"` and explicit dimensions `[REPO]`). Continue preferring this over any stock imagery.
- **Icons:** `lucide-react`, already installed and in use — no new icon system needed.
- **Motion:** Framer Motion is already installed and in use for the Magnetic Button and card interactions. Per the frontend-design discipline: motion should answer a user action (opening, confirming, revealing) or be one deliberate orchestrated moment — not scattered fade-and-slide entrances on every section. Respect `prefers-reduced-motion` throughout, including for the hero letter-reveal animation once its accessible-name bug (§2) is fixed.

---

## 16. Reusable component inventory

Standardize around a small, named vocabulary rather than growing bespoke one-offs per page:

`ShopStrip` (shipped) · `SiteNav` (shipped) · `IntentRouter`/hero task cards (shipped) · `ProofLine` (reviews/rating strip) · `PrimaryAction` / `SecondaryAction` buttons · `RealPhotoHero` · `ServiceHero` · `PriceTicket` / `WrittenEstimateTicket` (shipped) · `TireSizeFinder` (`TireFinderV2`, shipped) · `ServiceProcess` (numbered sequence) · `SymptomGrid` (shipped, on Home) · `ReviewCluster` (shipped) · `DirectionsCard` / `HoursCard` (folded into `ShopStrip` + Contact) · `DropoffCard` / Uber-Lyft block (shipped) · `ServiceCrosslinks` · `FAQSection` (content only, no rich-result expectation) · `CallDirectionsBar`.

The point is not adding new components — it's confirming every page reuses these rather than drifting into bespoke variants, which is exactly how the glassmorphism drift in §8 happened.

---

## 17. Structured-data / entity / schema plan

Keep the current model: one canonical `LocalBusiness` entity (`@type: ["AutoRepair","TireShop"]`, `@id: /#localbusiness`) referenced by every page, rather than a distinct entity per location page — already correctly built (§3), and the right pattern per Google's preference for specific types over generic ones (§4). Service pages should carry `Service` schema scoped to `provider: /#localbusiness`, not a repeated business entity. FAQ content stays as content; `FAQPage` markup is harmless but produces no rich result anymore (§4). Reserve `Product`/`Offer` markup for individual tire SKUs with genuinely live price and stock (§12), never for the tires category page as a whole.

**Three live defects to fix, and the right remedy for each** (all found by literal-HTML fetch this session, §2):

1. **`aggregateRating` is inconsistent across pages sharing one entity ID.** Present on the homepage (numeric, complete, `reviewCount: 1700`); **absent entirely** on `/brakes`, `/oil-change`, `/alignment`, `/tires`, `/about`, `/cleveland-auto-repair` despite those pages reusing the same `#localbusiness` `@id`; and present on `/contact` in a third shape — string-typed values, missing `worstRating`, on an `AutoRepair` block with no `@id` at all.

   **The obvious remedy is wrong.** The instinct is to standardize it everywhere so the money pages become "eligible for review stars." They will not be, at any level of markup quality: Google's self-serving-reviews policy excludes `LocalBusiness`/`Organization` review and `AggregateRating` markup about your own business on your own site, including via embedded widgets — verified against current documentation this session (§4). No amount of consistency work produces organic stars here, and inconsistent-but-unenforced markup also carries a small manual-action risk.

   **The right remedy is to pick one of two coherent positions and apply it uniformly.** Either (a) **drop `aggregateRating` from the shared entity entirely** — it earns nothing in Google Search, and the visible review block on the page is doing the actual trust work — or (b) **keep exactly one numeric, complete, correctly-typed `aggregateRating` inside the `#localbusiness` node**, sourced from the same canonical value as the visible copy, for the benefit of non-Google consumers (AI assistants, other search engines, aggregators) that do read it. Option (a) is the smaller, safer change; option (b) is defensible if the operator wants the data machine-readable for AI crawlers, which the site already deliberately serves (§2, item 5). What is *not* defensible is the current state: three different answers to the same question on one site. Whichever is chosen, `/contact`'s untyped, `@id`-less block should be repaired or removed either way.

2. **Two conflicting `BreadcrumbList` blocks on `/cleveland-auto-repair`** — one trail via `/areas-served`, one flat with no item URL. Same defect class as the previously-fixed duplicate `WebSite` and `aggregateRating` nodes, just newly surfaced on breadcrumbs. Ship one.

3. **Breadcrumb depth varies across peer pages** — `/alignment` emits `Home → Services → Wheel Alignment`, while `/brakes`, `/oil-change`, `/tires` emit flat two-level trails with no URL on the final item. Pick the 3-level form and apply it to all service pages; it communicates the real hierarchy that §9's internal-link plan depends on.

---

## 18. Metadata / internal-link / content plan

Build one automated test that renders every important public route and asserts `<title>`, meta description, canonical, robots directive, `og:title`, `twitter:title`, H1, and the business-identity facts (phone/address/hours) all agree with the route registry (`shared/routes.ts`) — this directly prevents the exact class of bug the repo already documented once (a title change that only reached social metadata because the actual prerendered `<title>` came from a different source). Internal linking should concentrate weight from Home into the six archetype hubs and a short, real-demand city list, rather than the current pattern of many pages linking laterally to dozens of siblings with equal weight.

**Live metadata findings to fold into that test's assertions** (§2): titles and descriptions are genuinely unique across sampled URLs — including programmatic city pages — which is the hard part and is already working. Three length overruns are worth trimming: `/alignment`'s title runs 71 characters (past the ~60-char safe zone), and meta descriptions on `/oil-change` (166 chars) and `/parma-auto-repair` (175 chars) will likely truncate in results. Add length bounds to the test rather than fixing these three by hand.

**Sitemap structure needs consolidating.** `robots.txt` advertises four sitemaps, but `sitemap.xml` is a flat `<urlset>` — not a `<sitemapindex>` — that independently duplicates URLs also listed in `sitemap-services.xml` and `sitemap-locations.xml`. Of roughly 190 entries, only four carry `<lastmod>`. Make `sitemap.xml` a true index pointing at the child sitemaps, and populate `lastmod` broadly from real content-modification dates (the honest-`lastmod` work already done for blog entries shows the pattern — extend it rather than reinventing it).

**On the homepage H1 specifically:** the live audit correctly notes that `Pull up for tires. / Drop off for repairs.` carries no locality or service keyword, while every other page's H1 anchors one. **Do not "fix" this by keyword-loading the headline.** It is the single most distinctive asset on the site (§1, §29), the `<title>` already reads `Nick's Tire & Auto Cleveland · Tires & Auto Repair Euclid`, the subhead names Cleveland and Euclid Ave, `ShopStrip` shows the full address, and the `#localbusiness` entity carries the geo data — Google derives title links and topical understanding from multiple on-page sources, not the H1 alone. If anyone wants to test a locality signal here, test it in the **subhead**, and treat the H1 as protected.

---

## 19. Image/media strategy

The real photography already in `client/public/photos/` is the site's most defensible, hardest-to-copy visual asset — use it as evidence (storefront, bays, the cone line, tools, cars on lifts), not as decoration. Current delivery is already solid: WebP, responsive `<picture>`+`srcSet` with lazy-loading below the fold, and a correctly preloaded, `fetchPriority="high"` LCP hero image with an explicit code comment warning against a past regression (mismatched preload/`<picture>` sources once caused a 22× bandwidth waste — a real, previously-fixed incident, worth keeping as a regression-test case). The one real gap: **no AVIF** alongside WebP currently exists in code — a genuine, low-effort upgrade opportunity, not a rebuild.

---

## 20. Core Web Vitals / performance plan

Google's current "good" thresholds, at the 75th percentile, measured separately for mobile and desktop: **LCP ≤ 2.5s, INP ≤ 200ms, CLS ≤ 0.1** `[WEB — stable since INP replaced FID as a Core Web Vital]`. This session's own lab trace measured **CLS 0.00** on the live homepage — excellent, and worth defending during any redesign. Google's CrUX dataset currently has **no field data for this origin** (confirmed live this session), which means Nick's cannot currently see its own real-user LCP/INP at all — the right response is instrumenting first-party RUM (the `web-vitals` package is not currently installed, per direct `package.json` verification — a real, small addition, §23), not waiting for CrUX to accumulate enough traffic.

Two concrete, code-confirmed opportunities, both already on the team's own roadmap rather than new discoveries: **self-host fonts as WOFF2** (currently Google Fonts via preconnect+preload, with self-hosting explicitly named as an unbuilt Phase-2 item) and **confirm `beasties` (critical-CSS inlining, already a devDependency) is actually wired into the build**, since its presence doesn't prove it's active.

**Internal engineering budgets** (proposed by this report, not Google thresholds): mobile hero image target <200KB where visual quality survives; no autoplay video or embedded map above the fold; no third-party review widget required for initial paint (the current build already avoids this, using its own review data); defer non-essential analytics (already done — Meta Pixel/GA4/Ahrefs are deferred via `requestIdleCallback`, confirmed in code).

---

## 21. Accessibility plan

**P0, in priority order:** fix the H1 duplicate accessible-name bug (§2, a specific, confirmed, cheap fix) · exactly one semantic H1 per page · correct heading order · nothing conveyed by color alone · visible keyboard focus · sticky/fixed elements never obscure a focused control (WCAG 2.2, §14) · form labels and announced validation errors · honor `prefers-reduced-motion`, including for the hero letter-reveal · descriptive link/button names · alt text only where the image conveys real information (the current template pattern — "`{service} at Nick's Tire & Auto Cleveland`" — is a reasonable baseline, worth varying per-image where a photo shows something specific). Add `axe-core` to CI (not currently installed, §23) specifically because it would have caught the redundant-announcement class of bug that a 100/100 Lighthouse score missed.

---

## 22. Analytics / GSC / GBP measurement plan

The 30-event taxonomy already defined (`docs/analytics/EVENT-TAXONOMY.md`, backed by a real `customer_events` table) already covers the acquisition funnel well: `directions_click`, `sms_click`/`sms_quote_click`, `tire_search_submitted`, `tire_quote_cta_click`, `form_completed`, `financing_apply_click`, and the phone-click path (`trackPhoneClick` in `SEO.tsx`, which vibrates the device, fires `umami` + GA4 + Meta Pixel, and writes a server-side `call_events` row via tRPC — a real, already-built server-side call log, not just a client analytics ping). **The one confirmed, concrete gap: `trackPageView` is fully built and never called, so SPA-internal navigation currently under-reports pageviews to GA4** (§3) — wire it into the router's navigation handler; this is the single highest-value, lowest-effort analytics fix available. A `gsc:report` script already exists and pulls real Search Console data programmatically (`googleapis` is installed for exactly this) — schedule it to run regularly and feed the KEEP/MERGE/REDIRECT decision in §5, rather than relying on point-in-time manual pulls.

**Do not build:** a separate "SEO score" dashboard, scroll-depth or generic engagement scoring, or any metric that doesn't tie back to a call, direction request, tire request, or drop-off.

---

## 23. Open-source/repo catalog

Corrected against a direct read of `apps/nickstire/package.json` this session — most of what a generic report would propose adding is already installed:

| Resource | Decision | Why |
|---|---|---|
| Radix UI primitives (24 packages) | **KEEP** | Already installed; accessible low-level UI, MIT-licensed |
| TanStack Query, tRPC v11, react-hook-form + Zod, wouter | **KEEP** | Already installed and load-bearing |
| Framer Motion | **KEEP** | Already installed; sufficient motion capability |
| Puppeteer | **KEEP** | Drives the prerender pipeline already |
| Sharp | **KEEP** | Image processing already in place |
| `@sentry/node`, Twilio, Resend, Stripe | **KEEP** | Error tracking, SMS/email, payments already wired — not gaps |
| `beasties` (critical-CSS) | **KEEP, VERIFY WIRED** | Already a devDependency; confirm it's active in the build, don't reinstall |
| `web-vitals` | **WRAP — real gap** | Not installed; small, first-party, exactly closes the CrUX-field-data gap in §20 |
| `axe-core` | **WRAP — real gap** | Not installed; automates the class of bug found in §2 |
| Playwright | **BENCHMARK/WRAP — distinct from Puppeteer** | Not installed; Puppeteer already owns prerendering — Playwright's job here would be acceptance tests for the golden conversion paths (call, directions, tire search, drop-off), a different use case, not a replacement |
| `schema-dts` | **BENCHMARK, low priority** | Not installed; only worth adopting if `LocalBusinessSchema.tsx`'s manual typing starts causing real errors |
| Any Next.js/Astro rewrite | **REJECT** | No measured problem it solves; migration risk outweighs any theoretical gain against a stack this capable |
| A new component/design-system library (e.g. shadcn wholesale) | **REJECT** | Duplicates the 24 already-installed Radix primitives and would erase the existing, distinctive EUCLID GRIT identity |
| Generic carousel library | **REJECT** | `embla-carousel-react` is already installed if a carousel is genuinely needed |
| A dedicated map framework | **REJECT by default** | The existing first-party `Map.tsx` wrapper + a Google Maps deep-link is cheaper and faster than a heavier framework |
| A heavy third-party review widget | **REJECT** | The current build already avoids this; §4's self-serving-review policy makes it pointless for SERP stars, and it would only add render cost |

---

## 24. Exact technical implementation recommendations for the current stack

Everything above is implementable inside `apps/nickstire` as-is: a small design-token pass to close the declared-vs-built gap (§8's glassmorphism enforcement), the `trackPageView` wiring (§22), the H1 fix (§2), `web-vitals` + `axe-core` additions (§23), the `/booking` → `/drop-off` route (already proposed in the repo's own docs, not yet built), the shadowed `lakewood-auto-repair` route removal (§3), provisioning the read-only prerender DB credential (§3), and a conscious decision on `ROBOTS_BLOCK_AI_TRAINING_CRAWLERS` (currently off by default — a real business call about whether AI assistants should be able to train on or freely cite Nick's content, separate from anything Google-related). None of this requires a framework change, a new design system, or a rewrite.

**Financing/warranty language — use only these verified figures, and reconcile the open conflicts before publishing anything new:** Acima is legally a lease-to-own product and must never be called "financing," "credit," or "a loan"; real warranty terms, corrected against a printed invoice, are **12-month parts / 90-day labor, no road-hazard or mileage coverage unless written, used tires 7-day defect-only** (an older "36-month warranty" claim in some docs is superseded and wrong — do not use it). **CORRECTION — the used-tire price split is NOT a defect.** An earlier draft of this report listed the on-site "$25 select / $40-80 most sizes" figure versus the ~$60 quoted by phone/SMS/social as a pricing conflict requiring an owner decision, and put it in P0. That was wrong. `apps/nickstire/AGENTS.md` §5 states the two-tier structure is **deliberate**: *"Used-tire pricing is deliberately two-tier: web says 'from $25 installed (select 12-inch; most $40–80)', quoting channels say $60. Do NOT 'fix' either direction — both are intentional."* Leave both alone. The lesson generalizes: before filing a cross-channel inconsistency as a defect, check whether app policy already declares it intentional.

**One pricing item IS genuinely open:** the diagnostic fee. `docs/website-audit-status.md:71` records *"'you don't pay until you say yes' flagged against the $59.99 diagnostic fee for owner confirmation"* — i.e. the promise and the fee may read as contradictory to a customer, and that reconciliation is an owner decision, not an engineering guess. Also note the terminology rule from the same policy section: **"Payment Programs", never "financing"** — which the live top-nav label `Financing` currently violates, even though the route path itself can stay `/financing` for URL stability.

---

## 25. Anti-patterns — what NOT to build

Do not: build more neighborhood or problem pages before the GSC evidence in §5 is re-pulled and classified · resurrect the review-generation flywheel (explicitly declined by the operator, 2026-09-07 — do not re-propose it) · invest engineering time in FAQPage schema expecting a rich result (§4) · chase organic review stars via `aggregateRating` markup (§4) · treat `llms.txt` as a Google ranking lever (§4) · add a fourth accent color, gradient washes, or a generic rounded-card kit · let glassmorphism keep expanding past the audit's own ≤2-surface verdict · use "reservation," "scheduled," or "your spot is held" language anywhere on the public site — it's genuinely first-come-first-served, and that specific reversal already happened once in this repo's history (an April 2026 urgency-timer/reservation-copy wave was later reverted) — don't reintroduce it · fabricate scarcity, countdown timers, or fake "X people viewing" counters (a prior fake social-proof ticker, `FomoTicker`, was already found and removed — treat that as a settled precedent, not an open question) · name competitors in general site copy (the existing single comparison-hub page is the deliberate, narrow exception) · rewrite the framework, swap the router, or adopt a new component library without a measured problem forcing it.

---

## 26. Prioritized roadmap

**P0 — cheap, high-value, low-risk, do first:**
1. **Add a DNS record + 301 for `www.nickstire.org`** (§2) — currently a hard DNS failure for anyone using the `www` form
2. Fix the H1 duplicate accessible-name bug (§2)
3. Remove the duplicate `BreadcrumbList` on `/cleveland-auto-repair` (§17)
4. Wire `trackPageView` into route changes (§22)
5. Remove the shadowed dead `lakewood-auto-repair` route (§3)
6. Provision the read-only prerender DB credential (§3)
7. Fix the stray "Moe's"-branded `facebook.com/nickstireeuclid` page and audit Yelp/BBB/Birdeye for the same stale branding (§6)
8. Get an owner decision on the two conflicting pricing figures and propagate one canonical number everywhere (§24)
9. Decide the `aggregateRating` position — drop it or standardize one correctly-typed instance — and apply it uniformly (§17)

**P1 — real work, clear payoff:**
10. Re-pull GSC data via the existing `gsc:report` script and run the KEEP/MERGE/REDIRECT classification across all 121 neighborhood + 13 problem pages (§5)
11. Enforce the ≤2-glassmorphism-surface verdict sitewide (§8)
12. Add `web-vitals` (RUM) and `axe-core` (CI) — both confirmed absent, both cheap (§23)
13. Standardize breadcrumb depth across service pages; make `sitemap.xml` a true index and populate `lastmod` broadly (§17, §18)
14. Self-host fonts as WOFF2 (§20 — already on the team's own roadmap; prioritize it)
15. Build the `/booking` → `/drop-off` route + redirect (already proposed, not done, §3)
16. Test a leaner mobile top-chrome sequence — identity/status before promo (§10, Experiment A)
17. Add title/meta length bounds to the metadata test and trim the three current overruns (§18)

**P2 — real value, more design/eng time:**
18. Add the two transferable competitor mechanisms: a simple visual process explainer, a make/model compatibility gallery (§6)
19. Build a real, dated local content hub — the confirmed open competitive territory (§6, §9)
20. Replace the full-screen loading spinner on internal navigation with a shell that keeps `ShopStrip`/nav visible through the transition (§2)
21. Make a conscious call on `ROBOTS_BLOCK_AI_TRAINING_CRAWLERS` (§3, §24)
22. Add Playwright acceptance tests for the golden conversion paths (§23)

**P3 — worth doing, lower urgency:**
23. `Product`/`Offer` schema for individual tire SKUs with real live price/stock only (§12, §17)
24. Add AVIF alongside WebP (§19)
25. Confirm `beasties` is actually wired into the build (§20, §23)

---

## 27. Highest-leverage upgrades, ranked

| # | Upgrade | Expected value | Evidence strength |
|---:|---|---|---|
| 1 | **DNS + 301 for `www.nickstire.org`** | Every `www` link/typed address currently hard-fails; near-zero cost | `[LIVE]` — reproduced (`Could not resolve host`) |
| 2 | Fix H1 duplicate accessible-name | Screen-reader trust/professionalism | `[LIVE]` — directly reproduced twice, two methods |
| 3 | Wire `trackPageView` | Fixes real GA4 undercounting immediately | `[REPO]` — confirmed zero callers |
| 4 | Re-classify neighborhood/problem pages via fresh GSC pull | Stops effort on ~150 dead routes; may redirect real equity | `[PARALLEL]`+`[REPO]` corroborated |
| 5 | Fix off-site "Moe's" branding (incl. own Facebook page) | Local prominence, zero code | `[LIVE]`+`[REPO-doc]` two-source convergence |
| 6 | Resolve the `aggregateRating` three-way inconsistency | Removes conflicting machine-readable claims + manual-action risk | `[LIVE]` literal JSON-LD diff |
| 7 | Owner-resolve pricing/fee conflicts (phone/SMS vs site) | Removes a real trust risk | `[REPO]` — confirmed conflict in canon docs |
| 8 | Remove duplicate `BreadcrumbList` on `/cleveland-auto-repair` | Invalid conflicting structured data on a money page | `[LIVE]` literal JSON-LD |
| 9 | Provision read-only prerender DB credential | Removes a prod-write risk in a weekly automated job | `[REPO]` — the workflow's own comment flags it |
| 10 | Add `web-vitals` RUM | Closes a confirmed CrUX blind spot | `[LIVE]`+`[REPO]` |
| 11 | Enforce ≤2-glassmorphism-surface rule | Closes declared-vs-built drift, protects distinctiveness | `[REPO]` — audit's own numbers |
| 12 | Add `axe-core` to CI | Systematizes catching bugs like #2 | `[REPO]` gap confirmed |
| 13 | Self-host fonts (WOFF2) | LCP/render-blocking reduction, already planned | `[REPO]` roadmap item |
| 14 | `sitemap.xml` → true index + broad `lastmod` | Cleaner crawl signals; 4 of ~190 URLs carry `lastmod` today | `[LIVE]` fetched and counted |
| 15 | Ship visual process explainer + make/model gallery | Reduces first-visit anxiety, adds compatibility trust | `[LIVE]` competitor research |
| 16 | Build real local content hub | Fills confirmed, undefended competitive white space | `[LIVE]` competitor research |
| 17 | Smooth route-transition loading state | Keeps call/directions reachable during every navigation | `[LIVE]` reproduced |
| 18 | `/booking` → `/drop-off` route | Removes lingering "reservation" framing conflict | `[REPO]` proposed-not-built |
| 19 | Test leaner mobile top-chrome sequence | Faster path to primary CTA | `[LIVE]`+`[HIST]` (Nielsen minimalism) |
| 20 | Standardize breadcrumb depth across service pages | Consistent hierarchy signal for the §9 link plan | `[LIVE]` literal JSON-LD |
| 21 | Conscious AI-crawler-access decision | Closes an unmade business decision | `[REPO]` toggle confirmed dormant |
| 22 | Remove shadowed `lakewood-auto-repair` route | Code hygiene, zero SEO cost (dead already) | `[REPO]` precisely located |
| 23 | Playwright acceptance tests for conversion paths | Regression protection for calls/directions/tires | `[REPO]` gap confirmed |
| 24 | Product/Offer schema for real tire SKUs only | Matches confirmed Google guidance narrowly | `[WEB]` verified |
| 25 | AVIF alongside WebP | Incremental image-weight reduction | `[REPO]` confirmed absent |

---

## 28. Acceptance tests

**Mobile (375px):** business identity, open/closed state, phone, and directions visible without scrolling · exactly one H1, announced once by a screen reader · no horizontal overflow · every primary control meets WCAG 2.2's 24×24px minimum (48×48px if the stricter internal rule is confirmed) · sticky elements never obscure a focused control · hero image causes no layout shift · a `prefers-reduced-motion` user gets full functionality with no animation dependency.

**Desktop:** primary intent understood within 5 seconds · location/phone/status prominent without scrolling past a reasonable first screen · full keyboard navigation works end-to-end.

**SEO, per indexable route:** 200 status, correct `index,follow` or `noindex` per the route registry, self-referencing canonical, unique title/H1 (with length bounds: title ≤ ~60 chars, description ≤ ~155), correct sitemap membership, exactly one `BreadcrumbList` with consistent depth, at most one `aggregateRating` sitewide-consistent with the §17 decision, and valid prerendered content matching source (bot-UA **GET**, not HEAD — a documented existing trap; the `x-prerendered: true` response header is the assertion to make). Additionally: `www.nickstire.org` resolves and 301s to the apex. For any route redirected per §5/§26: 301, removed from sitemap, no remaining internal links, target genuinely preserves the original query intent (Google's own consolidation guidance explicitly supports redirecting to the real consolidated destination rather than a generic homepage `[WEB-consistent with confirmed canonicalization guidance]`).

**Conversion:** `tel:` fires and logs a `call_events` row · `directions_click` fires · tire search → request flow logs `tire_search_submitted` and `tire_quote_cta_click` · drop-off heads-up form logs `form_completed` · landing page, referrer, and device are preserved through to the logged event · no duplicate event firing on the same action.

---

## 29. Before/after design hypothesis

**Today:** distinctive, ambitious, and slightly over-expressive — multiple good ideas (offer, membership, status, hero, cones, Sunday hours, used-tire trust, symptom triage, reviews, drop-off flow, location, local links) competing for the same few seconds of attention. That is a materially better starting problem than a generic, empty site.

**The fix is subtraction, not addition.** A visitor should walk away remembering three things: **pull up, the price is clear before work starts, and Nick's is right there on Euclid.** Everything else on the site should visibly support one of those three, not compete with them.

---

## 30. Experiments

Run one-variable tests; do not redesign five things and guess which one moved the number. Every experiment needs a pre-registered primary metric, guardrails, a minimum useful effect size, and an explicit rollback trigger before it starts — and given this site's real traffic volume (~776 clicks/5.5mo per §1), treat statistical power honestly: most tests here will read as directional evidence, not textbook-significant results, and should be labeled that way when reported.

- **Experiment A — top-chrome sequencing.** Control: current promo+membership+status stack. Variant: `ShopStrip`+nav only, with promo moved below the hero. Primary metric: primary-CTA click rate. Guardrail: membership-CTA conversions must not collapse.
- **Experiment B — hero subline.** The repo already has live experiment infrastructure for the hero tire subline, per the operator's parallel pass — finish reading that result before launching any new hero-copy test; don't run two overlapping hero experiments at once.
- **Experiment C — service CTA wording.** "PULL UP TODAY" vs. "CALL FOR A LIVE ANSWER," by service family.
- **Experiment D — review-proof placement.** Directly under the primary CTA vs. its current position.

---

## 31. North Star

```
SEARCH → the exact useful page → immediate Nick's identity → real shop, real location
→ a clear mechanical or tire answer → real proof → one obvious next move
→ CALL / DIRECTIONS / TIRES / DROP OFF → a car at the shop
```

Visually: the actual Euclid Avenue storefront, safety yellow and shop navy, condensed industrial type, real photography, a disciplined grid, big mobile actions, and very little decorative noise. Structurally: fewer URLs carrying more real information each, backed by genuine local evidence, connected to live pricing and inventory where it exists, measured against the site's own GSC data rather than assumption. Operationally: first-come, pull up, drop off, written estimate, call a human — the actual way the shop runs, never obscured by borrowed scheduling language from businesses that work differently.

The mistake to avoid is the one the evidence in this report already rules out: sanding Nick's down into a generic tire-chain template with a different logo. The raw material for something better is already built. The work is enforcement, subtraction, and closing the small number of gaps this report found and verified — not a redesign.
