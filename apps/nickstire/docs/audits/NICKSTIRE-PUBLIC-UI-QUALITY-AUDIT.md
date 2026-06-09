# Nick's Tire — Public UI / Conversion / SEO Quality Audit

_2026 public-UI-quality pass · branch `nickstire-public-ui-quality-pass` (from origin/main `5c1c1951`)._
_Method: 6-cluster multi-agent read-only code audit (10 agents, 47 raw findings, adversarially verified) + live mobile audit on a real 390px device emulation (Home, /brakes, /used-tires-cleveland, /contact) with console + network capture. Scope: customer-facing public site only. No admin, no backend, no migrations._

> Standing rule used as the honesty baseline: `shared/business.ts` is the single source of truth. Every public claim was checked against it.

---

## 1. Route inventory (clusters)

The public surface is ~200+ routes; templated families are audited once at the template level.

| Cluster | Key routes | Component(s) | Intent | Primary CTA | Trust proof | Mobile | SEO | Score | Notes |
|---|---|---|---|---|---|---|---|---|---|
| Home + shared chrome | `/` | Home.tsx, PageLayout, SiteNavbar, SiteFooter, SiteMobileCTA, StickyTrustBar | tire purchase / repair / near-me | CALL NOW + GET DIRECTIONS (hero) + sticky Call/Text/Directions bar | 4.9-star, 1,700+, Open Now bar, real storefront photo | sticky CTA bar (scrollY>400), no overflow | strong unique title/H1 | 8/10 | hero CTAs dark-on-dark (minor); thumb-zone widget stack |
| Primary services | `/brakes` `/diagnostics` `/alignment` `/synthetic-oil-change` `/tires` (+GenericServicePage x11) | hand-built + GenericServicePage | brake/diag/maint/tire | Call + Schedule | "free check / written quote / no pay til yes" | phone above fold, no overflow | strong intent titles, warranty 12mo correct | 8/10 | long-tail generic pages lack conversion overlays (content) |
| Core trust/info | `/about` `/contact` `/reviews` `/faq` `/services` `/areas-served` | About, Contact, ReviewsPage, FAQ, ServicesOverview, AreasServed | trust / contact / coverage | varies | reviews, map embed, hours, NAP | map+hours+address present | FAQPage/AEO surface | 7/10 | ASE wording normalized, $25 band added, areas-served CTAs added |
| High-intent SEO | `/tire-shop-near-me` `/auto-repair-near-me` `/no-credit-check-tires-cleveland` `/used-tires-cleveland` `/new-tires-cleveland` `/tire-repair-cleveland` `/wheel-alignment-cleveland` `/check-engine-light-diagnostic` + brand/compare x14 | dedicated pages + TireBrandPage + compare/* | near-me / used/new tire / financing | Call/Schedule | $25 band+fineprint live, $10-down | no overflow | intent-matched | 8/10 | $10-down congruence varies (low) |
| Templated SEO | City x22, Neighborhood x61, Problem x13, TireSize x30, Seasonal x2 | CityPage, NeighborhoodPage, ProblemPage, TireSizePage, SeasonalPage | local / problem | Call/Schedule | LocalBusiness schema | -- | unique-enough meta, registry-aligned | 7/10 | no critical SEO regressions found |
| Conversion / forms | `/appointment` `/booking` `/pricing` `/estimate` `/cost-estimator` `/financing` `/diagnose` | BookingWizard, estimators, DiagnosePage | booking / quote / financing | form submit | -- | -- | noindex transactional | 6/10 | tracking/attribution gaps (HOLD) |

Route-registry integrity: `shared/routes.ts` <-> `App.tsx` aligned; `pnpm validate:routes` passes. No routes added/removed in this pass.

---

## 2. Findings by evidence type

### Live-observed (real 390px device)
- **FomoTicker renders fabricated fallback** social proof when same-day activity is empty (invented bookings + invented 5-star review quotes). [FIXED]
- `net::ERR_FAILED` x2 on Home = **blocked third-party trackers** (`connect.facebook.net/fbevents.js`, `gtag G-B1LJ1P43G8`, `analytics.ahrefs.com`) -- not a first-party asset. [DOC]
- Google Fonts **preloaded-but-unused** warnings (`display=optional`) -- benign, non-blocking. [DOC]
- Mobile: no horizontal overflow on any page; hero CALL NOW + GET DIRECTIONS present (low contrast on dark photo); sticky Call/Text/Directions bar appears on scroll; used-tire `$25` carries fineprint+band live; warranty "12-month" live.

### Repo-verified
- `FomoTicker.tsx:25-36` hardcoded `FALLBACK_ENTRIES` (fabricated) vs `server/routers/public.ts:166-261` `activity.recent` which is **honest** (real bookings/invoices/4+-star reviews). [FIXED]
- `LiveVisitorCounter.tsx` is **honest** -- hides when real count < 3, never fakes. (Correct pattern; FomoTicker now mirrors it.)
- `ServicesOverview.tsx:243` "ASE" trust pillar + `DiagnosePage.tsx:805` / `LaborEstimator.tsx:532` ("ASE-trained") + `Careers.tsx:66` (hiring nice-to-have). **[VERIFIED BUSINESS FACT -- see section 6]** Owner confirmed ASE-certified capability; wording normalized to precise "ASE-certified", centralized in `business.ts` (`ase`). [FIXED]
- `FAQ.tsx:83` + `Home.tsx:274` bare/partial `$25` missing the `$40-80` band that `business.ts:172-177` requires on every public $25. [FIXED]
- `AreasServed.tsx:185-196` only CTAs were Schedule Drop-Off + Contact Us -- no call/directions for near-me intent. [FIXED]

### Code-inferred
- `PageLayout.tsx:56-67` mounts SiteMobileCTA + FomoTicker + UrgencyWidget + StickyTrustBar -- bottom-zone widget density. (FomoTicker now hides when no real data, reducing it.)
- Conversion forms (LeadPopup, estimators, Contact, SiteMobileCTA) have UTM/GA4/Meta-Pixel/CAPI attribution gaps. [HOLD -- tracking boundary]

### Unknown -> resolved
- Whether any technician holds valid **ASE certification** -- **RESOLVED: owner confirmed ASE-certified capability** (this pass).

---

## 3. False alarms disproven (verify-don't-trust)
1. **StickyTrustBar "Opens at" off-by-one** -- FALSE; `StickyTrustBar.tsx:34` already returns "Opens at 9 AM" correctly for Saturday->Sunday.
2. **AlignmentPage "financing pushes CTA below fold"** -- OVERSTATED; the Call+Schedule pair sits above the financing banner.
3. **"No above-fold mobile CTA on Home"** (initial live read) -- WRONG; CALL NOW + GET DIRECTIONS exist in the hero (dark-on-dark).
4. **"No Call/Text/Directions sticky bar"** (initial live read) -- WRONG; timing false-negative, the bar appears on scroll (`SiteMobileCTA.tsx`).

---

## 4. Top ranked issues + classification

| # | Issue | Trust | Conv | Mobile | SEO | Class | Disposition |
|---|---|---|---|---|---|---|---|
| 1 | FomoTicker fabricated fallback (fake bookings + fake reviews) | High | Med | Low | -- | SAFE | **BUILT** |
| 2 | Bare `$25` w/o `$40-80` band (FAQ + Home) -- bait-and-switch / moat | High | Med | -- | Med (AEO) | SAFE | **BUILT** |
| 3 | "ASE" wording precision (4 locations) | High | -- | -- | Med | **VERIFIED FACT** | **BUILT (normalized)** |
| 4 | /areas-served no call/directions (near-me intent) | -- | Med | High | Med | SAFE | **BUILT** |
| 5 | Conversion form/tracking attribution gaps | -- | Med | -- | -- | HOLD | tracking session |
| 6 | `net::ERR_FAILED` x2 | -- | -- | -- | -- | DOC | blocked 3rd-party trackers |
| 7 | Fonts preload-unused | -- | -- | -- | Low | DOC/CAREFUL | benign; LCP risk to fix |
| 8 | Thumb-zone widget stacking | -- | Low | Med | -- | DOC | no proven overlap; #1 reduces it |
| 9 | Long-tail GenericServicePage no conversion overlays | -- | Low | -- | Low | CAREFUL | content wave |
| 10 | `$10-down` financing congruence varies | -- | Low | -- | Low | SAFE | later copy pass |

---

## 5. What was built (4 SAFE fixes)

1. **FomoTicker honesty** -- removed the fabricated `FALLBACK_ENTRIES` (invented bookings + invented 5-star review quotes); the ticker now shows ONLY real `activity.recent` and hides when there is none (mirrors LiveVisitorCounter). New pure `client/src/components/fomoEntries.ts` (`resolveFomoEntries`, never fabricates) + unit test. Files: `FomoTicker.tsx`, `fomoEntries.ts`, `fomo-entries.test.ts`.
2. **Used-tire `$25` price proof** -- both bare floors now read "used tires from $25 installed on select 12-inch sizes (most run $40-80 installed)", carrying the qualifier + band `business.ts:172-177` mandates (FTC honesty + 4.9-star-moat protection). Keeps the $25 hook, removes the bait-and-switch. Files: `FAQ.tsx:83`, `Home.tsx:274`. (Adversarially verified: FAQ answer is a plain string, not schema-generator input.)
3. **/areas-served call + directions CTAs** -- replaced the low-value "Contact Us -> /contact" hop with `Call (216) 862-0005` (primary) + `Get Directions` (Google Maps), kept Schedule Drop-Off; reuses existing `BUSINESS` constants + button classes. File: `AreasServed.tsx:185-196`.
4. **ASE wording normalization** -- owner confirmed ASE-certified capability. Centralized the verified fact in `business.ts` (`ase: { certified, display: "ASE-certified technicians", short: "ASE-certified", capability }`, with a precise/no-overclaim comment). Normalized the 3 customer-facing surfaces to precise wording: `ServicesOverview.tsx:244` pillar subtitle -> `{BUSINESS.ase.display}` ("ASE-certified technicians"); `DiagnosePage.tsx:805` + `LaborEstimator.tsx:532` "ASE-trained" -> "ASE-certified". `Careers.tsx:66` left unchanged (it is an accurate hiring nice-to-have, not a customer credential claim). No "all technicians", no "Master ASE", no counts or names. Files: `shared/business.ts`, `ServicesOverview.tsx`, `DiagnosePage.tsx`, `LaborEstimator.tsx`.

---

## 6. ASE certification -- VERIFIED BUSINESS FACT

**Owner confirmed ASE-certified capability. Wording normalized to avoid overclaiming.**

Disposition: the original audit flagged "ASE" as an unsupported credential (it was not in `business.ts`). The owner confirmed the shop has ASE-certified technician capability, so ASE is a real, defensible trust signal and was **kept** (not removed). To stay precise and defensible, all customer-facing references were normalized to "ASE-certified" / "ASE-certified technicians" and centralized in `business.ts` (`ase`). Guardrails encoded in the constant's comment: no "all technicians are ASE certified" (unproven), no "ASE Master Certified" (unproven), no certification counts or names. `Careers.tsx` keeps "ASE certification (one or more areas)" because that is an accurate hiring qualification, not a shop credential claim.

## 7. What stayed HOLD / DOC (and why)

- **Conversion form/tracking attribution [HOLD]:** UTM/GA4/Meta-Pixel/CAPI gaps are real but every fix is a tracking-pipeline change -- an explicit hard boundary for this session. Route to a dedicated tracking session.
- **net::ERR_FAILED [DOC]:** blocked third-party trackers, not a first-party asset; loads fine in real customer browsers. No fix.
- **Fonts preload-unused [DOC/CAREFUL]:** `display=optional` fonts are non-blocking; the wasted preload is minor and touching the head font setup risks the carefully-tuned prerender LCP. Avoid perf theater; defer to a measured perf pass.
- **Thumb-zone stacking [DOC]:** no overlap proven at the measured scroll positions; the FomoTicker hide-when-empty change already reduces bottom-zone density.

---

## 8. Future roadmap (operator's call)
1. Dedicated **tracking/attribution** session: UTM capture + GA4/Meta-Pixel/CAPI on lead + estimator forms + the mobile CTA bar.
2. **Content wave:** conversion overlays (anchorTable/fearStats) for long-tail GenericServicePage services; `$10-down` financing congruence across financing-eligible pages.
3. **Measured perf pass:** font preload/`display` review with before/after LCP traces (not blind).
4. Off-site **SEO authority** program for /brakes /diagnostics ranking depth (multi-month, out of UI scope).

---

_All builds: UI-owned, repo-verified, no migration / backend / route-registry / form-behavior / tracking change. Verified: tsc 0 · unit + smoke green · build green. Not pushed pending operator approval._
